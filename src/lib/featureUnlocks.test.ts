// Pins the one-time unlock flow, which is money-adjacent and had no client
// coverage at all.
//
// Why this test exists: Mental Gym and Form Analysis both advertised a price and
// neither had a purchase call — the button navigated to /market, where credit
// packs are sold but the unlock is not. The fix routes them through
// process-purchase like Injury Management. The interesting part is the failure
// path: the server answers 402 with a machine-readable shortfall, the client
// turns that into a top-up for the exact gap, and the unlock is retried. If the
// mapping between those three shapes changes, the athlete gets a paywall that
// silently does nothing, and nothing else in the app would notice.

import { describe, expect, it, vi, beforeEach } from "vitest";

const purchaseItems = vi.fn();
vi.mock("@/lib/billing", () => ({ purchaseItems: (...args: unknown[]) => purchaseItems(...args) }));

import { featureKeyFor, labelFor, unlockFeature } from "./featureUnlocks";

beforeEach(() => {
  purchaseItems.mockReset();
});

describe("unlockFeature", () => {
  it("buys the unlock through process-purchase with the server-priced product id", async () => {
    purchaseItems.mockResolvedValue({ ok: true });

    const result = await unlockFeature("mental_gym");

    expect(result).toEqual({ status: "unlocked" });
    // The client never names a price; process-purchase reads credit_cost.
    expect(purchaseItems).toHaveBeenCalledWith([
      { product_id: "mental_gym", product_type: "feature_unlock" },
    ]);
  });

  it("turns a 402 into the exact shortfall, not a guess", async () => {
    purchaseItems.mockResolvedValue({
      ok: false,
      error: "Not enough credits for mental_gym (need 39).",
      data: { code: "insufficient_credits", required: 39, balance: 7, shortfall: 32 },
    });

    const result = await unlockFeature("mental_gym");

    expect(result).toEqual({ status: "insufficient", cost: 39, balance: 7, shortfall: 32 });
  });

  it("recomputes the shortfall when the server sends only the cost", async () => {
    purchaseItems.mockResolvedValue({
      ok: false,
      error: "Not enough credits for form_analysis (need 54).",
      data: { code: "insufficient_credits", required: 54, balance: 20 },
    });

    expect(await unlockFeature("form_analysis")).toEqual({
      status: "insufficient",
      cost: 54,
      balance: 20,
      shortfall: 34,
    });
  });

  it("reports any other failure as an error rather than a shortfall", async () => {
    purchaseItems.mockResolvedValue({ ok: false, error: "Unknown product: mental_gym" });

    const result = await unlockFeature("mental_gym");

    expect(result).toEqual({ status: "failed", error: "Unknown product: mental_gym" });
  });
});

describe("unlock catalogue", () => {
  it("names the entitlement key the app checks with hasFeature()", () => {
    // These are the ids subscriptions and the achievements page compare against,
    // so a typo here means a paid unlock that never appears to have worked.
    expect(featureKeyFor("mental_gym")).toBe("mental_gym");
    expect(featureKeyFor("form_analysis")).toBe("form_analysis");
    expect(featureKeyFor("injury_management")).toBe("injury_management");
  });

  it("has a human label for the top-up sheet", () => {
    expect(labelFor("mental_gym")).toBe("Mental Gym");
    expect(labelFor("injury_management")).toBe("Injury Management");
  });
});
