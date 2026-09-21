// ============================================================================
// VAYLO SPORTS — COINS ECONOMY: SINGLE SOURCE OF TRUTH
// ----------------------------------------------------------------------------
// Coins are the avatar-cosmetic currency. They are NOT credits.
// 1 credit = 7.5 coins.
// The DATABASE is authoritative: economy_config key `coins_per_credit`, read by
// public.coins_per_credit() and used by convert_credits_to_coins(). This
// constant must mirror it — it exists so the UI can show the rate and preview a
// conversion without a round trip.
//
// Coins are sold in the Market in bundles for real money (like credit packs)
// and can also be obtained by converting credits → coins at the fixed rate.
// All avatar CATALOG costs are in coins.
// ============================================================================

export const COINS_PER_CREDIT = 7.5;

export type CoinBundleConfig = {
  id: string;
  coins: number;
  bonus: number;
  price_cents: number;
  label?: string;
  popular?: boolean;
  best_value?: boolean;
};

/**
 * Coin bundles sold in the Market for real money.
 * Coins never expire. `coins` is the base amount, `bonus` is extra:
 * the athlete receives coins + bonus.
 *
 * PRICING RULE (enforced by src/config/money.test.ts — see MONEY.md):
 *  - cost per coin must fall as the bundle grows,
 *  - and the TOP bundle must beat converting credits (1 credit = 7.5 coins,
 *    and the best credit pack is $0.0384/credit → $0.00512/coin), otherwise
 *    nobody would ever buy coins for cash:
 *
 *      bundle            coins    price    $/coin
 *      Starter             120    $2.99    0.0249   (convenience premium)
 *      Value               330    $5.99    0.0182
 *      Popular             920   $12.99    0.0141
 *      Pro                2500   $24.99    0.0100
 *      Mega               7500   $37.49    0.0050  ← beats credit conversion
 */
export const COIN_BUNDLES: CoinBundleConfig[] = [
  { id: "coins_120",  coins: 120,  bonus: 0,    price_cents: 299,  label: "Starter" },
  { id: "coins_300",  coins: 300,  bonus: 30,   price_cents: 599,  label: "Value" },
  { id: "coins_800",  coins: 800,  bonus: 120,  price_cents: 1299, label: "Popular", popular: true },
  { id: "coins_2000", coins: 2000, bonus: 500,  price_cents: 2499, label: "Pro" },
  { id: "coins_5000", coins: 5000, bonus: 2500, price_cents: 3749, label: "Mega", best_value: true },
];

/**
 * First-purchase bundle: deliberately the best coins-per-dollar rate in the app,
 * offered once per account. Getting the first purchase out of the way is what
 * unlocks every later purchase, so this SKU is allowed to sit below the ladder.
 */
export const FIRST_PURCHASE_BUNDLE: CoinBundleConfig = {
  id: "coins_first",
  coins: 700,
  bonus: 0,
  price_cents: 199,
  label: "First buy · one only",
};

export const COIN_SOURCES = ["purchase", "credit_conversion", "reward", "admin_grant"] as const;

// Floored to whole coins, matching the SQL (floor(p_credits * rate)) so the
// preview the athlete sees is exactly what the server grants.
export function creditsToCoins(credits: number): number {
  return Math.floor(credits * COINS_PER_CREDIT);
}

export function coinsToCreditsDisplay(coins: number): string {
  return (coins / COINS_PER_CREDIT).toFixed(2);
}
