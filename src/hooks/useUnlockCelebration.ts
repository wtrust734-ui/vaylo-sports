// ============================================================================
// USE UNLOCK CELEBRATION — the automatic flex trigger
// ----------------------------------------------------------------------------
// Watches an ownership list for NEW epic/legendary/mythic items and surfaces
// the newest one as the active celebration. Two sources are supported:
//
//   DEFAULT — no argument: watches the shop store (useCosmeticsShop). Used
//             by the wardrobe screen.
//   EXTERNAL — pass { ownedItemIds, resolveItem, ready }: the production
//             Collection page feeds it its own useCosmetics inventory and
//             maps reward definitions into flex items, so the celebration
//             reaches the surface where real purchases already happen —
//             without that surface adopting the shop store.
//
// Three deliberate behaviours:
//
//   BASELINE — items already present on the first ready run are recorded, not
//   celebrated. Relogging, a snapshot sync, or a slow first paint must not
//   re-celebrate a month-old mythic. While `ready` is false (data still
//   loading) the baseline keeps re-taking, so the moment defs arrive they
//   read as "what I already own", not a mass unlock.
//
//   OVERLAY ARBITRATION — if the PB celebration card is on screen (it mounts
//   into #vaylo-pb-celebration-root, empty when idle), a flex unlock WAITS
//   for it instead of stacking a second full-screen modal over the first.
//   Polled on a short interval and cleaned up on unmount.
//
//   ONE AT A TIME — a second unlock replaces the current card rather than
//   stacking modals.
// ============================================================================

import { useEffect, useRef, useState } from "react";

import { useCosmeticsShop } from "@/lib/cosmeticsShop/store";
import type { CosmeticItem } from "@/lib/cosmeticsShop/types";

/** Rarities worth a flex. Common/rare are wardrobe decisions, not events. */
const HYPE_RARITIES = new Set(["epic", "legendary", "mythic"]);

export interface CelebrationSource {
  ownedItemIds: readonly string[];
  resolveItem: (id: string) => CosmeticItem | undefined;
  /** false while the caller's data is loading — see BASELINE above. */
  ready?: boolean;
}

export interface UnlockCelebration {
  /** The item to celebrate right now, or null when nothing is celebrating. */
  item: CosmeticItem | null;
  /** Dismiss the current celebration (the modal's close / share-done). */
  dismiss: () => void;
}

export function useUnlockCelebration(source?: CelebrationSource): UnlockCelebration {
  const storeOwned = useCosmeticsShop((s) => s.ownedItemIds);
  const catalog = useCosmeticsShop((s) => s.catalog);

  const owned = source?.ownedItemIds ?? storeOwned;
  const ready = source?.ready ?? true;
  const resolve = source?.resolveItem ?? ((id: string) => catalog.find((i) => i.id === id));

  const [item, setItem] = useState<CosmeticItem | null>(null);
  // null = baseline not yet taken; Set = ids that must NOT celebrate.
  const seen = useRef<Set<string> | null>(null);
  const deferred = useRef<number | null>(null);

  // Interval cleanup on unmount so a deferred raise never fires into nothing.
  useEffect(() => () => {
    if (deferred.current !== null) window.clearInterval(deferred.current);
  }, []);

  useEffect(() => {
    if (!ready || seen.current === null) {
      // Not ready → keep taking a fresh baseline; first ready run = baseline.
      seen.current = new Set(owned);
      return;
    }
    const fresh = owned.filter((id) => !seen.current!.has(id));
    fresh.forEach((id) => seen.current!.add(id));
    if (fresh.length === 0) return;
    const hype = fresh
      .map(resolve)
      .filter((i): i is CosmeticItem => !!i && HYPE_RARITIES.has(i.rarity));
    if (hype.length === 0) return;
    const next = hype[hype.length - 1];

    const raise = (): boolean => {
      const pb = document.getElementById("vaylo-pb-celebration-root");
      if (pb && pb.firstElementChild) return false; // PB card still on screen
      setItem(next);
      return true;
    };
    if (raise()) return;
    deferred.current = window.setInterval(() => {
      if (raise() && deferred.current !== null) {
        window.clearInterval(deferred.current);
        deferred.current = null;
      }
    }, 400);
  }, [owned, ready, resolve]);

  return { item, dismiss: () => setItem(null) };
}

export default useUnlockCelebration;
