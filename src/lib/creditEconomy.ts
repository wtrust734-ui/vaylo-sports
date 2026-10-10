// Vaylo Sports — Credit Economy Configuration
// Scalable, regionalized, remote-configurable economy.
// Local defaults are merged with remote config from `economy_config` table.

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
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
const CURRENCY_INFO: Record<string, { symbol: string; rate: number }> = {
  USD: { symbol: "$",   rate: 1 },
  GBP: { symbol: "£",   rate: 0.79 },
  EUR: { symbol: "€",   rate: 0.92 },
  CAD: { symbol: "C$",  rate: 1.36 },
  AUD: { symbol: "A$",  rate: 1.52 },
  NZD: { symbol: "NZ$", rate: 1.64 },
  CHF: { symbol: "CHF ",rate: 0.88 },
  NOK: { symbol: "kr ", rate: 10.8 },
  DKK: { symbol: "kr ", rate: 6.9 },
  SEK: { symbol: "kr ", rate: 10.5 },
  PLN: { symbol: "zł ", rate: 3.95 },
  CZK: { symbol: "Kč ", rate: 23 },
  JPY: { symbol: "¥",   rate: 152 },
  KRW: { symbol: "₩",   rate: 1340 },
  BRL: { symbol: "R$",  rate: 5.1 },
  MXN: { symbol: "MX$", rate: 17.5 },
  TRY: { symbol: "₺",   rate: 32 },
  ZAR: { symbol: "R",   rate: 18.5 },
  THB: { symbol: "฿",   rate: 36 },
  MYR: { symbol: "RM",  rate: 4.7 },
  IDR: { symbol: "Rp ", rate: 15800 },
  COP: { symbol: "COL$", rate: 4000 },
  INR: { symbol: "₹",   rate: 83 },
  PKR: { symbol: "₨",   rate: 278 },
  BDT: { symbol: "৳",   rate: 110 },
  NGN: { symbol: "₦",   rate: 1500 },
  KES: { symbol: "KSh", rate: 130 },
  EGP: { symbol: "E£",  rate: 48 },
  VND: { symbol: "₫",   rate: 25000 },
  PHP: { symbol: "₱",   rate: 56 },
};

export function getCurrencyInfo(currency: string) {
  return CURRENCY_INFO[currency] || CURRENCY_INFO.USD;
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

export function formatLocalPrice(priceCents: number, currencyOrCountry: string): string {
  const currency = CURRENCY_INFO[currencyOrCountry] ? currencyOrCountry : "USD";
  const info = getCurrencyInfo(currency);
  const localAmount = (priceCents / 100) * info.rate;
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
  event_type: "view" | "add_to_basket" | "purchase" | "offer_view" | "offer_convert";
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
