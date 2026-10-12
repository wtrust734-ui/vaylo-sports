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
    // Repriced 2026-10-12, from £129.99. This option is not metered — it pays
    // out 100 credits every month for as long as the account exists — so it has
    // to be priced against the credits it will ever hand over, not against the
    // first month. At the pack rate (about £0.06 a credit, see credits.ts) it
    // was promising roughly £6 of credits a month, which it recovered in under
    // two years and then paid out of our pocket for the rest of the athlete's
    // life. 12999 → 34999 is about 58 months of that promise: beyond the point
    // where almost every buyer has stopped training on it, and still the
    // cheapest way to buy credits in bulk for anyone who does keep going.
    { product_id: "credit_lifetime", period: "lifetime", price_pence: 34999 },
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
  // Repriced 2026-10-12, from £8.99 / £79.99 / £349.99.
  //
  // Unlimited is the one product whose cost is set by how hard the athlete
  // uses it rather than by what we sell: nothing is deducted, so every AI call
  // — a video analysis, a plan, a nutrition week — is paid for by us instead
  // of by credits. A subscriber who runs twenty video analyses a month was
  // costing more in provider fees than £8.99 cleared after store commission,
  // and the lifetime option made that exposure permanent for a single payment.
  //
  // The rates below are set so the worst-case athlete still pays for themselves
  // with room to spare: £19.99 a month is roughly £14 net of Google Play's 30%,
  // and the fair-usage ceiling on this plan (400 AI calls a day, enforced in
  // the database) is what keeps the tail of usage from running away. Lifetime
  // is 30 months of the monthly price, paid once, which is past the horizon a
  // one-off purchase should be financing and still a real discount for someone
  // who means to train for years.
  options: [
    { product_id: "unlimited_monthly", period: "month", price_pence: 1999 },
    { product_id: "unlimited_yearly", period: "year", price_pence: 17999, best_value: true },
    { product_id: "unlimited_lifetime", period: "lifetime", price_pence: 59999 },
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
