// ============================================================================
// ONE-TIME FEATURE UNLOCKS — the missing half of "unlock for N credits"
// ----------------------------------------------------------------------------
// Mental Gym and Form Analysis both advertise a price and both once had no way
// to act on it: the button navigated to /market, where the only products are
// credit packs, plans, coins and Event Packs. An athlete could top up and still
// have nothing to spend the credits on. Injury Management was the only feature
// with a real purchase call, and three advertised unlocks (Nutrition Pack,
// Cross-Sport Analysis, Learning) had no purchase call anywhere.
//
// The server side already knows how to do this — `process-purchase` maps these
// product ids through FEATURE_PRODUCTS, reads the price from `credit_cost`,
// spends the credits and writes the entitlement with the service role — so the
// gap was entirely client-side. This module is that missing call, in one place,
// so a fifth feature cannot repeat the mistake, and the catalogue of products it
// accepts comes from src/config/unlocks.ts so the shop and this call can never
// list different things.
// ============================================================================

import { purchaseItems } from "@/lib/billing";
import { UNLOCK_CATALOG, type UnlockProductId } from "@/config/unlocks";

/**
 * Product ids that `supabase/functions/_shared/moneyCatalog.ts` maps to a
 * feature key. Kept in step with FEATURE_PRODUCTS there by unlocks.test.ts: an
 * id the server does not know is rejected as "Unknown product", which is the
 * safe direction — but it is also an unlock nobody can buy, so the two lists
 * are asserted equal rather than trusted to stay equal.
 */
export const FEATURE_UNLOCKS: Record<UnlockProductId, { feature: string; label: string }> =
  Object.fromEntries(
    UNLOCK_CATALOG.map((entry) => [entry.product, { feature: entry.feature, label: entry.label }]),
  ) as Record<UnlockProductId, { feature: string; label: string }>;

export type FeatureUnlockProduct = UnlockProductId;

export type UnlockOutcome =
  | { status: "unlocked" }
  | { status: "insufficient"; shortfall: number; cost: number; balance: number }
  | { status: "failed"; error: string; dismissed?: boolean };

/** The entitlement key the app checks with `hasFeature()` after a purchase. */
export const featureKeyFor = (product: FeatureUnlockProduct) => FEATURE_UNLOCKS[product].feature;

export const labelFor = (product: FeatureUnlockProduct) => FEATURE_UNLOCKS[product].label;

/**
 * Buy a one-time unlock out of the athlete's credit balance.
 *
 * The price is never taken from this function: `process-purchase` reads
 * `credit_cost(feature)` from the database, spends the balance and records the
 * entitlement itself, so the client cannot name its own price or grant itself
 * an entitlement. That is the same route Injury Management already used, and the
 * reason `user_purchases` is insert-only for the service role.
 */
export async function unlockFeature(product: FeatureUnlockProduct): Promise<UnlockOutcome> {
  const res = await purchaseItems([{ product_id: product, product_type: "feature_unlock" }]);
  if (res.ok) return { status: "unlocked" };

  // A 402 carries a machine-readable shortfall so the top-up sheet can be
  // opened for the exact gap instead of guessing it from a message.
  const detail = (res.data ?? {}) as {
    code?: string;
    shortfall?: number;
    required?: number;
    balance?: number;
  };
  if (detail.code === "insufficient_credits") {
    const cost = Number(detail.required ?? 0);
    const balance = Number(detail.balance ?? 0);
    const shortfall = Number(detail.shortfall ?? Math.max(0, cost - balance));
    return { status: "insufficient", shortfall, cost, balance };
  }

  return { status: "failed", error: res.error || "Could not complete the unlock" };
}
