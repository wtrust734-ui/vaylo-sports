// ============================================================================
// VAYLO SPORTS — THE UNLOCK CATALOGUE (one-off, credit-priced entitlements)
// ----------------------------------------------------------------------------
// Every permanent unlock the Market sells, with the page it opens and the credit
// cost key its price comes from.
//
// Why this file exists. The app advertised unlock prices in two places — the
// Market's cost list and each feature's own button — while only *some* features
// had a purchase call at all. Cross-Sport Analysis was priced in the shop and
// had no feature behind it at all; Learning was priced and fully free. An
// athlete could read a price for things they could not buy and, in one case,
// could not even find.
//
// Deliberately NOT here: form analysis and nutrition. Form analysis is
// video-only and per analysis (a flat rate on a metered video call loses
// money), and nutrition is a standard tab with per-use charges (plan per week,
// calorie scan per scan). Neither is a one-off entitlement, so neither is in
// the permanent-unlock catalogue.
//
// The rules encoded here, each one checked by unlocks.test.ts:
//
//   * `product` is the id `process-purchase` resolves through FEATURE_PRODUCTS
//     (supabase/functions/_shared/moneyCatalog.ts). The client never sends a
//     price; the server prices the product from public.credit_cost().
//   * `feature` is the entitlement key checked with hasFeature() after the
//     purchase — what makes "bought it" and "can use it" the same fact.
//   * `costKey` is for DISPLAY only: prices are read with creditCost(costKey),
//     never written as literals next to a button.
//   * `route` is where the unlocked feature lives, so "Owned" always has
//     somewhere to go.
//
// `enables` names the metered AI key an unlock covers, when it covers one. That
// is what makes the margin auditable: an unlock that removes a per-call charge
// has to be priced above what those calls cost us, and unlocks.test.ts refuses
// to let a new entry ship without saying so.
// ============================================================================

import { API_COST_CEILING_USD, type FeatureCostKey } from "@/config/credits";

/** A metered feature key: one with a declared provider-cost ceiling. */
type MeteredKey = keyof typeof API_COST_CEILING_USD;

export type UnlockProductId =
  | "mental_gym"
  | "injury_management"
  | "cross_sport";

export type UnlockCatalogEntry = {
  /** Product id handed to process-purchase. Never a price, never a feature key. */
  product: UnlockProductId;
  /** Entitlement key the app checks with hasFeature(). */
  feature: string;
  /** Cost key the displayed price comes from. Display only. */
  costKey: FeatureCostKey;
  label: string;
  /** One line, used as the card subtitle and in the top-up sheet. */
  tagline: string;
  /** What the payment actually buys. Plain statements, not marketing. */
  unlocks: string[];
  /** Where the unlocked feature lives. */
  route: string;
  routeLabel: string;
  /**
   * The metered AI key (or keys) this unlock makes free for the athlete — and
   * therefore the cost the unlock has to cover. A list, because an unlock can
   * remove more than one charge, and asserting only the cheaper of the two
   * would certify a margin the unlock never has to clear. No current entry
   * uses it: flat rates on metered calls (unlimited analyses, free scans) are
   * retired, so every remaining unlock is access to a local feature.
   */
  enables?: MeteredKey | MeteredKey[];
  /** Other unlocks the same athlete tends to want, shown as a nudge. */
  pairsWith?: UnlockProductId[];
};

export const UNLOCK_CATALOG: UnlockCatalogEntry[] = [
  {
    product: "mental_gym",
    feature: "mental_gym",
    costKey: "mental_gym_unlock",
    label: "Mental Gym",
    tagline: "The full mental-performance library, kept for good.",
    unlocks: [
      "The complete focus, pressure and confidence programme",
      "Pre-competition routines you can run on the day",
      "Progress you keep across devices",
    ],
    route: "/mental",
    routeLabel: "Open Mental Gym",
    pairsWith: ["injury_management", "cross_sport"],
  },
  {
    product: "injury_management",
    feature: "injury_management",
    costKey: "injury_management_unlock",
    label: "Injury Management",
    tagline: "Log, track and train around an injury instead of through it.",
    unlocks: [
      "Injury log with status and body-part detail",
      "Load advice that adapts while something is healing",
      "Cross-training swaps that keep the high-impact work out",
    ],
    route: "/injury",
    routeLabel: "Open Injury Management",
    pairsWith: ["cross_sport"],
  },
  {
    product: "cross_sport",
    feature: "cross_sport",
    costKey: "cross_sport_unlock",
    label: "Cross-Sport Analysis",
    tagline: "See what your other sports are actually adding to your main one.",
    unlocks: [
      "Transfer report built from the metrics you have logged",
      "Which of your strengths carry over, and which gaps do not close",
      "Cross-training blocks ordered by transfer, not by habit",
    ],
    // Was /cross-training: that standalone tab is gone, and cross-training now
    // lives inside the plan itself (equipment answered at setup), so the plan
    // is the honest home for this price.
    route: "/training",
    routeLabel: "Open Training Plans",
    pairsWith: ["injury_management"],
  },
];

export const unlockEntry = (product: UnlockProductId): UnlockCatalogEntry | undefined =>
  UNLOCK_CATALOG.find((e) => e.product === product);

// ---------------------------------------------------------------------------
// Per-use features, and where to actually spend them
// ---------------------------------------------------------------------------
// The Market's cost list is a reference, so a price in it has to lead somewhere:
// a row whose feature has no reachable screen is a price for something the
// athlete cannot do, which is the complaint this whole file answers.
//
// Only keys with a real in-app home are listed. Keys that are spent inside a
// flow rather than on a screen (streak_shield's popup, the nutrition plan's
// weekly charge, the limiter plan inside Training) are deliberately absent:
// they are charged as part of something the athlete is already looking at, not
// bought from a menu.
//
// `development_trajectory` is absent for a blunter reason: nothing charges it.
// The Development Trajectory screen (/development) computes projectTrajectory()
// locally and is free, so the row that used to sit here priced 8 credits and
// pointed at /recovery — a price for a call no screen makes, which is the exact
// defect this list exists to remove. If trajectory forecasting is ever billed,
// it belongs here again, with a real charge behind it.
export const PER_USE_ROUTES: { key: FeatureCostKey; route: string; routeLabel: string }[] = [
  { key: "training_plan_week", route: "/training", routeLabel: "Training" },
  { key: "form_analysis", route: "/form", routeLabel: "Form Analysis" },
  { key: "video_form_analysis", route: "/form/video", routeLabel: "Video Analysis" },
  { key: "calorie_scan", route: "/nutrition", routeLabel: "Nutrition" },
  { key: "tactical_prep", route: "/tactics", routeLabel: "Tactics" },
  { key: "vaylo_coach_message", route: "/coach", routeLabel: "Coach" },
  { key: "weekly_coach_review", route: "/goals", routeLabel: "Goals" },
];
