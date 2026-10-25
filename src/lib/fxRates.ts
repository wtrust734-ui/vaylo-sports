// ============================================================================
// VAYLO SPORTS — display exchange rates
// ----------------------------------------------------------------------------
// Every price in the app is denominated in USD cents. Displaying it in another
// currency is a multiplication, and until now the multiplier was a hand-typed
// constant table: GBP 0.79, JPY 152, INR 83. Those numbers were correct on the
// day they were typed and wrong every day after, so a $9.99 pack showed £7.89
// when the honest conversion was £7.47 — about 5% high, and further out on the
// currencies that move faster (INR was 14% high). An athlete comparing Vaylo's
// price with anything else in their own currency saw the difference.
//
// This module owns ONE rate table, refreshed from a public daily feed and
// cached so prices still render offline:
//
//   published  — PUBLISHED_USD_RATES below. The offline fallback, refreshed by
//                hand when this file is touched. Never the primary source.
//   live       — the feed's rates for the current UTC day, cached for 6 hours.
//                Adopted only after validation, and discarded whole if the
//                payload looks wrong (see looksSane below) rather than
//                half-applied.
//
// Formatting stays synchronous: every price surface calls formatLocalPrice()
// during render, and a promise there would mean a flash of "$0.00". The table
// is therefore hydrated from cache at module load and swapped in place when a
// refresh lands, with an event so mounted prices re-render.
//
// The feed is ExchangeRate-API's open endpoint (open.er-api.com): no key, no
// account, daily update at 00:00 UTC. Its terms ask for attribution, shown in
// the Profile currency setting where the athlete actually chooses a currency.
// ============================================================================

/** Fired on `window` whenever the live table is replaced. */
export const FX_UPDATED_EVENT = "vaylo:fx-updated";

const CACHE_KEY = "vaylo:fx:usd:v1";
const ENDPOINT = "https://open.er-api.com/v6/latest/USD";
const TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

/**
 * USD → X, from ExchangeRate-API on 2026-10-25. This is the offline fallback;
 * the live feed supersedes it as soon as it answers. Keep this table and
 * CURRENCY_SYMBOLS in creditEconomy.ts in step — the symbol catalog is the
 * allowlist of currencies the app displays.
 */
export const PUBLISHED_USD_RATES: Readonly<Record<string, number>> = {
  USD: 1,
  GBP: 0.74768,
  EUR: 0.892628,
  CAD: 1.40039,
  AUD: 1.423077,
  NZD: 1.755731,
  CHF: 0.824784,
  NOK: 9.331084,
  DKK: 6.676237,
  SEK: 9.932479,
  PLN: 3.92779,
  CZK: 21.710808,
  JPY: 156.842558,
  KRW: 1324.821047,
  BRL: 5.044304,
  MXN: 18.682584,
  TRY: 49.741756,
  ZAR: 16.583315,
  THB: 33.75694,
  MYR: 4.084377,
  IDR: 18086.998885,
  COP: 3180.084041,
  INR: 95.001468,
  PKR: 276.820884,
  BDT: 123.715528,
  NGN: 1325.718117,
  KES: 129.836385,
  EGP: 55.281789,
  VND: 25817.343746,
  PHP: 63.634662,
};

type FxState = {
  rates: Record<string, number> | null;
  fetchedAt: number | null;
};

/**
 * A payload is adopted only if it is internally consistent for every currency
 * it claims. Two failure modes matter more than a missing currency:
 *
 *   • the base is not USD (a feed that answers "USD: 0.92" is quoting per GBP),
 *     which would invert every price in the app;
 *   • a single wild number, which a typo or a locale-formatted decimal throws.
 *
 * Both are caught by checking USD stayed 1 and every known currency is within
 * 3x of the published fallback. 3x is deliberately loose: it accepts a genuine
 * currency crisis and rejects an inverted or corrupted table.
 */
function looksSane(rates: Record<string, number>): boolean {
  if (rates.USD !== 1) return false;
  let checked = 0;
  for (const [code, fallback] of Object.entries(PUBLISHED_USD_RATES)) {
    const value = rates[code];
    // A provider dropping an exotic currency is not a reason to reject the
    // whole table: getUsdRate falls back per currency. A wild value is.
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value <= 0) return false;
    const ratio = value / fallback;
    if (ratio < 1 / 3 || ratio > 3) return false;
    checked++;
  }
  return checked >= 10;
}

function readCache(): FxState {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { rates: null, fetchedAt: null };
    const parsed = JSON.parse(raw) as { rates?: unknown; fetchedAt?: unknown };
    const fetchedAt = typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : null;
    if (!fetchedAt || Date.now() - fetchedAt > TTL_MS) return { rates: null, fetchedAt: null };
    if (!parsed.rates || typeof parsed.rates !== "object") return { rates: null, fetchedAt: null };
    const rates = Object.fromEntries(
      Object.entries(parsed.rates as Record<string, unknown>).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0,
      ),
    );
    if (!looksSane(rates)) return { rates: null, fetchedAt: null };
    return { rates, fetchedAt };
  } catch {
    // Corrupt cache or storage blocked: the published table is the fallback.
    return { rates: null, fetchedAt: null };
  }
}

let state: FxState = readCache();
let inFlight: Promise<boolean> | null = null;

/** USD → `currency`, live when available. Unknown codes fall back to 1. */
export function getUsdRate(currency: string): number {
  const code = currency.toUpperCase();
  const live = state.rates?.[code];
  if (typeof live === "number" && Number.isFinite(live) && live > 0) return live;
  return PUBLISHED_USD_RATES[code] ?? 1;
}

/** `live` once a validated feed has been adopted, `published` before that. */
export function fxRateSource(): "live" | "published" {
  return state.rates ? "live" : "published";
}

/** Epoch ms of the adopted feed, or null while on the published table. */
export function fxRatesFetchedAt(): number | null {
  return state.fetchedAt;
}

/**
 * Fetch and adopt today's rates.
 *
 * Resolves true when the table is live (freshly fetched, or already fresh from
 * cache), false when the feed was unreachable or rejected. Never throws: a
 * price screen must not fail because a rate provider is down.
 */
export async function refreshFxRates(force = false): Promise<boolean> {
  if (!force && state.rates && state.fetchedAt && Date.now() - state.fetchedAt < TTL_MS) {
    return true;
  }
  if (inFlight) return inFlight;

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;

  inFlight = (async () => {
    try {
      const response = await fetch(ENDPOINT, {
        signal: controller?.signal,
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { result?: string; rates?: Record<string, unknown> };
      if (body?.result !== "success" || !body.rates) return false;

      const rates = Object.fromEntries(
        Object.entries(body.rates).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0,
        ),
      );
      if (!looksSane(rates)) return false;

      const fetchedAt = Date.now();
      state = { rates, fetchedAt };
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ rates, fetchedAt }));
      } catch {
        // Private mode: this session still has the rates in memory.
      }
      try {
        window.dispatchEvent(new CustomEvent(FX_UPDATED_EVENT));
      } catch {
        // Non-browser environment.
      }
      return true;
    } catch {
      // Offline, aborted, DNS failure — keep whatever table is loaded.
      return false;
    } finally {
      if (timer) clearTimeout(timer);
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Kick a refresh from app startup without awaiting it. Cheap to call from
 * several places: the in-flight promise is shared and a fresh cache is a no-op.
 */
export function ensureFxRates(): void {
  void refreshFxRates();
}

/** Test seam: drop the in-memory table and rehydrate from the cache. */
export function __resetFxRatesForTests(): void {
  state = readCache();
  inFlight = null;
}
