// ============================================================================
// CHALLENGE SUGGESTION PERSONALISATION
// ----------------------------------------------------------------------------
// The Challenges page owns its suggestion banks (sport-specific + goal-based).
// This module adds the personalisation layer on top: which suggestions lead,
// decided by the athlete's sport family, without touching page logic.
//
// Pure functions — unit tested in challengeSuggestions.test.ts.
// ============================================================================

import type { AthleteProfile } from "./engine";
import { familyForSports } from "./sports";

/** Which challenge category each family should see first. */
const FAMILY_PRIORITIES: Record<string, string[]> = {
  endurance: ["distance", "duration", "count"],
  team: ["count", "duration", "distance"],
  skill: ["count", "duration", "distance"],
  strength: ["count", "distance", "duration"],
  combat: ["count", "duration", "distance"],
  multi: ["count", "duration", "distance"],
};

export function familyPriorityFor(sports: string[]): string[] {
  const family = familyForSports(sports);
  return (family && FAMILY_PRIORITIES[family]) || FAMILY_PRIORITIES.multi;
}

/**
 * Stable reorder: suggestions whose `type` ranks highest for this athlete's
 * family come first. Equal rank keeps authored order.
 */
export function orderByFamily<T extends { type: string }>(
  suggestions: T[],
  sports: string[]
): T[] {
  const priority = familyPriorityFor(sports);
  const rank = (type: string): number => {
    const i = priority.indexOf(type);
    return i === -1 ? priority.length : i;
  };
  return [...suggestions]
    .map((s, i) => ({ s, i, r: rank(s.type) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ s }) => s);
}

/** True when the athlete should see sport-specific banks (family known). */
export function wantsSportBank(profile: AthleteProfile): boolean {
  return familyForSports(profile.sports) !== null;
}
