// ============================================================================
// SHORTFALL TOP-UP PLANNER
// ----------------------------------------------------------------------------
// When an athlete cannot afford a cosmetic we do not just tell them "not enough
// Coins" — the moment of intent is the best moment to sell. This computes, from
// the configured ladder:
//
//   * the cheapest bundle that covers the gap (what they actually need),
//   * a value upgrade worth mentioning (more coins per dollar),
//   * and the convert-credits alternative.
//
// Pure functions, no React: unit tested in src/lib/topUp.test.ts.
// ============================================================================

import {
  COIN_BUNDLES,
  COINS_PER_CREDIT,
  FIRST_PURCHASE_BUNDLE,
  creditsToCoins,
  type CoinBundleConfig,
} from "@/config/coins";

export interface BundleOffer {
  id: string;
  coins: number;
  bonus: number;
  total: number;
  price_cents: number;
  label: string;
  /** Extra coins left over after paying the gap. */
  leftover: number;
  cents_per_coin: number;
  first_purchase_only: boolean;
}

export interface TopUpPlan {
  /** The gap the athlete has to close. */
  gap: number;
  /** Cheapest bundle that closes it (null when nothing does). */
  cheapest: BundleOffer | null;
  /**
   * A bundle worth offering instead of `cheapest` — strictly better coins per
   * dollar *and* not absurdly more expensive. Null when `cheapest` is already
   * the best value.
   */
  upgrade: BundleOffer | null;
  /** Credits needed to convert instead of buying (null if they don't have them). */
  convertCredits: number | null;
  /** Every covering bundle, cheapest first. */
  options: BundleOffer[];
}

const toOffer = (b: CoinBundleConfig, gap: number, firstPurchaseOnly: boolean): BundleOffer => {
  const total = b.coins + (b.bonus || 0);
  return {
    id: b.id,
    coins: b.coins,
    bonus: b.bonus || 0,
    total,
    price_cents: b.price_cents,
    label: b.label ?? b.id,
    leftover: Math.max(0, total - gap),
    cents_per_coin: b.price_cents / total,
    first_purchase_only: firstPurchaseOnly,
  };
};

/**
 * Plan a top-up for `gap` coins.
 *
 * @param gap          coins still needed
 * @param credits      the athlete's current credit balance (for the alternative)
 * @param firstPurchaseAvailable  whether the one-time bundle is still unused
 */
export function planTopUp(
  gap: number,
  credits = 0,
  firstPurchaseAvailable = false
): TopUpPlan {
  const wanted = Math.max(0, Math.ceil(gap));

  const catalogue: { bundle: CoinBundleConfig; firstOnly: boolean }[] = [
    ...COIN_BUNDLES.map((b) => ({ bundle: b, firstOnly: false })),
    ...(firstPurchaseAvailable ? [{ bundle: FIRST_PURCHASE_BUNDLE, firstOnly: true }] : []),
  ];

  const covering = catalogue
    .map(({ bundle, firstOnly }) => toOffer(bundle, wanted, firstOnly))
    .filter((o) => o.total >= wanted)
    // Cheapest first; on a price tie prefer the better coins-per-dollar.
    .sort((a, b) => a.price_cents - b.price_cents || a.cents_per_coin - b.cents_per_coin);

  const cheapest = covering[0] ?? null;

  // The upgrade nudge must be a real improvement, not a nudge for its own sake:
  // at least 15% better value for at most 3x the money.
  const upgrade =
    cheapest === null
      ? null
      : covering.find(
          (o) =>
            o.id !== cheapest.id &&
            o.cents_per_coin < cheapest.cents_per_coin * 0.85 &&
            o.price_cents <= cheapest.price_cents * 3
        ) ?? null;

  // Converting credits is the other way to close the gap: 1 credit = 7.5 coins.
  const creditsForGap = Math.ceil(wanted / COINS_PER_CREDIT);
  const convertCredits =
    wanted > 0 && credits >= creditsForGap && creditsToCoins(creditsForGap) >= wanted
      ? creditsForGap
      : null;

  return { gap: wanted, cheapest, upgrade, convertCredits, options: covering };
}
