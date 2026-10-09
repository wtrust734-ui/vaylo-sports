// ============================================================================
// PLAN PERIODISATION — the week-by-week skeleton, computed before the model runs
// ----------------------------------------------------------------------------
// Why this exists: `generate-plan` used to ask one model call for an entire
// plan, every week in one response. Long plans took minutes, and the structure
// they came back with was whatever the model decided that day — so a 12-week
// plan could ramp for three weeks and then flatten, and nothing in the app could
// tell, because the app had no opinion about periodisation at all. It only had a
// sentence in the prompt ("every 4th week is a deload") that the model was free
// to ignore.
//
// Now the app decides the skeleton first — which weeks are deloads, what each
// block is for, how volume and intensity progress — and the model is asked only
// to fill in the SESSIONS for its own slice of that skeleton. Three things
// follow:
//
//   * Weeks can be written in parallel (see PLAN_CHUNK_WEEKS below), which is
//     where the speed comes from, without the plan falling apart at the seams
//     between chunks: the progression lives here, not in the model's memory of
//     what it wrote earlier.
//   * The deload placement is the app's, not the model's. `generate-plan`
//     stamps these flags onto the merged plan, so a week cannot arrive labelled
//     however the model felt that day.
//   * This file is pure and unit-tested (`src/lib/planPeriodisation.test.ts`),
//     which the prompt it replaced could never be.
// ============================================================================

/** One week of the plan, as numbers, before any session is written. */
export interface WeekSkeleton {
  week: number;
  isDeload: boolean;
  /** Technique | Base | Build | Peak | Deload */
  focus: string;
  /** Non-rest days the week should contain. */
  sessions: number;
  /** Percentage of the athlete's normal volume. */
  volumePct: number;
  /** Percentage of the athlete's normal intensity. */
  intensityPct: number;
}

/**
 * Weeks of plan per model call, for the plans too long to write one week at a
 * time. Mirrored by `src/lib/planGeneration.ts`.
 */
export const PLAN_CHUNK_WEEKS = 2;

/**
 * The longest plan written one week per model call.
 *
 * Wall-clock time is set by the SLOWEST call and grows with the weeks inside a
 * call — measured on the deployed function at ~27s for a one-week call against
 * ~55s for a two-week one, because a call's output IS the plan's own text. So
 * one week per call is the fastest shape, and up to twelve weeks it costs no
 * more calls in flight than a long plan already fires. Past that the extra
 * calls buy less than they risk (a rate limit is a refunded plan, which is
 * worse than a slow one), so long plans keep the two-week chunks.
 */
export const ONE_WEEK_CHUNK_MAX_WEEKS = 12;

/**
 * Chunk size for a plan of this length: one week up to the ceiling above, two
 * weeks beyond it. Mirrors `planChunkWeeks` in `src/lib/planGeneration.ts`.
 */
export function planChunkWeeks(weeks: number): number {
  const total = clampInt(weeks, 1, 52, 4);
  return total <= ONE_WEEK_CHUNK_MAX_WEEKS ? 1 : PLAN_CHUNK_WEEKS;
}

/**
 * The three-week focus cycle inside each deload block, by level. A beginner
 * spends the first block on technique, an advanced athlete gets a peak week
 * because they can absorb one. The deload itself is placed by `deloadEvery`,
 * not by this cycle.
 */
const FOCUS_CYCLE: Record<string, string[]> = {
  beginner: ["Technique", "Base", "Build"],
  intermediate: ["Base", "Build", "Build"],
  advanced: ["Base", "Build", "Peak"],
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/**
 * The whole plan's skeleton. Monotonic by construction: a week never carries
 * less volume than the week before it unless it is a deload, and the deload is
 * the only place volume drops.
 */
export function buildWeekSkeleton(input: {
  duration: number;
  deloadEvery?: number;
  level?: string;
  sessionsPerWeek?: number;
}): WeekSkeleton[] {
  const duration = clampInt(input.duration, 1, 52, 4);
  const deloadEvery = clampInt(input.deloadEvery, 2, 8, 4);
  const sessionsPerWeek = clampInt(input.sessionsPerWeek, 1, 7, 4);
  const cycle = FOCUS_CYCLE[String(input.level ?? "").toLowerCase()] ?? FOCUS_CYCLE.intermediate;

  const weeks: WeekSkeleton[] = [];
  for (let week = 1; week <= duration; week++) {
    const isDeload = week % deloadEvery === 0;

    if (isDeload) {
      weeks.push({
        week,
        isDeload: true,
        focus: "Deload",
        // A deload with the same number of sessions is not a deload — it is the
        // same week with easier numbers, which athletes read as "this plan
        // never lets up".
        sessions: Math.max(1, sessionsPerWeek - 1),
        volumePct: 60,
        intensityPct: 65,
      });
      continue;
    }

    // Progress across the whole plan rather than within a block, so a 12-week
    // plan does not reset to block-one volume three times.
    const progress = duration > 1 ? (week - 1) / (duration - 1) : 1;
    const focus = cycle[(week - 1) % cycle.length];
    const peakBonus = focus === "Peak" ? 5 : 0;

    weeks.push({
      week,
      isDeload: false,
      focus,
      sessions: sessionsPerWeek,
      volumePct: Math.round(80 + 20 * progress),
      intensityPct: Math.min(100, Math.round(70 + 25 * progress + peakBonus)),
    });
  }

  return weeks;
}

/** Splits the skeleton into the pieces that are written in parallel. */
export function chunkSkeleton(weeks: WeekSkeleton[], size: number = PLAN_CHUNK_WEEKS): WeekSkeleton[][] {
  const chunkSize = clampInt(size, 1, 12, PLAN_CHUNK_WEEKS);
  const chunks: WeekSkeleton[][] = [];
  for (let i = 0; i < weeks.length; i += chunkSize) {
    chunks.push(weeks.slice(i, i + chunkSize));
  }
  return chunks;
}

const volumeLine = (w: WeekSkeleton): string =>
  `${w.sessions} session${w.sessions === 1 ? "" : "s"}, volume ~${w.volumePct}%, intensity ~${w.intensityPct}%`;

/**
 * The numbered targets handed to one chunk's prompt. Every week of the plan is
 * listed, not only the caller's, so a chunk can see where its part sits in the
 * progression even though its neighbours are being written at the same time.
 */
export function skeletonTargetLines(all: WeekSkeleton[], own: WeekSkeleton[]): string {
  const ownWeeks = new Set(own.map((w) => w.week));
  return all
    .map(
      (w) =>
        `- Week ${w.week}${ownWeeks.has(w.week) ? "  <-- THIS REQUEST" : ""} (${w.focus}${w.isDeload ? ", deload" : ""}): ${volumeLine(w)}`,
    )
    .join("\n");
}

/**
 * What a chunk needs to know about its neighbours that the numbers above do not
 * say out loud: they exist, they are being written now, and they are not its
 * business to cover.
 */
export function skeletonContinuityNote(own: WeekSkeleton[], all: WeekSkeleton[]): string {
  const first = own[0]?.week ?? 1;
  const last = own[own.length - 1]?.week ?? first;
  const before = all.filter((w) => w.week < first);
  const after = all.filter((w) => w.week > last);

  const parts: string[] = [];
  if (before.length) {
    const prev = before[before.length - 1];
    parts.push(
      `week ${prev.week} (${prev.focus}${prev.isDeload ? ", deload" : ""}) ends at ~${prev.volumePct}% volume`,
    );
  }
  if (after.length) {
    const next = after[0];
    parts.push(`week ${next.week} (${next.focus}${next.isDeload ? ", deload" : ""}) starts from ~${next.volumePct}% volume`);
  }

  const base =
    "You are writing ONE SLICE of this plan. The other weeks are being written at the same time by other calls — do not write them, do not summarise them, and do not assume anything about them that the targets above do not state.";
  return parts.length ? `${base} For continuity: ${parts.join(", and ")}.` : base;
}
