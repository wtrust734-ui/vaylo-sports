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
  | "perform.achievements"
  | "perform.challenges"
  | "perform.guardian"
  | "perform.startingAnalysis"
  | "perform.insights"
  // Recover
  | "recover.recovery"
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
  // Train — plans are universal; form leans skill+team (technique sports).
  // Cross-training no longer has a standalone surface: it is prescribed inside
  // the plan itself from the equipment answered at setup, so there is no key
  // for it here. Routines were removed the same way — no tab, no key.
  "training.plans": { key: "training.plans", families: ["*"], route: "/training" },
  // Universal, like plans: every athlete has a life, and an availability layer
  // that a single-sport athlete cannot reach would be the wrong kind of
  // personal rather than a smart one.
  "training.availability": { key: "training.availability", families: ["*"], route: "/availability" },
  // PBs are an endurance concept (run / bike / swim times) plus "Other", whose
  // sport is unknown rather than PB-less: hiding records from an athlete the
  // app cannot classify would be the wrong kind of personal. Team, skill,
  // strength and combat athletes (football, cricket, tennis, lifting, MMA)
  // never see the tab — their sports have no PBs.
  "training.pbs": { key: "training.pbs", families: ["endurance", "multi"], route: "/pbs" },
  // Form is universal, and its own CONTENT is what personalises now. It used to
  // be scoped to the technique families, on the reading that "technique" is a
  // skill-sport word — which hid the free drills and cues from the athlete whose
  // sport needs them most, a runner. The tab is free for everyone and filters
  // the drills inside it by family (src/lib/formDrills.ts: a runner is shown
  // running work, never a footballer's), so the door no longer needs a rule.
  // The AI video analysis inside the tab is still paid, per analysis.
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
  // The Trophy Room: achievements, purchase badges and challenges are
  // universal — every sport earns medals and takes on challenges.
  "perform.achievements": { key: "perform.achievements", families: ["*"], route: "/achievements" },
  "perform.challenges": { key: "perform.challenges", families: ["*"], route: "/challenges" },
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
  // Recover — injury, mental and nutrition are universal. Every sport breaks,
  // stresses and eats: hiding the nutrition tab from pure-skill athletes made
  // the tab feel missing rather than personal, and fueling matters whatever
  // the sport.
  "recover.recovery": { key: "recover.recovery", families: ["*"], route: "/recovery" },
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
