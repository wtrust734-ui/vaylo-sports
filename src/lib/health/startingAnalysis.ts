// ============================================================================
// VAYLO HEALTH — "Your Vaylo Starting Analysis"
// ----------------------------------------------------------------------------
// What an athlete sees straight after importing history, and the reason the
// import is worth doing at all: not a list of activities, but a reading of them.
//
// The whole module is judged by one rule the specification states twice — never
// fabricate missing data. Every claim below is therefore either derived from
// something that is actually in the record and carries a `basedOn` line saying
// what, or it is absent and the reason it is absent is stated. There is no
// plausible-sounding filler, and nothing here will say an athlete's training
// "improved" over a period that holds two sessions.
//
// Three further constraints, all load-bearing:
//
//   • IT IS NOT A MEDICAL READING. The output never names a condition, a
//     diagnosis, or a syndrome. It describes what the sessions show — volume,
//     rhythm, gaps, how often demanding days came back-to-back — and leaves the
//     judgement about the athlete's body to people who can examine it.
//
//   • ESTIMATES ARE LABELLED. Imported sessions carry no effort rating, so
//     their intensity is derived from duration, distance and sport (Phase 3's
//     own bands) and every place that uses it says so. Manual sessions with an
//     RPE use it.
//
//   • YOUTH GETS DEVELOPMENT FRAMING, NOT A PROGRESS REPORT. For an athlete
//     under 18 the copy leads with rhythm, consistency and enjoyment and drops
//     the comparative-performance phrasing. The thresholds do not change; the
//     pressure does.
//
// Pure: no I/O, no clock reads, no Supabase. `today` is an argument.
// ============================================================================

import { INTENSITY_BANDS, classifySport, type IntensityBand } from "../sessionLoad";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One session, reduced to what an analysis may legitimately reason about. */
export interface AnalysisSession {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  sport: string;
  title?: string | null;
  durationMinutes: number | null;
  distanceKm: number | null;
  /** Phase 3 load, when it could be computed. Null is not zero. */
  load: number | null;
  /** Provider id, or "manual". Drives the imported/manual split and labels. */
  source: string;
}

export interface AnalysisGoal {
  title: string;
  category?: string | null;
  metric_unit?: string | null;
  current_value?: number | null;
  target_value?: number | null;
  deadline?: string | null;
}

export interface AnalysisInput {
  sessions: AnalysisSession[];
  goals?: AnalysisGoal[];
  primarySport?: string | null;
  age?: number | null;
  /**
   * The day the windows are measured back from.
   *
   * Defaults to the LAST session's date, not the wall clock. An analysis is a
   * reading of the record it was built from: run today over a season that ended
   * in March, a wall-clock default would report six months of nothing, which is
   * a fact about the import and not about the athlete.
   */
  today?: string;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface AnalysisInsight {
  id: string;
  title: string;
  detail: string;
  /** What the claim rests on. A reader must be able to check it. */
  basedOn: string;
  tone: "strength" | "watch" | "neutral";
}

export interface SportCount {
  sport: string;
  sessions: number;
}

export interface TrainingPatterns {
  weeklyVolumeMinutes: number;
  weeklySessionCount: number;
  commonSports: SportCount[];
  typicalSessionMinutes: number;
  longestSessionMinutes: number;
  /** Estimated from duration, distance and sport — no effort ratings exist. */
  typicalIntensity: IntensityBand | null;
  typicalIntensityBasis: "estimated" | "logged" | null;
}

export interface ConsistencySummary {
  weeksConsidered: number;
  weeksWithSessions: number;
  weeksMeetingTarget: number;
  percent: number;
  targetPerWeek: number;
  /** Days between the last session and `today`. Reported, never penalised. */
  daysSinceLastSession: number;
}

export interface WorkloadSummary {
  recentDays: number;
  recentLoad: number;
  recentSessions: number;
  priorLoad: number | null;
  priorSessions: number | null;
  /** Recent weekly load ÷ prior weekly load, when both windows hold data. */
  ratio: number | null;
  band: "high" | "steady" | "low" | "unknown";
}

export interface ProgressTrend {
  metric: "distance" | "duration";
  sport: string | null;
  fromValue: number;
  toValue: number;
  changePercent: number;
  direction: "up" | "down" | "flat";
  basedOn: string;
}

export interface GoalAlignment {
  aligned: boolean | null;
  goalTitle: string;
  text: string;
}

export interface StartingAnalysis {
  /** No sessions at all: nothing to analyse, and the UI says only that. */
  empty: boolean;
  reason: string | null;
  windowDays: number;
  sessionCount: number;
  importedCount: number;
  manualCount: number;
  sources: string[];
  firstDate: string | null;
  lastDate: string | null;
  patterns: TrainingPatterns | null;
  consistency: ConsistencySummary | null;
  recentWorkload: WorkloadSummary | null;
  progress: ProgressTrend | null;
  progressUnavailableReason: string | null;
  goalAlignment: GoalAlignment | null;
  strengths: AnalysisInsight[];
  issues: AnalysisInsight[];
  nextSteps: AnalysisInsight[];
  caveats: string[];
}

// ---------------------------------------------------------------------------
// Thresholds — stated once, so the copy and the tests agree
// ---------------------------------------------------------------------------

/** Below this, a "pattern" would be describing noise. */
export const MIN_SESSIONS_FOR_PATTERNS = 8;
/** Below this, a trend is two data points and a story. */
export const MIN_SESSIONS_FOR_TREND = 6;
/** The same weekly rhythm Phase 2 treats as consistent training. */
export const CONSISTENCY_TARGET_PER_WEEK = 3;
/** A week this much above the athlete's own median week is a spike. */
export const SPIKE_RATIO = 1.5;
/** A gap this long is worth naming, because it changes what the next week should be. */
export const LONG_GAP_DAYS = 21;
/** How many consecutive demanding days count as a demanding block. */
export const BACK_TO_BACK_DAYS = 2;
/** Youth framing threshold. Under this, the copy stops being comparative. */
export const YOUTH_AGE = 18;

export const WORKLOAD_WINDOW_DAYS = 28;

export const YOUTH_ANALYSIS_NOTE =
  "This is a development summary, not a performance assessment. The most useful things to build at your age are a steady training rhythm, a range of sports, and enjoyment — not the biggest numbers.";

export const NO_EFFORT_NOTE =
  "Your imported sessions have no effort rating, so intensity here is estimated from duration, distance and sport rather than from how hard the sessions felt.";

export const RECORD_ONLY_NOTE =
  "This reads the training that is in your record. Sessions done without a watch or phone, or recorded in an app you have not connected, are not here — so treat the totals as a floor, not a measurement.";

// ---------------------------------------------------------------------------
// Day arithmetic — date-only, so it stays out of the timezone's way
// ---------------------------------------------------------------------------

/** Days since the epoch for a YYYY-MM-DD string, or null when unparseable. */
export function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(utc) ? utc / DAY_MS : null;
}

export function isoFromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday of the week a day belongs to, as a day number. */
export function mondayOf(day: number): number {
  const dow = new Date(day * DAY_MS).getUTCDay(); // 0 = Sunday
  return day - ((dow + 6) % 7);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const mean = (values: number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

const round = (n: number, places = 0): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/**
 * The intensity band a load-per-minute figure sits closest to.
 *
 * Phase 3's factors ARE load per minute (duration × factor), so a session's own
 * ratio can be read back against the same table the load was derived from. This
 * is why the estimate is defensible: it is the inverse of the calculation that
 * produced the number, not a second guess about the athlete.
 */
export function bandFromFactor(factor: number | null): IntensityBand | null {
  if (factor === null || !Number.isFinite(factor) || factor <= 0) return null;
  let best: IntensityBand | null = null;
  let bestGap = Infinity;
  for (const [band, spec] of Object.entries(INTENSITY_BANDS) as [
    IntensityBand,
    { factor: number },
  ][]) {
    const gap = Math.abs(spec.factor - factor);
    if (gap < bestGap) {
      bestGap = gap;
      best = band;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Reads an athlete's record and returns the starting analysis.
 *
 * Order of business: establish the facts (how much, over what span, from where),
 * then derive what those facts support, then say what they do not support. The
 * "does not support" half is not decoration — it is the difference between an
 * analysis and an advertisement.
 */
export function buildStartingAnalysis(input: AnalysisInput): StartingAnalysis {
  const youth = input.age != null && input.age < YOUTH_AGE;

  const dated = (input.sessions ?? [])
    .map((session) => ({ session, day: dayNumber(session.date) }))
    .filter((x): x is { session: AnalysisSession; day: number } => x.day !== null)
    .sort((a, b) => a.day - b.day);

  const base: StartingAnalysis = {
    empty: dated.length === 0,
    reason: null,
    windowDays: 0,
    sessionCount: dated.length,
    importedCount: 0,
    manualCount: 0,
    sources: [],
    firstDate: null,
    lastDate: null,
    patterns: null,
    consistency: null,
    recentWorkload: null,
    progress: null,
    progressUnavailableReason: null,
    goalAlignment: null,
    strengths: [],
    issues: [],
    nextSteps: [],
    caveats: [],
  };

  if (!dated.length) {
    return {
      ...base,
      empty: true,
      reason:
        "There are no sessions to read yet. Import your history or log a few sessions, and this becomes a picture of how you actually train.",
      caveats: [RECORD_ONLY_NOTE],
    };
  }

  const firstDay = dated[0].day;
  const lastDay = dated[dated.length - 1].day;
  const todayDay = dayNumber(input.today ?? "") ?? lastDay;
  const sessions = dated.map((x) => x.session);

  const imported = sessions.filter((s) => s.source && s.source !== "manual");
  const manual = sessions.filter((s) => !s.source || s.source === "manual");
  const sources = [...new Set(imported.map((s) => s.source))];

  const caveats: string[] = [RECORD_ONLY_NOTE];
  if (imported.length) caveats.push(NO_EFFORT_NOTE);
  if (youth) caveats.push(YOUTH_ANALYSIS_NOTE);

  const tooFew = sessions.length < MIN_SESSIONS_FOR_PATTERNS;
  const enoughForPatterns = !tooFew;

  // -------------------------------------------------------------------------
  // Patterns
  // -------------------------------------------------------------------------

  const firstMonday = mondayOf(firstDay);
  const lastMonday = mondayOf(lastDay);
  const weeksConsidered = Math.max(1, Math.floor((lastMonday - firstMonday) / 7) + 1);

  const durations = sessions
    .map((s) => s.durationMinutes)
    .filter((d): d is number => typeof d === "number" && d > 0);
  const totalMinutes = durations.reduce((a, b) => a + b, 0);

  const bySport = new Map<string, number>();
  for (const s of sessions) {
    const name = (s.sport ?? "").trim() || "Training";
    bySport.set(name, (bySport.get(name) ?? 0) + 1);
  }
  const commonSports: SportCount[] = [...bySport.entries()]
    .map(([sport, count]) => ({ sport, sessions: count }))
    .sort((a, b) => b.sessions - a.sessions || a.sport.localeCompare(b.sport));

  // Intensity: median load per minute, read back against Phase 3's bands.
  const factors = sessions
    .map((s) =>
      typeof s.load === "number" && typeof s.durationMinutes === "number" && s.durationMinutes > 0
        ? s.load / s.durationMinutes
        : null,
    )
    .filter((f): f is number => f !== null);
  const typicalFactor = factors.length >= 3 ? median(factors) : null;
  const typicalIntensity = bandFromFactor(typicalFactor);

  const patterns: TrainingPatterns | null = enoughForPatterns
    ? {
        weeklyVolumeMinutes: Math.round(totalMinutes / weeksConsidered),
        weeklySessionCount: round(sessions.length / weeksConsidered, 1),
        commonSports,
        typicalSessionMinutes: Math.round(median(durations)),
        longestSessionMinutes: durations.length ? Math.max(...durations) : 0,
        typicalIntensity,
        typicalIntensityBasis: typicalIntensity ? "estimated" : null,
      }
    : null;

  // -------------------------------------------------------------------------
  // Consistency — measured over the span the record covers
  // -------------------------------------------------------------------------

  const perWeek = new Map<number, number>();
  for (const { day } of dated) {
    const monday = mondayOf(day);
    perWeek.set(monday, (perWeek.get(monday) ?? 0) + 1);
  }
  const weeksMeetingTarget = [...perWeek.values()].filter(
    (n) => n >= CONSISTENCY_TARGET_PER_WEEK,
  ).length;

  const consistency: ConsistencySummary | null = enoughForPatterns
    ? {
        weeksConsidered,
        weeksWithSessions: perWeek.size,
        weeksMeetingTarget,
        // Over the recorded span, so a holiday is not silently scored as
        // inconsistent. The gap is reported separately, as a fact.
        percent: Math.round((weeksMeetingTarget / weeksConsidered) * 100),
        targetPerWeek: CONSISTENCY_TARGET_PER_WEEK,
        daysSinceLastSession: Math.max(0, todayDay - lastDay),
      }
    : null;

  // -------------------------------------------------------------------------
  // Recent workload — last 4 weeks against the 4 before them
  // -------------------------------------------------------------------------

  const inWindow = (from: number, to: number) =>
    dated.filter((x) => x.day > from && x.day <= to);
  const recent = inWindow(todayDay - WORKLOAD_WINDOW_DAYS, todayDay);
  const prior = inWindow(todayDay - WORKLOAD_WINDOW_DAYS * 2, todayDay - WORKLOAD_WINDOW_DAYS);

  const loadOf = (rows: { session: AnalysisSession }[]) =>
    rows.reduce((sum, r) => sum + (typeof r.session.load === "number" ? r.session.load : 0), 0);
  const priced = (rows: { session: AnalysisSession }[]) =>
    rows.filter((r) => typeof r.session.load === "number").length;

  let recentWorkload: WorkloadSummary | null = null;
  if (priced(recent) > 0) {
    // Both windows are the same length, so the totals compare directly as a
    // ratio. A prior window with no priced session yields no ratio at all — it
    // does not yield "1.0", which would read as "steady" when the truth is that
    // there is nothing to be steady against.
    const comparable = priced(prior) > 0 && loadOf(prior) > 0;
    const ratio = comparable ? round(loadOf(recent) / loadOf(prior), 2) : null;
    recentWorkload = {
      recentDays: WORKLOAD_WINDOW_DAYS,
      recentLoad: Math.round(loadOf(recent)),
      recentSessions: recent.length,
      priorLoad: comparable ? Math.round(loadOf(prior)) : null,
      priorSessions: comparable ? prior.length : null,
      ratio,
      band:
        ratio === null
          ? "unknown"
          : ratio > 1.3
            ? "high"
            : ratio < 0.7
              ? "low"
              : "steady",
    };
  }

  // -------------------------------------------------------------------------
  // Progress — one measured metric, only when both halves can carry it
  // -------------------------------------------------------------------------

  const dominant = commonSports[0]?.sport ?? input.primarySport ?? null;
  const dominantKind = classifySport(dominant, null);
  const dominantSessions = dominant ? sessions.filter((s) => (s.sport ?? "").trim() === dominant) : [];

  let progress: ProgressTrend | null = null;
  let progressUnavailableReason: string | null = null;

  const distanceRows = dominantSessions.filter(
    (s) => typeof s.distanceKm === "number" && s.distanceKm > 0,
  );
  const durationRows = sessions.filter(
    (s) => typeof s.durationMinutes === "number" && s.durationMinutes > 0,
  );

  const trend = (
    rows: AnalysisSession[],
    metric: "distance" | "duration",
  ): ProgressTrend | null => {
    if (rows.length < MIN_SESSIONS_FOR_TREND) return null;
    const split = Math.floor(rows.length / 2);
    const valueOf = (s: AnalysisSession) =>
      metric === "distance" ? (s.distanceKm as number) : (s.durationMinutes as number);
    const early = mean(rows.slice(0, split).map(valueOf));
    const late = mean(rows.slice(rows.length - split).map(valueOf));
    if (!early || !late) return null;
    const changePercent = Math.round(((late - early) / early) * 100);
    return {
      metric,
      sport: metric === "distance" ? dominant : null,
      fromValue: round(early, 2),
      toValue: round(late, 2),
      changePercent,
      direction: Math.abs(changePercent) < 5 ? "flat" : changePercent > 0 ? "up" : "down",
      basedOn: `${rows.length} ${metric === "distance" ? `${dominant} ` : ""}sessions across the record, earliest half against latest half`,
    };
  };

  if (distanceRows.length >= MIN_SESSIONS_FOR_TREND) {
    progress = trend(distanceRows, "distance");
  } else if (durationRows.length >= MIN_SESSIONS_FOR_TREND) {
    progress = trend(durationRows, "duration");
  }
  if (!progress) {
    progressUnavailableReason =
      distanceRows.length > 0
        ? `Not enough comparable sessions to read a trend yet — ${distanceRows.length} of the ${MIN_SESSIONS_FOR_TREND} needed with a recorded distance.`
        : `No distances were recorded in this history, and there are not yet ${MIN_SESSIONS_FOR_TREND} sessions with a duration to compare.`;
  }

  // -------------------------------------------------------------------------
  // Goal alignment
  // -------------------------------------------------------------------------

  let goalAlignment: GoalAlignment | null = null;
  const goal = (input.goals ?? [])[0];
  if (goal?.title) {
    const goalKind = classifySport(`${goal.title} ${goal.category ?? ""}`, null);
    if (goalKind === "unknown" || dominantKind === "unknown" || !dominant) {
      goalAlignment = {
        aligned: null,
        goalTitle: goal.title,
        text: `Your record is mostly ${commonSports
          .slice(0, 2)
          .map((s) => s.sport)
          .join(" and ")}. I can't yet say how that lines up with “${goal.title}” — there isn't enough here for me to match the two honestly.`,
      };
    } else if (goalKind === dominantKind) {
      goalAlignment = {
        aligned: true,
        goalTitle: goal.title,
        text: `Your recent training is mostly ${dominant}, which lines up with your goal of “${goal.title}”.`,
      };
    } else {
      goalAlignment = {
        aligned: false,
        goalTitle: goal.title,
        text: `Your recent training is more focused on ${dominant} than on your goal of “${goal.title}”. That is worth knowing before the next block — not necessarily wrong, but it should be a choice.`,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Strengths, issues, next steps
  // -------------------------------------------------------------------------

  const strengths: AnalysisInsight[] = [];
  const issues: AnalysisInsight[] = [];
  const nextSteps: AnalysisInsight[] = [];

  if (consistency && consistency.percent >= 70) {
    strengths.push({
      id: "consistent",
      title: "You train most weeks",
      detail: `You hit ${CONSISTENCY_TARGET_PER_WEEK} or more sessions in ${consistency.weeksMeetingTarget} of ${consistency.weeksConsidered} weeks. That rhythm is the foundation everything else is built on.`,
      basedOn: `${consistency.percent}% of the ${consistency.weeksConsidered} weeks in your record`,
      tone: "strength",
    });
  }
  if (patterns && patterns.weeklySessionCount >= 2 && patterns.weeklySessionCount <= 6) {
    strengths.push({
      id: "rhythm",
      title: "A sustainable weekly rhythm",
      detail: `About ${patterns.weeklySessionCount} sessions a week, averaging ${patterns.weeklyVolumeMinutes} minutes. That is a load you can hold and build on.`,
      basedOn: `${sessions.length} sessions over ${weeksConsidered} weeks`,
      tone: "strength",
    });
  }
  if (commonSports.length >= 2) {
    strengths.push({
      id: "multi-sport",
      title: "More than one sport",
      detail: `Your history covers ${commonSports
        .slice(0, 3)
        .map((s) => s.sport)
        .join(", ")}. Range like that builds a broader base and gives you somewhere to go when one sport needs a break.`,
      basedOn: `${commonSports.length} sports across ${sessions.length} sessions`,
      tone: "strength",
    });
  }
  if (recentWorkload && recentWorkload.band === "steady" && recentWorkload.ratio !== null) {
    strengths.push({
      id: "steady-load",
      title: "Your recent load is steady",
      detail: `The last ${WORKLOAD_WINDOW_DAYS} days sit close to the ${WORKLOAD_WINDOW_DAYS} before them. Holding volume steady is how a base gets built without asking too much of one week.`,
      basedOn: `${recentWorkload.recentLoad} load recently against ${recentWorkload.priorLoad} before`,
      tone: "strength",
    });
  }

  // Spike weeks, judged against the athlete's own median — never an external
  // standard, because there isn't one that fits a 14-year-old and a 40-year-old.
  const weekLoads = new Map<number, number>();
  for (const { session, day } of dated) {
    if (typeof session.load !== "number") continue;
    const monday = mondayOf(day);
    weekLoads.set(monday, (weekLoads.get(monday) ?? 0) + session.load);
  }
  const weekLoadValues = [...weekLoads.values()];
  const medianWeek = median(weekLoadValues);
  const spikeWeeks = weekLoadValues.filter((v) => medianWeek > 0 && v > medianWeek * SPIKE_RATIO);
  // Strictly a minority, or it is not a spike at all. When half the weeks sit
  // above 1.5× the median, the "median" is describing an alternation that IS the
  // athlete's pattern, and calling it a deviation would be advice about nothing.
  if (medianWeek > 0 && spikeWeeks.length > 0 && spikeWeeks.length < weekLoadValues.length / 2) {
    issues.push({
      id: "spikes",
      title: youth ? "Some weeks were much bigger than others" : "Load jumped in some weeks",
      detail: `${spikeWeeks.length} ${spikeWeeks.length === 1 ? "week was" : "weeks were"} well above your usual week. Big single weeks are where niggles come from — the same volume spread over more weeks tends to stick better.`,
      basedOn: `weekly load against your own median week (${Math.round(medianWeek)})`,
      tone: "watch",
    });
  }

  // Demanding days back to back.
  const loadByDay = new Map<number, number>();
  for (const { session, day } of dated) {
    if (typeof session.load !== "number") continue;
    loadByDay.set(day, (loadByDay.get(day) ?? 0) + session.load);
  }
  const dayLoads = [...loadByDay.entries()].sort((a, b) => a[0] - b[0]);
  const upperQuartile = (() => {
    const values = dayLoads.map(([, v]) => v).sort((a, b) => a - b);
    if (!values.length) return Infinity;
    return values[Math.min(values.length - 1, Math.floor(values.length * 0.75))];
  })();
  let backToBack = 0;
  for (let i = 1; i < dayLoads.length; i++) {
    if (dayLoads[i][0] - dayLoads[i - 1][0] === 1) {
      if (dayLoads[i][1] >= upperQuartile && dayLoads[i - 1][1] >= upperQuartile) backToBack++;
    }
  }
  if (backToBack > 0 && dayLoads.length >= MIN_SESSIONS_FOR_TREND) {
    issues.push({
      id: "back-to-back",
      title: "Demanding days came back to back",
      detail: `${backToBack} ${backToBack === 1 ? "pair" : "pairs"} of your hardest days sat on consecutive days. An easier day between them is usually worth more than the session it replaces.`,
      basedOn: `the ${dayLoads.length} days in your record that carry a load figure`,
      tone: "watch",
    });
  }

  // A long gap: named as a fact, because it changes what the next week should be.
  let longestGap = 0;
  for (let i = 1; i < dated.length; i++) {
    longestGap = Math.max(longestGap, dated[i].day - dated[i - 1].day);
  }
  if (longestGap >= LONG_GAP_DAYS) {
    issues.push({
      id: "gap",
      title: "There was a long break",
      detail: `Your record has a gap of ${longestGap} days. When you come back from a break, building back gradually beats picking up where you left off — Vaylo plans the return for you when it knows about it.`,
      basedOn: `the longest gap between consecutive sessions in your record`,
      tone: "watch",
    });
  }

  // Next steps. Data gaps first: advice built on a thin record is not advice.
  if (tooFew) {
    nextSteps.push({
      id: "log-more",
      title: "Give me a little more to work with",
      detail: `There are ${sessions.length} sessions here, and a pattern needs about ${MIN_SESSIONS_FOR_PATTERNS}. Keep logging and this page fills in.`,
      basedOn: `${sessions.length} sessions recorded`,
      tone: "neutral",
    });
  }
  if (!input.goals?.length) {
    nextSteps.push({
      id: "set-a-goal",
      title: "Set a goal",
      detail:
        "A goal is what turns a training history into a plan. Add one and this analysis can tell you whether your recent training is pointing at it.",
      basedOn: "no outcome goals are set on this account",
      tone: "neutral",
    });
  } else if (goalAlignment && goalAlignment.aligned === false) {
    nextSteps.push({
      id: "aim-at-goal",
      title: `Point your week at “${goalAlignment.goalTitle}”`,
      detail:
        "Your recent training leans towards a different sport from your goal. Either shift some sessions towards it, or move the goal — but choose on purpose.",
      basedOn: "your goal's sport and your most-trained sport",
      tone: "neutral",
    });
  }
  if (spikeWeeks.length > 0) {
    nextSteps.push({
      id: "hold-volume",
      title: "Hold your volume for a few weeks",
      detail:
        "A steadier weekly load tends to build more than one big week followed by a quiet one. Aim for the same total, spread more evenly.",
      basedOn: `${spikeWeeks.length} ${spikeWeeks.length === 1 ? "week" : "weeks"} above ${SPIKE_RATIO}× your median week`,
      tone: "neutral",
    });
  }
  const hasStrengthWork = sessions.some(
    (s) => classifySport(s.sport, s.title ?? null) === "strength",
  );
  if (!hasStrengthWork && sessions.length >= MIN_SESSIONS_FOR_TREND) {
    nextSteps.push({
      id: "add-strength",
      title: "Add one strength session a week",
      detail:
        "There is no strength work in this history. One session a week is a small change that tends to make the sessions you already do more durable.",
      basedOn: `no strength sessions among ${sessions.length} recorded`,
      tone: "neutral",
    });
  }
  if (progress?.direction === "down") {
    nextSteps.push({
      id: "check-the-basics",
      title: "Check the basics before pushing",
      detail:
        "Your recent sessions are a little shorter or shorter-distance than your earlier ones. Sometimes that is a deliberate step back, sometimes it is a sign the week needs an easier day. Worth a look either way.",
      basedOn: "the earliest half of your record against the latest half",
      tone: "neutral",
    });
  }

  const windowDays = Math.max(1, todayDay - firstDay);

  return {
    ...base,
    empty: false,
    windowDays,
    sessionCount: sessions.length,
    importedCount: imported.length,
    manualCount: manual.length,
    sources,
    firstDate: isoFromDayNumber(firstDay),
    lastDate: isoFromDayNumber(lastDay),
    patterns,
    consistency,
    recentWorkload,
    progress,
    progressUnavailableReason,
    goalAlignment,
    strengths,
    issues,
    nextSteps,
    caveats,
  };
}
