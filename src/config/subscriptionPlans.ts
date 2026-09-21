// ============================================================================
// VAYLO SPORTS — PHASE 2 SUBSCRIPTION CATALOGUE (single source of truth)
// ----------------------------------------------------------------------------
// Only TWO plans exist: the Credit Plan and the Unlimited Plan.
// Each plan has three billing periods (month / year / lifetime).
// Prices mirror `public.subscription_plans` in the database — the DB row wins
// at runtime (see useSubscriptionPlans), this file is the offline fallback.
//
// Adding a future plan = append a PlanDefinition here + a row in
// subscription_plans. No other file needs to change.
// ============================================================================

export type BillingPeriod = "month" | "year" | "lifetime";

/** The only entitlement types in the new system. */
export type EntitlementKey = "monthly_credit_allowance" | "unlimited_credits";

export type PlanKey = "free" | "credit" | "unlimited";

export type SubscriptionStatus = "free" | "trial" | "active" | "expired" | "cancelled";

export type PlanOption = {
  /** Stable product id, matches subscription_plans.product_id */
  product_id: string;
  period: BillingPeriod;
  price_pence: number;
  best_value?: boolean;
};

export type PlanDefinition = {
  plan_key: PlanKey;
  name: string;
  tagline: string;
  /** Entitlements granted by this plan. */
  entitlements: {
    monthly_credit_allowance: number;
    unlimited_credits: boolean;
  };
  /** Max credits that can be carried into the next cycle (backend-configurable). */
  credit_rollover_limit: number;
  /** Fair usage ceiling on AI calls per day (null = unlimited). */
  fair_usage_daily_ai_calls: number | null;
  priority_ai: boolean;
  benefits: string[];
  options: PlanOption[];
};

export const CURRENCY = { code: "GBP", symbol: "£" } as const;

export const formatPence = (pence: number) =>
  `${CURRENCY.symbol}${(pence / 100).toFixed(2)}`;

export const PERIOD_LABEL: Record<BillingPeriod, string> = {
  month: "Monthly",
  year: "Yearly",
  lifetime: "Lifetime",
};

export const PERIOD_SUFFIX: Record<BillingPeriod, string> = {
  month: "/mo",
  year: "/yr",
  lifetime: "one-off",
};

export const CREDIT_PLAN: PlanDefinition = {
  plan_key: "credit",
  name: "Credit Plan",
  tagline: "100 credits topped up every month.",
  entitlements: { monthly_credit_allowance: 100, unlimited_credits: false },
  credit_rollover_limit: 300,
  fair_usage_daily_ai_calls: null,
  priority_ai: false,
  benefits: [
    "100 credits added automatically every month",
    "Spend credits anywhere credits are accepted",
    "Unused credits roll over (up to your rollover limit)",
    "See your next credit refill date any time",
  ],
  options: [
    { product_id: "credit_monthly", period: "month", price_pence: 549 },
    { product_id: "credit_yearly", period: "year", price_pence: 5999, best_value: true },
    { product_id: "credit_lifetime", period: "lifetime", price_pence: 12999 },
  ],
};

export const UNLIMITED_PLAN: PlanDefinition = {
  plan_key: "unlimited",
  name: "Unlimited Plan",
  tagline: "Unlimited credits. Nothing is ever deducted.",
  entitlements: { monthly_credit_allowance: 0, unlimited_credits: true },
  credit_rollover_limit: 0,
  fair_usage_daily_ai_calls: 400,
  priority_ai: true,
  benefits: [
    "Unlimited credits across every feature",
    "No credit deductions, ever",
    "Priority AI processing (rolling out)",
    "Future premium AI features included automatically",
  ],
  options: [
    { product_id: "unlimited_monthly", period: "month", price_pence: 899 },
    { product_id: "unlimited_yearly", period: "year", price_pence: 7999, best_value: true },
    { product_id: "unlimited_lifetime", period: "lifetime", price_pence: 34999 },
  ],
};

export const SUBSCRIPTION_PLANS: PlanDefinition[] = [CREDIT_PLAN, UNLIMITED_PLAN];

export const getPlan = (key?: string | null) =>
  SUBSCRIPTION_PLANS.find((p) => p.plan_key === key) || null;

export const getPlanOption = (productId?: string | null) => {
  for (const plan of SUBSCRIPTION_PLANS) {
    const opt = plan.options.find((o) => o.product_id === productId);
    if (opt) return { plan, option: opt };
  }
  return null;
};

export const PLAN_LABEL: Record<PlanKey, string> = {
  free: "Free",
  credit: "Credit Plan",
  unlimited: "Unlimited Plan",
};

/** Default fair usage policy — overridable from the backend per plan row. */
export const FAIR_USAGE_POLICY = {
  enabled: true,
  window: "24h",
  default_daily_ai_calls: 400,
  message:
    "Unlimited means unlimited for normal athlete use. Extreme automated usage may be rate limited to keep the service fast for everyone.",
} as const;
