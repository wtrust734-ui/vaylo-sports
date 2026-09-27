import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import {
  getStarterOfferState,
  purchaseStarterOffer,
  type StarterOfferPurchaseResult,
  type StarterOfferState,
} from "@/lib/starterOffer";

/** Subscribes the component to Welcome Bundle eligibility for the signed-in user. */
export function useStarterOffer() {
  const { user, refreshProfile } = useAuth();
  const [state, setState] = useState<StarterOfferState>({ status: "loading" });
  const [purchasing, setPurchasing] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setState({ status: "unavailable" });
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    getStarterOfferState(user.id)
      .then((s) => {
        if (alive) setState(s);
      })
      .catch(() => {
        if (alive) setState({ status: "unavailable" });
      });
    return () => {
      alive = false;
    };
  }, [user?.id]);

  const purchase = useCallback(async (): Promise<StarterOfferPurchaseResult> => {
    setPurchasing(true);
    try {
      const result = await purchaseStarterOffer();
      if (result.ok) await refreshProfile?.();
      // Re-evaluate: a successful purchase flips the card to "claimed"/gone.
      if (user?.id) {
        getStarterOfferState(user.id)
          .then((s) => setState(s))
          .catch(() => { /* keep current state */ });
      }
      return result;
    } finally {
      setPurchasing(false);
    }
  }, [user?.id, refreshProfile]);

  return { state, purchasing, purchase };
}
