// Unit tests for the starter-offer window math. Database-dependent paths
// (row lookup, redemption) are covered by the server's own guards; these tests
// pin the pure logic the UI depends on.

import { describe, expect, it } from "vitest";

import {
  STARTER_OFFER_PRODUCT_ID,
  STARTER_OFFER_SLUG,
  STARTER_OFFER_WINDOW_HOURS,
  hoursLeftInWindow,
} from "./starterOffer";

describe("starter offer ids", () => {
  it("derives the product id from the slug with the offer_ prefix", () => {
    // The offer_ prefix is what makes process-purchase enforce one-per-account.
    expect(STARTER_OFFER_PRODUCT_ID).toBe(`offer_${STARTER_OFFER_SLUG}`);
    expect(STARTER_OFFER_PRODUCT_ID.startsWith("offer_")).toBe(true);
  });

  it("keeps the window under four days", () => {
    expect(STARTER_OFFER_WINDOW_HOURS).toBeGreaterThan(0);
    expect(STARTER_OFFER_WINDOW_HOURS).toBeLessThanOrEqual(96);
  });
});

describe("hoursLeftInWindow", () => {
  const NOW = Date.parse("2026-09-27T12:00:00Z");

  it("counts down from account creation", () => {
    const created = new Date(NOW - 10 * 3600_000).toISOString(); // 10h ago
    expect(hoursLeftInWindow(NOW, created)).toBeCloseTo(STARTER_OFFER_WINDOW_HOURS - 10, 5);
  });

  it("returns 0 once the window has passed", () => {
    const created = new Date(NOW - (STARTER_OFFER_WINDOW_HOURS + 1) * 3600_000).toISOString();
    expect(hoursLeftInWindow(NOW, created)).toBe(0);
  });

  it("returns 0 for a missing or malformed creation date", () => {
    expect(hoursLeftInWindow(NOW, null)).toBe(0);
    expect(hoursLeftInWindow(NOW, undefined)).toBe(0);
    expect(hoursLeftInWindow(NOW, "not-a-date")).toBe(0);
  });

  it("supports a custom window (used for the row's own ends_at)", () => {
    const created = new Date(NOW - 5 * 3600_000).toISOString();
    // window 0 hours → anything in the past is expired
    expect(hoursLeftInWindow(NOW, created, 0)).toBe(0);
    // window 6 hours → 1h left
    expect(hoursLeftInWindow(NOW, created, 6)).toBeCloseTo(1, 5);
  });

  it("never returns a negative number of hours", () => {
    const created = new Date(NOW - 1000 * 3600_000).toISOString();
    expect(hoursLeftInWindow(NOW, created)).toBe(0);
  });
});
