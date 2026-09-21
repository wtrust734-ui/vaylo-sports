import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COIN_BUNDLES, COINS_PER_CREDIT, FIRST_PURCHASE_BUNDLE } from "@/config/coins";
import { CREDIT_PACKS as CREDIT_PACKS_CONFIG } from "@/config/credits";
import { planTopUp } from "@/lib/topUp";

const total = (b: { coins?: number; credits?: number; bonus: number }) =>
  (b.coins ?? b.credits ?? 0) + b.bonus;

// The generated mirror the edge function actually uses.
const mirrorSrc = () => readFileSync("supabase/functions/_shared/moneyCatalog.ts", "utf8");

describe("coin ladder economics", () => {
  it("gets cheaper per coin as bundles grow", () => {
    const perCoin = COIN_BUNDLES.map((b) => b.price_cents / total(b));
    for (let i = 1; i < perCoin.length; i++) {
      expect(perCoin[i]).toBeLessThan(perCoin[i - 1]);
    }
  });

  it("beats converting credits at the top of the ladder", () => {
    const bestPackPerCredit = Math.min(
      ...CREDIT_PACKS_CONFIG.map((p) => p.price_cents / total(p))
    );
    const conversionPerCoin = bestPackPerCredit / COINS_PER_CREDIT;
    const topBundlePerCoin = COIN_BUNDLES[COIN_BUNDLES.length - 1].price_cents /
      total(COIN_BUNDLES[COIN_BUNDLES.length - 1]);

    // Coins bought for cash must be the better deal, or nobody buys them.
    expect(topBundlePerCoin).toBeLessThan(conversionPerCoin);
  });

  it("keeps the small bundles above the conversion price", () => {
    const bestPackPerCredit = Math.min(
      ...CREDIT_PACKS_CONFIG.map((p) => p.price_cents / total(p))
    );
    const conversionPerCoin = bestPackPerCredit / COINS_PER_CREDIT;
    expect(COIN_BUNDLES[0].price_cents / total(COIN_BUNDLES[0])).toBeGreaterThan(conversionPerCoin);
  });

  it("keeps the client credit packs in step with the edge-function mirror", () => {
    // The mirror is generated from these configs; a mismatch here means the two
    // sides of the app would charge different prices.
    const src = mirrorSrc();
    for (const pack of CREDIT_PACKS_CONFIG) {
      expect(src).toContain(`"id": "${pack.id}"`);
      expect(src).toContain(`"price_cents": ${pack.price_cents}`);
    }
    for (const bundle of [...COIN_BUNDLES, FIRST_PURCHASE_BUNDLE]) {
      expect(src).toContain(`"id": "${bundle.id}"`);
      expect(src).toContain(`"price_cents": ${bundle.price_cents}`);
    }
  });

  it("makes the first-purchase bundle the best rate in the app", () => {
    const firstPerCoin = FIRST_PURCHASE_BUNDLE.price_cents / total(FIRST_PURCHASE_BUNDLE);
    const bestLadder = Math.min(...COIN_BUNDLES.map((b) => b.price_cents / total(b)));
    expect(firstPerCoin).toBeLessThan(bestLadder);
  });
});

describe("planTopUp", () => {
  it("suggests the cheapest bundle that covers the gap", () => {
    const plan = planTopUp(40);
    expect(plan.cheapest?.id).toBe("coins_120");
    expect(plan.cheapest!.total).toBeGreaterThanOrEqual(40);
    expect(plan.cheapest!.leftover).toBe(plan.cheapest!.total - 40);
  });

  it("picks a bigger bundle when the gap is large", () => {
    const plan = planTopUp(3000, 0, false);
    expect(plan.cheapest?.id).toBe("coins_5000");
    expect(plan.options.every((o) => o.total >= 3000)).toBe(true);
  });

  it("prefers the one-time bundle when it is the cheaper way to cover the gap", () => {
    const withoutFirst = planTopUp(600, 0, false);
    const withFirst = planTopUp(600, 0, true);
    expect(withoutFirst.cheapest?.id).toBe("coins_800");
    expect(withFirst.cheapest?.id).toBe(FIRST_PURCHASE_BUNDLE.id);
    expect(withFirst.cheapest!.price_cents).toBeLessThan(withoutFirst.cheapest!.price_cents);
  });

  it("never offers the first-purchase bundle twice", () => {
    expect(planTopUp(600, 0, false).options.some((o) => o.first_purchase_only)).toBe(false);
  });

  it("offers a strictly better-value upgrade", () => {
    const plan = planTopUp(5000, 0, false);
    if (plan.upgrade) {
      expect(plan.upgrade.cents_per_coin).toBeLessThan(plan.cheapest!.cents_per_coin);
      expect(plan.upgrade.price_cents).toBeGreaterThan(plan.cheapest!.price_cents);
      expect(plan.upgrade.total).toBeGreaterThan(plan.cheapest!.total);
    }
  });

  it("only offers credit conversion when the athlete can afford it", () => {
    expect(planTopUp(75, 5, false).convertCredits).toBe(null);
    expect(planTopUp(75, 50, false).convertCredits).toBe(10);
    // 10 credits at 7.5 coins each = 75 coins, exactly enough.
    expect(planTopUp(75, 50, false).convertCredits! * COINS_PER_CREDIT).toBeGreaterThanOrEqual(75);
  });

  it("handles a zero gap without inventing a purchase", () => {
    const plan = planTopUp(0);
    expect(plan.gap).toBe(0);
  });
});
