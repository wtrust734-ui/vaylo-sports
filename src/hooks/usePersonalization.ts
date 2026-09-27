import { useMemo } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { parseSports } from "@/lib/profile";
import {
  familiesForProfile,
  isShowAllEnabled,
  shouldPersonalize,
  visibleFeatures,
  type AthleteProfile,
} from "@/lib/personalization/engine";
import type { FamilyKey } from "@/lib/personalization/features";

/**
 * The athlete profile the engine works from, resolved from the auth profile.
 * "established" = has logged anything historically — approximated here by
 * account age is unreliable, so we use whether a sport exists plus the profile
 * having been created more than 14 days ago.
 */
export function useAthleteProfile(): AthleteProfile {
  const { profile } = useAuth();

  return useMemo<AthleteProfile>(() => {
    const sports = parseSports(profile?.sport);
    let experience: AthleteProfile["experience"] = "new";
    const createdAt = profile?.created_at;
    if (createdAt) {
      const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
      if (ageDays > 14) experience = "established";
    }
    return { sports, experience };
  }, [profile?.sport, profile?.created_at]);
}

export function usePersonalization() {
  const athlete = useAthleteProfile();

  return useMemo(() => {
    const active = shouldPersonalize(athlete);
    const families = familiesForProfile(athlete);
    return {
      athlete,
      families,
      active,
      visible: <T extends { feature: import("@/lib/personalization/features").FeatureKey }>(items: T[]) =>
        active ? visibleFeatures(items, athlete) : items,
    };
  }, [athlete]);
}

export type { FamilyKey };
