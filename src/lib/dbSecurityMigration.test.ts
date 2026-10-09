// Source assertions for the 30 September 2026 security hardening.
//
// The live probes in `npm run security:check` prove the database refuses bad
// writes today. This file is the cheap, always-on guard for the migration
// SOURCE: it fails the suite if a future edit silently drops a revoke, a
// constraint, or the orphan-cleanup ordering, without needing credentials or a
// network round-trip. Same pattern as purchaseSequence.test.ts.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const HARDENING = "/supabase/migrations/20260930064813_security_hardening_ownership_and_grants.sql";
const DENY = "/supabase/migrations/20260930064921_explicit_deny_policies_for_service_only_tables.sql";

describe("security hardening migration", () => {
  const src = read(HARDENING);

  it("closes the anon-executable trigger function (advisor lint 0028)", () => {
    expect(src).toMatch(
      /revoke all on function public\.guard_achievement_claims\(\) from public, anon, authenticated;/i,
    );
  });

  it("closes the cross-user entitlement oracle has_unlimited_credits", () => {
    expect(src).toMatch(
      /revoke all on function public\.has_unlimited_credits\(uuid\) from public, anon, authenticated;/i,
    );
  });

  it("deletes orphan subscription rows BEFORE adding the ownership FKs", () => {
    const deleteAt = src.indexOf("delete from public.subscriptions");
    const fkLoopAt = src.indexOf("foreach t in array tables loop");
    expect(deleteAt).toBeGreaterThan(-1);
    expect(fkLoopAt).toBeGreaterThan(deleteAt);
  });

  it("adds user_id foreign keys with ON DELETE CASCADE", () => {
    expect(src).toMatch(/foreign key \(user_id\) references auth\.users\(id\) on delete cascade/i);
  });

  it("keeps the service-only telemetry ledgers FK-free by intent", () => {
    expect(src).toMatch(/purchase_analytics, fair_usage_events/);
  });

  it("asserts balances can never go negative", () => {
    expect(src).toMatch(/profiles_credits_nonneg/);
    expect(src).toMatch(/profiles_coins_nonneg/);
    expect(src).toMatch(/credit_transactions_balance_nonneg/);
    expect(src).toMatch(/coin_transactions_amount_nonzero/);
  });

  it("asserts identity invariants", () => {
    expect(src).toMatch(/friendships_not_self/);
    expect(src).toMatch(/referrals_not_self/);
  });

  it("makes duplicate achievement claims impossible", () => {
    expect(src).toMatch(
      /create unique index if not exists achievements_user_claim_uq\s+on public\.achievements \(user_id, type, title\)/i,
    );
  });

  it("indexes the user_id lookups every RLS policy performs", () => {
    expect(src).toMatch(/idx_%I_user_id on public\.%I \(user_id\)/);
    expect(src).toMatch(/idx_coin_transactions_user_created/);
  });
});

describe("service-only tables are explicitly closed (advisor lint 0008)", () => {
  const src = read(DENY);

  it("creates deny-all policies for every service-role-only table", () => {
    expect(src).toMatch(/'ai_call_events','brands','brand_placements','brand_metrics'/);
    expect(src).toMatch(/for all using \(false\) with check \(false\)/i);
  });
});

describe("standing ledger guarantees survive", () => {
  it("credit ledger idempotency stays UNIQUE (replay protection)", () => {
    const src = read("/supabase/migrations/20260901030027_03e6f408-cb6a-434d-9d1a-1a1f91702ba7.sql");
    expect(src).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_idem_uniq/);
  });

  it("the client only ever READS the credit ledger (history view)", () => {
    const src = read("/src/lib/credits.ts");
    const at = src.indexOf('.from("credit_transactions")');
    expect(at).toBeGreaterThan(-1);
    const window = src.slice(at, at + 220);
    expect(window).toMatch(/\.select\(/);
    expect(window).not.toMatch(/\.insert\(|\.upsert\(|\.update\(/);
  });

  it("no client code inserts into the coin ledger", () => {
    const src = read("/src/lib/credits.ts");
    expect(src).not.toMatch(/\.from\("coin_transactions"\)[\s\S]{0,200}\.insert\(/);
  });
});
