import { useMemo } from "react";

import { useAthleteProfile } from "./usePersonalization";
import { familyForSports, type SportFamily } from "@/lib/personalization/sports";

export type UnlockRecommendation = {
  /** FeatureCostKey for the recommended unlock. */
  feature: string;
  /** Which family rule produced it (for tests/debug). */
  family: SportFamily;
  /** Why the athlete sees this, in plain language. */
  why: string;
};

const FAMILY_RECOMMENDATION: Record<
  SportFamily,
  { feature: string; why: string } | null
> = {
  endurance: { feature: "nutrition_pack", why: "Endurance athletes burn through fueling — the Nutrition Pack pays for itself in training blocks." },
  strength: { feature: "form_analysis_unlock", why: "Bar-path and technique checks multiply every strength gain you make." },
  team: { feature: "injury_management_unlock", why: "Availability wins seasons — structured rehab keeps you on the pitch." },
  skill: { feature: "form_analysis_unlock", why: "Frame-by-frame technique review is the fastest lever in skill sports." },
  combat: { feature: "mental_gym_unlock", why: "Composure under pressure is trainable — that's what the Mental Gym builds." },
  multi: null,
};

/**
 * The one premium unlock this athlete is most likely to want, based on sport
 * family. Returns null when there's no strong signal (unknown sport) — the
 * Market then shows its standard merchandising.
 */
export function useRecommendedUnlock(): UnlockRecommendation | null {
  const athlete = useAthleteProfile();

  return useMemo(() => {
    const family = familyForSports(athlete.sports);
    if (!family) return null;
    const rec = FAMILY_RECOMMENDATION[family];
    if (!rec) return null;
    return { ...rec, family };
  }, [athlete.sports]);
}
