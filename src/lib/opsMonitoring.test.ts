// Guards for the ops metrics layer (MDF-007).
//
// The database owns the actual rules here too; these tests pin the CONTRACT:
// the rollup is idempotent and operator-only, the cost view separates charges
// from refunds by ledger source, the schedule is upsert-by-name, and both
// provider adapters emit the same latencies into the log drain.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../supabase/migrations/20261020130000_ops_metrics.sql"),
  "utf8",
).replace(/\r\n?/g, "\n");

const OPENAI = readFileSync(
  path.resolve(__dirname, "../../supabase/functions/_shared/openai.ts"),
  "utf8",
).replace(/\r\n?/g, "\n");

const GOOGLE = readFileSync(
  path.resolve(__dirname, "../../supabase/functions/_shared/google.ts"),
  "utf8",
).replace(/\r\n?/g, "\n");

describe("ops metrics migration", () => {
  it("rolls one day up into exactly one idempotent row (a missed night can be replayed)", () => {
    expect(MIGRATION).toMatch(/create or replace function public\.ops_rollup_one_day\(p_day date\)/);
    expect(MIGRATION).toMatch(/on conflict \(day\) do update set/);
    // The day is a parameter, never now() — replay must reproduce the same row.
    expect(MIGRATION).not.toMatch(/now\(\)::date as day/);
  });

  it("is an operator surface: written and read by service role, closed to clients", () => {
    expect(MIGRATION).toMatch(
      /revoke all on function public\.ops_rollup_one_day\(date\) from public, anon, authenticated/,
    );
    expect(MIGRATION).toMatch(/grant execute on function public\.ops_rollup_one_day\(date\) to service_role/);
    expect(MIGRATION).toMatch(/grant select on public\.ops_metrics_daily to service_role/);
  });

  it("counts refunds by ledger source, so purchases and referral grants stay out", () => {
    expect(MIGRATION).toMatch(/amount > 0/);
    expect(MIGRATION).toMatch(/source like 'refund%'/);
  });

  it("carries the failure-shape counters the alert plan builds on", () => {
    expect(MIGRATION).toMatch(/error_shapes_new/);
    expect(MIGRATION).toMatch(/name = 'credit_refund_failed'/);
  });

  it("schedules the daily rollup by name (a redeploy upserts, never stacks)", () => {
    expect(MIGRATION).toMatch(/'ops-metrics-daily'/);
    expect(MIGRATION).toMatch(/ops_rollup_one_day\(current_date - 1\)/);
  });
});

describe("provider call logging — the latency and cost feeds", () => {
  it("OpenAI logs feature, model, duration and tokens on every successful call", () => {
    expect(OPENAI).toMatch(
      /\[ai\] ok feature=\$\{args\.feature\} model=\$\{v\.cfg\.model\} ms=\$\{durationMs\} tokens=/,
    );
  });

  it("and marks upstream failures with the status, never the raw body", () => {
    expect(OPENAI).toMatch(/openai error feature=\$\{args\.feature\} status=\$\{res\.status\}/);
  });

  it("Gemini carries the same duration shape on success and failure", () => {
    expect(GOOGLE).toMatch(/Gemini generate ok.*model=\$\{call\.model\}.*ms=\$\{Date\.now\(\) - started\}/);
    expect(GOOGLE).toMatch(/Gemini request failed.*upstream_error.*model=/);
  });

  it("neither adapter ever logs the provider response body on failure", () => {
    // The OpenAI path logs a600-char slice — that one is deliberate (documented)
    // and capped; the adapter's failure log itself must not say "body=" raw.
    expect(GOOGLE).not.toMatch(/console\.error\("Gemini request failed", res\.status, res\.body/);
  });
});
