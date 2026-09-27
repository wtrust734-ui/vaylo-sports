// ============================================================================
// PERSONALISATION ENGINE
// ----------------------------------------------------------------------------
// Pure decision core: given an athlete's profile it decides what is visible,
// in what order, on every navigable surface (sidebar, hubs, quick actions).
// React-free so it is fully unit-testable; hooks live in usePersonalization.ts.
//
// Principles:
//   * fail open — unknown features stay visible, never hidden
//   * one escape hatch — "Show everything" restores the full app
//   * order matters as much as visibility (most-relevant first)
// ============================================================================

import type { SportFamily } from "./sports";
import { familyForSports } from "./sports";
import { isFeatureRelevant, type FamilyKey, type FeatureKey } from "./features";

/** localStorage key for the "Show everything" escape hatch. */
export const SHOW_ALL_KEY = "vaylo:personalization:showAll";

export type AthleteProfile = {
  sports: string[]; // parsed from profiles.sport ("Running, Cycling")
  experience: "new" | "established";
};

export function isShowAllEnabled(): boolean {
  try {
    return localStorage.getItem(SHOW_ALL_KEY) === "1";
  } catch {
    return false;
  }
}

export function setShowAllEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(SHOW_ALL_KEY, "1");
    else localStorage.removeItem(SHOW_ALL_KEY);
  } catch {
    // storage unavailable — escape hatch just won't persist
  }
}

/** Families for an athlete; ["*"] when unknown so nothing is hidden. */
export function familiesForProfile(profile: AthleteProfile): FamilyKey[] {
  const families = new Set<FamilyKey>();
  for (const s of profile.sports) {
    const f = familyForSports([s]);
    if (f) families.add(f);
  }
  if (families.size === 0) return ["*"];
  return [...families];
}

/** Generic relevance filter over any list keyed by FeatureKey. */
export function visibleFeatures<T extends { feature: FeatureKey }>(
  items: T[],
  profile: AthleteProfile
): T[] {
  const families = familiesForProfile(profile);
  return items.filter((it) => isFeatureRelevant(it.feature, families));
}

/**
 * Stable relevance ordering: keeps list order but promotes the items whose
 * families overlap the athlete's. Equal-relevance items keep their original
 * relative order (stable sort), so authored order is preserved.
 */
export function orderByRelevance<T extends { feature: FeatureKey }>(
  items: T[],
  profile: AthleteProfile
): T[] {
  const families = familiesForProfile(profile);
  if (families.includes("*")) return items; // unknown athlete — authored order
  return [...items]
    .map((it, i) => ({
      it,
      i,
      // irrelevant items (1) sink below relevant ones (0); universal ("*") features stay put
      s: isFeatureRelevant(it.feature, families) ? 0 : 1,
    }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map(({ it }) => it);
}

/**
 * New athletes see onboarding-friendly surfaces first; established athletes see
 * depth. Implemented as a stable re-order, not a filter — nothing disappears.
 */
export function orderForExperience<T extends { newFirst?: boolean; establishedFirst?: boolean }>(
  items: T[],
  profile: AthleteProfile
): T[] {
  if (profile.experience === "new") {
    return [...items].sort((a, b) => Number(b.newFirst ?? false) - Number(a.newFirst ?? false));
  }
  return [...items].sort((a, b) => Number(b.establishedFirst ?? false) - Number(a.establishedFirst ?? false));
}

/** True when the surface should collapse to a tailored subset. */
export function shouldPersonalize(profile: AthleteProfile | null): boolean {
  if (!profile) return false;
  if (isShowAllEnabled()) return false;
  return profile.sports.length > 0;
}
