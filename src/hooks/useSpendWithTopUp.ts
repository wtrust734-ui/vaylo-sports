// ============================================================================
// SPEND + TOP-UP + RETRY — the one hook credit-spending screens should use
// ----------------------------------------------------------------------------
// Wraps spendCredits() so an insufficient-credits error becomes a purchase
// opportunity instead of a dead end:
//
//   1. spend fails with insufficient_credits
//   2. the global top-up sheet opens (shortfall pre-computed by the server's
//      response, never guessed)
//   3. the athlete buys or dismisses
//   4. on purchase, the original spend is retried automatically (idempotency
//      key preserved, so a double-fire can never charge twice)
//
// Returns the same shape as spendCredits, so call sites change by one line.
// ============================================================================

import { useCallback } from "react";

import { spendCredits, creditCost, featureLabel, type FeatureCostKey, type SpendOptions, type SpendResult } from "@/lib/credits";
import { requestCreditTopUp } from "@/lib/topUpStore";

export type SpendWithTopUpResult = SpendResult & {
  /** True when the sheet was shown and the athlete dismissed it. */
  dismissedTopUp: boolean;
};

export function useSpendWithTopUp() {
  return useCallback(
    async (feature: FeatureCostKey, opts: SpendOptions = {}): Promise<SpendWithTopUpResult> => {
      const first = await spendCredits(feature, opts);
      if (first.success || first.error !== "insufficient_credits") {
        return { ...first, dismissedTopUp: false };
      }

      const cost = first.cost || creditCost(feature, opts.quantity ?? 1);
      const shortfall = first.shortfall ?? Math.max(0, cost - first.balance);
      const reasonLabel = opts.reason ?? featureLabel(feature);

      const outcome = await requestCreditTopUp({ shortfall, reasonLabel, balance: first.balance });
      if (!outcome.purchased) {
        return { ...first, dismissedTopUp: outcome.dismissed };
      }

      // Balance refreshed by the sheet — retry exactly what was blocked.
      const retry = await spendCredits(feature, opts);
      return { ...retry, dismissedTopUp: false };
    },
    []
  );
}
