// ============================================================================
// VAYLO SPORTS — SINGLE SOURCE OF TRUTH FOR MONETISATION (Phase 1)
// ----------------------------------------------------------------------------
// Every monetisation screen, paywall, and edge-function price MUST read from
// this file (or from the remote `economy_config` overrides layered on top of
// the defaults declared here). No hard-coded prices anywhere else.
//
// PHASE 1 SCOPE: cleanup only. Legacy tier products are marked deprecated and
// are no longer purchasable, but historical entitlements are still honoured.
// New product values are intentionally left as PLACEHOLDERS for Phase 2.
// ============================================================================

export type ProductStatus = "active" | "deprecated" | "placeholder";

export type MonetisationProduct = {
  id: string;
  name: string;
  /** "credit_pack" | "subscription" | "unlimited" | "feature_unlock" | "event_pack" */
  kind: "credit_pack" | "subscription" | "unlimited" | "feature_unlock" | "event_pack";
  status: ProductStatus;
  /** null = price not decided yet (Phase 2) */
  price_cents: number | null;
  credits?: number | null;
  bonus?: number | null;
  period?: "month" | "year" | "lifetime" | null;
  label?: string;
  /** Why it is deprecated / what replaces it */
  note?: string;
};

// ---------------------------------------------------------------------------
// 1. DEPRECATED LEGACY PRODUCTS — purchase blocked, entitlements grandfathered
// ---------------------------------------------------------------------------
export const DEPRECATED_PRODUCT_IDS = [
  "sub_minimum_monthly",
  "sub_premium_monthly",
  "sub_pro_monthly",
  "sub_pro_yearly",
  "sub_elite_monthly",
  "sub_elite_yearly",
  "plan_free",
  "plan_minimum",
  "plan_pro",
  "plan_elite",
] as const;

/** Legacy `subscriptions.plan_type` values that must no longer be sold. */
export const DEPRECATED_PLAN_TYPES = ["minimum", "pro", "elite", "premium"] as const;

export const LEGACY_PRODUCTS: MonetisationProduct[] = [
  { id: "sub_minimum_monthly", name: "Minimum Plan", kind: "subscription", status: "deprecated", price_cents: 299, credits: 150, period: "month", note: "Replaced in Phase 2 by the new credit subscription." },
  { id: "sub_premium_monthly", name: "Premium Plan", kind: "subscription", status: "deprecated", price_cents: 999, period: "month", note: "Replaced in Phase 2 by the unlimited option." },
  { id: "plan_pro", name: "Pro tier", kind: "subscription", status: "deprecated", price_cents: 999, period: "month", note: "Tier-based gating removed; features now credit-based." },
  { id: "plan_elite", name: "Elite tier", kind: "subscription", status: "deprecated", price_cents: 1999, period: "month", note: "Tier-based gating removed; features now credit-based." },
];

export const isDeprecatedProduct = (productId?: string | null) =>
  !!productId && (DEPRECATED_PRODUCT_IDS as readonly string[]).includes(productId);

export const isDeprecatedPlanType = (planType?: string | null) =>
  !!planType && (DEPRECATED_PLAN_TYPES as readonly string[]).includes(planType);

// ---------------------------------------------------------------------------
// 2. PHASE 2 PLACEHOLDERS — shapes only, no final pricing decided
// ---------------------------------------------------------------------------
export type PaywallOptionKind = "credits" | "subscription" | "unlimited";

export const PAYWALL_OPTIONS: {
  kind: PaywallOptionKind;
  title: string;
  description: string;
}[] = [
  { kind: "credits", title: "Buy credits", description: "One-off credit top-up, spend on any feature." },
  { kind: "subscription", title: "Credit subscription", description: "Monthly credit allowance, auto-refilled." },
  { kind: "unlimited", title: "Unlimited", description: "Unlimited credits across every feature." },
];

/** Reserved slots for Phase 2. Prices deliberately null. */
export const PLACEHOLDER_PRODUCTS: MonetisationProduct[] = [
  { id: "new_credit_subscription", name: "Credit Subscription (TBD)", kind: "subscription", status: "placeholder", price_cents: null, credits: null, period: "month" },
  { id: "new_unlimited", name: "Unlimited (TBD)", kind: "unlimited", status: "placeholder", price_cents: null, period: "month" },
  { id: "new_lifetime", name: "Lifetime (TBD)", kind: "unlimited", status: "placeholder", price_cents: null, period: "lifetime" },
];

// ---------------------------------------------------------------------------
// 3. CREDIT PRODUCTS — re-exported from the credit economy config
//    (src/config/credits.ts is the single source of truth for credit values)
// ---------------------------------------------------------------------------
export type { CreditPackConfig, FeatureCostKey } from "@/config/credits";
export { CREDIT_PACKS, FEATURE_COSTS, STARTING_CREDITS } from "@/config/credits";

export type UnlimitedPackConfig = {
  id: string; price_cents: number; period: "lifetime" | "month" | "year";
  label: string; best_value?: boolean;
};

export const UNLIMITED_PACKS: UnlimitedPackConfig[] = [
  { id: "infinite_lifetime", price_cents: 4999, period: "lifetime", label: "Lifetime" },
  { id: "infinite_monthly",  price_cents: 299,  period: "month",    label: "Monthly" },
  { id: "infinite_yearly",   price_cents: 2499, period: "year",     label: "Yearly", best_value: true },
];



// ---------------------------------------------------------------------------
// 5. FEATURE ENTITLEMENT KEYS — used for grandfathered/one-off unlocks
// ---------------------------------------------------------------------------
export const FEATURE_ENTITLEMENTS = [
  "form_analysis",
  "injury_management",
  "nutrition_pack",
  "mental_gym",
  "coach_pro",
  "hrv_insights",
] as const;

export type FeatureEntitlement = typeof FEATURE_ENTITLEMENTS[number];
