import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { confirmationMail, emailConfigured, sendMail } from "../_shared/email.ts";

// ============================================================================
// waitlist-signup — the endpoint behind the waiting list on the Vaylo website
// ----------------------------------------------------------------------------
// The waiting list is public and unauthenticated, which makes it the most
// abuseable endpoint in this project. Everything below exists because of that.
//
//   1. rejects anything that is not a POST
//   2. drops honeypot submissions, answering exactly as a success would
//   3. validates the fields a human can actually fill in
//   4. rate-limits per client address, durably (counted in Postgres, not in
//      this isolate's memory — see the note on RATE_LIMIT)
//   5. inserts with the service role
//
// What it deliberately does NOT do:
//
//   * reveal whether an address is already on the list. A "you are already
//     signed up" response turns this into an oracle for "does this person have
//     a Vaylo account", so a new signup and a repeat return the same answer.
//   * return a position or a total. There is no queue to have a place in; a
//     number would imply an order of service that does not exist.
//   * send a confirmation to a repeat signup. A confirmation goes out only for
//     a row that was actually inserted; the upsert returns no rows when the
//     address already exists, so a double click cannot produce a second "you
//     are on the list" message.
//   * accept a self-service removal. An endpoint that deleted a row for any
//     address typed into it would be an enumeration oracle and a way for one
//     person to remove another; removal goes through the Contact form.
// ============================================================================

/** Closed set. Must stay identical to waitlist_signups_source_check. */
const SOURCES = ["web", "home", "play", "share", "qr"] as const;
type Source = (typeof SOURCES)[number];

/**
 * Signups from one client address per hour.
 *
 * Counted in Postgres rather than in this isolate's memory, because Supabase
 * runs several instances of a function and recycles them: an in-memory counter
 * resets on a cold start and is not shared between instances, so it turns away
 * a flood on one box and not at all on the next. It is also the only durable
 * bound on a table anybody can write to.
 */
const RATE_LIMIT = 5;

/**
 * Deliberately permissive but structural: enough to catch a typo, not so much
 * that a legitimate address with an unusual TLD is rejected. The only real
 * validation of an email address is delivering to it.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Salted hash of the client address, for rate limiting and abuse investigation
 * only. Not a user identifier, and not reused for anything else.
 */
async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * The single response body, used for every accepted signup.
 *
 * One string, not two. Any difference between "new" and "already on the list"
 * is an oracle, so there is nothing to branch on.
 */
const ACCEPTED = {
  ok: true,
  message: "You are on the list.",
};

/**
 * Run work after the response has been sent.
 *
 * The signup is already stored by this point, so a slow mail server must not
 * hold the caller's request open — and must not turn a successful signup into a
 * timeout that the person responds to by submitting again. EdgeRuntime.waitUntil
 * keeps the isolate alive for the send without blocking the reply; where the
 * runtime does not offer it the send is still started, just not awaited.
 */
function background(task: () => Promise<void>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
    .EdgeRuntime;
  const started = task().catch((error) => {
    console.error("waitlist confirmation failed", String(error).slice(0, 200));
  });
  if (runtime?.waitUntil) {
    runtime.waitUntil(started);
    return;
  }
  void started;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed", message: "Please use the form on this page." }, 405);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json", message: "The request could not be read." }, 400);
  }

  // ---------------------------------------------------------------------------
  // Honeypot
  //
  // A real person never sees this field — it is hidden from sight and from the
  // accessibility tree — so leaving it empty is the only thing a browser can do.
  // A bot that fills every input it finds gives itself away.
  //
  // On a hit we answer exactly as we would on a success. A rejected bot that
  // gets an error learns the trap exists and stops tripping it, and one bot per
  // attempt is a nuisance an attacker can iterate against.
  // ---------------------------------------------------------------------------
  if (typeof payload.company_website === "string" && payload.company_website.trim() !== "") {
    return json(ACCEPTED);
  }

  const email = clean(payload.email, 320);
  if (!email || !EMAIL_RE.test(email)) {
    return json(
      { error: "invalid_email", message: "Please enter an email address we can contact you at." },
      400,
    );
  }

  const displayName = clean(payload.display_name, 120);
  const sourceRaw = clean(payload.source, 20);
  // An unknown source is coerced to 'web' rather than rejected: a stale link
  // carrying a new campaign name should still register the person, and the
  // database constraint keeps the stored value inside the closed set either way.
  const source: Source = SOURCES.includes(sourceRaw as Source) ? (sourceRaw as Source) : "web";

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---------------------------------------------------------------------------
  // Rate limit
  //
  // Counted against the table itself, which is the only store every instance of
  // this function shares. It counts this address's recent signups rather than
  // rejected attempts, so a person who typos their email a few times is not
  // locked out by their own mistakes.
  // ---------------------------------------------------------------------------
  const salt = Deno.env.get("WAITLIST_IP_SALT") ?? "vaylo-waitlist";
  const ipHash = await hashIp(clientIp(req), salt);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count } = await admin
    .from("waitlist_signups")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gt("created_at", since);

  if ((count ?? 0) >= RATE_LIMIT) {
    return json(
      {
        error: "rate_limited",
        message: "You have joined several times recently. Please try again later.",
      },
      429,
    );
  }

  // ---------------------------------------------------------------------------
  // Store
  //
  // Lower-cased, because "A@b.com" and "a@b.com" are one inbox and the unique
  // index has to agree with that or one person gets two rows.
  //
  // onConflict: ignoreDuplicates is what makes a double click, a flaky network
  // and a resubmit all land as one person rather than as a rate-limit hit on
  // somebody's second attempt. The response is identical either way, so this
  // cannot be used to test whether an address is already registered.
  // ---------------------------------------------------------------------------
  // `.select()` is what makes the confirmation safe to send: with
  // ignoreDuplicates a duplicate collides and returns NO rows, so an empty
  // result is "this address was already here" and a one-row result is a genuine
  // new signup. Without it there is no way to tell the two apart, and a repeat
  // click would send a second confirmation.
  const { data: inserted, error } = await admin
    .from("waitlist_signups")
    .upsert(
      {
        email: email.toLowerCase(),
        display_name: displayName,
        source,
        ip_hash: ipHash,
        user_agent: clean(req.headers.get("user-agent"), 300),
      },
      { onConflict: "email", ignoreDuplicates: true },
    )
    .select("email, display_name, unsubscribe_token");

  if (error) {
    // Never echo the database's message: it can name the constraint or the
    // column, which is a map of the table for anyone probing it.
    console.error("waitlist insert failed", error.code);
    return json(
      {
        error: "insert_failed",
        message: "Something went wrong on our side and nothing was saved. Please try again.",
      },
      500,
    );
  }

  // ---------------------------------------------------------------------------
  // Confirmation email
  //
  // Sent after the reply, for a genuinely new row only. The row is already
  // stored, so a mail failure must not fail the signup: it leaves
  // confirmation_sent_at null, which is a visible "not sent" rather than a
  // silent assumption that it went.
  // ---------------------------------------------------------------------------
  const created = inserted?.[0];
  if (created) {
    background(async () => {
      if (!emailConfigured()) {
        // Not an error: the list still works, it simply does not mail yet. The
        // page says so rather than promising a message that cannot be sent.
        console.warn("waitlist confirmation skipped: email is not configured");
        return;
      }
      await sendMail(confirmationMail(created));
      await admin
        .from("waitlist_signups")
        .update({ confirmation_sent_at: new Date().toISOString() })
        .eq("email", created.email);
    });
  }

  return json(ACCEPTED);
});