import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatLocalPrice, loadEconomyConfig } from "@/lib/creditEconomy";

/**
 * A bundle price in the athlete's own currency.
 *
 * The currency is resolved the way the Market resolves it: the configured
 * region, overridden by the athlete's own setting. Extracted from
 * CoinTopUpSheet (2026-10-15) because the cosmetics tab now sells coins
 * directly too, and two copies of currency resolution is how a price ends up
 * shown in dollars on one screen and pounds on the next.
 */
export const useLocalPrice = (userId: string | undefined) => {
  const [currency, setCurrency] = useState("USD");

  useEffect(() => {
    let alive = true;
    void (async () => {
      let value = await loadEconomyConfig()
        .then((cfg) => cfg.region.currency)
        .catch(() => "USD");
      if (userId) {
        const { data } = await supabase
          .from("user_settings")
          .select("currency")
          .eq("user_id", userId)
          .maybeSingle();
        if (data?.currency) value = data.currency;
      }
      if (alive) setCurrency(value);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  return (cents: number) => formatLocalPrice(cents, currency);
};
