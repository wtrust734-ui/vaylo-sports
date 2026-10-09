// ============================================================================
// useInsights — the insights reading, with the offline fallback
// ----------------------------------------------------------------------------
// Same load order the starting analysis uses, for the same reason: the live
// reading is what the athlete wants, the snapshot saved to this device is what
// they can still have with no connection, and the screen has to say which of
// the two it is showing. A cached reading presented as a live one would be the
// specific lie Phase 5's cache exists to prevent.
//
// The read is deliberately not polling and not refreshed per render. It happens
// once on mount and when the athlete asks, because seven metrics over eight
// weeks of rows is not something to recompute under a scroll listener.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { localDateKey } from "@/lib/dates";
import { loadInsights, readCachedInsights } from "@/lib/insightsPlanning";
import type { TrainingInsights } from "@/lib/insights";

export type InsightsState =
  | { kind: "loading" }
  | {
      kind: "ready";
      insights: TrainingInsights;
      /** True when this came off the device rather than the account. */
      offline: boolean;
      savedAt: number | null;
      /** True when the cached reading is past its useful age. */
      stale: boolean;
    }
  | { kind: "empty" };

export interface UseInsightsResult {
  state: InsightsState;
  /** Re-reads from the account, falling back to the cache if it cannot. */
  refresh: () => void;
  busy: boolean;
}

export function useInsights(userId?: string | null): UseInsightsResult {
  const [state, setState] = useState<InsightsState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!userId) {
      setState({ kind: "empty" });
      return;
    }
    setBusy(true);
    // Read the cache first so a failed live read has something to fall back on
    // even if it fails before this function can look again.
    const cached = readCachedInsights(userId);
    try {
      const read = await loadInsights(userId, localDateKey());
      if (!alive.current) return;
      // An empty reading is still a real answer, but only when the account was
      // actually reached — otherwise a dead connection would render as "you
      // have no training", which is the worst possible thing to say to someone
      // whose data is fine.
      setState({
        kind: "ready",
        insights: read.insights,
        offline: false,
        savedAt: null,
        stale: false,
      });
    } catch {
      if (!alive.current) return;
      setState(
        cached
          ? {
              kind: "ready",
              insights: cached.insights,
              offline: true,
              savedAt: cached.savedAt,
              stale: cached.stale,
            }
          : { kind: "empty" },
      );
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [userId]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  return { state, refresh: () => void load(), busy };
}
