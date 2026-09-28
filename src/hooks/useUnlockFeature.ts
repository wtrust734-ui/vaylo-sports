// ============================================================================
// UNLOCK A FEATURE, TOP UP IF SHORT, RETRY — the purchase-side twin of
// useSpendWithTopUp
// ----------------------------------------------------------------------------
// useSpendWithTopUp handles a per-use credit spend that comes up short. A
// one-time unlock is the same loop with a different call, so it gets the same
// treatment: a shortfall becomes a purchase opportunity instead of a dead end,
// and the unlock the athlete actually wanted is retried afterwards.
//
//   1. process-purchase spends the credits and answers 402 with the gap
//   2. the global top-up sheet opens for exactly that gap (server-computed,
//      never guessed from a message)
//   3. on purchase the unlock is retried; dismissing leaves the paywall as it was
// ============================================================================

import { useCallback } from "react";

import { requestCreditTopUp } from "@/lib/topUpStore";
import { unlockFeature, type FeatureUnlockProduct, type UnlockOutcome } from "@/lib/featureUnlocks";

export type UnlockWithTopUpResult = UnlockOutcome;

export function useUnlockFeature() {
  return useCallback(
    async (product: FeatureUnlockProduct): Promise<UnlockWithTopUpResult> => {
      const first = await unlockFeature(product);
      if (first.status !== "insufficient") return first;

      const outcome = await requestCreditTopUp({
        shortfall: first.shortfall,
        reasonLabel: `${product.replace(/_/g, " ")} unlock`,
        balance: first.balance,
      });
      if (!outcome.purchased) {
        return {
          status: "failed",
          error: `Not enough credits — this unlock costs ${first.cost}.`,
          dismissed: outcome.dismissed,
        };
      }

      return unlockFeature(product);
    },
    [],
  );
}
