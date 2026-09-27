// ============================================================================
// FEATURE RELEVANCE CATALOG
// ----------------------------------------------------------------------------
// For every personalised surface in the app we ask one question: "does this
// feature matter to THIS athlete?" The answer comes from the intersection of:
//
//   * sport families  (a runner and a weightlifter live different training lives)
//   * the athlete's state (new accounts need onboarding surfaces, not depth)
//
// A feature marked relevant for a family shows for those athletes; everything
// else is filtered out of their nav (with a global "Show everything" escape
// hatch in Settings, because nobody likes an app that hides things).
// ============================================================================

import type { SportFamily } from "./sports";

/**
 * The union of families a feature can be relevant for. `["*"]` = everyone.
 * Family keys: endurance | team | skill | strength | combat | multi
 */
export type FamilyKey = SportFamily | "*";

export type FeatureKey =
  // Train
  | "training.plans"
  | "training.workouts"
  | "training.routines"
  | "training.crossTraining"
  | "training.pbs"
  | "training.form"
  | "training.arOverlay"
  // Perform
  | "perform.vpr"
  | "perform.metrics"
  | "perform.skills"
  | "perform.development"
  | "perform.identity"
  | "perform.goals"
  | "perform.compare"
  // Recover
  | "recover.recovery"
  | "recover.wearables"
  | "recover.nutrition"
  | "recover.mental"
  | "recover.injury"
  // Compete
  | "compete.events"
  | "compete.challenges"
  | "compete.leaderboard"
  | "compete.friends"
  | "compete.communities"
  | "compete.opponents"
  | "compete.arcade"
  // Learn
  | "learn.hub"
  | "learn.coach";

export type FeatureDef = {
  key: FeatureKey;
  families: FamilyKey[];
  /**
   * Route used for the "show everything" escape hatch and hub ordering.
   * Only surfaces with routes participate in nav filtering.
   */
  route: string;
};

export const FEATURE_CATALOG: Record<FeatureKey, FeatureDef> = {
  // Train — plans & routines are universal; form/AR lean skill+team (technique
  // sports); cross-training matters most to single-discipline athletes, which
  // is every family here — so it stays universal.
  "training.plans": { key: "training.plans", families: ["*"], route: "/training" },
  "training.workouts": { key: "training.workouts", families: ["*"], route: "/workouts" },
  "training.routines": { key: "training.routines", families: ["*"], route: "/routines" },
  "training.crossTraining": { key: "training.crossTraining", families: ["*"], route: "/cross-training" },
  "training.pbs": { key: "training.pbs", families: ["endurance", "skill", "strength", "multi"], route: "/pbs" },
  "training.form": { key: "training.form", families: ["skill", "team", "strength", "combat", "multi"], route: "/form" },
  "training.arOverlay": { key: "training.arOverlay", families: ["skill", "team", "combat", "multi"], route: "/ar-overlay" },
  // Perform
  "perform.vpr": { key: "perform.vpr", families: ["*"], route: "/vpr" },
  "perform.metrics": { key: "perform.metrics", families: ["*"], route: "/metrics" },
  "perform.skills": { key: "perform.skills", families: ["skill", "team", "combat", "multi"], route: "/skills" },
  "perform.development": { key: "perform.development", families: ["*"], route: "/development" },
  "perform.identity": { key: "perform.identity", families: ["*"], route: "/identity" },
  "perform.goals": { key: "perform.goals", families: ["*"], route: "/goals" },
  "perform.compare": { key: "perform.compare", families: ["*"], route: "/compare" },
  // Recover — injury & mental are universal (every sport breaks and stresses);
  // wearables matter most where readiness data exists; nutrition skews endurance.
  "recover.recovery": { key: "recover.recovery", families: ["*"], route: "/recovery" },
  "recover.wearables": { key: "recover.wearables", families: ["endurance", "team", "multi"], route: "/health-sync" },
  "recover.nutrition": { key: "recover.nutrition", families: ["endurance", "team", "strength", "combat", "multi"], route: "/nutrition" },
  "recover.mental": { key: "recover.mental", families: ["*"], route: "/mental" },
  "recover.injury": { key: "recover.injury", families: ["*"], route: "/injury" },
  // Compete
  "compete.events": { key: "compete.events", families: ["*"], route: "/events" },
  "compete.challenges": { key: "compete.challenges", families: ["*"], route: "/challenges" },
  "compete.leaderboard": { key: "compete.leaderboard", families: ["*"], route: "/leaderboard" },
  "compete.friends": { key: "compete.friends", families: ["*"], route: "/friends" },
  "compete.communities": { key: "compete.communities", families: ["*"], route: "/communities" },
  "compete.opponents": { key: "compete.opponents", families: ["team", "skill", "combat"], route: "/opponents" },
  "compete.arcade": { key: "compete.arcade", families: ["*"], route: "/arcade" },
  // Learn
  "learn.hub": { key: "learn.hub", families: ["*"], route: "/learning" },
  "learn.coach": { key: "learn.coach", families: ["*"], route: "/coach" },
};

/**
 * True when the feature should surface for these families.
 * `"*"` on either side means universal: features marked `*` show to everyone,
 * and an athlete with unknown families (`["*"]`) sees everything (fail open).
 */
export function isFeatureRelevant(key: FeatureKey, families: FamilyKey[]): boolean {
  const def = FEATURE_CATALOG[key];
  if (!def) return true; // unknown keys stay visible — fail open, never hide
  if (def.families.includes("*") || families.includes("*")) return true;
  return families.some((f) => def.families.includes(f));
}
