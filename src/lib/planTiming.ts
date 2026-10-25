// ============================================================================
// PLAN TIMING — what plan generation actually cost, the last few times
// ----------------------------------------------------------------------------
// `planGeneration.ts` holds the estimate's SHAPE (a fixed pre-call cost, a
// per-call generation cost, a small per-week merge cost) and encodes a real
// fact about the server: parallel one-week chunks mean the wall clock tracks
// the slowest call, not the number of calls. But the constants in that model
// were measured against the deployed function on one day. If the provider
// slows down, or upgrade rewrites the plan faster, every estimate drifts and
// nothing in the app ever learns.
//
// So this module records what generation ACTUALLY cost the last handful of
// times — per device, in the same kind/shape buckets the server partitions
// its work into — and calibrates the estimate from those measurements when
// there are enough of them. When there are not, the caller falls back to the
// documented model, and the UI says that is what it is quoting.
//
// What is deliberately NOT here: any statistic invented from nothing. The
// median of a bucket is a genuine measurement of waits real requests took;
// the fallback constants are the prior the screen starts from, and the
// screen labels which one it is quoting.
// ============================================================================

import {
  EXPECTED_PER_WEEK_SECONDS,
  MIN_EXPECTED_SECONDS,
  NUTRITION_PER_WEEK_SECONDS,
  expectedNutritionSeconds,
  expectedPlanSeconds,
  planChunkWeeks,
} from "./planGeneration";

export type PlanGenerationKind = "training" | "nutrition";
export type PlanGenerationOutcome = "ok" | "failed";

export type PlanGenerationSample = {
  /** Weeks in the plan that was requested. */
  weeks: number;
  /** Wall-clock milliseconds from the invoke being issued to a definitive
   *  answer arriving (plan data, a refusal, a charge error — any verdict).
   *  A cancelled round trip was never recorded: nothing was measured to keep. */
  ms: number;
  /** When the request completed. */
  at: number;
  outcome: PlanGenerationOutcome;
};

const STORAGE_KEY = "vaylo.plan_generation_timings.v1";

/** The estimate uses a small window of recent history, not all time. */
const MAX_SAMPLES_PER_KIND = 14;

/**
 * Waits the screen can be trusted with. Everything under this is a fast
 * refusal (a 402, a throttle), not a generation. Everything over is a hung
 * round trip the browser killed, or a device that slept mid-request; a wait
 * the request never legitimately completed within says nothing about how
 * long real ones take and is dropped rather than allowed to bend the median.
 */
const MIN_RECORDED_MS = MIN_EXPECTED_SECONDS * 1000;
const MAX_RECORDED_MS = 10 * 60 * 1000;

/** How many valid timed generations of the same shape make a median believable. */
export const MIN_SAMPLES_FOR_CALIBRATION = 3;

const isKind = (value: unknown): value is PlanGenerationKind =>
  value === "training" || value === "nutrition";

const sanitizeSample = (raw: unknown): PlanGenerationSample | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const weeks = Math.round(Number(r.weeks));
  const ms = Number(r.ms);
  const at = Number(r.at);
  if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) return null;
  if (!Number.isFinite(ms) || ms < MIN_RECORDED_MS || ms > MAX_RECORDED_MS) return null;
  if (!Number.isFinite(at) || at <= 0) return null;
  if (r.outcome !== "ok" && r.outcome !== "failed") return null;
  return { weeks, ms: Math.round(ms), at: Math.round(at), outcome: r.outcome };
};

const loadHistory = (): Partial<Record<PlanGenerationKind, PlanGenerationSample[]>> => {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return {};
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-browsing storage failures mean no history, not a crash on the
    // estimate screen.
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<PlanGenerationKind, PlanGenerationSample[]>> = {};
    for (const key of Object.keys(parsed)) {
      if (!isKind(key)) continue;
      const samples = parsed[key];
      if (!Array.isArray(samples)) continue;
      const clean = samples.map(sanitizeSample).filter((s): s is PlanGenerationSample => s !== null);
      if (clean.length) out[key] = clean;
    }
    return out;
  } catch {
    // Corrupt storage is indistinguishable from no history; reset rather
    // than let one bad byte poison every future estimate.
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return {};
  }
};

const saveHistory = (history: Partial<Record<PlanGenerationKind, PlanGenerationSample[]>>): void => {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Storage full or blocked: history is an optimisation, never a
    // requirement. Generation still works; only the calibration is lost.
  }
};

/**
 * Record what one generation actually cost. Any verdict counts — the outcome
 * is stored with the sample because a REFUSAL is measured too and must NOT
 * calibrate the estimate: a 402 answers in a second or two, and treating
 * that as "generation time" would teach the screen to promise a wait the
 * real work never takes. Calibration therefore reads only `ok` samples.
 */
export function recordPlanGenerationMs(input: {
  kind: PlanGenerationKind;
  weeks: number;
  ms: number;
  outcome: PlanGenerationOutcome;
  /** Completion time. Defaults to now; the tests seed it to order samples
   *  deterministically without sleeping. */
  at?: number;
}): void {
  const weeks = Math.round(Number(input.weeks));
  const ms = Number(input.ms);
  if (!Number.isFinite(weeks) || weeks < 1 || !Number.isFinite(ms) || ms < 0) return;
  const sample = sanitizeSample({ weeks, ms, at: Number.isFinite(Number(input.at)) ? Number(input.at) : Date.now(), outcome: input.outcome });
  if (!sample) return; // outside the measurable window: keep nothing
  const history = loadHistory();
  const existing = history[input.kind] ?? [];
  // Newest last, capped. A device that generated weekly therefore calibrates
  // on roughly its last three months of waits, not on day-one numbers
  // forever — which is the drift this module exists to correct.
  const next = [...existing.filter((s) => Boolean(s.at)), sample]
    .sort((a, b) => a.at - b.at)
    .slice(-MAX_SAMPLES_PER_KIND);
  history[input.kind] = next;
  saveHistory(history);
}

/** Every timed generation of this kind, oldest first. Exposed for tests. */
export function planGenerationHistory(kind: PlanGenerationKind): PlanGenerationSample[] {
  return [...(loadHistory()[kind] ?? [])].sort((a, b) => a.at - b.at);
}

/** Test hook: forget the recorded history. */
export function clearPlanGenerationHistory(): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export type EstimateSource = "history" | "model";

export type PlanEstimate = {
  seconds: number;
  source: EstimateSource;
  /** Workflows of this shape when the estimate is history-based. */
  samples?: number;
};

/**
 * The prior for a kind, from the pipeline it actually runs. Nutrition is a
 * smaller job than training (a week of meals, no periodisation), so quoting it
 * the training constant promised nearly double the wait it takes.
 */
const modelSeconds = (kind: PlanGenerationKind, weeks: number): number =>
  kind === "nutrition" ? expectedNutritionSeconds(weeks) : expectedPlanSeconds(weeks);

/** The per-week merge slope of the same kind's model. */
const perWeekSeconds = (kind: PlanGenerationKind): number =>
  kind === "nutrition" ? NUTRITION_PER_WEEK_SECONDS : EXPECTED_PER_WEEK_SECONDS;

const median = (values: number[]): number => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The screen's estimate for a plan of `weeks`, in seconds.
 *
 * With enough successful generations of the same shape behind it, the number
 * is the median of what those actually took, nudged by the model's per-week
 * merge slope when the recorded plans were a different length. Without
 * enough history it is the documented model constant, and `source` says so —
 * the UI must not present an unmeasured constant as "usually".
 *
 * The slope nudge is the one non-median term, and it is small on purpose:
 * the server writes all chunks in parallel, so the per-week component is the
 * merge plus larger payloads — bounded by the same cap the model uses.
 */
export function estimatePlanSeconds(kind: PlanGenerationKind, weeks: number): PlanEstimate {
  // Same guard the model applies: a half-filled wizard can pass NaN/0/–1 here,
  // and one NaN week would otherwise land in the median arithmetic below (a
  // `slope = k * (weeks - medianWeeks)` term) and turn the whole estimate into
  // NaN for every later render.
  const safeWeeks = Math.max(1, Math.min(52, Number.isFinite(weeks) ? Math.floor(weeks) : 4));
  weeks = safeWeeks;
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return { seconds: modelSeconds(kind, safeWeeks), source: "model" };
  }
  const shape = planChunkWeeks(safeWeeks);
  const shapeMatches = planGenerationHistory(kind).filter(
    (s) => s.outcome === "ok" && planChunkWeeks(s.weeks) === shape,
  );
  if (shapeMatches.length < MIN_SAMPLES_FOR_CALIBRATION) {
    return { seconds: modelSeconds(kind, weeks), source: "model" };
  }
  const medianWeeks = median(shapeMatches.map((s) => s.weeks));
  const medianSeconds = median(shapeMatches.map((s) => s.ms)) / 1000;
  const slope = perWeekSeconds(kind) * (safeWeeks - medianWeeks);
  const seconds = Math.max(
    MIN_EXPECTED_SECONDS,
    Math.min(90, Math.round(medianSeconds + (medianWeeks === safeWeeks ? 0 : Math.max(0, slope)))),
  );
  return { seconds, source: "history", samples: shapeMatches.length };
}
