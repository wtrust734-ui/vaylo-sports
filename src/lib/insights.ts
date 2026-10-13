// ============================================================================
// INSIGHTS — the actionable analytics layer
// ----------------------------------------------------------------------------
// Phase 5's `startingAnalysis` answers "how do you train?" once, from history.
// This answers the question that keeps being asked afterwards: "where am I
// right now, and what should I do about it?" — and it answers it in seven
// things rather than a dashboard, because a screen with forty numbers on it is
// a screen nobody reads twice.
//
// The specification names exactly what belongs here:
//
//   consistency · recent workload · load trend · recovery trend ·
//   goal progress · plan adjustments · return-from-break status
//
// and, just as importantly, what does not: charts that do not drive a decision,
// metrics the athlete cannot influence, and risk scores that sound medical. So
// every metric below is one of three shapes — a number with a verdict, a
// number with a direction, or an honest "not yet measurable" — and each carries
// the same structured `why` and `rationale` the rest of this phase uses.
//
// It computes nothing that already exists elsewhere. Load comes from Phase 3's
// `sessionLoad`, planning statuses and the completion denominator from Phase 1's
// `lifeEvents`, recovery thresholds from Phase 3's `recoveryAdjust`, goal
// progress from Phase 4's `roadmap`, and the reasoning shape itself from
// `lib/explanations.ts`. This module is the join, not a second opinion.
//
// Pure: no I/O, no clock reads, no Supabase. `today` and the facts arrive as
// arguments, so every rule here is testable without a database — and the
// offline cache in Phase 5 can hold the result.
// ============================================================================

import { loadTotals } from "./sessionLoad";
import {
  HIGH_FATIGUE,
  HIGH_SORENESS,
  HIGH_STRESS,
  POOR_READINESS,
  POOR_SLEEP,
  GOOD_READINESS,
  ELEVATED_LOAD_RATIO,
  REDUCED_LOAD_RATIO,
} from "./recoveryAdjust";
import {
  buildExplanation,
  explainConsistency,
  explainGoalProximity,
  explainWorkload,
  sortExplanations,
  type ExplanationConfidence,
  type ExplanationReason,
  type ExplanationTone,
} from "./explanations";
import {
  CONSISTENCY_TARGET_PER_WEEK,
  RECORD_ONLY_NOTE,
  NO_EFFORT_NOTE,
  YOUTH_AGE,
  YOUTH_ANALYSIS_NOTE,
  dayNumber,
  isoFromDayNumber,
  mondayOf,
} from "./health/startingAnalysis";
import { lifeEventType } from "./lifeEvents";
import type { LifeEventType } from "./lifeEvents";
import type { RoadmapProgressStatus } from "./roadmap";

// ---------------------------------------------------------------------------
// Windows — named because the copy quotes them
// ---------------------------------------------------------------------------

/** Consistency, workload and adjustments are all read over four weeks. */
export const INSIGHT_WINDOW_DAYS = 28;
/** Sleep, fatigue and readiness are read over the last fortnight. */
export const RECOVERY_WINDOW_DAYS = 14;
/** A trend line shorter than four points is a shape invented from noise. */
export const LOAD_TREND_MIN_WEEKS = 4;
/** Eight weeks is the ceiling: past that the bars stop being comparable. */
export const LOAD_TREND_MAX_WEEKS = 8;
/** How far off a competition has to be before it organises the week. */
export const GOAL_WINDOW_DAYS = 21;

// ---------------------------------------------------------------------------
// Input — what the athlete's own record holds
// ---------------------------------------------------------------------------

export interface InsightSession {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  sport: string;
  durationMinutes: number | null;
  distanceKm: number | null;
  /** Phase 3 load. Null is not zero — a session that could not be priced. */
  load: number | null;
  /** Provider id, or "manual". Drives the imported/manual split. */
  source: string;
  title?: string | null;
}

export interface InsightPlannedSession {
  date: string;
  title: string;
  /** Phase 1 status. Only `planned` and `completed` count toward the number. */
  status: string;
  lifeEventId?: string | null;
  important?: boolean;
  /** Phase 1's rule, applied by the caller: excluded from the denominator. */
  countsTowardCompletion: boolean;
}

export interface InsightRecoveryDay {
  date: string;
  /** All 1–10 except readiness, which is 0–100 and genuinely optional. */
  sleepQuality?: number | null;
  fatigue?: number | null;
  soreness?: number | null;
  stress?: number | null;
  hours?: number | null;
  readinessScore?: number | null;
}

export interface InsightAdjustment {
  date: string;
  title: string;
  /** The life event type that caused it, when there was one. */
  eventType?: LifeEventType | null;
  /** Phase 2's record of what was taken off, when the change was a rebuild. */
  volumePct?: number | null;
}

export interface InsightGoal {
  title: string;
  /** The app's existing `outcomeProgress()` percentage. */
  percent: number;
  status: RoadmapProgressStatus;
  daysRemaining: number | null;
  achievedMilestones: number;
  totalMilestones: number;
  nextMilestone: { title: string; targetDate: string | null } | null;
}

export interface InsightCompetition {
  title: string;
  days: number;
}

export interface InsightReturnProgression {
  /** 1 = the first week back. */
  weekBack: number;
  totalWeeks: number;
  volumePct: number;
  /**
   * What the week is for. The first four are the return progression; `preload`
   * is the loading week before a planned break, `holiday` the eased week inside
   * one and `paused` the week inside one the athlete said they would not train
   * in, because a break reshapes the weeks around it too. Mirrors
   * `ReturnFocus` in `@/lib/adaptivePlan`.
   */
  focus: "rebuild" | "restore" | "resume" | "compete" | "preload" | "holiday" | "paused";
}

export interface InsightFacts {
  /** Local calendar day, `YYYY-MM-DD`. Never read from the clock here. */
  today: string;
  age?: number | null;
  sessions: InsightSession[];
  planned: InsightPlannedSession[];
  recovery: InsightRecoveryDay[];
  goals: InsightGoal[];
  adjustments: InsightAdjustment[];
  returnFromBreak?: InsightReturnProgression | null;
  competition?: InsightCompetition | null;
  /** The athlete's primary sport, for the trend's subtitle. */
  primarySport?: string | null;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type InsightMetricId =
  | "return_progression"
  | "consistency"
  | "workload"
  | "recovery_trend"
  | "goal_progress"
  | "plan_adjustments"
  | "load_trend";

export interface InsightMetric {
  id: InsightMetricId;
  label: string;
  /**
   * False when the record cannot support the number.
   *
   * The metric is still returned, with the reason, because "we cannot tell you
   * yet" is information the athlete can act on (log a check-in) and a missing
   * section is not.
   */
  available: boolean;
  /** The short value shown with the label. */
  value: string;
  /** The recommendation or the reading, in one sentence. */
  headline: string;
  tone: ExplanationTone;
  why: ExplanationReason[];
  /** "What this means". */
  rationale: string;
  confidence: ExplanationConfidence;
  /** The one thing to do about it, or null when nothing needs doing. */
  nextStep: string | null;
  /** Weekly load for the trend, oldest first. Empty for every other metric. */
  series?: number[];
  /** Up to two sports named in the trend, for the subtitle. */
  seriesSports?: string[];
}

export interface TrainingInsights {
  empty: boolean;
  reason: string | null;
  today: string;
  windowDays: number;
  sessionCount: number;
  importedCount: number;
  manualCount: number;
  metrics: InsightMetric[];
  /** The most actionable metric, for a banner or the screen's lead card. */
  top: InsightMetric | null;
  caveats: string[];
  youth: boolean;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * The week start day-numbers and keys ending with the week containing `monday`,
 * oldest first.
 */
function weekStrip(monday: number, weeks: number): { start: number; key: string }[] {
  const out: { start: number; key: string }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = monday - i * 7;
    out.push({ start, key: isoFromDayNumber(start) });
  }
  return out;
}

/**
 * The label for a life-event type.
 *
 * `lifeEventType` is total — it falls back to the last catalogue entry for an
 * id the client does not know — so an unrecognised type from the database reads
 * as "Private / no reason" rather than throwing inside a render.
 */
function eventLabel(type: LifeEventType | null | undefined): string {
  if (!type) return "your plans changing";
  return lifeEventType(type)?.label ?? "your plans changing";
}

// ---------------------------------------------------------------------------
// The metrics
// ---------------------------------------------------------------------------

function consistencyMetric(
  facts: InsightFacts,
  youth: boolean,
  windowStart: string,
): InsightMetric {
  const inWindow = facts.planned.filter((p) => p.date >= windowStart && p.date <= facts.today);
  const counted = inWindow.filter((p) => p.countsTowardCompletion);
  const completed = counted.filter((p) => p.status === "completed").length;
  const excused = inWindow.length - counted.length;
  const percent = counted.length ? Math.round((completed / counted.length) * 100) : 0;

  // The week strip is the honest denominator for "weeks hitting the target":
  // a week with nothing scheduled in it cannot be a week the athlete failed.
  const monday = mondayOf(dayNumber(facts.today) ?? 0);
  const weeks = weekStrip(monday, INSIGHT_WINDOW_DAYS / 7);
  let weeksConsidered = 0;
  let weeksMeetingTarget = 0;
  for (const week of weeks) {
    const end = week.start + 6;
    const inWeek = counted.filter((p) => {
      const n = dayNumber(p.date);
      return n !== null && n >= week.start && n <= end && p.status === "completed";
    });
    const scheduled = counted.filter((p) => {
      const n = dayNumber(p.date);
      return n !== null && n >= week.start && n <= end;
    });
    if (scheduled.length === 0) continue;
    weeksConsidered++;
    if (inWeek.length >= CONSISTENCY_TARGET_PER_WEEK) weeksMeetingTarget++;
  }

  const explanation =
    counted.length === 0
      ? null
      : explainConsistency({
          completed,
          planned: counted.length,
          percent,
          targetPerWeek: CONSISTENCY_TARGET_PER_WEEK,
          weeksConsidered: Math.max(1, weeksConsidered),
          weeksMeetingTarget,
          excusedByBreak: excused,
          youth,
        });

  if (!explanation) {
    return {
      id: "consistency",
      label: "Consistency",
      available: false,
      value: "—",
      headline: "No planned sessions in the last four weeks to measure against.",
      tone: "info",
      why: [
        {
          text: "Consistency is the share of your plan you actually did, and there is nothing scheduled in this window.",
          source: "plan",
        },
      ],
      rationale:
        "Build a plan or log training and this becomes a real number instead of a percentage of nothing.",
      confidence: "none",
      nextStep: "Set up a plan so there is something to be consistent with.",
    };
  }

  const nextStep =
    percent >= 85
      ? null
      : excused > 0
        ? "Pick the days you can realistically hold, and treat those as fixed."
        : `Aim for ${CONSISTENCY_TARGET_PER_WEEK} sessions a week — the same days each week if you can.`;

  return {
    id: "consistency",
    label: "Consistency",
    available: true,
    value: `${percent}%`,
    headline: explanation.headline,
    tone: explanation.tone,
    why: explanation.why,
    rationale: explanation.rationale,
    confidence: explanation.confidence,
    nextStep,
  };
}

function workloadMetric(facts: InsightFacts, youth: boolean, windowStart: string): InsightMetric {
  const recentStart = isoFromDayNumber((dayNumber(facts.today) ?? 0) - INSIGHT_WINDOW_DAYS + 1);
  const priorStart = isoFromDayNumber((dayNumber(facts.today) ?? 0) - INSIGHT_WINDOW_DAYS * 2 + 1);

  const entries = facts.sessions.map((s) => ({ date: s.date, load: num(s.load) }));
  const recent = entries.filter((e) => e.date >= recentStart && e.date <= facts.today);
  const prior = entries.filter((e) => e.date >= priorStart && e.date < recentStart);

  const recentTotals = loadTotals(recent);
  const priorTotals = loadTotals(prior);
  // Day-count normalised, so a window the record only partly covers is not
  // silently read as a drop in training.
  const perDay = (t: { total: number; daysLogged: number }, fallback: number) =>
    t.daysLogged > 0 ? t.total / t.daysLogged : fallback;
  const recentPerDay = perDay(recentTotals, 0);
  const priorPerDay = perDay(priorTotals, 0);
  // Both windows need a PRICED session before they can be compared. Sessions in
  // the record with no effort rating or too little detail contribute a date but
  // no load, and a ratio built from those would read a logging gap as a change
  // in training.
  const comparable = recentTotals.sessions > 0 && priorTotals.sessions > 0;
  const ratio = comparable && priorPerDay > 0 ? recentPerDay / priorPerDay : null;
  const band: "high" | "steady" | "low" | "unknown" =
    ratio === null
      ? "unknown"
      : ratio > ELEVATED_LOAD_RATIO
        ? "high"
        : ratio < REDUCED_LOAD_RATIO
          ? "low"
          : "steady";

  const explanation = explainWorkload({
    recentDays: INSIGHT_WINDOW_DAYS,
    recentLoad: Math.round(recentTotals.total),
    // The count that produced the load, so the sentence and the number agree.
    recentSessions: recentTotals.sessions,
    priorLoad: comparable ? Math.round(priorTotals.total) : null,
    ratio,
    band,
    inReturnProgression: !!facts.returnFromBreak,
    youth,
  });

  return {
    id: "workload",
    label: "Recent workload",
    available: comparable && recent.length > 0,
    value:
      ratio === null
        ? recent.length
          ? `${Math.round(recentTotals.total)} load`
          : "—"
        : `${ratio >= 1 ? "+" : "−"}${Math.abs(Math.round((ratio - 1) * 100))}%`,
    headline: explanation.headline,
    tone: explanation.tone,
    why: explanation.why,
    rationale: explanation.rationale,
    confidence: explanation.confidence,
    nextStep:
      band === "high"
        ? "Put an easier week in before adding anything else."
        : band === "low"
          ? "Add one session back, and keep it easy."
          : null,
  };
}

function recoveryTrendMetric(facts: InsightFacts): InsightMetric {
  const start = isoFromDayNumber((dayNumber(facts.today) ?? 0) - RECOVERY_WINDOW_DAYS + 1);
  const inWindow = facts.recovery
    .filter((r) => r.date >= start && r.date <= facts.today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (inWindow.length === 0) {
    return {
      id: "recovery_trend",
      label: "Recovery",
      available: false,
      value: "—",
      headline: "No recovery check-ins in the last two weeks.",
      tone: "info",
      why: [
        {
          text: `You have no sleep, fatigue or readiness entries in the last ${RECOVERY_WINDOW_DAYS} days.`,
          source: "recovery",
        },
        {
          text: "Your training is still read from your sessions; only the how-you-felt half is missing.",
          source: "plan",
        },
      ],
      rationale:
        "Recovery is the half of the picture that only you can supply. Logging how you slept is enough to start.",
      confidence: "none",
      nextStep: "Log one check-in — sleep quality and fatigue is enough.",
    };
  }

  const sleep = inWindow.map((r) => num(r.sleepQuality)).filter((v): v is number => v !== null);
  const fatigue = inWindow.map((r) => num(r.fatigue)).filter((v): v is number => v !== null);
  const soreness = inWindow.map((r) => num(r.soreness)).filter((v): v is number => v !== null);
  const stress = inWindow.map((r) => num(r.stress)).filter((v): v is number => v !== null);
  const readiness = inWindow.map((r) => num(r.readinessScore)).filter((v): v is number => v !== null);

  const avgSleep = mean(sleep);
  const avgFatigue = mean(fatigue);
  const avgSoreness = mean(soreness);
  const avgStress = mean(stress);
  const avgReadiness = mean(readiness);

  // Direction from halves, not from a regression: with twelve points a
  // regression line is a claim the data cannot support, and the athlete only
  // needs to know which way it is going.
  const half = Math.max(1, Math.floor(inWindow.length / 2));
  const firstHalf = inWindow.slice(0, half);
  const secondHalf = inWindow.slice(half);
  const fatigueEarly = mean(firstHalf.map((r) => num(r.fatigue)).filter((v): v is number => v !== null));
  const fatigueLate = mean(secondHalf.map((r) => num(r.fatigue)).filter((v): v is number => v !== null));
  const direction =
    fatigueEarly === null || fatigueLate === null || secondHalf.length === 0
      ? null
      : fatigueLate < fatigueEarly - 0.5
        ? "improving"
        : fatigueLate > fatigueEarly + 0.5
          ? "worsening"
          : "steady";

  const poorSleep = avgSleep !== null && avgSleep < POOR_SLEEP;
  const highFatigue = avgFatigue !== null && avgFatigue >= HIGH_FATIGUE;
  const highSoreness = avgSoreness !== null && avgSoreness >= HIGH_SORENESS;
  const highStress = avgStress !== null && avgStress >= HIGH_STRESS;
  const lowReadiness = avgReadiness !== null && avgReadiness < POOR_READINESS;
  const goodReadiness = avgReadiness !== null && avgReadiness >= GOOD_READINESS;

  const why: ExplanationReason[] = [
    {
      text: `Across ${inWindow.length} check-in${inWindow.length === 1 ? "" : "s"} in the last ${RECOVERY_WINDOW_DAYS} days${
        avgFatigue !== null ? `, average fatigue was ${round1(avgFatigue)}/10` : ""
      }${avgSleep !== null ? ` and average sleep quality ${round1(avgSleep)}/10` : ""}.`,
      source: "recovery",
    },
  ];
  if (avgReadiness !== null) {
    why.push({ text: `Average readiness was ${Math.round(avgReadiness)}/100.`, source: "recovery" });
  } else {
    why.push({
      text: "You have not used the readiness score, so it is not part of this reading.",
      source: "recovery",
    });
  }
  if (direction === "improving") {
    why.push({
      text: `Fatigue is coming down: ${round1(fatigueEarly ?? 0)} early in the window against ${round1(fatigueLate ?? 0)} now.`,
      source: "history",
    });
  } else if (direction === "worsening") {
    why.push({
      text: `Fatigue is climbing: ${round1(fatigueEarly ?? 0)} early in the window against ${round1(fatigueLate ?? 0)} now.`,
      source: "history",
    });
  }
  if (highSoreness) {
    why.push({ text: `Average soreness was ${round1(avgSoreness ?? 0)}/10.`, source: "recovery" });
  }
  if (highStress) {
    why.push({ text: `Average stress was ${round1(avgStress ?? 0)}/10.`, source: "recovery" });
  }

  const flags = [poorSleep, highFatigue, highSoreness, highStress].filter(Boolean).length;
  const tone: ExplanationTone = lowReadiness || flags >= 2 ? "watch" : goodReadiness || direction === "improving" ? "positive" : "info";
  const headline = lowReadiness || flags >= 2
    ? "Your check-ins say recovery is running behind — this is a week to keep the easy sessions easy."
    : direction === "improving"
      ? "Your check-ins are trending better than they were fortnight ago."
      : "Your check-ins are in a normal range for you.";

  const value =
    avgFatigue !== null
      ? `fatigue ${round1(avgFatigue)}/10`
      : avgReadiness !== null
        ? `readiness ${Math.round(avgReadiness)}/100`
        : "logged";

  return {
    id: "recovery_trend",
    label: "Recovery",
    available: true,
    value,
    headline,
    tone,
    why,
    // The action comes first when the signals agree, and the honesty about what
    // these numbers are is never dropped: a recovery reading is the athlete's
    // own report, and the screen should not let the specificity of "7.5/10"
    // imply a precision it does not have.
    rationale:
      (flags >= 2
        ? "Sleep, fatigue and soreness moving together is the pattern worth acting on early — taking one easier week now costs far less than a forced one later. "
        : "") +
      "These are your own ratings, not a measurement. They are useful because they are consistent with each other, not because any single number is precise.",
    confidence: inWindow.length >= 5 ? "medium" : "low",
    nextStep: flags >= 2 ? "Make the next hard session easier, or move it a day." : null,
  };
}

function goalMetric(facts: InsightFacts): InsightMetric {
  const goal = facts.goals[0] ?? null;
  if (!goal) {
    return {
      id: "goal_progress",
      label: "Goal progress",
      available: false,
      value: "—",
      headline: "No goal is set, so there is nothing to measure progress against.",
      tone: "info",
      why: [{ text: "You have no active outcome goal.", source: "goal" }],
      rationale:
        "Goals are what turn a training log into a plan. Without one, every week is judged on its own.",
      confidence: "none",
      nextStep: "Set one outcome goal with a date.",
    };
  }

  const explanation = explainGoalProximity({
    goalTitle: goal.title,
    daysRemaining: goal.daysRemaining,
    percent: goal.percent,
    status: goal.status,
    nextMilestone: goal.nextMilestone,
    achievedMilestones: goal.achievedMilestones,
    totalMilestones: goal.totalMilestones,
    competition: facts.competition ?? null,
    keyWindowDays: GOAL_WINDOW_DAYS,
  });

  const why: ExplanationReason[] = explanation?.why ?? [
    { text: `${goal.title} is ${goal.percent}% of the way there.`, source: "goal" },
  ];

  return {
    id: "goal_progress",
    label: "Goal progress",
    available: true,
    value: goal.totalMilestones > 0
      ? `${goal.achievedMilestones}/${goal.totalMilestones}`
      : `${goal.percent}%`,
    headline: explanation?.headline ?? `${goal.title} is ${goal.percent}% of the way there.`,
    tone: goal.status === "behind" ? "watch" : "info",
    why,
    rationale:
      explanation?.rationale ??
      "Milestones are the steps between where you are and the target. Hitting them is the progress, not the percentage alone.",
    confidence: goal.totalMilestones > 0 || goal.daysRemaining !== null ? "medium" : "low",
    nextStep: goal.nextMilestone
      ? `Next up: ${goal.nextMilestone.title}.`
      : goal.totalMilestones === 0
        ? "Break this goal into a first milestone."
        : null,
  };
}

function adjustmentsMetric(facts: InsightFacts, windowStart: string, youth: boolean): InsightMetric {
  const inWindow = facts.adjustments.filter((a) => a.date >= windowStart && a.date <= facts.today);

  if (facts.planned.length === 0) {
    return {
      id: "plan_adjustments",
      label: "Plan changes",
      available: false,
      value: "—",
      headline: "No plan in this window, so no changes to report.",
      tone: "info",
      why: [{ text: "There are no planned sessions in the last four weeks.", source: "plan" }],
      rationale:
        "This counts the sessions your life changed. Without a plan there is nothing for an event to move.",
      confidence: "none",
      nextStep: null,
    };
  }

  if (inWindow.length === 0) {
    return {
      id: "plan_adjustments",
      label: "Plan changes",
      available: true,
      value: "0",
      headline: "Nothing has adjusted your plan in the last four weeks.",
      tone: "positive",
      why: [
        { text: "No availability window, rebuild or rescheduled session in this window.", source: "plan" },
        { text: `Your plan ran as written across ${facts.planned.filter((p) => p.date >= windowStart).length} scheduled sessions.`, source: "plan" },
      ],
      rationale: "An uninterrupted month is the best possible input into a training block.",
      confidence: "medium",
      nextStep: null,
    };
  }

  const byType = new Map<string, number>();
  for (const a of inWindow) {
    const label = eventLabel(a.eventType ?? null);
    byType.set(label, (byType.get(label) ?? 0) + 1);
  }
  const breakdown = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  const rebuilt = inWindow.filter((a) => a.volumePct !== null && a.volumePct !== undefined);

  const why: ExplanationReason[] = breakdown.map(([label, count]) => ({
    text: `${count} session${count === 1 ? "" : "s"} adjusted because of ${label.toLowerCase()}.`,
    source: "calendar" as const,
  }));
  if (rebuilt.length) {
    why.push({
      text: `${rebuilt.length} of them were part of a rebuild, which is written into your plan rather than left as a gap.`,
      source: "plan",
    });
  }

  return {
    id: "plan_adjustments",
    label: "Plan changes",
    available: true,
    value: String(inWindow.length),
    headline: `${inWindow.length} session${inWindow.length === 1 ? "" : "s"} adjusted by your life in the last four weeks.`,
    tone: "info",
    why,
    rationale: youth
      ? "Time away, exams and family things are part of a season, not a failure in it. The plan absorbs them so you do not have to make them up."
      : "None of these count as missed sessions. The plan absorbs them so you are not paying them back later.",
    confidence: "high",
    nextStep: null,
  };
}

function returnMetric(facts: InsightFacts): InsightMetric | null {
  const back = facts.returnFromBreak;
  if (!back) return null;
  const explanation = buildExplanation({
    id: `return:${back.weekBack}`,
    kind: "return",
    headline: `You are in Week ${back.weekBack} of ${back.totalWeeks} in your return-from-break progression.`,
    why: [
      {
        text: `This week is programmed at about ${back.volumePct}% of your usual volume.`,
        source: "plan",
      },
      {
        text: `Week ${back.weekBack} of ${back.totalWeeks} is for ${
          back.focus === "rebuild"
            ? "rebuilding your base"
            : back.focus === "restore"
              ? "restoring your usual load"
              : back.focus === "resume"
                ? "getting back to full training"
                : back.focus === "paused"
                  ? "a week you told the app you would not train in"
                  : back.focus === "preload"
                    ? "banking a little extra before your break"
                    : back.focus === "holiday"
                      ? "easy movement while you are away"
                      : "staying fresh for competition"
        }.`,
        source: "plan",
      },
    ],
    rationale:
      "Nothing was moved from your break into this week. Finishing the progression is what makes the return stick.",
    tone: "info",
  });

  return {
    id: "return_progression",
    label: "Return from break",
    available: true,
    value: `Week ${back.weekBack} of ${back.totalWeeks}`,
    headline: explanation.headline,
    tone: explanation.tone,
    why: explanation.why,
    rationale: explanation.rationale,
    confidence: explanation.confidence,
    nextStep:
      back.weekBack >= back.totalWeeks
        ? "This is the last week of the rebuild — normal training resumes after it."
        : "Keep this week at the programmed volume, even if it feels easy.",
  };
}

function loadTrendMetric(facts: InsightFacts): InsightMetric {
  const todayNum = dayNumber(facts.today) ?? 0;
  const monday = mondayOf(todayNum);
  const entries = facts.sessions.map((s) => ({ date: s.date, load: num(s.load), sport: s.sport }));
  const firstLogged = facts.sessions
    .map((s) => dayNumber(s.date))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)[0];
  const weeksLogged =
    firstLogged === undefined ? 0 : Math.floor((monday - mondayOf(firstLogged)) / 7) + 1;
  const weeks = Math.min(LOAD_TREND_MAX_WEEKS, Math.max(0, weeksLogged));

  if (weeks < LOAD_TREND_MIN_WEEKS) {
    return {
      id: "load_trend",
      label: "Load trend",
      available: false,
      value: "—",
      headline: `A trend needs at least ${LOAD_TREND_MIN_WEEKS} weeks of logged load.`,
      tone: "info",
      why: [
        {
          text: `Your record covers ${weeks} week${weeks === 1 ? "" : "s"} of training.`,
          source: "history",
        },
        { text: "Drawing a line through fewer weeks would be a shape, not a trend.", source: "history" },
      ],
      rationale: "The weekly pattern is what shows whether an easier week is due. It appears once there is something to compare.",
      confidence: "none",
      nextStep: "Keep logging — this fills in on its own.",
    };
  }

  const strip = weekStrip(monday, weeks);
  const series = strip.map((week) => {
    const end = week.start + 6;
    return Math.round(
      loadTotals(
        entries
          .filter((e) => {
            const n = dayNumber(e.date);
            return n !== null && n >= week.start && n <= end;
          })
          .map((e) => ({ date: e.date, load: e.load })),
      ).total,
    );
  });

  const sportCounts = new Map<string, number>();
  for (const e of entries) sportCounts.set(e.sport, (sportCounts.get(e.sport) ?? 0) + 1);
  const seriesSports = [...sportCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([s]) => s);

  const peak = Math.max(...series);
  const last = series[series.length - 1];
  const average = Math.round(series.reduce((a, b) => a + b, 0) / series.length);
  const peakWeek = strip[series.indexOf(peak)];
  // The final bar is the week the athlete is standing in, so on a Tuesday it
  // holds two days of training. Comparing that against whole weeks and calling
  // it "well below your average" told a real athlete their week had collapsed
  // when it had barely started — caught on the live screen, not in a test.
  const daysIntoWeek = todayNum - monday + 1;
  const finalWeekPartial = daysIntoWeek < 7;

  const why: ExplanationReason[] = [
    {
      text: `Across ${weeks} weeks your weekly load has averaged ${average}.`,
      source: "load",
    },
    {
      text: `The biggest week was ${peak} load (week of ${peakWeek?.key ?? "—"}).`,
      source: "load",
    },
    {
      text:
        last === peak
          ? "This week is already the biggest one in the window."
          : finalWeekPartial
            ? `This week stands at ${last} load after ${daysIntoWeek} day${daysIntoWeek === 1 ? "" : "s"}.`
            : `This week stands at ${last} load.`,
      source: "load",
    },
  ];
  if (finalWeekPartial) {
    why.push({
      text: "This week is still in progress, so its total is not yet comparable with the others.",
      source: "load",
    });
  }
  if (seriesSports.length > 1) {
    why.push({
      text: `Split across ${seriesSports.join(" and ")}.`,
      source: "load",
    });
  }

  return {
    id: "load_trend",
    label: "Load trend",
    available: true,
    value: `${average}/week`,
    headline:
      last === peak
        ? finalWeekPartial
          ? "This week is already the heaviest in the last two months."
          : "This is the heaviest week in the last two months — the easier week is due."
        : finalWeekPartial
          ? "Your weekly load is holding a steady pattern."
          : last < average * 0.7
            ? "This week is well below your recent average."
            : "Your weekly load is holding a steady pattern.",
    tone: last === peak ? "watch" : "info",
    why,
    rationale:
      "Load does its work in the pattern, not in any single week. The useful question is whether the heavy weeks are followed by lighter ones.",
    confidence: weeks >= 6 ? "medium" : "low",
    nextStep: last === peak ? "Follow this week with a lighter one." : null,
    series,
    seriesSports,
  };
}

// ---------------------------------------------------------------------------
// Putting it together
// ---------------------------------------------------------------------------

/**
 * The six areas the specification names, plus the return-from-break status when
 * one is in force.
 *
 * Order is deliberate, and it is the order the screen renders top to bottom:
 *
 *   1. a rebuild in progress, because it explains the other six readings;
 *   2. how the athlete is recovering, because it is the only reading that can
 *      change the session about to happen today;
 *   3. workload, then consistency — the two the athlete can act on this week;
 *   4. the goal, then what life has changed;
 *   5. the trend line last, because it is context rather than an instruction.
 */
export function buildTrainingInsights(facts: InsightFacts): TrainingInsights {
  const youth = facts.age !== null && facts.age !== undefined && facts.age < YOUTH_AGE;
  const windowStart = isoFromDayNumber(
    (dayNumber(facts.today) ?? 0) - INSIGHT_WINDOW_DAYS + 1,
  );

  const importedCount = facts.sessions.filter((s) => s.source && s.source !== "manual").length;
  const manualCount = facts.sessions.length - importedCount;
  const youthCaveats = youth ? [YOUTH_ANALYSIS_NOTE] : [];

  if (facts.sessions.length === 0 && facts.planned.length === 0) {
    return {
      empty: true,
      reason:
        "There is nothing to read yet. Log a few sessions or import your history and this fills in from your own training.",
      today: facts.today,
      windowDays: INSIGHT_WINDOW_DAYS,
      sessionCount: 0,
      importedCount: 0,
      manualCount: 0,
      metrics: [],
      top: null,
      caveats: [],
      youth,
    };
  }

  const metrics: InsightMetric[] = [];
  const back = returnMetric(facts);
  if (back) metrics.push(back);
  metrics.push(
    // Recovery before consistency on purpose: two metrics can both be "worth
    // acting on", and the lead card picks the first of them — the check-in that
    // says the athlete is run down should outrank a month-long percentage,
    // because it is the one that changes what they do today.
    recoveryTrendMetric(facts),
    workloadMetric(facts, youth, windowStart),
    consistencyMetric(facts, youth, windowStart),
    goalMetric(facts),
    adjustmentsMetric(facts, windowStart, youth),
    loadTrendMetric(facts),
  );

  // The lead card is the most actionable thing on the screen, using the same
  // ordering the explanation framework defines for tone.
  const ranked = sortExplanations(
    metrics
      .filter((m) => m.available)
      .map((m) => ({
        id: m.id,
        kind: "consistency" as const,
        headline: m.headline,
        why: m.why,
        rationale: m.rationale,
        tone: m.tone,
        confidence: m.confidence,
        insufficient: false,
        omitted: 0,
        summary: m.headline,
      })),
  );
  const top = ranked.length ? metrics.find((m) => m.id === ranked[0].id) ?? null : null;

  const caveats: string[] = [
    "Every number here is built from what you logged. Nothing is estimated about your body.",
    ...youthCaveats,
  ];
  if (importedCount > 0 && manualCount === 0) {
    caveats.push(
      `All ${importedCount} sessions in this window came from your connected app. ${RECORD_ONLY_NOTE}`,
    );
  } else if (importedCount > 0) {
    caveats.push(`${importedCount} of ${facts.sessions.length} sessions in this window were imported.`);
  }
  const unefforted = facts.sessions.filter((s) => num(s.load) === null).length;
  if (unefforted > 0) {
    caveats.push(
      `${unefforted} session${unefforted === 1 ? " is" : "s are"} in the record without an effort rating or enough detail to price, so ${
        unefforted === 1 ? "it is" : "they are"
      } counted in consistency but not in load. ${NO_EFFORT_NOTE}`,
    );
  }

  return {
    empty: false,
    reason: null,
    today: facts.today,
    windowDays: INSIGHT_WINDOW_DAYS,
    sessionCount: facts.sessions.length,
    importedCount,
    manualCount,
    metrics,
    top,
    caveats,
    youth,
  };
}

/** Where the athlete should go next, from the lead metric. */
export function nextActionFrom(insights: TrainingInsights): string | null {
  return insights.top?.nextStep ?? null;
}
