// ============================================================================
// ONE-TIME FEATURE UNLOCKS — the missing half of "unlock for N credits"
// ----------------------------------------------------------------------------
// Mental Gym and Form Analysis both advertise a price ("Unlock for 39 credits",
// "54 credits — Unlock in Market") and both had no way to act on it: the button
// navigated to /market, where the only products are credit packs, plans, coins
// and Event Packs. An athlete could top up and still have nothing to spend the
// credits on. Injury Management was the only feature with a real purchase call.
//
// The server side already knows how to do this — `process-purchase` maps these
// product ids through FEATURE_PRODUCTS, reads the price from `credit_cost`,
// spends the credits and writes the entitlement with the service role — so the
// gap was entirely client-side. This module is that missing call, in one place,
// so a fourth feature cannot repeat the mistake.
// ============================================================================

import { purchaseItems } from "@/lib/billing";

/**
 * Product ids that `supabase/functions/_shared/moneyCatalog.ts` maps to a
 * feature key. Keep in step with FEATURE_PRODUCTS there: an id the server does
 * not know is rejected as "Unknown product", which is the safe direction.
 */
export const FEATURE_UNLOCKS = {
  mental_gym: { feature: "mental_gym", label: "Mental Gym" },
  form_analysis: { feature: "form_analysis", label: "Form Analysis" },
  injury_management: { feature: "injury_management", label: "Injury Management" },
  nutrition_pack: { feature: "nutrition_pack", label: "Nutrition Pack" },
  cross_sport: { feature: "cross_sport", label: "Cross-Sport Analysis" },
} as const;

export type FeatureUnlockProduct = keyof typeof FEATURE_UNLOCKS;

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
