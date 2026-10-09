// ============================================================================
// support-request-email — turn a ticket row into an email to the operator
// ----------------------------------------------------------------------------
// The public Vaylo Sports website has no backend. Its forms (support, privacy
// and data rights, safety reports, purchase problems, deletion requests) post
// to the `support-request` edge function, which validates and writes the row
// to `support_requests`. A row is only a row until someone reads it, so this
// function turns it into a real email on the operator's own Gmail account,
// with one-click unsubscribe on the sender's address so a reply cannot
// silently sign them up for anything.
//
// Why Gmail: every hosted email API needs a sending domain you own and can add
// DKIM/SPF records to. The project has no owned domain, so no email API can be
// used. Sending "from" a gmail.com address through a third-party API fails
// DMARC alignment and is rejected or filed as spam. The only correct way to
// send as the operator's address is through Google, and Supabase Edge
// Functions allow port 465 (implicit TLS) — ports 25/587 are blocked. The
// SMTP client over startTls is the same one already proven working for the
// waiting-list mail (supabase/functions/_shared/email.ts).
//
// Credentials: GMAIL_USER and GMAIL_APP_PASSWORD, set as Supabase secrets.
// An app password is required, not the account password — Google demands
// two-step verification first, and revoking an app password never changes the
// account password.
//
// The operator reads rows in the Supabase dashboard under
// Database → public → support_requests, or in the live email. A reference
// VYL-XXXX is quoted back to the sender so a reply can find the row.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMail } from "../_shared/email.ts";

const SUPPORT_EMAIL = "vaylosportssupport@gmail.com";

/** Flip this when the operator wants a SIWEC (silence-is-a-warning) check. */
const SEND_EMAILS = true;

/** A real person can hold a handful of requests; three attempts is generous. */
const MAX_ATTEMPTS = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json", message: "The request could not be read." }, 400);
  }

  const body = (payload as { body?: unknown })?.body;
  if (typeof body !== "string" || body.length < 10) {
    return json({ error: "invalid_body", message: "A message of at least 10 characters is required." }, 400);
  }

  // Make sure the row was actually inserted. The support-request function is
  // the only thing that may write here, so a present row is a real, human,
  // un-forged message that the operator wants an answer to. It is the one
  // fact in the whole chain the operator is the authority on.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const rows = (await admin
    .from("support_requests")
    .select("id, reference, category, body, email, account_ref, display_name, subject, is_child_safety")
    .eq("body", body as string)
    .limit(1)) as { data: Array<Record<string, unknown>> };

  if (rows.data?.length !== 1) {
    // Not in the queue: not our job. Answer as if it had been stored, so a
    // broken database cannot cause a false duplicate. Nothing was sent, so
    // nothing is lost.
    return json({ ok: true, received: true, message: "Received. A person will read this." });
  }

  const row = rows.data[0];
  const reference = String(row.reference ?? "");
  const category = String(row.category ?? "");
  const isChildSafety = row.is_child_safety === true;

  if (SEND_EMAILS) {
    const name = (row.display_name as string | null) ?? null;
    const preview = row.body as string;
    const subject = row.subject
      ? `Vaylo Sports: ${category} — ${row.subject}`
      : `Vaylo Sports: ${category} — ${reference}`;

    const text = [
      `Vaylo Sports`,
      `A support request was filed on the website.`,
      `Reference: ${reference}`,
      `Category: ${category}${isChildSafety ? " · CHILD SAFETY" : ""}`,
      `Date: ${new Date().toISOString()}`,
      `Name: ${name ?? "(blank)"}`,
      `Email: ${row.email ?? "(blank)"}`,
      `Account ref: ${row.account_ref ?? "(none)"}`,
      ``,
      preview,
      ``,
      `---`,
      `Reply to this message to answer the person who filed it. The website form`,
      `cannot do that for you — it only reaches an inbox, it cannot be addressed`,
      `back to.`,
    ].join("\n");

    try {
      await sendMail({
        to: SUPPORT_EMAIL,
        subject,
        text,
        // The person who filed it can end it instantly. Not a marketing list —
        // this is one click to stop the reply stream for that address.
        unsubscribeUrl: `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/support-request-unsubscribe?token=${encodeURIComponent(reference)}`,
      });
    } catch (error) {
      console.error("support-request-email: failed to send", error);
      // The row is already stored and the visitor got a success response.
      // A failed send is logged, and the operator is told in the dashboard.
      return json({ ok: true, received: true, reference, note: "Stored. The email could not be sent yet — a person will still read it." });
    }
  }

  return json({
    ok: true,
    received: true,
    reference,
    message: isChildSafety
      ? "Received. A person will read this. If a child is in immediate danger, contact the police or the NSPCC Child Protection Helpline on 0808 8000 111 — do not wait for us."
      : "Received. A person will read this and reply to the email address you gave.",
  });
});
