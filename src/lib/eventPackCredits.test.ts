import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BUILT_IN_EVENT_PACKS,
  EVENT_PACK_CREDITS_PER_DOLLAR,
  creditsForPackPrice,
} from "@/config/eventPacks";

// ---------------------------------------------------------------------------
// Event Packs are sold for credits, and the price is charged by the database
// from a generated table — so three things can silently disagree:
//
//   1. the catalogue's rate and the rows the generator writes,
//   2. the rows and what `claim_event_pack` actually deducts,
//   3. the price the screen shows and the price the server takes.
//
// Any of those drifting means an athlete is quoted one number and charged
// another, which is the kind of bug that shows up as a support ticket rather
// than a stack trace. These tests pin all three against the generated SQL,
// which is the file that gets applied to production.
//
// Behaviour against the live database (deduction, shortfall, the verified
// purchase path, and that an Unlimited subscription does NOT make a pack free)
// was verified separately in a rolled-back transaction.
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, "../..");

/** Windows checkouts are CRLF (`core.autocrlf=true`); normalize before matching. */
const toLf = (src: string): string => src.replace(/\r\n?/g, "\n");

const GENERATED = toLf(
  readFileSync(
    resolve(ROOT, "supabase/migrations/20260927200000_event_pack_credits.sql"),
    "utf8",
  ),
);

/** The generated rows, keyed by pack id — one insert row per line. */
function parseRows(sql: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of sql.split("\n")) {
    const m = line.match(/^ {2}\('([^']+)'/);
    if (m) rows.set(m[1], line);
  }
  return rows;
}

const ROWS = parseRows(GENERATED);

describe("event pack credit pricing", () => {
  it("derives credits from the cash price at the documented rate", () => {
    expect(EVENT_PACK_CREDITS_PER_DOLLAR).toBe(20);

    // Every tier the catalogue actually uses, so a rate change shows up here.
    const tiers: [number, number][] = [
      [1299, 260],
      [1499, 300],
      [1999, 400],
      [2499, 500],
      [2999, 600],
      [3499, 700],
      [3999, 800],
      [4499, 900],
      [4999, 1000],
      [5999, 1200],
      [6999, 1400],
    ];
    for (const [cents, credits] of tiers) {
      expect(creditsForPackPrice(cents), `$${cents / 100}`).toBe(credits);
    }
  });

  it("never prices a pack at zero", () => {
    // A zero would make a priced pack free, since the claim only charges when
    // credit_price is positive.
    for (const pack of BUILT_IN_EVENT_PACKS) {
      expect(pack.creditPrice, pack.id).toBeGreaterThan(0);
      expect(Number.isInteger(pack.creditPrice), pack.id).toBe(true);
    }
    expect(creditsForPackPrice(0)).toBe(1);
    expect(creditsForPackPrice(1)).toBe(1);
  });

  it("prices every built-in pack consistently with the helper", () => {
    for (const pack of BUILT_IN_EVENT_PACKS) {
      expect(pack.creditPrice, pack.id).toBe(creditsForPackPrice(pack.priceCents));
    }
    expect(BUILT_IN_EVENT_PACKS.length).toBe(648);
  });

  it("writes a server row for every pack with the same two prices", () => {
    // The screen quotes the catalogue; the server charges this table. A pack
    // missing here falls back to the bundled price and would be refused.
    expect(ROWS.size).toBe(BUILT_IN_EVENT_PACKS.length);

    const mismatched: string[] = [];
    for (const pack of BUILT_IN_EVENT_PACKS) {
      const line = ROWS.get(pack.id);
      if (!line) {
        mismatched.push(`${pack.id} (no row)`);
        continue;
      }
      if (!line.includes(`, ${pack.priceCents}, ${pack.creditPrice}, `)) {
        mismatched.push(`${pack.id} (row prices differ from the catalogue)`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("charges the catalogue price and cannot be told what to charge", () => {
    // The claim function has to take its numbers from the row it just read.
    expect(GENERATED).toContain("v_cost := v_pack.credit_price");
    expect(GENERATED).toContain("where pack_id = p_pack_id and not coalesce(retired, false)");

    // p_price_cents must remain an ignored parameter, never a source of truth.
    expect(GENERATED).not.toContain("v_pack.price_cents = p_price_cents");
    expect(GENERATED).not.toMatch(/price_cents\s*:=\s*p_price_cents/);
  });

  it("keeps the unlimited bypass out of the pack charge", () => {
    // Unlimited is a metered-AI entitlement. If the claim ever routed through
    // credits_spend(), a $2.99 unlimited month would include all 648 packs.
    const body = GENERATED.slice(GENERATED.indexOf("create or replace function public.claim_event_pack"));
    expect(body).not.toContain("has_unlimited_credits");
    expect(body).not.toContain("public.spend_credits");
    expect(body).not.toContain("public.credits_spend");
    // The deduction is still recorded, against the guarded profiles row.
    expect(body).toContain("insert into public.credit_transactions");
    expect(body).toContain("set_config('app.allow_credit_change', 'on', true)");
  });

  it("reports a shortfall instead of failing the claim outright", () => {
    // The screen needs the exact gap to offer the top-up sheet.
    expect(GENERATED).toContain("'error', 'insufficient_credits'");
    expect(GENERATED).toContain("'shortfall', v_cost - v_balance");
  });

  it("records what was paid and keeps the store path intact", () => {
    expect(GENERATED).toContain("add column if not exists credits_paid integer not null default 0");
    expect(GENERATED).toContain("add column if not exists credit_price integer not null default 0");
    // A verified purchase still grants without charging credits.
    expect(GENERATED).toContain("v_source := 'purchase'");
    expect(GENERATED).toContain("'event_pack:' || p_pack_id");
  });
});
