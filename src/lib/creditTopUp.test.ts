// Unit tests for the credit shortfall top-up planner.
// Mirrors src/lib/topUp.test.ts (coins).

import { describe, expect, it } from "vitest";

import { CREDIT_PACKS } from "@/config/credits";
import { bestPackPricePerCredit, planCreditTopUp } from "./creditTopUp";

describe("planCreditTopUp", () => {
  it("finds the cheapest pack covering the gap", () => {
    // 60 credits: pack_25 (25) can't cover, pack_50 (50+10=60) exactly covers.
    const plan = planCreditTopUp(60);
    expect(plan.cheapest?.id).toBe("pack_50");
    expect(plan.cheapest?.total).toBe(60);
    expect(plan.cheapest?.leftover).toBe(0);
  });

  it("shows leftover credits for oversized packs", () => {
    const plan = planCreditTopUp(30);
    expect(plan.cheapest?.total).toBeGreaterThanOrEqual(30);
    expect(plan.cheapest!.leftover).toBe(plan.cheapest!.total - 30);
  });

  it("prefers the better credits-per-dollar on a price tie", () => {
    const tie = [
      { id: "a", credits: 50, bonus: 0, price_cents: 500 },
      { id: "b", credits: 60, bonus: 0, price_cents: 500 },
    ];
    const plan = planCreditTopUp(50, tie);
    expect(plan.cheapest?.id).toBe("b");
  });

  it("offers an upgrade only when it is meaningfully better and not absurdly pricier", () => {
    const ladder = [
      { id: "small", credits: 30, bonus: 0, price_cents: 300 }, // 10.0 c/credit
      { id: "mid", credits: 70, bonus: 0, price_cents: 650 }, //  9.3 c/credit (2% better → not an upgrade)
      { id: "big", credits: 200, bonus: 0, price_cents: 1200 }, //  6.0 c/credit (40% better, 4x price → too expensive)
      { id: "sweet", credits: 100, bonus: 0, price_cents: 650 }, //  6.5 c/credit (35% better, 2.2x → valid upgrade)
    ];
    const plan = planCreditTopUp(25, ladder);
    expect(plan.cheapest?.id).toBe("small");
    expect(plan.upgrade?.id).toBe("sweet");
  });

  it("returns no upgrade when cheapest is already the best value", () => {
    const plan = planCreditTopUp(10, [{ id: "only", credits: 20, bonus: 0, price_cents: 200 }]);
    expect(plan.cheapest?.id).toBe("only");
    expect(plan.upgrade).toBeNull();
  });

  it("returns nulls when no pack covers the gap", () => {
    const plan = planCreditTopUp(10000, [{ id: "tiny", credits: 5, bonus: 0, price_cents: 100 }]);
    expect(plan.cheapest).toBeNull();
    expect(plan.upgrade).toBeNull();
    expect(plan.options).toHaveLength(0);
  });

  it("handles a zero/negative gap", () => {
    const plan = planCreditTopUp(0);
    expect(plan.gap).toBe(0);
    expect(plan.cheapest).toBeNull();
  });

  it("covers real feature costs with the real ladder", () => {
    // Largest single feature cost in the config is form_analysis_unlock (54).
    for (const gap of [3, 5, 10, 12, 24, 54]) {
      const plan = planCreditTopUp(gap);
      expect(plan.cheapest, `gap ${gap} must be coverable`).not.toBeNull();
      expect(plan.cheapest!.total).toBeGreaterThanOrEqual(gap);
    }
  });

  it("keeps the real ladder monotonic: bigger packs are better value", () => {
    // The economy invariant the whole app leans on — every pack must be worth
    // buying relative to the one below it, otherwise the upgrade nudge lies.
    const sorted = [...CREDIT_PACKS].sort((a, b) => a.price_cents - b.price_cents);
    const totals = sorted.map((p) => p.credits + (p.bonus || 0));
    for (let i = 1; i < totals.length; i++) {
      const valueRatio = totals[i] / totals[i - 1];
      const priceRatio = sorted[i].price_cents / sorted[i - 1].price_cents;
      expect(valueRatio, `${sorted[i].id} vs ${sorted[i - 1].id}`).toBeGreaterThan(priceRatio);
    }
  });
});

describe("bestPackPricePerCredit", () => {
  it("returns the best rate on the ladder", () => {
    expect(bestPackPricePerCredit()).toBeCloseTo(CREDIT_PACKS[4].price_cents / 650, 5);
  });

  it("returns 0 for an empty ladder", () => {
    expect(bestPackPricePerCredit([])).toBe(0);
  });
});
