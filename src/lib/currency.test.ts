import { describe, expect, it } from "vitest";

import { formatLocalPrice } from "./creditEconomy";
import { PUBLISHED_USD_RATES } from "./fxRates";
import { formatPence } from "@/config/subscriptionPlans";

// The conversion itself is exercised in fxRates.test.ts. These assert the
// formatting pipeline that every price surface goes through: the right symbol,
// the right rounding, and — the bug that started this — a genuinely converted
// number rather than the USD figure with a different glyph in front of it.
const number = (formatted: string) => Number(formatted.replace(/[^0-9.]/g, ""));

describe("display currency conversion", () => {
  it("converts a USD pack price to a smaller GBP amount", () => {
    const usd = 9.99;
    expect(formatLocalPrice(999, "USD")).toBe("$9.99");
    expect(formatLocalPrice(999, "GBP")).toBe(`£${(usd * PUBLISHED_USD_RATES.GBP).toFixed(2)}`);
    // The old failure mode: £9.99 — the number was never converted.
    expect(formatLocalPrice(999, "GBP")).not.toBe("£9.99");
    expect(number(formatLocalPrice(999, "GBP"))).toBeLessThan(usd);
  });

  it("converts GBP-denominated plan prices into the chosen currency", () => {
    // £5.49 is the source price. Converting GBP→GBP must return the source
    // amount whatever the rate is; converting to USD must be larger.
    expect(formatPence(549, "GBP")).toBe("£5.49");
    const usd = formatPence(549, "USD");
    expect(usd.startsWith("$")).toBe(true);
    expect(number(usd)).toBeGreaterThan(5.49);
    expect(number(usd)).toBeCloseTo(5.49 / PUBLISHED_USD_RATES.GBP, 1);
  });

  it("rounds high-rate currencies rather than printing decimals", () => {
    expect(formatLocalPrice(999, "JPY")).toBe(
      `¥${Math.round(9.99 * PUBLISHED_USD_RATES.JPY).toLocaleString("en-US")}`,
    );
    expect(formatLocalPrice(999, "INR")).toMatch(/^₹[\d,]+$/);
  });

  it("falls back to USD for a code the app does not display", () => {
    expect(formatLocalPrice(999, "XYZ")).toBe("$9.99");
  });
});
