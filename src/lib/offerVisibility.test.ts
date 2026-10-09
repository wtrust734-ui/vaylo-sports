// ============================================================================
// The rule this file protects: an offer that has been redeemed once is not
// shown again. It is a one-line filter, which is exactly why it needs a test —
// the bug it fixes was a filter that existed on one screen and not the other.
// ============================================================================

import { describe, expect, it } from "vitest";

import { filterUnclaimedOffers, offerSlugFromProductId } from "./offerVisibility";

const offers = [
  { slug: "welcome-starter", title: "Welcome Bundle" },
  { slug: "double-credits-weekend", title: "Double Credits" },
  { slug: "winback-50", title: "Come back" },
];

describe("reading the offer slug off a purchase row", () => {
  it("strips the offer prefix", () => {
    expect(offerSlugFromProductId("offer_welcome-starter")).toBe("welcome-starter");
    expect(offerSlugFromProductId("offer_winback-50")).toBe("winback-50");
  });

  it("ignores rows that are not offers", () => {
    // Packs, bundles, coins and subscriptions all live in the same table.
    for (const id of ["pack_500", "coins_1200", "sub_pro_monthly", "", "welcome-starter"]) {
      expect(offerSlugFromProductId(id)).toBeNull();
    }
    expect(offerSlugFromProductId(null)).toBeNull();
    expect(offerSlugFromProductId(42)).toBeNull();
  });

  it("refuses to read a bare prefix as an empty slug", () => {
    // An empty slug in the set would match nothing anyway, but a set entry that
    // cannot correspond to a real offer is a signal that the parse is wrong.
    expect(offerSlugFromProductId("offer_")).toBeNull();
    expect(offerSlugFromProductId("offer_   ")).toBeNull();
  });
});

describe("filtering the offer list", () => {
  it("drops the redeemed offer and keeps the rest", () => {
    const visible = filterUnclaimedOffers(offers, new Set(["welcome-starter"]));

    expect(visible.map((o) => o.slug)).toEqual(["double-credits-weekend", "winback-50"]);
  });

  it("shows everything when nothing is known to be redeemed", () => {
    // This is the signed-out case and the read-failure case: showing a spent
    // offer costs a tap, hiding a live one costs a sale.
    expect(filterUnclaimedOffers(offers, new Set())).toHaveLength(3);
  });

  it("is indifferent to a claim for an offer that is no longer live", () => {
    // The athlete redeemed a row that has since been deleted or deactivated.
    const visible = filterUnclaimedOffers(offers, new Set(["retired-offer"]));
    expect(visible).toHaveLength(3);
  });

  it("returns the original array untouched when there is nothing to hide", () => {
    // Referential stability: this runs inside a useMemo on every render.
    expect(filterUnclaimedOffers(offers, new Set())).toBe(offers);
  });
});
