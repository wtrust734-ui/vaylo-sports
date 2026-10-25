// Tests for the shared display-rate table (src/lib/fxRates.ts).
//
// The bug these lock down: prices were converted with a hand-typed table that
// never changed, so a GBP price was ~5% high and an INR price ~14% high. The
// three properties that make it correct now:
//
//   * a validated feed replaces the published table (and is cached);
//   * an unusable feed — inverted base, wild value — is rejected whole rather
//     than half-applied, leaving the last good table in place;
//   * an offline device still formats, from the published fallback.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FX_UPDATED_EVENT,
  PUBLISHED_USD_RATES,
  __resetFxRatesForTests,
  fxRateSource,
  getUsdRate,
  refreshFxRates,
} from "./fxRates";

const CACHE_KEY = "vaylo:fx:usd:v1";

const LIVE_GBP = 0.751;

/** A payload shaped like the provider's, with rates that pass validation. */
const payload = (over: Record<string, number> = {}) => ({
  result: "success",
  base_code: "USD",
  rates: {
    ...PUBLISHED_USD_RATES,
    GBP: LIVE_GBP,
    EUR: 0.9,
    ...over,
  },
});

const respond = (body: unknown, ok = true) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response),
  );

beforeEach(() => {
  localStorage.clear();
  __resetFxRatesForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("live rates", () => {
  it("adopts a validated feed, caches it and tells mounted prices to re-render", async () => {
    respond(payload());
    const heard = vi.fn();
    window.addEventListener(FX_UPDATED_EVENT, heard);

    expect(await refreshFxRates()).toBe(true);
    expect(getUsdRate("GBP")).toBe(LIVE_GBP);
    expect(getUsdRate("USD")).toBe(1);
    expect(fxRateSource()).toBe("live");
    expect(heard).toHaveBeenCalledTimes(1);

    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
    expect(cached.rates.GBP).toBe(LIVE_GBP);

    window.removeEventListener(FX_UPDATED_EVENT, heard);
  });

  it("rejects an inverted table instead of showing every price in the wrong base", async () => {
    // A provider answering per-GBP rather than per-USD: "USD" is no longer 1.
    respond({
      result: "success",
      rates: { ...PUBLISHED_USD_RATES, USD: 1.338, GBP: 1 },
    });

    expect(await refreshFxRates()).toBe(false);
    expect(fxRateSource()).toBe("published");
    expect(getUsdRate("GBP")).toBe(PUBLISHED_USD_RATES.GBP);
  });

  it("rejects a table with one wildly wrong value rather than applying it", async () => {
    respond(payload({ JPY: 1.2 }));
    expect(await refreshFxRates()).toBe(false);
    expect(getUsdRate("JPY")).toBe(PUBLISHED_USD_RATES.JPY);
  });

  it("keeps the published table when the provider is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));

    expect(await refreshFxRates()).toBe(false);
    expect(getUsdRate("GBP")).toBe(PUBLISHED_USD_RATES.GBP);
    expect(getUsdRate("ZZZ")).toBe(1);
  });

  it("does not fetch again inside the cache window", async () => {
    respond(payload());
    expect(await refreshFxRates()).toBe(true);
    expect(await refreshFxRates()).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("hydrates from a fresh cache before any network call", async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ rates: { ...PUBLISHED_USD_RATES, GBP: LIVE_GBP }, fetchedAt: Date.now() }),
    );
    __resetFxRatesForTests();

    expect(fxRateSource()).toBe("live");
    expect(getUsdRate("GBP")).toBe(LIVE_GBP);
  });

  it("ignores an expired cache", async () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        rates: { ...PUBLISHED_USD_RATES, GBP: LIVE_GBP },
        fetchedAt: Date.now() - 7 * 60 * 60 * 1000,
      }),
    );
    __resetFxRatesForTests();

    expect(fxRateSource()).toBe("published");
    expect(getUsdRate("GBP")).toBe(PUBLISHED_USD_RATES.GBP);
  });
});
