import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailConfigured, gmailUser, sendMail, withFooter } from "../_shared/email.ts";
import { jwtRole } from "../_shared/jwt.ts";

// ============================================================================
// waitlist-broadcast — send one message to everyone still on the waiting list
// ----------------------------------------------------------------------------
// This is the endpoint that mails real people, so it is the one that has to be
// hardest to call by accident.
//
//   * POST only. A GET that mailed the whole list would be triggered by any
//     crawler that found the URL.
//
//   * Service-role only. This function is never called from a browser: it is run
//     deliberately by the operator, who is the only holder of that credential.
//     It is not "admin JWT" gated, because an admin session in the app is a
//     token that lives in a browser and can be replayed; the service key never
//     leaves the server side. If this is ever wired to the dashboard it needs
//     its own deliberate auth decision, not a shortcut here.
//
//     How the check works, because the obvious version is wrong. The first
//     version of this compared the bearer token to
//     Deno.env.SUPABASE_SERVICE_ROLE_KEY for equality and returned 403 to the
//     real service key — a project now issues a legacy JWT and a newer
//     sb_secret_* key, and the runtime does not necessarily inject the same one
//     the CLI prints. Comparing two representations of "the same" credential is
//     a trap, so this does not compare them at all.
//
//     Instead it relies on two things that are each already true: the gateway
//     has verify_jwt enabled for this function, so it has already rejected any
//     token not signed by this project; and the token's own `role` claim says
//     what it is. Reading the claim is therefore reading a verified fact, not
//     trusting caller input. An anon or publishable key carries role `anon` and
//     an app session carries `authenticated`; only the service key carries
//     `service_role`. The equality check against the env var is kept as well,
//     because it still holds when the injected value is the legacy JWT.
//
//   * Batched. Sending is a TLS handshake and a full SMTP conversation per
//     recipient, so one call cannot mail an unbounded list before the request
//     times out. `limit` caps the batch and the response reports how many are
//     left, so a large list is a sequence of calls with a visible count rather
//     than a single call that silently half-succeeds.
//
//   * Every message carries its own unsubscribe link, generated per recipient
//     from that row's token — never a shared one, which would let one person
//     remove another.
// ============================================================================

const BATCH_DEFAULT = 40;
const BATCH_MAX = 100;

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bearer(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * The `role` claim of a JWT the gateway has already verified.
 *
 * Returns "" for anything unparseable. The signature is NOT checked here and
 * does not need to be: verify_jwt on this function means an unsigned or
 * foreign-signed token never reaches this code at all.
 */
function roleOf(token: string): string {
  // The base64URL translation and padding live in ../_shared/jwt.ts. This file
  // was the only place that had them right, and it is not a good place to keep
  // them: the two functions that needed the same decode (delete-account,
  // export-my-data) had it wrong, and one shared reader is the fix for all of
  // them rather than a third copy.
  return jwtRole(token);
}

function authorised(req: Request, serviceKey: string): boolean {
  const supplied = bearer(req);
  if (!supplied) return false;
  if (supplied === serviceKey) return true;
  return roleOf(supplied) === "service_role";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return json({ error: "server_not_configured" }, 500);
  if (!authorised(req, serviceKey)) return json({ error: "forbidden" }, 403);

  let payload: {
    subject?: unknown;
    html?: unknown;
    text?: unknown;
    limit?: unknown;
    dry_run?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const subject = typeof payload.subject === "string" ? payload.subject.trim().slice(0, 160) : "";
  const bodyHtml = typeof payload.html === "string" ? payload.html.slice(0, 200_000) : "";
  const bodyText = typeof payload.text === "string" ? payload.text.slice(0, 100_000) : "";
  const dryRun = payload.dry_run === true;

  if (!subject || (!bodyHtml && !bodyText)) {
    return json(
      { error: "missing_content", message: "subject and at least one of html/text are required" },
      400,
    );
  }

  const limitRaw = Number(payload.limit ?? BATCH_DEFAULT);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), BATCH_MAX)
    : BATCH_DEFAULT;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // Everyone who has not left. Newest last, so the longest-standing signups are
  // mailed first if a list takes several batches.
  const { data, error } = await admin
    .from("waitlist_signups")
    .select("email, display_name, unsubscribe_token, created_at")
    .is("unsubscribed_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("broadcast list failed", error.code);
    return json({ error: "list_failed" }, 500);
  }

  const all = data ?? [];

  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      recipients: all.length,
      from: gmailUser(),
      email_configured: emailConfigured(),
      limit,
    });
  }

  if (!emailConfigured()) {
    return json(
      {
        error: "email_not_configured",
        message: "GMAIL_USER and GMAIL_APP_PASSWORD are not set for this project.",
      },
      500,
    );
  }

  const batch = all.slice(0, limit);
  const failures: string[] = [];
  let sent = 0;

  // Sequential, not parallel. Gmail rate-limits per connection and per second,
  // and a burst of parallel SMTP conversations from one address is what gets an
  // account throttled or blocked.
  for (const row of batch) {
    const footer = withFooter(bodyHtml, bodyText || subject, row.unsubscribe_token);
    try {
      await sendMail({
        to: row.email,
        subject,
        text: footer.text,
        html: bodyHtml ? footer.html : undefined,
        unsubscribeUrl: footer.link || undefined,
      });
      await admin
        .from("waitlist_signups")
        .update({ last_emailed_at: new Date().toISOString() })
        .eq("email", row.email);
      sent++;
    } catch (failure) {
      // One bad address must not stop the run. The address itself is not echoed
      // into the log beyond what is already in the table, and the failure list
      // is returned to the caller, who is the operator.
      failures.push(row.email);
      console.error("broadcast send failed", String(failure).slice(0, 200));
    }
  }

  return json({
    ok: failures.length === 0,
    sent,
    failed: failures.length,
    failed_addresses: failures.slice(0, 25),
    remaining: Math.max(all.length - sent, 0),
    total: all.length,
    batch: batch.length,
    limit,
  });
});
