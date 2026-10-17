import { describe, expect, it } from "vitest";
import {
  COSMETIC_BUNDLES,
  bundleSavings,
  isAvailableNow,
} from "./cosmeticCatalog";

describe("isAvailableNow (mirrors the server's purchase window check)", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const windowed = (from: string | null, to: string | null) => ({
    type: "border",
    season: "winter_2026",
    available_from: from,
    available_to: to,
  });

  it("allows items with no window at any time", () => {
    expect(isAvailableNow(windowed(null, null), now)).toBe(true);
  });

  it("hides items before their window opens", () => {
    expect(isAvailableNow(windowed("2026-11-15T00:00:00Z", null), now)).toBe(false);
  });

  it("hides items after their window closes", () => {
    expect(isAvailableNow(windowed(null, "2026-10-01T00:00:00Z"), now)).toBe(false);
  });

  it("shows items inside their window", () => {
    expect(
      isAvailableNow(
        windowed("2026-10-15T00:00:00Z", "2026-11-02T00:00:00Z"),
        now,
      ),
    ).toBe(true);
  });

  it("accepts open-ended bounds on non-seasonal items", () => {
    expect(isAvailableNow(windowed("2026-10-01T00:00:00Z", null), now)).toBe(true);
    expect(isAvailableNow(windowed(null, "2099-01-01T00:00:00Z"), now)).toBe(true);
  });

  it("treats a windowless seasonal item as not on sale (server parity)", () => {
    expect(
      isAvailableNow({ type: "seasonal", season: "olympics", available_from: null, available_to: null }, now),
    ).toBe(false);
    expect(
      isAvailableNow({ type: "seasonal", season: "summer", available_from: "2026-06-01T00:00:00Z", available_to: null }, now),
    ).toBe(false);
  });
});

describe("CosmeticBundleConfig: the discounts the page shows are real", () => {
  it("every bundle costs less than the sum of its parts", () => {
    for (const bundle of COSMETIC_BUNDLES) {
      expect(bundleSavings(bundle)).toBeGreaterThan(0);
      expect(bundle.coinCost).toBeLessThan(bundle.itemValue);
    }
  });

  it("savings match the honest line the card shows", () => {
    expect(bundleSavings(COSMETIC_BUNDLES[0])).toBe(450);
    expect(bundleSavings(COSMETIC_BUNDLES[1])).toBe(500);
    expect(bundleSavings(COSMETIC_BUNDLES[2])).toBe(300);
  });

  it("bundle ids match the server seed exactly (checkout is by id)", () => {
    expect(COSMETIC_BUNDLES.map((b) => b.id).sort()).toEqual([
      "champions_look",
      "glow_set",
      "starter_look",
    ]);
  });

  it("no bundle reuses an item within itself", () => {
    for (const bundle of COSMETIC_BUNDLES) {
      expect(new Set(bundle.itemIds).size).toBe(bundle.itemIds.length);
    }
  });
});
