import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatLocalPrice, loadEconomyConfig } from "@/lib/creditEconomy";
import { FX_UPDATED_EVENT } from "@/lib/fxRates";
import { DISPLAY_CURRENCY_EVENT, readDisplayCurrency } from "./useDisplayCurrency";

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
  const [currency, setCurrency] = useState(() => readDisplayCurrency("USD"));
  // The rate table is fetched, so a price can be rendered before it lands. See
  // the same note in useDisplayCurrency: this re-render is the whole point.
  const [, setRateGeneration] = useState(0);

  useEffect(() => {
    const onRates = () => setRateGeneration((n) => n + 1);
    window.addEventListener(FX_UPDATED_EVENT, onRates);
    return () => window.removeEventListener(FX_UPDATED_EVENT, onRates);
  }, []);

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
    const onCurrency = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (typeof next === "string" && /^[A-Z]{3}$/.test(next)) setCurrency(next);
    };
    window.addEventListener(DISPLAY_CURRENCY_EVENT, onCurrency);
    return () => {
      alive = false;
      window.removeEventListener(DISPLAY_CURRENCY_EVENT, onCurrency);
    };
  }, [userId]);

  return (cents: number) => formatLocalPrice(cents, currency);
};
