// ============================================================================
// MARKET VALUE — the honest arithmetic behind the shop's value copy
// ----------------------------------------------------------------------------
// Two questions a buyer actually asks, answered from CONFIG rather than from
// marketing copy, so the number on screen can never drift from the number the
// server charges:
//
//   1. "What am I saving by buying the bigger pack?" — every ladder in the
//      app is deliberately monotonically better per unit (see credits.ts and
//      MONEY.md), so the saving is real arithmetic on the displayed tiers,
//      not a claim. Shown only when it is at least a few percent; a "2% less"
//      badge is noise that teaches buyers to ignore badges.
//
//   2. "What do credits actually DO?" — a compact sample of real feature
//      prices from FEATURE_COSTS, including the eight-week plan the starting
//      grant is built around. Anchoring a pack against concrete features is
//      the difference between "25 credits" (abstract) and "five coach
//      reviews" (a decision).
//
// Nothing here invents urgency, scarcity or social proof. The ladders and
// prices themselves are Play product configuration and are never modified —
// this only describes them.
// ============================================================================

import { FEATURE_COSTS, FEATURE_LABELS, type FeatureCostKey } from "@/config/credits";

/** Below this, a "saving" is not worth a badge — it trains buyers to ignore them. */
export const MIN_VISIBLE_SAVINGS_PCT = 5;

export interface CreditPackLike {
  credits: number;
  bonus?: number;
  price_cents: number;
  label?: string;
}

export interface CoinBundleLike {
  coins: number;
  bonus?: number;
  price_cents: number;
  label?: string;
}

export const totalCredits = (p: CreditPackLike): number => p.credits + (p.bonus ?? 0);
export const totalCoins = (b: CoinBundleLike): number => b.coins + (b.bonus ?? 0);

/** Cents per unit, floored to a whole cent for display. */
export const perUnitCents = (priceCents: number, units: number): number =>
  Math.floor(priceCents / Math.max(1, units));

/**
 * Percent saved per unit by `bigger` versus `smaller`, or null when the bigger
 * tier is not meaningfully cheaper (equal price per unit, a smaller tier, or
 * an empty denominator). Rounding is to whole percents — a decimal place of
 * "savings" is fabricated precision on a 249-cent pack.
 */
export function savingsPctVs(smaller: CreditPackLike | CoinBundleLike, bigger: CreditPackLike | CoinBundleLike): number | null {
  const unitsOf = (x: CreditPackLike | CoinBundleLike): number =>
    "credits" in x ? totalCredits(x) : totalCoins(x);
  const smallPer = smaller.price_cents / Math.max(1, unitsOf(smaller));
  const bigPer = bigger.price_cents / Math.max(1, unitsOf(bigger));
  if (!(smallPer > 0) || !(bigPer > 0) || bigPer >= smallPer) return null;
  return Math.round((1 - bigPer / smallPer) * 100);
}

/** "25% less per credit than Starter" — null when there is nothing to say. */
export function savingsLabelVs(
  smaller: CreditPackLike | CoinBundleLike,
  bigger: CreditPackLike | CoinBundleLike,
  noun: "credit" | "Coin",
): string | null {
  const pct = savingsPctVs(smaller, bigger);
  if (pct === null || pct < MIN_VISIBLE_SAVINGS_PCT) return null;
  const smallerName = smaller.label ? ` ${smaller.label}` : "";
  return `${pct}% less per ${noun} than${smallerName}`;
}

/**
 * Real feature prices, as an anchor next to the packs. Derived from
 * FEATURE_COSTS so the shop can never quote a price the charge path disagrees
 * with. The eight-week plan line multiplies the per-week cost — the same
 * arithmetic the starting grant is built around (see credits.ts).
 */
export const PLAN_EXAMPLE_WEEKS = 8;

export function valueExampleLines(): string[] {
  return [
    `${PLAN_EXAMPLE_WEEKS}-week AI plan: ${FEATURE_COSTS.training_plan_week * PLAN_EXAMPLE_WEEKS} credits`,
    `AI form analysis: ${FEATURE_COSTS.video_form_analysis}`,
    `Weekly coach review: ${FEATURE_COSTS.weekly_coach_review}`,
    `Nutrition plan week: ${FEATURE_COSTS.nutrition_plan_week}`,
  ];
}

/** Label lookup for receipts/tests — re-exported so callers need one import. */
export const featureLabel = (key: FeatureCostKey): string => FEATURE_LABELS[key];
