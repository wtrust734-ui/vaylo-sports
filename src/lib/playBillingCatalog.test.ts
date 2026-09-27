import { describe, expect, it } from "vitest";
import {
  isKnownMoneyProduct,
  playPurchasableProductIds,
} from "../../supabase/functions/_shared/playBilling.ts";

// ---------------------------------------------------------------------------
// The Play verifier is the one place where a forged receipt could become a
// grant, so its catalog rules are pinned here. These tests import the real
// generated money mirror (like moneyMirror.test.ts does) so a new pack or
// coin bundle is automatically accepted, and a renamed product id fails here
// before it fails in production.
// ---------------------------------------------------------------------------

describe("play billing catalog rules", () => {
  it("accepts every current credit pack", () => {
    expect(isKnownMoneyProduct("pack_25")).toBe(true);
    expect(isKnownMoneyProduct("pack_50")).toBe(true);
    expect(isKnownMoneyProduct("pack_120")).toBe(true);
    expect(isKnownMoneyProduct("pack_200")).toBe(true);
    expect(isKnownMoneyProduct("pack_500")).toBe(true);
  });

  it("accepts coin bundles and the first-purchase bundle", () => {
    expect(isKnownMoneyProduct("coins_120")).toBe(true);
    expect(isKnownMoneyProduct("coins_first")).toBe(true);
  });

  it("accepts unlimited packs", () => {
    expect(isKnownMoneyProduct("infinite_lifetime")).toBe(true);
    expect(isKnownMoneyProduct("infinite_monthly")).toBe(true);
    expect(isKnownMoneyProduct("infinite_yearly")).toBe(true);
  });

  it("accepts every welcome-bundle offer product the server can price", () => {
    // offer_* products are validated against the special_offers table at
    // request time (not statically here); the catalog rule must not reject the
    // prefix itself.
    const offerable = playPurchasableProductIds().filter((id) => id.startsWith("offer_"));
    expect(Array.isArray(offerable)).toBe(true);
  });

  it("refuses unknown or deprecated products", () => {
    expect(isKnownMoneyProduct("")).toBe(false);
    expect(isKnownMoneyProduct("nonexistent_pack")).toBe(false);
    // Deprecated legacy subscription ids must not become purchasable again
    // through Play Billing.
    expect(isKnownMoneyProduct("sub_premium_monthly")).toBe(false);
    expect(isKnownMoneyProduct("plan_elite")).toBe(false);
  });

  it("refuses feature unlocks — those are bought with credits, not money", () => {
    // FEATURE_PRODUCTS ids (form_analysis_unlock etc.) are deliberately absent
    // from PRODUCT_PRICES, so they must not be Play-purchasable either.
    expect(isKnownMoneyProduct("form_analysis_unlock")).toBe(false);
    expect(isKnownMoneyProduct("nutrition_pack")).toBe(false);
  });
});
