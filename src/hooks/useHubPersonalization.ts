import { useMemo } from "react";

import type { HubLink } from "@/components/layout/HubPage";
import { isFeatureRelevant, type FeatureKey } from "@/lib/personalization/features";
import { familiesForProfile } from "@/lib/personalization/engine";
import { usePersonalization } from "./usePersonalization";

type HubLinkWithFeature = HubLink & { feature: FeatureKey };

/**
 * Filters a hub's link groups for the signed-in athlete. Groups end up empty
 * when every link is irrelevant — those groups are dropped entirely.
 * When personalization is off (no sport / show-all on) everything passes through.
 */
export function useHubGroups<T extends { title: string; links: HubLinkWithFeature[] }>(
  groups: T[]
): { title: string; links: HubLink[] }[] {
  const { families, active } = usePersonalization();

  return useMemo(() => {
    if (!active) return groups;
    return groups
      .map((g) => ({
        ...g,
        links: g.links.filter((l) => isFeatureRelevant(l.feature, families)),
      }))
      .filter((g) => g.links.length > 0);
    // `groups` is rebuilt each render by callers; filtering is cheap and pure,
    // so we intentionally depend on the serialized identity below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, families, JSON.stringify(groups)]);
}

export { familiesForProfile };
