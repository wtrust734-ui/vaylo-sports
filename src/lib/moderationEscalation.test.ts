// ============================================================================
// MODERATION ESCALATION WIRING — a report nobody reads is the UGC lie
// ----------------------------------------------------------------------------
// Play's UGC review asks, after "you have user-generated content", the one
// question this app struggled to answer honestly: does a report reach a human?
// For two years the honest answer was no — `content_reports` was written by
// `report_content()` and read by nobody (docs/RELEASE-AUDIT.md §4, the largest
// operational gap). On 2026-10-15 it was closed with a database trigger and an
// edge function, and this test exists so the claim can never silently rot:
// - the trigger is removed for any reason
// - the function stops sending mail
// - the secret stops being shared
// Each assertion pins a file pair that must move together.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.resolve(__dirname, "../..", p), "utf8");

const migration = read("supabase/migrations/20261015210000_content_report_escalation.sql");
const escalate = read("supabase/functions/content-report-escalate/index.ts");

describe("every content report reaches a human", () => {
  it("the database still fires the webhook on insert", () => {
    // The trigger is the only path a client cannot choose to skip, so its
    // existence is the load-bearing fact.
    expect(migration).toContain("create trigger content_reports_escalation_trg");
    expect(migration).toContain(
      "after insert on public.content_reports\n  for each row execute function public.notify_content_report_escalation()",
    );
  });

  it("the webhook is fire-and-forget so a slow email cannot block a report", () => {
    expect(migration).toMatch(/net\.http_post\(/);
    expect(migration).toMatch(/timeout_milliseconds := 5000/);
  });

  it("the trigger refuses to post unauthenticated rather than spamming itself", () => {
    // Same guarantee as the waitlist trigger: a missing secret is a loud
    // warning, never an unauthenticated request.
    expect(migration).toMatch(/is not set; the report is stored but nobody was emailed/);
    expect(migration).toMatch(/return null;/);
  });

  it("the function emails the operator inbox, tagged urgent for the racing reasons", () => {
    // The inbox is the support one (same as the support-request function), so
    // a proven-deliverable address is assumed by both paths.
    expect(escalate).toContain('const OPERATOR_EMAIL = "vaylosportssupport@gmail.com";');
    expect(escalate).toMatch(/await sendMail\(/);
    const urgentSet = escalate.indexOf('const URGENT = new Set');
    expect(urgentSet, "the urgent-reason set is gone").toBeGreaterThan(-1);
    expect(escalate.slice(urgentSet, escalate.indexOf(");", urgentSet))).toContain('"self_harm"');
    expect(escalate.slice(urgentSet, escalate.indexOf(");", urgentSet))).toContain('"sexual"');
  });

  it("the function authenticates the webhook with the shared secret", () => {
    // Readable attacker-proofing: every request must carry the same random key
    // the trigger reads from private_secrets. No key, no inbox access.
    expect(escalate).toMatch(/REPORT_ESCALATION_KEY/);
    expect(escalate).toMatch(/x-escalation-key/);
    expect(escalate).toMatch(/json\(\{ error: "unauthorized" \}, 401\)/);
  });

  it("the function refuses to run unconfigured instead of escalating to nobody", () => {
    // A 503 keeps the report row (it is already stored) and tells the logs
    // what to fix — the same "mail may not have arrived" honesty as
    // support-request.
    expect(escalate).toMatch(/not_configured.*503|503.*not_configured|error: "not_configured" \}, 503/s);
  });

  it("the secret table is invisible to every athlete role", () => {
    // Private_secrets rows are the moderation door key. The grants are the whole
    // guarantee: anon and authenticated get nothing.
    expect(migration).toMatch(
      /revoke all on public\.private_secrets from anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant select on public\.private_secrets to service_role;/,
    );
  });
});
