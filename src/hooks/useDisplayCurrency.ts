// ============================================================================
// useDisplayCurrency — one display currency across every price surface
// ----------------------------------------------------------------------------
// The Profile screen writes the athlete's choice to `user_settings.currency`
// and caches it locally so prices can update before the network round trip.
// This hook reads that cache, listens for the immediate change event, and also
// picks up a change made in another tab. A price screen that only read the
// setting once on mount kept showing the old currency after the athlete changed
// it and came straight back.
// ============================================================================

import { useEffect, useState } from "react";
import { FX_UPDATED_EVENT } from "@/lib/fxRates";

export const DISPLAY_CURRENCY_KEY = "vaylo:display-currency";
export const DISPLAY_CURRENCY_EVENT = "vaylo:currency-changed";

/** The cached choice, or the caller's fallback when nothing has been chosen. */
export function readDisplayCurrency(fallback = "USD"): string {
  try {
    const cached = localStorage.getItem(DISPLAY_CURRENCY_KEY);
    if (cached && /^[A-Z]{3}$/.test(cached)) return cached;
  } catch {
    /* storage unavailable — the database value still applies */
  }
  return fallback;
}

/** Persist a choice and tell every mounted price surface to re-render now. */
export function setDisplayCurrency(currency: string): void {
  try {
    localStorage.setItem(DISPLAY_CURRENCY_KEY, currency);
  } catch {
    /* non-fatal */
  }
  try {
    window.dispatchEvent(new CustomEvent(DISPLAY_CURRENCY_EVENT, { detail: currency }));
  } catch {
    /* non-browser environment */
  }
}

export function useDisplayCurrency(fallback = "USD"): string {
  const [currency, setCurrency] = useState(() => readDisplayCurrency(fallback));
  // Rates arrive after first paint (they are fetched, not bundled). A price is
  // computed during render from the shared table, so the component has to be
  // told when that table is replaced or it keeps the stale conversion until
  // something else happens to re-render it. Nothing reads this value; the
  // state change IS the render.
  const [, setRateGeneration] = useState(0);

  useEffect(() => {
    const onRates = () => setRateGeneration((n) => n + 1);
    window.addEventListener(FX_UPDATED_EVENT, onRates);
    return () => window.removeEventListener(FX_UPDATED_EVENT, onRates);
  }, []);

  useEffect(() => {
    const onCurrency = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (typeof next === "string" && /^[A-Z]{3}$/.test(next)) setCurrency(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === DISPLAY_CURRENCY_KEY) setCurrency(readDisplayCurrency(fallback));
    };
    window.addEventListener(DISPLAY_CURRENCY_EVENT, onCurrency);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DISPLAY_CURRENCY_EVENT, onCurrency);
      window.removeEventListener("storage", onStorage);
    };
  }, [fallback]);

  // A verified account value can arrive after first paint (Market reads it in
  // its own effect). Only adopt it when the athlete has no cached choice, so a
  // deliberately chosen currency is never overwritten by a region default.
  useEffect(() => {
    try {
      if (!localStorage.getItem(DISPLAY_CURRENCY_KEY)) setCurrency(fallback);
    } catch {
      setCurrency(fallback);
    }
  }, [fallback]);

  return currency;
}
