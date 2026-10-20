import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMail } from "../_shared/email.ts";

// ============================================================================
// content-report-escalate — moderation escalation for content_reports
// ----------------------------------------------------------------------------
// Nobody reads `content_reports`. That is the largest operational gap in the
// product (docs/RELEASE-AUDIT.md §4, item 4 of docs/LEGAL-MISSING-FACTS.md §9)
// and the thing Play's content-rating reviewers ask about next after "you have
// user-generated content": whether a report reaches a human.
//
// So a report reaching the table is not enough. This function turns a new row
// into an email in the operator's inbox — the same inbox the support form uses,
// because that inbox provably receives mail (VYL-D7TNMX78 probe, 2026-10-15).
//
// The caller is a database webhook (pg_net), not the client: a crafted client
// could skip anything it is asked to invoke itself, and the DB guarantees the
// row. The webhook posts with a shared secret so the inbox cannot be spammed
// by anyone who can reach the function URL. verify_jwt is OFF (the request
// carries its own secret in the `x-escalation-key` header) — set that via:
//   supabase secrets set REPORT_ESCALATION_KEY=<random>
//
// The email is deliberately minimal: reference, priority, reason, target label
// and report details are already in the row this function fetches with the
// service role, so the operator replies from the dashboard where the report
// status is updated, not by emailing the reporter (the report may be anonymous
// to the target by design).
// ============================================================================

const OPERATOR_EMAIL = "vaylosportssupport@gmail.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-escalation-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Reasons that race the moderator — a queue is too slow for these. */
const URGENT = new Set(["child_safety", "self_harm", "sexual", "hate"]);

interface ReportRow {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  target_label: string | null;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expected = Deno.env.get("REPORT_ESCALATION_KEY");
  if (!expected) {
    // Unset secret means the webhook cannot be trusted: refuse loudly enough
    // for logs to show, quietly enough for the reporter's UX not to matter —
    // the row is already stored; this email is the second half.
    console.error("content-report-escalate: REPORT_ESCALATION_KEY not set");
    return json({ error: "not_configured" }, 503);
  }
  if (req.headers.get("x-escalation-key") !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: { report_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const reportId = typeof payload.report_id === "string" ? payload.report_id : null;
  if (!reportId) return json({ error: "missing_report_id" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await admin
    .from("content_reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (error || !data) return json({ error: "report_not_found", detail: error?.message ?? null }, 404);

  const report = data as ReportRow;
  const urgent = URGENT.has(report.reason);
  const subject = `${urgent ? "[URGENT] " : ""}Vaylo content report: ${report.reason} in ${report.target_type}`;

  const text = [
    "Vaylo Sports — content report needs a moderator",
    "",
    `Reason:        ${report.reason}${urgent ? "  (urgent — do not let this sit in the queue)" : ""}`,
    `Target:        ${report.target_type} ${report.target_label ? `(${report.target_label})` : ""}`,
    `Reference:     ${report.target_id}`,
    `Filed:         ${report.created_at}`,
    `Report id:     ${report.id}`,
    `Status:        ${report.status}`,
    "",
    report.details ? `Details:\n${report.details}\n` : "No free-text details were given.",
    "",
    "---",
    "Act in the dashboard (content_reports) — set the status and record actions",
    "there. This message is a nudge, not the case file. Child-safety and",
    "self-harm matters are covered by docs/INCIDENT-RUNBOOK.md §4.",
    "",
    "Reply-to here does not reach the reporter; the report may be anonymous",
    "to the target by design.",
  ].join("\n");

  try {
    await sendMail({ to: OPERATOR_EMAIL, subject, text });
    return json({ ok: true, urgent });
  } catch (e) {
    console.error("content-report-escalate: mail failed", e);
    return json({ ok: false, error: "mail_failed" }, 200);
  }
});
