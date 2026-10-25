// ============================================================================
// NAV CATALOG — every nav surface annotated with its FeatureKey
// ----------------------------------------------------------------------------
// The sidebar groups, the four hubs and the quick-action sheet all read from
// one filtered catalog so a runner's app and a lifter's app genuinely differ.
// ============================================================================

import type { FeatureKey } from "./features";

export type NavItemSpec = {
  feature: FeatureKey;
  labelKey: string;
  path: string;
  /**
   * The entitlement key (`hasFeature`) this route needs before it may appear.
   * Absent = free. Set it and the item is filtered out of every navigation
   * surface until the unlock — or Unlimited — is owned, instead of being listed
   * with a padlock on it. Must agree with ROUTE_UNLOCKS below; nav.test.ts
   * refuses a route that is gated in one place and not the other.
   */
  unlock?: string;
  /** Promote for brand-new athletes (onboarding-friendly surfaces). */
  newFirst?: boolean;
  /** Promote once the athlete has history (depth surfaces). */
  establishedFirst?: boolean;
};

export type NavGroupSpec = {
  titleKey: string;
  hubPath: string | null;
  feature: FeatureKey | null; // a group can itself be hidden (e.g. Learn)
  items: NavItemSpec[];
};

export const NAV_CATALOG: NavGroupSpec[] = [
  {
    titleKey: "sidebar.groupHome",
    hubPath: "/",
    feature: null,
    items: [
      { feature: "perform.goals", labelKey: "sidebar.dashboard", path: "/" },
    ],
  },
  {
    titleKey: "sidebar.groupTrain",
    hubPath: "/train",
    feature: null,
    items: [
      { feature: "training.plans", labelKey: "sidebar.trainingPlans", path: "/training", newFirst: true },
      { feature: "training.availability", labelKey: "sidebar.availability", path: "/availability" },
      { feature: "training.pbs", labelKey: "sidebar.pbs", path: "/pbs", establishedFirst: true },
      { feature: "training.form", labelKey: "sidebar.formAnalysis", path: "/form" },
      // Cross-Sport Analysis: a one-off unlock, so it is absent from the
      // navigation until it is owned. It lives beside the other reads of the
      // athlete's own numbers rather than with the plan, because that is what it
      // analyses — the six indices, not the sessions.
      { feature: "training.plans", labelKey: "sidebar.crossSport", path: "/cross-sport", unlock: "cross_sport" },
    ],
  },
  {
    titleKey: "sidebar.groupPerform",
    hubPath: "/perform",
    feature: null,
    items: [
      { feature: "perform.vpr", labelKey: "sidebar.vpr", path: "/vpr", newFirst: true },
      { feature: "perform.metrics", labelKey: "sidebar.metricsHub", path: "/metrics" },
      { feature: "perform.skills", labelKey: "sidebar.skills", path: "/skills" },
      { feature: "perform.development", labelKey: "sidebar.development", path: "/development" },
      { feature: "perform.identity", labelKey: "sidebar.identity", path: "/identity" },
      { feature: "perform.goals", labelKey: "sidebar.goals", path: "/goals", newFirst: true },
      { feature: "perform.compare", labelKey: "sidebar.compare", path: "/compare", establishedFirst: true },
    ],
  },
  {
    titleKey: "sidebar.groupRecover",
    hubPath: "/recover",
    feature: null,
    items: [
      { feature: "recover.recovery", labelKey: "sidebar.recovery", path: "/recovery", newFirst: true },
      { feature: "recover.nutrition", labelKey: "sidebar.nutrition", path: "/nutrition" },
      // Mental Gym and Injury Management are one-off purchases: an athlete who
      // has not bought them does not have these entries at all. The Market's
      // unlocks section is where they are bought; until then, a menu row that
      // only leads to a paywall is a menu row for a product, not for a screen.
      { feature: "recover.mental", labelKey: "sidebar.mental", path: "/mental", unlock: "mental_gym" },
      { feature: "recover.injury", labelKey: "sidebar.injury", path: "/injury", unlock: "injury_management" },
    ],
  },
  {
    titleKey: "sidebar.groupCompete",
    hubPath: "/compete",
    feature: null,
    items: [
      { feature: "compete.events", labelKey: "sidebar.events", path: "/events" },
      { feature: "compete.challenges", labelKey: "sidebar.challenges", path: "/challenges", newFirst: true },
      // Friends and direct messages: relevant to every sport, so it is priced
      // for the families everyone belongs to and is never hidden.
      { feature: "compete.challenges", labelKey: "sidebar.friends", path: "/friends" },
      { feature: "compete.arcade", labelKey: "sidebar.arcade", path: "/arcade" },
    ],
  },
  {
    titleKey: "sidebar.groupLearn",
    hubPath: "/learning",
    feature: "learn.hub",
    items: [
      { feature: "learn.hub", labelKey: "sidebar.learning", path: "/learning", newFirst: true },
      { feature: "learn.coach", labelKey: "sidebar.coach", path: "/coach" },
    ],
  },
  {
    titleKey: "sidebar.groupYou",
    hubPath: "/profile",
    feature: null,
    items: [
      { feature: "perform.goals", labelKey: "sidebar.achievements", path: "/achievements" },
      { feature: "perform.goals", labelKey: "sidebar.eventPacks", path: "/event-packs" },
      { feature: "perform.goals", labelKey: "sidebar.creditsCoins", path: "/market" },
      { feature: "perform.goals", labelKey: "sidebar.subscription", path: "/subscription" },
      { feature: "perform.goals", labelKey: "sidebar.referEarn", path: "/referrals" },
      { feature: "perform.goals", labelKey: "sidebar.notifications", path: "/notifications" },
      { feature: "perform.goals", labelKey: "sidebar.profile", path: "/profile" },
      { feature: "perform.guardian", labelKey: "sidebar.guardian", path: "/guardian" },
      { feature: "perform.startingAnalysis", labelKey: "sidebar.startingAnalysis", path: "/starting-analysis" },
      { feature: "perform.insights", labelKey: "sidebar.insights", path: "/insights" },
    ],
  },
];

/** Quick-action sheet entries (bottom nav "+"). */
export const QUICK_ACTIONS: (NavItemSpec & { descKey: string; icon: string })[] = [
  { feature: "compete.events", labelKey: "quickActions.logResult", descKey: "quickActions.logResultDesc", path: "/events", icon: "Trophy" },
  { feature: "recover.recovery", labelKey: "quickActions.recoveryCheckIn", descKey: "quickActions.recoveryCheckInDesc", path: "/recovery", icon: "HeartPulse" },
  { feature: "perform.vpr", labelKey: "quickActions.logMetric", descKey: "quickActions.logMetricDesc", path: "/vpr", icon: "Pencil" },
];

// ---------------------------------------------------------------------------
// Purchased screens — routes that are useless until the unlock is owned
// ---------------------------------------------------------------------------
// One map, so a route cannot be gated in the sidebar and open in a hub. The
// values are the entitlement keys `hasFeature()` answers for (see
// src/config/unlocks.ts, which owns the purchase side).
//
// Cross-Sport Analysis IS here, and it is the reason this map exists. It used to
// point at /training — the free plan screen — so the athlete who bought it could
// not be shown where to go and its tile could not be hidden. Its own route is a
// real screen now (src/pages/CrossSportAnalysis.tsx), so the purchase and the
// route are the same fact: own it and the Train hub lists it, do not and a row
// that only leads to a paywall is never rendered.
//
export const ROUTE_UNLOCKS: Record<string, string> = {
  "/mental": "mental_gym",
  "/injury": "injury_management",
  "/cross-sport": "cross_sport",
};

/** The entitlement a route needs, or null when the route is free. */
export function unlockForPath(path: string): string | null {
  const base = path.split("?")[0].replace(/\/$/, "");
  if (ROUTE_UNLOCKS[base]) return ROUTE_UNLOCKS[base];
  for (const [prefix, feature] of Object.entries(ROUTE_UNLOCKS)) {
    if (base.startsWith(`${prefix}/`)) return feature;
  }
  return null;
}

/**
 * True when the athlete may see this route at all.
 *
 * `hasFeature` comes from useSubscription(): true for a bought unlock AND for an
 * Unlimited subscription, which is what "paid for it" has to mean here. While
 * entitlements are still loading the answer is false, so a paid entry is absent
 * rather than flashing in and out.
 */
export function isRouteEntitled(
  path: string,
  hasFeature: (feature: string) => boolean,
): boolean {
  const needed = unlockForPath(path);
  return needed === null || hasFeature(needed);
}

/**
 * The one filter every nav surface uses. Items are dropped, not badged: a
 * padlock on a row the athlete cannot open is an advert, and the app already
 * has a shop for that.
 */
export function visibleByEntitlement<T extends { path: string; unlock?: string }>(
  items: T[],
  hasFeature: (feature: string) => boolean,
): T[] {
  return items.filter((item) => {
    const needed = item.unlock ?? unlockForPath(item.path);
    return needed === null || needed === undefined || hasFeature(needed);
  });
}
