import { lsGet, lsSet } from "./localStore";
import { localDateKey } from "./dates";
import { sameEventMetric } from "./eventTrophies";

// ============================================================================
// PB WALL STORE — the same localStorage wall the PBs page renders
// ----------------------------------------------------------------------------
// The PBs page ("vaylo_pbs_v1", src/pages/PBs.tsx) is user-facing storage for
// personal bests. The log-save flow needs to read it (is this a PB?) and write
// it (store the new best). Both sides live here so the key and entry shape are
// defined once and cannot drift.
// ============================================================================

export const PB_STORE_KEY = "vaylo_pbs_v1";

export interface PbEntry {
  id: string;
  metric: string;
  value: number;
  unit: string;
  date: string;
  history: { date: string; value: number }[];
}

const readWall = (): PbEntry[] => lsGet<PbEntry[]>(PB_STORE_KEY, []);

/** The wall reduced to what the trophy evaluation needs. */
export const wallForEvaluation = (): { metric: string; value: number }[] =>
  readWall()
    .filter((p) => p.metric && typeof p.value === "number" && p.value > 0)
    .map((p) => ({ metric: p.metric, value: p.value }));

/**
 * Record a faster time on a timed event label ("Running · 5K", which is how
 * the trophy ladder names them). Returns whether that was actually an
 * improvement — the caller decides what to celebrate.
 */
export const recordTimedPb = (metric: string, seconds: number): { isPb: boolean; previousSeconds: number | null } => {
  const wall = readWall();
  const today = localDateKey();
  // "Running · 5K" and a hand-typed "5K" are the same event. Keep the fastest
  // matching record (not merely the first) so a duplicate label cannot make a
  // slower time look like a personal best.
  const matches = wall.filter(
    (p) => sameEventMetric(p.metric, metric) && typeof p.value === "number" && p.value > 0,
  );
  const existing = matches.reduce<PbEntry | null>(
    (best, p) => (best === null || p.value < best.value ? p : best),
    null,
  );
  const previous = existing?.value ?? null;
  if (previous !== null && seconds >= previous) return { isPb: false, previousSeconds: previous };

  if (existing) {
    const updated: PbEntry = {
      ...existing,
      value: seconds,
      date: today,
      unit: "",
      history: [...existing.history, { date: today, value: seconds }].slice(-30),
    };
    lsSet(PB_STORE_KEY, wall.map((p) => (p.id === existing.id ? updated : p)));
  } else {
    lsSet(PB_STORE_KEY, [
      { id: crypto.randomUUID(), metric, value: seconds, unit: "", date: today, history: [{ date: today, value: seconds }] },
      ...wall,
    ]);
  }
  return { isPb: true, previousSeconds: previous };
};
