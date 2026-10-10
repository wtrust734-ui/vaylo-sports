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
      { feature: "recover.wearables", labelKey: "sidebar.wearables", path: "/health-sync" },
      { feature: "recover.nutrition", labelKey: "sidebar.nutrition", path: "/nutrition" },
      { feature: "recover.mental", labelKey: "sidebar.mental", path: "/mental" },
      { feature: "recover.injury", labelKey: "sidebar.injury", path: "/injury" },
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
      { feature: "perform.identity", labelKey: "sidebar.avatarStudio", path: "/avatar" },
      { feature: "perform.goals", labelKey: "sidebar.collection", path: "/collection" },
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
