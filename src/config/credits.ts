// ============================================================================
// VAYLO SPORTS — CREDIT ECONOMY: SINGLE SOURCE OF TRUTH (Phase 3)
// ----------------------------------------------------------------------------
// Every credit-related value in the app lives here. Nothing anywhere else may
// hard-code a credit amount. These are the *defaults*; the `economy_config`
// table (admin editable, see /admin/pricing) overrides them at runtime and the
// database enforces the authoritative cost inside `credits_spend()`.
// ============================================================================

/** Credits granted to a brand-new account (mirrors DB `starting_credits()`). */
export const STARTING_CREDITS = 50;

// ---------------------------------------------------------------------------
// Feature costs — the ONLY place client-side costs are declared
// ---------------------------------------------------------------------------
export type FeatureCostKey =
  | "archetype_view"
  | "development_trajectory"
  | "cross_sport_unlock"
  | "training_plan_week"
  | "limiter_fix_plan"
  | "form_analysis_unlock"
  | "video_form_analysis"
  | "injury_management_unlock"
  | "calorie_scan"
  | "nutrition_plan_week"
  | "nutrition_pack_unlock"
  | "mental_gym_unlock"
  | "vaylo_coach_message"
  | "weekly_coach_review"
  | "tactical_prep"
  | "learning_unlock"
  | "streak_shield";

export const FEATURE_COSTS: Record<FeatureCostKey, number> = {
  archetype_view: 19,
  development_trajectory: 5,
  cross_sport_unlock: 19,
  training_plan_week: 5,
  limiter_fix_plan: 24,
  form_analysis_unlock: 54,
  video_form_analysis: 12,
  injury_management_unlock: 29,
  calorie_scan: 10,
  nutrition_plan_week: 4,
  nutrition_pack_unlock: 39,
  mental_gym_unlock: 39,
  vaylo_coach_message: 3,
  weekly_coach_review: 3,
  tactical_prep: 5,
  learning_unlock: 29,
  streak_shield: 3,
};

/** Human labels for history / receipts. */
export const FEATURE_LABELS: Record<FeatureCostKey, string> = {
  archetype_view: "Athlete Archetype",
  development_trajectory: "Development Trajectory",
  cross_sport_unlock: "Cross-Sport Analysis",
  training_plan_week: "AI Training Plan (per week)",
  limiter_fix_plan: "Limiter Fix Plan",
  form_analysis_unlock: "Form Analysis unlock",
  video_form_analysis: "AI Video Form Analysis",
  injury_management_unlock: "Injury Management unlock",
  calorie_scan: "AI Calorie Scan",
  nutrition_plan_week: "Nutrition Plan (per week)",
  nutrition_pack_unlock: "Nutrition Pack unlock",
  mental_gym_unlock: "Mental Gym unlock",
  vaylo_coach_message: "Vaylo Sports Coach message",
  weekly_coach_review: "Weekly Coach Review",
  tactical_prep: "Tactical Analysis",
  learning_unlock: "Learning Hub unlock",
  streak_shield: "Streak Shield",
};

/** Features that are permanent one-off unlocks (entitlements). */
export const PERMANENT_UNLOCKS: FeatureCostKey[] = [
  "form_analysis_unlock",
  "injury_management_unlock",
  "nutrition_pack_unlock",
  "mental_gym_unlock",
  "learning_unlock",
  "cross_sport_unlock",
];

/** AI-metered features (charged per use). */
export const AI_USAGE_FEATURES: FeatureCostKey[] = [
  "vaylo_coach_message",
  "weekly_coach_review",
  "calorie_scan",
  "video_form_analysis",
  "tactical_prep",
  "training_plan_week",
  "nutrition_plan_week",
  "development_trajectory",
  "archetype_view",
];

// ---------------------------------------------------------------------------
// Credit packs (display defaults; regional tiers may override)
// ---------------------------------------------------------------------------
export type CreditPackConfig = {
  id: string; credits: number; bonus: number; price_cents: number;
  label?: string; popular?: boolean; best_value?: boolean;
};

export const CREDIT_PACKS: CreditPackConfig[] = [
  { id: "pack_25",  credits: 25,  bonus: 0,   price_cents: 249,  label: "Starter" },
  { id: "pack_50",  credits: 50,  bonus: 10,  price_cents: 499,  label: "Boost" },
  { id: "pack_120", credits: 120, bonus: 25,  price_cents: 999,  label: "Popular", popular: true },
  { id: "pack_200", credits: 200, bonus: 50,  price_cents: 1499, label: "Power" },
  { id: "pack_500", credits: 500, bonus: 150, price_cents: 2499, label: "Max", best_value: true },
];

// ---------------------------------------------------------------------------
// Subscription credit allowance (subscriptions themselves are out of scope)
// ---------------------------------------------------------------------------
export const MONTHLY_ALLOWANCE = {
  /** Credit Plan monthly refill. */
  credit_plan: 100,
  /** Maximum credits that can roll over between cycles. */
  rollover_limit: 300,
};

// ---------------------------------------------------------------------------
// Promotional / reward credit values (all grants go through credits_grant)
// ---------------------------------------------------------------------------
export type PromoBonusKey =
  | "referral_referrer"
  | "referral_referee"
  | "arcade_record"
  | "winback";

export const PROMO_BONUSES: Record<PromoBonusKey, number> = {
  referral_referrer: 50,
  referral_referee: 25,
  arcade_record: 10,
  winback: 20,
};

/** 7-day daily reward ladder (credits per consecutive day). */
export const DAILY_REWARDS = [2, 3, 4, 5, 6, 8, 12];

// ---------------------------------------------------------------------------
// Credit sources — recorded on every transaction row
// ---------------------------------------------------------------------------
export const CREDIT_SOURCES = [
  "starter",
  "subscription_refill",
  "credit_pack",
  "arcade",
  "referral",
  "promo",
  "admin_grant",
  "daily_reward",
  "chest",
  "app",
  "unlimited_plan",
] as const;
export type CreditSource = typeof CREDIT_SOURCES[number];
