// ============================================================================
// VAYLO SPORTS — Vaylo Sports Performance System (client)
// ----------------------------------------------------------------------------
// One source of truth for everything the VPR surfaces show: the score, how it
// has moved, which factors drive it, and today's readiness. Both the dashboard
// hero and the VPR page read from here, so they can never disagree.
//
// Every number is derived from tables that already exist:
//   performance_metrics → the score and its six sub-indices (calculateVPR)
//   vpr_snapshots       → the trend (last vs previous snapshot)
//   recovery_logs       → readiness today and its day-over-day change
// Nothing here invents a metric; where data is missing the value is null and
// the UI says so.
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { calculateVPR, getSportWeights, type MetricRow, type VPRScores } from "@/lib/performance";
import { localDateKey } from "@/lib/dates";

export interface VprFactor {
  key: keyof Omit<VPRScores, "overall_vpr">;
  label: string;
  value: number;
  /** Sport weight (0–1) — how much this factor matters for THIS athlete's sport. */
  weight: number;
  /**
   * Attention priority: a high weight on a low score is what to work on next.
   * Derived, not measured — it ranks the real numbers, it is not a new metric.
   */
  priority: number;
}

export interface VprSystemState {
  loading: boolean;
  /** null when the athlete has no metrics yet. */
  vpr: VPRScores | null;
  /** Latest minus previous snapshot; null with fewer than two snapshots. */
  delta: number | null;
  /** Snapshot count behind the delta, so the UI can say what it compares. */
  snapshotCount: number;
  /** All six factors, most-deserving-of-attention first. */
  factors: VprFactor[];
  /** Today's readiness; null if the athlete has not checked in today. */
  readiness: number | null;
  /** readiness minus the most recent earlier log; null without a comparison. */
  readinessDelta: number | null;
  /** Consecutive check-in days ending today (0 when none). */
  checkInStreak: number;
}

const FACTOR_LABELS: Record<keyof Omit<VPRScores, "overall_vpr">, string> = {
  speed_index: "Speed",
  power_index: "Power",
  endurance_capacity: "Endurance",
  repeatability: "Repeatability",
  skill_consistency: "Skill",
  reaction_efficiency: "Reaction",
};

const FACTOR_KEYS = Object.keys(FACTOR_LABELS) as (keyof Omit<VPRScores, "overall_vpr">)[];

/** Pure: ranks factors by weighted headroom, most-deserving-of-attention first. */
export function rankFactors(vpr: VPRScores, sport: string): VprFactor[] {
  const weights = getSportWeights(sport);
  return FACTOR_KEYS
    .map((key) => {
      const weight = weights[key] ?? 0;
      const value = vpr[key];
      return { key, label: FACTOR_LABELS[key], value, weight, priority: weight * (100 - value) };
    })
    .sort((a, b) => b.priority - a.priority);
}

/** Pure: trend from an ascending snapshot list. */
export function deltaFromSnapshots(ascending: { overall_vpr: number }[]): number | null {
  if (ascending.length < 2) return null;
  const last = ascending[ascending.length - 1].overall_vpr;
  const prev = ascending[ascending.length - 2].overall_vpr;
  return last - prev;
}

/** Pure: today's readiness and its change vs the most recent earlier log. */
export function readinessFromLogs(
  logs: { log_date: string; readiness_score: number | null }[],
  today: string,
): { readiness: number | null; delta: number | null } {
  const sorted = [...logs].sort((a, b) => (a.log_date < b.log_date ? 1 : -1));
  const todays = sorted.find((l) => l.log_date === today);
  const earlier = sorted.find((l) => l.log_date < today && l.readiness_score != null);
  return {
    readiness: todays?.readiness_score ?? null,
    delta: todays?.readiness_score != null && earlier?.readiness_score != null
      ? todays.readiness_score - earlier.readiness_score
      : null,
  };
}

/** Pure: consecutive check-in days ending today. */
export function checkInStreakFromLogs(logs: { log_date: string }[], today: string): number {
  const dates = new Set(logs.map((l) => l.log_date));
  let streak = 0;
  // Parse as a local calendar day — `new Date("YYYY-MM-DD")` is UTC and would
  // shift the whole streak a day west of UTC (see lib/dates.ts).
  const [y, m, dNum] = today.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1, dNum ?? 1);
  // The streak counts back from today; a missing today does not zero yesterday's.
  if (!dates.has(today)) d.setDate(d.getDate() - 1);
  for (;;) {
    const key = localDateKey(d);
    if (!dates.has(key)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/**
 * Loads everything the VPR system needs in one round trip per table.
 * `sport` changes the factor weighting, so it is part of the key.
 */
export function useVprSystem(sport: string | null | undefined, userId: string | null | undefined): VprSystemState {
  const [state, setState] = useState<VprSystemState>({
    loading: true, vpr: null, delta: null, snapshotCount: 0, factors: [],
    readiness: null, readinessDelta: null, checkInStreak: 0,
  });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      const [metrics, snapshots, recovery] = await Promise.all([
        supabase.from("performance_metrics").select("*").eq("user_id", userId).order("log_date", { ascending: false }).limit(200),
        supabase.from("vpr_snapshots").select("overall_vpr, created_at").eq("user_id", userId).order("created_at", { ascending: true }).limit(50),
        supabase.from("recovery_logs").select("log_date, readiness_score").eq("user_id", userId).order("log_date", { ascending: false }).limit(30),
      ]);
      if (cancelled) return;

      const metricRows = (metrics.data ?? []) as unknown as MetricRow[];
      const sportName = (sport ?? "").split(",")[0].trim() || "default";
      const vpr = metricRows.length ? calculateVPR(metricRows, sportName) : null;
      const snapshotRows = (snapshots.data ?? []) as { overall_vpr: number }[];
      const readinessState = readinessFromLogs((recovery.data ?? []) as never, localDateKey());

      setState({
        loading: false,
        vpr,
        delta: deltaFromSnapshots(snapshotRows),
        snapshotCount: snapshotRows.length,
        factors: vpr ? rankFactors(vpr, sportName) : [],
        readiness: readinessState.readiness,
        readinessDelta: readinessState.delta,
        checkInStreak: checkInStreakFromLogs((recovery.data ?? []) as never, localDateKey()),
      });
    })();

    return () => { cancelled = true; };
  }, [userId, sport]);

  return state;
}
