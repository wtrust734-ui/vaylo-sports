// Source assertions for the 30 September 2026 economy/marketplace package.
// Same pattern as dbSecurityMigration.test.ts: the live probes in
// `npm run security:check` prove the database refuses bad writes today; these
// tests fail the suite if a future edit silently drops a constraint, trigger
// or policy from the migration SOURCE.
//
// The behavioural DB tests (forge paid item, unowned equip, prestige grant,
// forge paid pack with/without evidence, RPC claim, free pack insert) were
// executed against the live database inside rolled-back transactions on
// 2026-09-30 with a simulated authenticated JWT — all blocked/allowed as
// intended. They need a real auth user, so they are not reproducible in CI.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const ECON = "/supabase/migrations/20260930100723_economy_marketplace_integrity.sql";

describe("economy migration — reward catalog", () => {
  const src = read(ECON);

  it("caps catalog value sets (cost, rarity, id length)", () => {
    expect(src).toMatch(/avatar_catalog_shape/);
    expect(src).toMatch(/rarity in \('common', 'rare', 'epic', 'legendary', 'mythic'\)/);
  });

  it("keeps chest probabilities summing to 100", () => {
    expect(src).toMatch(/Chest probabilities must sum to 100/);
  });

  it("keeps duplicate-conversion values at 1+ credit", () => {
    expect(src).toMatch(/Duplicate conversion values must be at least 1 credit/);
  });
});

describe("economy migration — avatar ownership", () => {
  const src = read(ECON);

  it("only free catalog items can be inserted directly", () => {
    expect(src).toMatch(/Only free catalog items can be added directly/);
  });

  it("the purchase RPC path is gated by a server-only GUC", () => {
    expect(src).toMatch(/app\.avatar_grant/);
    expect(src).toMatch(/set_config\('app\.avatar_grant', 'on', true\)/);
  });

  it("equipped slots must be owned or free", () => {
    expect(src).toMatch(/Cosmetic % is not owned/);
  });

  it("prestige cannot be raised by an update and is zeroed on insert", () => {
    expect(src).toMatch(/Prestige cannot be increased directly/);
    expect(src).toMatch(/new\.prestige_level := 0/);
  });

  it("legacy avatar rows keep rendering (slot-unchanged pass-through)", () => {
    expect(src).toMatch(/v_slots_unchanged/);
    expect(src).toMatch(/old\.outfit is not distinct from new\.outfit/);
  });

  it("bounds display names", () => {
    expect(src).toMatch(/char_length\(btrim\(display_name\)\) between 1 and 24/);
  });
});

describe("economy migration — creators, listings, bookings", () => {
  const src = read(ECON);

  it("verification cannot be self-granted (insert and update)", () => {
    expect(src).toMatch(/with check \(\(select auth\.uid\(\)\) = user_id and verified = false\)/);
  });

  it("payout email shape is validated", () => {
    expect(src).toMatch(/creator_profiles_payout_email_shape/);
  });

  it("sales metrics are server-owned", () => {
    expect(src).toMatch(/Sales metrics are updated by the system only/);
  });

  it("new listings start with zero sales and no rating", () => {
    expect(src).toMatch(/New listings start with zero sales and no rating/);
  });

  it("listing prices are bounded", () => {
    expect(src).toMatch(/Listing price out of range/);
  });

  it("bookings carry no client price or video link", () => {
    expect(src).toMatch(/new\.price_cents := 0/);
    expect(src).toMatch(/new\.video_link := null/);
  });

  it("rating stays 1-5", () => {
    expect(src).toMatch(/Rating must be 1-5/);
  });
});

describe("economy migration — event packs and sponsors", () => {
  const src = read(ECON);

  it("paid pack ownership requires payment evidence, not a claim", () => {
    expect(src).toMatch(/Paid packs are granted only by the purchase flow/);
    expect(src).toMatch(/t\.metadata ->> 'pack_id' = new\.pack_id/);
    expect(src).toMatch(/p\.product_id = 'event_pack:' \|\| new\.pack_id/);
  });

  it("service-role webhooks bypass the client-facing pack guard", () => {
    const fn = src.indexOf("guard_pack_ownership_insert");
    const body = src.slice(fn);
    expect(body).toMatch(/if auth\.uid\(\) is null then/);
  });

  it("claim_event_pack serialises per user+pack (no double-charge race)", () => {
    expect(src).toMatch(/pg_advisory_xact_lock/);
  });

  it("sponsor CTA links are http(s) only", () => {
    expect(src).toMatch(/brand_placements_cta_url_safe/);
    expect(src).toMatch(/\^https\?:\/\//);
  });
});

describe("frontend enforces the same rules", () => {
  it("free avatar unlocks go through the server grant", () => {
    expect(read("/src/pages/Avatar.tsx")).toMatch(/purchase_avatar_item_coins/);
  });

  it("bookings no longer send a client price or video link", () => {
    const src = read("/src/components/coach/HumanCoaches.tsx");
    expect(src).not.toMatch(/price_cents.*[0-9]{4}/);
    expect(src).not.toMatch(/meet\.vaylo\.app/);
  });

  it("creator onboarding does not promise payouts", () => {
    expect(read("/src/pages/BecomeCreator.tsx")).toMatch(/payouts are not yet enabled/);
    expect(read("/src/pages/BecomeCreator.tsx")).not.toMatch(/Monthly Stripe payouts/);
  });
});
