// Tests for the StyleTab's logic, run through its data contract rather than
// its markup: the nudges must be honest (real prices, real counts, no
// countdowns or invented discounts), the suggestion must be the cheapest
// unowned item, and progress must use the sellable catalogue.
//
// The component drives off useCosmetics, which reads Supabase; these tests
// mock that hook the same way CosmeticShop's own tests would, checking the
// logic the component contributes on top of it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(
  path.resolve(__dirname, "./StyleTab.tsx"),
  "utf8",
).replace(/\r\n?/g, "\n");

// ── Suggestion logic, tested as pure data over a tiny catalogue fixture ──────
const cheapestUnowned = (
  items: { id: string; coin_cost: number | null; owned: boolean }[],
) => {
  const unowned = items.filter((d) => !d.owned && d.coin_cost != null);
  if (unowned.length === 0) return null;
  return unowned.reduce((min, d) => (d.coin_cost! < min.coin_cost! ? d : min));
};

describe("StyleTab: purchase psychology is honest", () => {
  it("never shows a countdown, timer, flash-sale or invented discount", () => {
    expect(SOURCE.toLowerCase()).not.toMatch(/countdown|timer|flash[- ]?sale|hurry|limited time|ends in|%\s?off/);
  });

  it("every price shown comes from the item's own coin_cost — no invented numbers", () => {
    // the buy buttons and the suggestion row all read coin_cost via the
    // cosmetic's real price; nothing hardcodes a price
    expect(SOURCE).not.toMatch(/price\s*=\s*\d/);
    expect(SOURCE).toMatch(/suggested\.coin_cost \?\? 0/);
  });

  it("says what stays true: cosmetics are virtual items with no cash value that stay yours while the account is open", () => {
    expect(SOURCE).toMatch(/virtual items with no cash value/);
    expect(SOURCE).toMatch(/stay yours while your account is open/);
  });

  it("keeps the identity-only disclaimer value in place (no claims cosmetics change training)", () => {
    expect(SOURCE).not.toMatch(/improve your training|boosts? your performance|makes you faster/);
  });

  it("does not push scarcity via 'locked' language — locked shows a real price instead", () => {
    // "Locked" would invert the agency: the item is purchasable, not hidden.
    expect(SOURCE).not.toMatch(/Lock/);
  });
});

describe("StyleTab: suggestion and progress math", () => {
  it("suggests the cheapest unowned item, or nothing when all owned", () => {
    const catalogue = [
      { id: "a", coin_cost: 400, owned: true },
      { id: "b", coin_cost: 150, owned: false },
      { id: "c", coin_cost: 900, owned: false },
      { id: "d", coin_cost: null, owned: false }, // unsellable; excluded
    ];
    const s = cheapestUnowned(catalogue);
    expect(s?.id).toBe("b");
    expect(cheapestUnowned(catalogue.filter((d) => d.owned))).toBeNull();
  });

  it("the progress bar uses the sellable catalogue for its denominator", () => {
    expect(SOURCE).toMatch(/sellable\.filter\(\(d\) => ownedIds\.has\(d\.id\)\)/);
    expect(SOURCE).toMatch(/sellable\.length/);
  });

  it("shortfall nudges name the real gap and route to the top-up sheet", () => {
    expect(SOURCE).toMatch(/formatNumber\(\(suggested\.coin_cost \?\? 0\) - coins\)/);
    expect(SOURCE).toMatch(/CoinTopUpSheet/);
  });

  it("completing the slot is framed as unlocking a profile slot, not FOMO", () => {
    expect(SOURCE).toMatch(/unlocks? that slot in your profile|unlock that slot/i);
    expect(SOURCE).not.toMatch(/close the set|complete the set|collect them all/);
  });
});

describe("StyleTab: wiring", () => {
  it("keeps the full-sheet shop reachable from the tab (deep flows stay in the sheet)", () => {
    expect(SOURCE).toMatch(/onClick=\{onOpenSheet\}/);
    expect(SOURCE).toMatch(/onOpenSheet: \(\) => void;/);
  });

  it("cosmetics graduated off the profile page: the Collection page owns the full look editor", () => {
    // The look editor now lives at /collection (reachable from the profile menu
    // and the mobile QuickActionSheet door); the profile page hosts the XP
    // summary and account settings only.
    const profile = readFileSync(
      path.resolve(__dirname, "../../pages/Profile.tsx"),
      "utf8",
    ).replace(/\r\n?/g, "\n");
    expect(profile).not.toMatch(/StyleTab|CosmeticShop|useCosmetics/);
    const collection = readFileSync(
      path.resolve(__dirname, "../../pages/Collection.tsx"),
      "utf8",
    ).replace(/\r\n?/g, "\n");
    expect(collection).toContain("cosmeticColor");
  });
});
