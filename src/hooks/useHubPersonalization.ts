import { useMemo } from "react";

import type { HubLink } from "@/components/layout/HubPage";
import { isFeatureRelevant, type FeatureKey } from "@/lib/personalization/features";
import { familiesForProfile } from "@/lib/personalization/engine";
import { isRouteVisible } from "@/config/featureFlags";
import { usePersonalization } from "./usePersonalization";

type HubLinkWithFeature = HubLink & { feature: FeatureKey };

/**
 * Filters a hub's link groups for the signed-in athlete. Groups end up empty
 * when every link is irrelevant — those groups are dropped entirely.
 * When personalization is off (no sport / show-all on) everything passes through.
 *
 * Two independent filters run here, in this order:
 *
 *   1. Launch flags, by route. A feature that is off for this build is not
 *      shown to anyone, whatever their sport. It runs even when
 *      personalization is off, which is the case that matters most — "show all"
 *      is exactly the setting where an unflagged feature would otherwise appear.
 *   2. Personalisation, by feature family.
 *
 * The flag filter lives here rather than in each hub page so that a feature
 * added to a new hub tomorrow is covered by construction. Doing it per page
 * meant four call sites, and three of the four would have been the same
 * conditional written again.
 */
export function useHubGroups<T extends { title: string; links: HubLinkWithFeature[] }>(
  groups: T[]
): { title: string; links: HubLink[] }[] {
  const { families, active } = usePersonalization();

  return useMemo(() => {
    const withoutLaunchFlags = (gs: T[]) =>
      gs
        .map((g) => ({ ...g, links: g.links.filter((l) => isRouteVisible(l.path)) }))
        .filter((g) => g.links.length > 0);

    if (!active) return withoutLaunchFlags(groups);
    return withoutLaunchFlags(groups)
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
