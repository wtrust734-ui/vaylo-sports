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
  | "training.availability"
  | "training.routines"
  | "training.crossTraining"
  | "training.pbs"
  | "training.form"
  | "training.workouts"
  // Perform
  | "perform.vpr"
  | "perform.metrics"
  | "perform.skills"
  | "perform.development"
  | "perform.identity"
  | "perform.goals"
  | "perform.compare"
  | "perform.guardian"
  | "perform.startingAnalysis"
  | "perform.insights"
  // Recover
  | "recover.recovery"
  | "recover.wearables"
  | "recover.nutrition"
  | "recover.mental"
  | "recover.injury"
  // Compete
  | "compete.events"
  | "compete.challenges"
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
  // Universal, like plans: every athlete has a life, and an availability layer
  // that a single-sport athlete cannot reach would be the wrong kind of
  // personal rather than a smart one.
  "training.availability": { key: "training.availability", families: ["*"], route: "/availability" },
  "training.routines": { key: "training.routines", families: ["*"], route: "/routines" },
  "training.crossTraining": { key: "training.crossTraining", families: ["*"], route: "/cross-training" },
  "training.pbs": { key: "training.pbs", families: ["endurance", "skill", "strength", "multi"], route: "/pbs" },
  // UNIVERSAL, and deliberately so. Form Analysis is a purchasable surface: it
  // is sold in the Market at a stated price, and it was hidden here from every
  // pure-endurance athlete. Hiding a paid feature from the athletes whose sport
  // does not score for it does not make the app more personal — it makes the
  // product unsellable and, worse, unfindable: the athlete reads the price on
  // the shop screen and then cannot reach the thing they just bought. Any
  // surface that can be bought is universal; personalisation still governs
  // optional depth (/skills, /pbs), which is what it was built for.
  "training.form": { key: "training.form", families: ["*"], route: "/form" },
  // Logging a finished session is not a preference any sport opts out of: the
  // record it writes is what the recovery read, the streak and the insights all
  // consume, so it is universal like plans are.
  "training.workouts": { key: "training.workouts", families: ["*"], route: "/workouts" },
  // Perform
  "perform.vpr": { key: "perform.vpr", families: ["*"], route: "/vpr" },
  "perform.metrics": { key: "perform.metrics", families: ["*"], route: "/metrics" },
  "perform.skills": { key: "perform.skills", families: ["skill", "team", "combat", "multi"], route: "/skills" },
  "perform.development": { key: "perform.development", families: ["*"], route: "/development" },
  "perform.identity": { key: "perform.identity", families: ["*"], route: "/identity" },
  "perform.goals": { key: "perform.goals", families: ["*"], route: "/goals" },
  "perform.compare": { key: "perform.compare", families: ["*"], route: "/compare" },
  // Kept for under-18 accounts: the guardian layer is how a parent or guardian
  // reaches the sanitized view of a minor's training, and a route only the minor
  // could reach would be unreachable through the one surface that explains it.
  // The 18–30 reposition does not retire it — no one is turned away.
  "perform.guardian": { key: "perform.guardian", families: ["*"], route: "/guardian" },
  // Universal: what the app makes of your training history is worth reading
  // whatever the sport, and it is the screen that explains why importing a
  // history is worth doing at all.
  "perform.startingAnalysis": {
    key: "perform.startingAnalysis",
    families: ["*"],
    route: "/starting-analysis",
  },
  // Universal: consistency, workload and recovery are read the same way in
  // every sport, and every athlete benefits from knowing why a suggestion was
  // made. Deliberately not gated behind a data-rich family — the screen has an
  // honest "not measurable yet" state for anyone whose record is thin.
  "perform.insights": {
    key: "perform.insights",
    families: ["*"],
    route: "/insights",
  },
  // Recover — injury & mental are universal (every sport breaks and stresses);
  // wearables matter most where readiness data exists; nutrition skews endurance.
  "recover.recovery": { key: "recover.recovery", families: ["*"], route: "/recovery" },
  "recover.wearables": { key: "recover.wearables", families: ["endurance", "team", "multi"], route: "/health-sync" },
  // Universal for the same reason as /form: the Nutrition Pack and the AI
  // calorie scan are sold in the Market, and a pure-skill athlete used to be
  // unable to reach either — see the note on training.form above.
  "recover.nutrition": { key: "recover.nutrition", families: ["*"], route: "/nutrition" },
  "recover.mental": { key: "recover.mental", families: ["*"], route: "/mental" },
  "recover.injury": { key: "recover.injury", families: ["*"], route: "/injury" },
  // Compete
  "compete.events": { key: "compete.events", families: ["*"], route: "/events" },
  "compete.challenges": { key: "compete.challenges", families: ["*"], route: "/challenges" },
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
