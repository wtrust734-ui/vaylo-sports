// Vaylo Sports — Credit Economy Configuration
// Scalable, regionalized, remote-configurable economy.
// Local defaults are merged with remote config from `economy_config` table.

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getUsdRate } from "@/lib/fxRates";
import { isOfferLive } from "@/lib/offerWindow";

export type CreditPack = {
  id: string;
  credits: number;
  bonus: number;
  price_cents: number;
  label?: string;
  popular?: boolean;
  best_value?: boolean;
};

export type InfinitePack = {
  id: string;
  price_cents: number;
  period: "lifetime" | "month" | "year";
  label: string;
  best_value?: boolean;
};

export type SpecialOffer = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  offer_type: "starter" | "limited" | "double_credits" | "loyalty" | "winback";
  pack_id: string | null;
  bonus_multiplier: number;
  bonus_flat: number;
  price_cents: number | null;
  target_audience: string;
  starts_at: string | null;
  ends_at: string | null;
};

// Values live in the single monetisation config — never duplicate them here.
export type { FeatureCostKey } from "@/config/monetisation";
import {
  CREDIT_PACKS,
  UNLIMITED_PACKS,
  FEATURE_COSTS,
  type FeatureCostKey,
} from "@/config/monetisation";

export const DEFAULT_PACKS: CreditPack[] = CREDIT_PACKS;
export const DEFAULT_INFINITE: InfinitePack[] = UNLIMITED_PACKS;
export const DEFAULT_FEATURE_COSTS: Record<FeatureCostKey, number> = FEATURE_COSTS;


// --- Currency catalog (display only — IAP store handles actual charge) ---
//
// Symbols live here; RATES do not. The rate was a hand-typed constant per
// currency and went stale the day it was written (GBP was 0.79 when the real
// rate was 0.748, so every price read ~5% high and the athlete saw a different
// number wherever else they looked). `getUsdRate` reads one shared table that
// is refreshed daily and cached — see src/lib/fxRates.ts. This file keeps only
// what a feed cannot give us: the glyph and the allowlist of currencies the app
// is willing to display.
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  CAD: "C$",
  AUD: "A$",
  NZD: "NZ$",
  CHF: "CHF ",
  NOK: "kr ",
  DKK: "kr ",
  SEK: "kr ",
  PLN: "zł ",
  CZK: "Kč ",
  JPY: "¥",
  KRW: "₩",
  BRL: "R$",
  MXN: "MX$",
  TRY: "₺",
  ZAR: "R",
  THB: "฿",
  MYR: "RM",
  IDR: "Rp ",
  COP: "COL$",
  INR: "₹",
  PKR: "₨",
  BDT: "৳",
  NGN: "₦",
  KES: "KSh",
  EGP: "E£",
  VND: "₫",
  PHP: "₱",
};

const SUPPORTED_CURRENCIES = new Set(Object.keys(CURRENCY_SYMBOLS));

export function getCurrencyInfo(currency: string) {
  const code = SUPPORTED_CURRENCIES.has(currency) ? currency : "USD";
  return { symbol: CURRENCY_SYMBOLS[code], rate: getUsdRate(code) };
}

// Legacy shim — older callers passed country codes
export function getRegionInfo(_country?: string) {
  return { currency: "USD", symbol: "$", rate: 1 };
}

export async function detectRegion(): Promise<{ country: string; currency: string; tier_code: string }> {
  try {
    const cached = localStorage.getItem("vaylo:region:v2");
    if (cached) return JSON.parse(cached);
  } catch { /* corrupted cache or storage unavailable — fall through to detection */ }

  let country = "US";
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
    const region = (locale.split("-")[1] || "US").toUpperCase();
    if (region) country = region;
  } catch { /* locale API unavailable */ }

  const { data: map } = await supabase
    .from("country_pricing_map")
    .select("country_code, tier_code, currency")
    .eq("country_code", country)
    .maybeSingle();

  const result = map
    ? { country, currency: map.currency, tier_code: map.tier_code }
    : { country: "US", currency: "USD", tier_code: "A" };

  try { localStorage.setItem("vaylo:region:v2", JSON.stringify(result)); } catch { /* storage unavailable */ }
  return result;
}

/**
 * Margin added to every price that is not in GBP (2.5%).
 *
 * GBP is the currency the price list is written in, so a GBP price is the price.
 * Every other number on a price tag is a conversion, and converting costs
 * money: the card network charges a cross-border fee, the processor charges a
 * non-GBP settlement fee, and the rate the feed publishes is the mid-market
 * rate, which nobody actually gets. Absorbing all of that made a non-GBP sale
 * quietly worth less than the same sale in GBP. A small, explicit margin keeps
 * the take per sale the same in every market; it is applied here, at the one
 * place a price becomes a string, so the market, the top-up sheets, the starter
 * offer and the subscription plans cannot disagree about it.
 *
 * This is a pricing decision, not a conversion — the conversion itself stays
 * exact, and is refreshed from the live table (src/lib/fxRates.ts).
 */
export const NON_GBP_PRICE_MARGIN = 0.025;

export function formatLocalPrice(priceCents: number, currencyOrCountry: string): string {
  const currency = SUPPORTED_CURRENCIES.has(currencyOrCountry) ? currencyOrCountry : "USD";
  const info = getCurrencyInfo(currency);
  const margin = currency === "GBP" ? 1 : 1 + NON_GBP_PRICE_MARGIN;
  const localAmount = (priceCents / 100) * info.rate * margin;
  const display = info.rate >= 50
    ? Math.round(localAmount).toLocaleString()
    : localAmount.toFixed(2);
  return `${info.symbol}${display}`;
}

// --- Remote config loader ---
type RemoteConfig = {
  packs: CreditPack[];
  infinite: InfinitePack[];
  featureCosts: Record<FeatureCostKey, number>;
  offers: SpecialOffer[];
  region: { country: string; currency: string; tier_code: string };
};

export async function loadEconomyConfig(): Promise<RemoteConfig> {
  const region = await detectRegion();

  const [{ data: tierRow }, { data: cfgRows }, { data: offerRows }] = await Promise.all([
    supabase.from("pricing_tiers").select("*").eq("code", region.tier_code).eq("active", true).maybeSingle(),
    supabase.from("economy_config").select("*").in("region", [region.country, "GLOBAL"]).eq("active", true),
    supabase.from("special_offers").select("*").eq("active", true).in("region", [region.country, "GLOBAL"]),
  ]);

  const byKey = new Map<string, { key: string; region: string; value: unknown }>();
  for (const row of cfgRows || []) {
    // Region-specific overrides global
    const existing = byKey.get(row.key);
    if (!existing || (existing.region === "GLOBAL" && row.region !== "GLOBAL")) {
      byKey.set(row.key, row);
    }
  }

  // Tiered pricing takes precedence over global economy_config rows
  const tierPacks = tierRow?.packs as CreditPack[] | undefined;
  const tierInfinite = tierRow?.infinite as InfinitePack[] | undefined;
  const packs = tierPacks ?? (byKey.get("credit_packs")?.value as CreditPack[]) ?? DEFAULT_PACKS;
  const infinite = tierInfinite ?? (byKey.get("infinite_packs")?.value as InfinitePack[]) ?? DEFAULT_INFINITE;
  const featureCosts = {
    ...DEFAULT_FEATURE_COSTS,
    ...(byKey.get("feature_costs")?.value as Record<FeatureCostKey, number> ?? {}),
  };

  // Rows outside their own window are dropped here rather than trusted
  // downstream. The database is authoritative — its SELECT policy hides
  // out-of-window rows — but a cached or service-role-fetched row must not be
  // able to drive a bonus either, because nothing ever clears `active` when an
  // offer's deadline passes.
  const offers: SpecialOffer[] = ((offerRows ?? []) as Array<Record<string, unknown>>)
    .map((o) => ({
      id: String(o.id),
      slug: String(o.slug),
      title: String(o.title),
      description: o.description == null ? null : String(o.description),
      offer_type: String(o.offer_type) as SpecialOffer["offer_type"],
      pack_id: o.pack_id == null ? null : String(o.pack_id),
      bonus_multiplier: Number(o.bonus_multiplier ?? 1),
      bonus_flat: Number(o.bonus_flat ?? 0),
      price_cents: Number(o.price_cents),
      target_audience: o.target_audience == null ? null : String(o.target_audience),
      starts_at: o.starts_at == null ? null : String(o.starts_at),
      ends_at: o.ends_at == null ? null : String(o.ends_at),
    }))
    .filter((o) => isOfferLive(o));

  return { packs, infinite, featureCosts, offers, region };
}

// --- Analytics tracking ---
export async function trackEconomyEvent(params: {
  event_type: "view" | "section_view" | "confirm_open" | "add_to_basket" | "purchase" | "offer_view" | "offer_convert";
  pack_id?: string;
  offer_slug?: string;
  amount_cents?: number;
  credits_granted?: number;
  bonus_granted?: number;
  metadata?: Record<string, unknown>;
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const region = await detectRegion();
    await supabase.from("purchase_analytics").insert({
      user_id: user.id,
      event_type: params.event_type,
      pack_id: params.pack_id ?? null,
      offer_slug: params.offer_slug ?? null,
      region: region.country,
      currency: region.currency,
      amount_cents: params.amount_cents ?? 0,
      credits_granted: params.credits_granted ?? 0,
      bonus_granted: params.bonus_granted ?? 0,
      metadata: (params.metadata ?? {}) as unknown as Json,
    });
  } catch {
    // Silent — analytics should never break UX
  }
}

// --- Apply offer to a pack ---
export function applyOffer(pack: CreditPack, offer: SpecialOffer | null): CreditPack {
  if (!offer || !isOfferLive(offer)) return pack;
  if (offer.pack_id && offer.pack_id !== pack.id) return pack;

  const bonus = Math.round(pack.bonus * (offer.bonus_multiplier ?? 1)) + (offer.bonus_flat ?? 0);
  return {
    ...pack,
    bonus,
    price_cents: offer.price_cents ?? pack.price_cents,
  };
}

export function getDoubleCreditsOffer(offers: SpecialOffer[]): SpecialOffer | null {
  return offers.find((o) => o.offer_type === "double_credits" && isOfferLive(o)) ?? null;
}
