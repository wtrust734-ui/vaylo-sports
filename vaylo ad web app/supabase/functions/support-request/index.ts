import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendMail } from "../_shared/email.ts";

// ============================================================================
// support-request — the endpoint behind every form on the Vaylo Sports website
// ----------------------------------------------------------------------------
// The website is static HTML with no backend of its own. Its forms — support,
// privacy and data rights, safety reports, child-safety reports, purchase
// problems, deletion requests, copyright complaints — post here.
//
// This function exists because a form that submits nowhere is a form that lies.
// It told a person their report had been received when it had gone nowhere, and
// for a child-safety report that is not a cosmetic bug.
//
// What it does, in order:
//   1. rejects anything that is not a POST
//   2. drops honeypot submissions, so a naive bot learns nothing from the response
//   3. validates the category against the same closed set the database enforces
//   4. validates the fields a human can actually fill in
//   5. rate-limits per client address
//   6. inserts with the service role, and answers with a short reference
//   7. emails the operator, so the ticket reaches a human rather than sitting
//      in a dashboard nobody is watching
//
// What it deliberately does NOT do:
//   * fail the request because mail failed. The row is already stored by then,
//     so a mail outage must cost a delayed ticket, never a lost one. The
//     response says so plainly rather than claiming an email is on its way.
//   * delete an account. `delete-account` requires a fresh authenticated token
//     proving you are the account owner. A website form cannot supply that, so a
//     deletion request here is a *request*: a human verifies ownership against
//     the address on the account and then runs the authenticated deletion.
//     The response says "request received", never "account deleted".
// ============================================================================

/** Closed category set. Must stay identical to support_requests_category_check. */const CATEGORIES = [
  "general",
  "account",
  "privacy",
  "deletion",
  "safety",
  "child_safety",
  "purchase",
  "bug",
  "copyright",
] as const;

type Category = (typeof CATEGORIES)[number];

/** Submissions from one client address per hour. */
const RATE_LIMIT = 5;
/** Longest body accepted, matching the database check. */
const MAX_BODY = 8000;

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
 * Short, quotable reference. Read out over the phone to a person who has no way
 * to find their own row in a dashboard, so it avoids ambiguous characters: no
 * 0/O, no 1/I.
 */
function makeReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "VYL-";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Salted hash of the client address, for rate limiting and abuse
 * investigation only. Not a user identifier and not reused for anything else.
 * Salted per deployment so the hashes cannot be reversed by brute force.
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

/** Where a ticket goes. The one inbox the operator reads. */
const SUPPORT_EMAIL = "vaylosportssupport@gmail.com";

interface Ticket {
  reference: string;
  category: string;
  isChildSafety: boolean;
  email: string;
  accountRef: string | null;
  displayName: string | null;
  subject: string | null;
  body: string;
}

/**
 * Hand a stored ticket to the operator's inbox.
 *
 * Runs after the row is already written, so it can only ever *add* to what
 * happened. Returns true when the message was handed to SMTP, false when it
 * was not — the caller turns that into an honest note rather than a silent
 * success, because a child-safety report that reached a dashboard but not an
 * inbox is a report that a person may not read for days.
 */
async function notifyOperator(ticket: Ticket): Promise<boolean> {
  const subject = ticket.subject
    ? `Vaylo Sports: ${ticket.category} — ${ticket.subject}`
    : `Vaylo Sports: ${ticket.category} — ${ticket.reference}`;

  const text = [
    "Vaylo Sports",
    "A support request was filed on the website.",
    `Reference: ${ticket.reference}`,
    `Category: ${ticket.category}${ticket.isChildSafety ? " · CHILD SAFETY" : ""}`,
    `Date: ${new Date().toISOString()}`,
    `Name: ${ticket.displayName ?? "(blank)"}`,
    `Email: ${ticket.email}`,
    `Account ref: ${ticket.accountRef ?? "(none)"}`,
    "",
    ticket.body,
    "",
    "---",
    "Reply to this message to answer the person who filed it. The website form",
    "cannot do that for you — it only reaches an inbox, it cannot be addressed",
    "back to.",
  ].join("\n");

  // The person who filed it can end the reply stream with one click. This is
  // not a marketing list — it stops exactly this one thread for this one
  // address, and the ticket itself stays in the queue.
  const unsubscribeUrl =
    `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/support-request-unsubscribe` +
    `?token=${encodeURIComponent(ticket.reference)}`;

  try {
    await sendMail({ to: SUPPORT_EMAIL, subject, text, unsubscribeUrl });
    return true;
  } catch (error) {
    console.error("support-request: failed to email operator", error);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
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
  // A real person never sees this field — it is hidden from sight and from
  // keyboard navigation, so leaving it empty is the only thing a browser can do.
  // A bot that fills every input it finds gives itself away.
  //
  // On a hit we answer exactly as we would on a success. That is the point: a
  // rejected bot that gets an error learns the trap exists and stops tripping
  // it, and one bot per attempt is a nuisance an attacker can iterate against.
  // ---------------------------------------------------------------------------
  if (typeof payload.company_website === "string" && payload.company_website.trim() !== "") {
    return json({ ok: true, reference: makeReference(), received: true });
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  const category = payload.category;
  if (typeof category !== "string" || !CATEGORIES.includes(category as Category)) {
    return json({ error: "invalid_category", message: "Please choose what your message is about." }, 400);
  }

  const email = clean(payload.email, 320);
  if (!email || !EMAIL_RE.test(email)) {
    return json({ error: "invalid_email", message: "Please enter an email address we can reply to." }, 400);
  }

  const body = clean(payload.body, MAX_BODY + 1);
  if (!body || body.length < 10) {
    return json({ error: "invalid_body", message: "Please describe the issue in a little more detail." }, 400);
  }
  if (body.length > MAX_BODY) {
    return json({ error: "body_too_long", message: "That message is too long. Please shorten it, or email us instead." }, 400);
  }

  // Derived here, never taken from the client: a crafted request must not be
  // able to file a child-protection concern in the ordinary queue.
  const isChildSafety = category === "child_safety";

  const subject = clean(payload.subject, 200);
  const accountRef = clean(payload.account_ref, 320);
  const displayName = clean(payload.display_name, 120);

  // ---------------------------------------------------------------------------
  // Rate limit
  // ---------------------------------------------------------------------------
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const salt = Deno.env.get("SUPPORT_IP_SALT") ?? "vaylo-support";
  const ipHash = await hashIp(clientIp(req), salt);

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("support_requests")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gt("created_at", since);

  if ((count ?? 0) >= RATE_LIMIT) {
    return json(
      {
        error: "rate_limited",
        message:
          "You have sent several messages recently. Please wait an hour, or email us directly if it is urgent.",
      },
      429,
    );
  }

  // ---------------------------------------------------------------------------
  // Store
  //
  // A reference collision is astronomically unlikely but not impossible, and a
  // duplicate key here means we must not tell the sender it failed. Retry a few
  // times with a fresh reference rather than losing a safety report to a
  // 1-in-4-billion event.
  // ---------------------------------------------------------------------------
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const reference = makeReference();
    const { error } = await admin.from("support_requests").insert({
      reference,
      category,
      is_child_safety: isChildSafety,
      email,
      account_ref: accountRef,
      display_name: displayName,
      subject,
      body,
      ip_hash: ipHash,
      user_agent: req.headers.get("user-agent"),
    });

    if (!error) {
      // The row is stored, so from here nothing can lose it. Email it, and
      // record whether that actually worked — the operator reads this inbox,
      // not the dashboard, so a silent mail failure is a missed ticket.
      const emailed = await notifyOperator({
        reference,
        category,
        isChildSafety,
        email,
        accountRef,
        displayName,
        subject,
        body,
      });

      // Best-effort bookkeeping. A failure here costs a column, never a ticket,
      // so it must not be able to change what the sender is told.
      await admin
        .from("support_requests")
        .update({ email_message_sent: emailed, email_sent_at: emailed ? new Date().toISOString() : null })
        .eq("reference", reference);

      return json({
        ok: true,
        reference,
        received: true,
        emailed,
        // Shown to the person who pressed send, so they know what just
        // happened and what happens next. Never says anything was deleted,
        // fixed or resolved — it was received, and a person will read it.
        category,
        is_child_safety: isChildSafety,
        message: !emailed
          ? "Received and saved, but our email did not go out just now. It is still in our queue and a person will read it — if it is urgent, please email us directly."
          : isChildSafety
            ? "Received. A person will read this. If a child is in immediate danger, contact the police or the NSPCC Child Protection Helpline on 0808 8000 111 — do not wait for us."
            : "Received. A person will read this and reply to the email address you gave.",
      });
    }

    lastError = error.message;
    if (!/duplicate key/i.test(error.message)) break;
  }

  console.error("support-request: insert failed", lastError);
  return json(
    {
      error: "store_failed",
      message:
        "We could not save your message just now. Nothing has been sent — please email us instead so we still get it.",
    },
    500,
  );
});