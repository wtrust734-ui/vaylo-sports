// ============================================================================
// VAYLO SPORTS — CREDIT ECONOMY: SINGLE SOURCE OF TRUTH (Phase 3)
// ----------------------------------------------------------------------------
// Every credit-related value in the app lives here. Nothing anywhere else may
// hard-code a credit amount. These are the *defaults*; the `economy_config`
// table (admin editable, see /admin/pricing) overrides them at runtime and the
// database enforces the authoritative cost inside `credits_spend()`.
// ============================================================================

/** Credits granted to a brand-new account (mirrors DB `starting_credits()`).
 *
 * This is a MIRROR. The value that actually grants is `economy_config` key
 * `starting_credits` (GLOBAL), read by `public.starting_credits()` and applied
 * by `handle_new_user()`. Changing this constant alone changes nothing a new
 * athlete receives — the migration that changes the table is what matters, and
 * `startingCreditsMirror.test.ts` fails if the two ever disagree.
 *
 * Re-derived 2026-10-04 from scripts/credit-economy-model.mjs.
 *
 * The requirement this number exists to satisfy: a brand-new athlete must be
 * able to build an 8-week training plan on day one and still have the grant
 * left over to do a few other things with it. At the previous costs that was
 * impossible — an 8-week plan charged 8 x 42 = 336 credits against a 50-credit
 * grant, so a new account could afford ONE week and then hit a wall. A trial
 * that ends before the product has shown anything is not a trial.
 *
 * The grant is now spent like this (model script, "THE STARTING GRANT, SPENT"):
 *
 *   8-week training plan ......... 160   (8 x 20)
 *   AI calorie scan ..............  12
 *   3x coach message .............  24
 *   AI form analysis .............  15
 *   weekly coach review ..........  10
 *   4-week nutrition plan ........  60   (4 x 15, AI-written)
 *   ------------------------------------
 *   total ........................ 281
 *   granted ...................... 260
 *
 * That basket is no longer covered end to end — the AI nutrition plan is 60 of
 * it and the plan alone is 160 — so the honest statement is the one the grant
 * actually makes: an 8-week plan leaves 100 credits, which still buys the scan,
 * the form analysis and the review. The nutrition plan is a second purchase or
 * a Nutrition Pack, not part of the free basket.
 *
 * Giving that basket away costs about $0.04 in provider calls, so the whole
 * onboarding experience is effectively free and the grant is a conversion
 * argument rather than a cost.
 */
export const STARTING_CREDITS = 260;

// ---------------------------------------------------------------------------
// Feature costs — the ONLY place client-side costs are declared
// ---------------------------------------------------------------------------
export type FeatureCostKey =
  | "archetype_view"
  | "development_trajectory"
  | "cross_sport_unlock"
  | "training_plan_week"
  | "plan_edit"
  | "plan_edit_full"
  | "limiter_fix_plan"
  | "form_analysis"
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

// ---------------------------------------------------------------------------
// Pricing AI-backed features
// ---------------------------------------------------------------------------
// Every feature below calls a third-party model (OpenAI or Google) and costs us
// real money per use. They are priced so that revenue covers that cost many
// times over, rather than roughly breaking even — a metered API bill at
// break-even is a business that goes backwards the moment a user is heavy.
//
// The maths, so it can be re-checked rather than taken on trust:
//
//   Revenue per credit. The pack prices are CREDIT_PACKS below. Effective
//   credits include the bonus, so the biggest pack is the best deal and the
//   worst case for us:
//
//     Starter  25 credits / 249c  = 9.96 c/credit
//     Boost    60 / 499c          = 8.32
//     Popular  145 / 999c         = 6.89
//     Power   250 / 1499c         = 6.00
//     Elite    650 / 2499c         = 3.84   <- tier A; see the tiers below
//
//   That ladder is TIER A — and the pack ladder is regional (pricing_tiers,
//   mirrored in REGIONAL_TIERS below). price_cents are USD cents in every
//   tier: formatLocalPrice() converts to local currency for display, so tier
//   D really does sell the 650-credit pack at $9.99, not $24.99. The four
//   active tiers, best pack first:
//
//     Tier A  Premium   650 / 2499c = 3.845 c/credit
//     Tier B  Developed 650 / 1999c = 3.075
//     Tier C  Emerging  650 / 1499c = 2.306
//     Tier D  Growth    650 /  999c = 1.537  <- the number that matters
//
//   So $0.0153 per credit is what we can count on: every metered price below
//   clears MIN_MARGIN_MULTIPLE × its ceiling at THAT rate, in every market we
//   sell in — not only at the flattering tier-A rate, which overstated
//   revenue by 2.5× in eight countries and quietly put most AI features under
//   their own floor there (found by the 2026-10-03 regional audit; the test
//   suite re-derives all of this from REGIONAL_TIERS).
//
//   Cost ceilings. API_COST_CEILING_USD is a deliberate over-estimate of a
//   single call: we assume a larger, more expensive model than we would
//   actually choose, plus a long context and a generous output. It is a ceiling
//   we are willing to tolerate, not a measured provider price — provider
//   pricing changes and no provider is deployed yet (see ai-data-use.html).
//
//   If a real measured cost ever exceeds its ceiling, raise the credit cost
//   before raising anything else. The multiple below is the safety margin that
//   absorbs being wrong about the ceiling by a wide margin.
//
// AI_COST_CEILINGS documents the ceiling per feature so the ratio is auditable
// rather than a number someone picked.
export const API_COST_CEILING_USD = {
  // Re-derived 2026-10-04 from the models' own list prices x a token budget,
  // then doubled. scripts/credit-economy-model.mjs prints the working; these
  // are the numbers it produced.
  //
  // The previous ceilings were 20-100x the real cost, which is not a safety
  // margin — it is a different number. Because every feature price is derived
  // as (ceiling x MIN_MARGIN_MULTIPLE) / credit-value, an inflated ceiling
  // inflates every price with it. That is why an 8-week plan cost 336 credits
  // against a 50-credit grant: the model was working exactly as written, on
  // numbers that were never measured.
  //
  // Luna is $0.10/$0.50 per 1M tokens (stated in _shared/aiModels.ts); Sol is
  // $2.00/$10.00 and is used by limiter_analysis alone. Form and video analysis
  // run on Gemini Flash, whose price is NOT written down anywhere in this
  // repository — those two are an assumption, taken at Flash list price, and
  // are the numbers most likely to need revisiting once a provider is live.
  vaylo_coach_message: 0.0024, // 6k in / 1.2k out
  weekly_coach_review: 0.0024, // 6k in / 1.2k out
  training_plan_week: 0.00562, // 8k in / 4k out
  // The same per-week cost model as generating one: an edit sends the week it
  // is changing plus the instruction and gets a week back, so the ceiling is the
  // same shape, one week rather than a whole plan's worth of chunks.
  plan_edit: 0.003, // 5k in / 2.5k out
  plan_edit_full: 0.006, // every week rewritten in parallel, 2 weeks per call
  calorie_scan: 0.0014, // 2.5k in / 0.9k out
  // A nutrition plan is now written by the model (generate-nutrition-plan),
  // two weeks per call at ~6k in / ~8k out on Luna — about $0.0046 a call, so
  // ~$0.0023 a week — doubled for a bad token estimate. Until 2026-10-09 this
  // key had NO ceiling because the feature made no provider call at all: the
  // plan just stored the numbers the athlete typed in.
  nutrition_plan_week: 0.006,
  tactical_prep: 0.0029, // 7k in / 1.5k out
  development_trajectory: 0.0017, // 4k in / 0.9k out
  archetype_view: 0.0022, // 5k in / 1.2k out
  // 20k in / 3k out on Gemini Flash. This is the second most expensive call in
  // the app after the limiter plan, because a clip is many frames.
  video_form_analysis: 0.0272,
  form_analysis: 0.00715, // one photo, 2k in / 1.2k out
  // The largest single output in the app (limiter_analysis, 8000 output tokens
  // on Sol at $10/MTok).
  limiter_fix_plan: 0.1248,
} as const;

/**
 * The floor every metered feature has to clear, as a multiple of its ceiling.
 *
 * Eight, not two. The ceiling above is now a measured list price rather than a
 * guess, and the credit value it is divided by is NET of the store's cut, so
 * the multiple is doing one job only: absorbing a bad token estimate, a
 * provider price rise, or a retry.
 *
 * `pricing.test.ts` re-derives this for every AI feature and fails the suite if
 * one drops below it.
 */
export const MIN_MARGIN_MULTIPLE = 8;

/**
 * Worst-case revenue per credit, in USD, derived from REGIONAL_TIERS.
 *
 * $0.0105 = the cheapest NET revenue any real buyer produces: tier D's biggest
 * pack (660 credits for 999 USD-cents) after Google Play's 30% cut, which is
 * $0.010595 — rounded DOWN, the conservative direction.
 *
 * NET rather than gross is the important part, and it is a change. The previous
 * 0.0153 was the same pack's GROSS rate, so every margin this file claimed was
 * overstated by a third: the store's cut was never subtracted. Any price that
 * only cleared the floor on gross revenue was thinner than advertised. Pricing
 * off the net figure is the conservative direction — it raises the floor, which
 * is why several prices below came DOWN as the credit value did.
 *
 * Kept as a literal so pricing can be reasoned about without running code;
 * pricing.test.ts re-derives it from REGIONAL_TIERS (net of GOOGLE_PLAY_TAKE)
 * and fails if this drifts in either direction.
 */
export const WORST_CASE_USD_PER_CREDIT = 0.0105;

/**
 * The store's cut, used to turn a pack's price into the revenue we actually
 * keep. Google Play takes 30% of in-app credit sales, dropping to 15% once a
 * year's earnings pass $1M. Margin floors are measured against the 30% figure;
 * the 15% rate only ever makes the business look better, so it is never used
 * to justify a price.
 */
export const GOOGLE_PLAY_TAKE = 0.3;

export const FEATURE_COSTS: Record<FeatureCostKey, number> = {
  // Re-derived 2026-10-04. Every metered price below is
  //   ceil(ceiling x MIN_MARGIN_MULTIPLE / credit value),
  // rounded to a number a person can read on a button, with the working printed
  // by scripts/credit-economy-model.mjs. Margins are against NET revenue, so
  // every one of these is profitable AFTER Google Play's cut.
  //
  // Most prices FELL, and none of that is generosity: the old ceilings were
  // 20-100x the real provider cost, and every price was derived from them. The
  // effect on the athlete was an 8-week plan costing 336 credits against a
  // 50-credit starting grant — one week of the flagship product, then a wall.
  archetype_view: 10,
  development_trajectory: 8,
  cross_sport_unlock: 15,
  // 20 x 8 weeks = a full 8-week plan for 160 credits. This is the number the
  // whole economy is arranged around: the starting grant covers it exactly.
  training_plan_week: 20,
  // EDITING A PLAN YOU ALREADY OWN. Two prices, because they are two products:
  // a week (or a single session, which is the same call asked more narrowly) for
  // 10, and the whole plan rewritten for 20. Both are one OpenAI call per two
  // weeks, so both clear the margin floor several times over, and both are
  // deliberately far cheaper than the plan itself — an athlete who cannot afford
  // to change a plan they paid for is an athlete who abandons it.
  plan_edit: 10,
  plan_edit_full: 20,
  // The most expensive call in the app (Sol, $2/$10 per 1M, 8k output tokens) and
  // priced as such. It is still a one-off deep-dive, not a metered habit.
  limiter_fix_plan: 120,
  // A photo on Gemini Flash costs about $0.0036. 15 credits clears it 22x over
  // and, at the best pack, costs an athlete about 13 cents — small enough to be
  // an impulse, which is the point of the feature. Buy too many and the unlock
  // below becomes the better deal, exactly as it should.
  form_analysis: 15,
  // FLAT-RATE: one payment, unlimited photo analyses. The question is not the
  // 8x floor but how long break-even takes. At the net credit value this buys
  // $1.17 of revenue against $0.0036 per call, so it breaks even after 326
  // analyses — far beyond anything one athlete does — while still beating the
  // per-call price after 8 (110/15), so it stays sellable to anyone
  // photographing a lift regularly.
  form_analysis_unlock: 110,
  // A clip is many frames, so this is the second-costliest call in the app.
  video_form_analysis: 45,
  injury_management_unlock: 25,
  calorie_scan: 12,
  // AI-WRITTEN, per week, re-priced 8 -> 15 on 2026-10-09 when the model took
  // over the plan. Against a $0.006 ceiling this is 15 x $0.0105 = $0.1575 of
  // NET revenue on the worst pack in the worst market, i.e. 26x the ceiling and
  // comfortably past the 8x floor AFTER Google Play's 30% — the same figure the
  // suite re-derives. The scan above is 90x, so the two halves of this screen
  // are both profitable on their own; the Nutrition Pack (30 credits, once)
  // remains the cheaper route for anyone who scans or plans twice.
  nutrition_plan_week: 15,
  nutrition_pack_unlock: 30,
  mental_gym_unlock: 30,
  vaylo_coach_message: 8,
  weekly_coach_review: 10,
  tactical_prep: 12,
  learning_unlock: 25,
  streak_shield: 3,
};

/** Human labels for history / receipts. */
export const FEATURE_LABELS: Record<FeatureCostKey, string> = {
  archetype_view: "Athlete Archetype",
  development_trajectory: "Development Trajectory",
  cross_sport_unlock: "Cross-Sport Analysis",
  training_plan_week: "AI Training Plan (per week)",
  plan_edit: "AI plan edit (one week)",
  plan_edit_full: "AI plan edit (whole plan)",
  limiter_fix_plan: "Limiter Fix Plan",
  form_analysis: "AI Form Analysis (per photo)",
  form_analysis_unlock: "Form Analysis unlock (unlimited photos)",
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
  "plan_edit",
  "plan_edit_full",
  "development_trajectory",
  "archetype_view",
  "form_analysis",
  "limiter_fix_plan",
];

// ---------------------------------------------------------------------------
// Credit packs (display defaults; regional tiers may override)
// ---------------------------------------------------------------------------
export type CreditPackConfig = {
  id: string; credits: number; bonus: number; price_cents: number;
  label?: string; popular?: boolean; best_value?: boolean;
};

export const CREDIT_PACKS: CreditPackConfig[] = [
  // Bonuses raised 2026-10-04 (0/10/25/50/150 -> 5/15/45/90/160). Prices and
  // credit counts are unchanged: they are Play product IDs, and re-pricing them
  // is a store-console change, not a code change. What changed is how much of
  // the purchase is free.
  //
  // The ladder is the retention mechanic, so it is worth being precise about
  // what it does. Cost per credit falls at every step (8.30 -> 3.79 cents in
  // tier A), which means the biggest pack is always the best value and always
  // will be. That is deliberate: it pulls an athlete who has decided to buy at
  // all towards spending more than they first intended, and the free portion
  // grows with the spend (+5 ... +160) so the larger the commitment, the more
  // of it is given away.
  //
  // pack_500's bonus is capped at 160 by the coin ladder, not by taste: the
  // biggest coin bundle has to stay cheaper than converting credits, and at
  // 7.5 coins per credit a larger bonus would hand the coin economy away. See
  // MONEY.md.
  { id: "pack_25",  credits: 25,  bonus: 5,   price_cents: 249,  label: "Starter" },
  { id: "pack_50",  credits: 50,  bonus: 15,  price_cents: 499,  label: "Boost" },
  { id: "pack_120", credits: 120, bonus: 45,  price_cents: 999,  label: "Popular", popular: true },
  { id: "pack_200", credits: 200, bonus: 90,  price_cents: 1499, label: "Power" },
  { id: "pack_500", credits: 500, bonus: 160, price_cents: 2499, label: "Elite", best_value: true },
];

// ---------------------------------------------------------------------------
// Regional pack ladders — a data mirror of `pricing_tiers`
// ---------------------------------------------------------------------------
/**
 * The four ACTIVE rows of pricing_tiers, read from the database on
 * 2026-10-03. Same credits and bonuses everywhere; only price_cents differ,
 * and they are USD cents in every tier (formatLocalPrice converts for
 * display; the IAP store handles the actual charge).
 *
 * Why this mirror exists: every margin statement in this file is against
 * WORST_CASE_USD_PER_CREDIT, and that constant is only honest if it is the
 * worst rate a real buyer can pay — which is tier D, not the default ladder.
 * pricing.test.ts re-derives the worst case from this table and fails if the
 * table, the constant, or the default CREDIT_PACKS ever disagree.
 */
export const REGIONAL_TIERS = [
  {
    code: "A",
    name: "Premium Markets",
    packs: [
      { id: "pack_25", credits: 25, bonus: 5, price_cents: 249, label: "Starter" },
      { id: "pack_50", credits: 50, bonus: 15, price_cents: 499, label: "Boost" },
      { id: "pack_120", credits: 120, bonus: 45, price_cents: 999, label: "Popular" },
      { id: "pack_200", credits: 200, bonus: 90, price_cents: 1499, label: "Power" },
      { id: "pack_500", credits: 500, bonus: 160, price_cents: 2499, label: "Elite" },
    ],
  },
  {
    code: "B",
    name: "Developed Markets",
    packs: [
      { id: "pack_25", credits: 25, bonus: 5, price_cents: 199, label: "Starter" },
      { id: "pack_50", credits: 50, bonus: 15, price_cents: 399, label: "Boost" },
      { id: "pack_120", credits: 120, bonus: 45, price_cents: 799, label: "Popular" },
      { id: "pack_200", credits: 200, bonus: 90, price_cents: 1199, label: "Power" },
      { id: "pack_500", credits: 500, bonus: 160, price_cents: 1999, label: "Elite" },
    ],
  },
  {
    code: "C",
    name: "Emerging Markets",
    packs: [
      { id: "pack_25", credits: 25, bonus: 5, price_cents: 99, label: "Starter" },
      { id: "pack_50", credits: 50, bonus: 15, price_cents: 199, label: "Boost" },
      { id: "pack_120", credits: 120, bonus: 45, price_cents: 499, label: "Popular" },
      { id: "pack_200", credits: 200, bonus: 90, price_cents: 799, label: "Power" },
      { id: "pack_500", credits: 500, bonus: 160, price_cents: 1499, label: "Elite" },
    ],
  },
  {
    code: "D",
    name: "Growth Markets",
    packs: [
      { id: "pack_25", credits: 25, bonus: 5, price_cents: 49, label: "Starter" },
      { id: "pack_50", credits: 50, bonus: 15, price_cents: 99, label: "Boost" },
      { id: "pack_120", credits: 120, bonus: 45, price_cents: 299, label: "Popular" },
      { id: "pack_200", credits: 200, bonus: 90, price_cents: 499, label: "Power" },
      { id: "pack_500", credits: 500, bonus: 160, price_cents: 999, label: "Elite" },
    ],
  },
] as const;

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
