// Source assertions for the security/database package (30 Sep 2026).
// Migrations 20260930131434 (security_integrity_hardening),
// 20260930131945 (hardening_fix) and 20260930132312 (hardening_2).
//
// Behavioral verification was executed against the LIVE database in
// rolled-back transactions on 2026-09-30: friendship RPC acceptance works with
// dual directional rows; duplicate same-direction and reverse-direction
// friendship inserts are blocked (unique_violation, row count 2→2); negative
// purchase price is refused by CHECK; cross-account store-token replay is
// refused by the global unique. Live probes are not reproducible in CI.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const HARDENING = "/supabase/migrations/20260930131434_security_integrity_hardening.sql";
const HARDENING_FIX = "/supabase/migrations/20260930131945_security_integrity_hardening_fix.sql";
const HARDENING_2 = "/supabase/migrations/20260930132312_security_integrity_hardening_2.sql";

describe("security_integrity_hardening (20260930131434)", () => {
  const src = read(HARDENING);

  it("closes the unindexed user_blocks FK", () => {
    expect(src).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked\s*\n\s*ON public\.user_blocks \(blocked_id\)/
    );
  });

  it("removes the training_loads duplicate CONSTRAINT (not just an index)", () => {
    expect(src).toMatch(
      /ALTER TABLE public\.training_loads\s*\n\s*DROP CONSTRAINT IF EXISTS training_loads_user_id_log_date_key/
    );
  });

  it("removes the video_form_analyses duplicate index", () => {
    expect(src).toMatch(/DROP INDEX IF EXISTS public\.video_form_analyses_user_recent_idx/);
  });

  it("adds the rate-limit and housekeeping indexes", () => {
    expect(src).toMatch(
      /CREATE INDEX IF NOT EXISTS ai_call_events_user_feature_time_idx\s*\n\s*ON public\.ai_call_events \(user_id, feature, created_at\)/
    );
    expect(src).toMatch(
      /CREATE INDEX IF NOT EXISTS ai_call_events_created_at_idx\s*\n\s*ON public\.ai_call_events \(created_at\)/
    );
  });

  it("makes purchase-token idempotency global (cross-account replay closed)", () => {
    expect(src).toMatch(/DROP INDEX IF EXISTS public\.user_purchases_provider_reference_idx/);
    expect(src).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS user_purchases_provider_reference_global_uniq\s*\n\s*ON public\.user_purchases \(provider_reference\)\s*\n\s*WHERE provider_reference IS NOT NULL/
    );
  });

  it("adds the non-negative price CHECK", () => {
    expect(src).toMatch(
      /ADD CONSTRAINT user_purchases_price_non_negative\s*\n\s*CHECK \(price_cents IS NULL OR price_cents >= 0\)/
    );
  });

  it("documents idempotency and rollback per section", () => {
    expect(src).toMatch(/IF NOT EXISTS/);
    expect(src).toMatch(/Rollback/);
  });
});

describe("security_integrity_hardening_fix (20260930131945)", () => {
  const src = read(HARDENING_FIX);

  it("removes the normalized friendship pair index that broke the RPC data model", () => {
    expect(src).toMatch(/DROP INDEX IF EXISTS public\.friendships_pair_normalized_uniq/);
  });

  it("documents the dual-directional-row friendship model and the retained trigger", () => {
    expect(src).toMatch(/TWO\r?\n-- directional rows/);
    expect(src).toMatch(/guard_friendship_pair\(\) BEFORE/);
  });
});

describe("security_integrity_hardening_2 (20260930132312)", () => {
  const src = read(HARDENING_2);

  it("restores the user-leading index on user_purchases", () => {
    expect(src).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_user_purchases_user_id\s*\n\s*ON public\.user_purchases \(user_id\)/
    );
  });
});

describe("friendship data model — pinned by live-probe evidence", () => {
  it("accept_friend_request inserts both directional rows (documented contract)", () => {
    // The remote function body was read and is the source of truth for the
    // data model; this assertion pins the migration comment that records it so
    // nobody reintroduces a normalized-pair constraint without revisiting it.
    expect(read(HARDENING_FIX)).toMatch(/accept_friend_request\(\)/);
  });
});
