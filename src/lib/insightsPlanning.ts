// ============================================================================
// INSIGHTS PLANNING — gathering the facts, and caching the reading
// ----------------------------------------------------------------------------
// The impure half of `lib/insights.ts`, and the only part of this phase that
// touches the database or the clock. It reads; it never decides. Every rule
// about what a number means stays in the pure module, so the same reasoning can
// be tested without a database and the cached reading can be rendered offline.
//
// It also does the joining that Phase 1–5 left to their screens:
//
//   • sessions      → Phase 5's one reader of `workouts` (reused, not copied)
//   • planned       → Phase 1's statuses and `countsTowardCompletion`, so a
//                     holiday still does not read as fourteen failures
//   • adjustments   → Phase 1's `plan_events.life_event_id` joins and Phase 2's
//                     `plan_adjustments` records
//   • goal progress → Phase 4's `buildGoalRoadmap`, so the insights screen and
//                     the goals screen cannot disagree about a percentage
//   • return status → Phase 2's own `steps`, so "week 2 of 3" is the plan's
//                     number rather than a second count of weeks
//
// Reading is bounded on purpose: eight weeks back at most, thirty check-ins,
// three goals. Passive analytics that quietly fetch a season on every mount is
// how an app becomes slow, and none of the seven metrics needs more than this.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { readFailed } from "@/lib/dbRead";
import { readAnalysisSessions, IMPORT_SOURCE } from "./health/importRunner";
import { ageFromDob } from "./age";
import { localDateKey } from "./dates";
import {
  countsTowardCompletion,
  type LifeEvent,
  type PlannedSession,
} from "./lifeEvents";
import {
  activeAdjustments,
  weekContaining,
  type PlanAdjustmentRecord,
} from "./adaptivePlan";
import {
  asPlanWeeks,
  sessionDate,
  weekOneMonday,
  type TrainingPlanLike,
} from "./planSchedule";
import {
  buildGoalRoadmap,
  nextMilestone,
  type RoadmapGoalRow,
  type RoadmapContext,
} from "./roadmap";
import { cacheRead, cacheWrite, type CacheKey } from "./offlineCache";
import {
  buildTrainingInsights,
  LOAD_TREND_MAX_WEEKS,
  RECOVERY_WINDOW_DAYS,
  type InsightAdjustment,
  type InsightCompetition,
  type InsightFacts,
  type InsightGoal,
  type InsightPlannedSession,
  type InsightRecoveryDay,
  type InsightReturnProgression,
  type TrainingInsights,
} from "./insights";

/**
 * The cache key for the reading.
 *
 * Phase 5's cache is keyed by name so each screen owns one snapshot. Insights
 * get their own rather than sharing `startingAnalysis`: one is a reading of a
 * starting point that should never drift, the other is a reading of today.
 */
export const INSIGHTS_CACHE_KEY: CacheKey = "insights";

/** Eight weeks of trend, plus a week of slack for the trend's first week. */
export const INSIGHTS_LOOKBACK_DAYS = LOAD_TREND_MAX_WEEKS * 7 + 7;

/** Check-ins read: enough for a fortnight plus the direction before it. */
export const RECOVERY_READ_LIMIT = 30;

/** Goals considered. The screen shows one; the rest are for future roll-ups. */
export const GOALS_READ_LIMIT = 3;

export interface InsightsRead {
  insights: TrainingInsights;
  fromCache: boolean;
  /** Epoch ms the snapshot was written, when it came from the cache. */
  savedAt: number | null;
  /** Past the TTL for this key, so the screen must date the reading it shows. */
  stale: boolean;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface GoalRow {
  title: string;
  category: string | null;
  metric_unit: string | null;
  current_value: number | null;
  target_value: number | null;
  deadline: string | null;
  created_at: string | null;
  current_level: string | null;
  phase: string | null;
  development_areas: unknown;
  milestones: unknown;
  progress_status: string | null;
  roadmap_updated_at: string | null;
}

interface PlanRow {
  id: string;
  title: string | null;
  sport: string | null;
  created_at: string | null;
  week_current: number | null;
  duration_weeks: number | null;
  plan_data: unknown;
  plan_adjustments: unknown;
}

interface PlanEventRow {
  scheduled_date: string;
  title: string | null;
  status: string | null;
  important: boolean | null;
  life_event_id: string | null;
}

interface RecoveryRow {
  log_date: string;
  sleep_quality: number | null;
  fatigue: number | null;
  soreness: number | null;
  stress: number | null;
  rest_hours: number | null;
  readiness_score: number | null;
}

interface CompetitionRow {
  title: string | null;
  event_date: string | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const dayKeys = (date: string, days: number) =>
  localDateKey(new Date(new Date(`${date}T00:00:00`).getTime() - days * 86_400_000));

/**
 * The nearest upcoming competition, if any.
 *
 * Failures are swallowed on purpose: a deployment without the `events` table
 * should lose goal proximity, not the whole insights screen.
 */
async function readCompetition(userId: string, today: string): Promise<InsightCompetition | null> {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("title, event_date")
      .eq("user_id", userId)
      .gte("event_date", `${today}T00:00:00`)
      .order("event_date", { ascending: true })
      .limit(1);
    // The swallow above is deliberate — a missing `events` table must not cost
    // the whole insights screen — so the failure is logged rather than raised.
    readFailed(error, "your upcoming competition", { quiet: true });
    const row = (data ?? [])[0] as CompetitionRow | undefined;
    if (!row?.event_date) return null;
    const when = localDateKey(new Date(row.event_date));
    const days = Math.round(
      (new Date(`${when}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) /
        86_400_000,
    );
    return { title: row.title ?? "Your competition", days: Math.max(0, days) };
  } catch {
    return null;
  }
}

/**
 * The return-from-break progression in force today, from Phase 2's own record.
 *
 * Null unless a rebuild is actually running this week: a plan with a rebuild
 * three weeks behind it is not "in return progression", and saying so would put
 * a stale number in front of the athlete as though it were current.
 */
function readReturnProgression(
  plan: PlanRow | null,
  today: string,
): InsightReturnProgression | null {
  if (!plan) return null;
  const adjustments = activeAdjustments(plan.plan_adjustments);
  if (!adjustments.length) return null;

  const like: TrainingPlanLike = {
    id: plan.id,
    created_at: plan.created_at,
    plan_data: plan.plan_data,
    plan_adjustments: plan.plan_adjustments,
  };
  const weeks = asPlanWeeks(plan.plan_data);
  if (!weeks.length) return null;
  const anchor = weekOneMonday(like);
  const week = weekContaining(weeks, (w) => sessionDate(anchor, w, 1), today);
  if (week === null) return null;

  // Newest rebuild first: a second break can land inside the first rebuild's
  // window, and the one the athlete is living in is the later record.
  const ordered = [...adjustments].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  for (const adjustment of ordered) {
    const step = adjustment.steps.find((s) => s.week === week);
    if (!step) continue;
    return {
      weekBack: step.back,
      totalWeeks: adjustment.steps.length,
      volumePct: step.volumePct,
      focus: step.focus,
    };
  }
  return null;
}

/** One adjustment entry per rebuilt week, so the count and the weeks agree. */
function rebuildAdjustments(
  plan: PlanRow | null,
  windowStart: string,
  today: string,
): InsightAdjustment[] {
  if (!plan) return [];
  const adjustments = activeAdjustments(plan.plan_adjustments) as PlanAdjustmentRecord[];
  if (!adjustments.length) return [];
  const like: TrainingPlanLike = {
    id: plan.id,
    created_at: plan.created_at,
    plan_data: plan.plan_data,
    plan_adjustments: plan.plan_adjustments,
  };
  const anchor = weekOneMonday(like);

  return adjustments.flatMap((adjustment) =>
    adjustment.steps.map((step) => {
      const date = sessionDate(anchor, step.week, 1);
      return {
        date,
        title: `Rebuild week ${step.back}`,
        eventType: adjustment.break.eventType,
        volumePct: step.volumePct,
      } satisfies InsightAdjustment;
    }),
  ).filter((a) => a.date >= windowStart && a.date <= today);
}

async function readPlanEvents(
  userId: string,
  windowStart: string,
  windowEnd: string,
): Promise<PlanEventRow[]> {
  const { data, error } = await supabase
    .from("plan_events")
    .select("scheduled_date, title, status, important, life_event_id")
    .eq("user_id", userId)
    .gte("scheduled_date", windowStart)
    .lte("scheduled_date", windowEnd)
    .limit(500);
  // This is the denominator of adherence: "of the sessions that were planned,
  // how many happened". A failed read makes it zero, which reads as "nothing was
  // planned" and flatters the percentage instead of emptying it.
  readFailed(error, "your planned sessions", { quiet: true });
  return (data ?? []) as PlanEventRow[];
}

/**
 * Life events overlapping the window.
 *
 * A named function rather than an inline builder so its element type survives:
 * a heterogeneous `Promise.all` array widens every member to a union, which is
 * how a `.then((r) => r.data as LifeEvent[])` stops being a `LifeEvent[]`.
 */
async function readLifeEvents(userId: string, windowStart: string, today: string): Promise<LifeEvent[]> {
  try {
    const { data, error } = await supabase
      .from("life_events")
      .select("id, start_date, end_date, event_type, activity_level, allow_training")
      .eq("user_id", userId)
      .gte("end_date", windowStart)
      .lte("start_date", today);
    readFailed(error, "your breaks and time away", { quiet: true });
    return (data ?? []) as LifeEvent[];
  } catch {
    return [];
  }
}

async function readRecovery(userId: string, recoveryStart: string): Promise<RecoveryRow[]> {
  try {
    const { data, error } = await supabase
      .from("recovery_logs")
      .select("log_date, sleep_quality, fatigue, soreness, stress, rest_hours, readiness_score")
      .eq("user_id", userId)
      .gte("log_date", recoveryStart)
      .order("log_date", { ascending: false })
      .limit(RECOVERY_READ_LIMIT);
    readFailed(error, "your recovery check-ins", { quiet: true });
    return (data ?? []) as RecoveryRow[];
  } catch {
    return [];
  }
}

async function readGoals(userId: string): Promise<GoalRow[]> {
  try {
    const { data, error } = await supabase
      .from("outcome_goals")
      .select(
        "title, category, metric_unit, current_value, target_value, deadline, created_at, current_level, phase, development_areas, milestones, progress_status, roadmap_updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(GOALS_READ_LIMIT);
    readFailed(error, "your goals", { quiet: true });
    return (data ?? []) as GoalRow[];
  } catch {
    return [];
  }
}

async function readActivePlan(userId: string): Promise<PlanRow | null> {
  try {
    const { data, error } = await supabase
      .from("training_plans")
      .select("id, title, sport, created_at, week_current, duration_weeks, plan_data, plan_adjustments")
      .eq("user_id", userId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1);
    // Null means "no active plan", which the insights screen states as a fact.
    readFailed(error, "your active plan", { quiet: true });
    return ((data ?? []) as PlanRow[])[0] ?? null;
  } catch {
    return null;
  }
}

async function readProfile(
  userId: string,
): Promise<{ date_of_birth: string | null; sport: string | null } | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("date_of_birth, sport")
      .eq("user_id", userId)
      .maybeSingle();
    readFailed(error, "your profile", { quiet: true });
    return (data as { date_of_birth: string | null; sport: string | null } | null) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Assembling the facts
// ---------------------------------------------------------------------------

/**
 * Everything the metric layer is allowed to reason about, read in parallel.
 *
 * Every read degrades to an empty list rather than throwing: an athlete whose
 * goals table is unreachable still gets their consistency and workload, and one
 * missing section is a better outcome than a blank screen.
 */
export async function gatherInsightFacts(
  userId: string,
  today: string = localDateKey(),
): Promise<InsightFacts> {
  const lookbackStart = dayKeys(today, INSIGHTS_LOOKBACK_DAYS);
  const windowStart = dayKeys(today, 27);
  const recoveryStart = dayKeys(today, RECOVERY_WINDOW_DAYS - 1);

  const [sessions, planEvents, lifeEvents, recovery, goals, plan, competition, profile] =
    await Promise.all([
      readAnalysisSessions(userId).catch(() => []),
      readPlanEvents(userId, lookbackStart, today).catch(() => []),
      readLifeEvents(userId, windowStart, today),
      readRecovery(userId, recoveryStart),
      readGoals(userId),
      readActivePlan(userId),
      readCompetition(userId, today),
      readProfile(userId),
    ]);

  // Phase 1's rule, applied once here so the denominator is the same one the
  // weekly report and the availability screen use.
  const planned: InsightPlannedSession[] = planEvents.map((row) => ({
    date: row.scheduled_date,
    title: row.title ?? "Session",
    status: row.status ?? "planned",
    lifeEventId: row.life_event_id,
    important: !!row.important,
    countsTowardCompletion: countsTowardCompletion(row as PlannedSession, lifeEvents),
  }));

  const byEventId = new Map(lifeEvents.map((e) => [e.id, e]));
  const availabilityAdjustments: InsightAdjustment[] = planEvents
    .filter((row) => !!row.life_event_id)
    .map((row) => ({
      date: row.scheduled_date,
      title: row.title ?? "Session",
      eventType: byEventId.get(row.life_event_id as string)?.event_type ?? null,
      volumePct: null,
    }));

  const adjustments = [...availabilityAdjustments, ...rebuildAdjustments(plan, windowStart, today)]
    .filter((a) => a.date >= windowStart && a.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Phase 4 owns goal progress. The same context the goals screen passes is
  // passed here, so a percentage cannot differ between the two screens.
  const planWeeks = plan ? asPlanWeeks(plan.plan_data) : [];
  const roadmapContext: RoadmapContext = {
    today,
    age: ageFromDob(profile?.date_of_birth ?? null),
    sports: profile?.sport ? [profile.sport] : [],
    lifeEvents,
    weeks: planWeeks,
    adjustments: plan ? activeAdjustments(plan.plan_adjustments) : [],
    competitions: competition
      ? [{ title: competition.title, date: dayKeys(today, -competition.days) }]
      : [],
  };

  const insightGoals: InsightGoal[] = goals.map((row) => {
    const roadmap = buildGoalRoadmap(row as RoadmapGoalRow, roadmapContext);
    const achieved = roadmap.milestones.filter((m) => m.status === "achieved").length;
    const next = nextMilestone(roadmap.milestones);
    return {
      title: row.title,
      percent: roadmap.progress.percent,
      status: roadmap.progress.status,
      daysRemaining: roadmap.progress.daysRemaining,
      achievedMilestones: achieved,
      totalMilestones: roadmap.milestones.length,
      nextMilestone: next ? { title: next.title, targetDate: next.targetDate } : null,
    };
  });

  // A reading of nothing and a reading that could not happen are different
  // answers, and the difference is whether the account answered at all.
  //
  // Every read above degrades to an empty list rather than throwing, which is
  // right for one missing section and wrong for a dead connection: with all of
  // them empty, an offline screen would say "there is nothing to read yet" to an
  // athlete with two years of training — and, because `loadInsights` caches what
  // it computes, it would then overwrite the good snapshot on the device with
  // that blank. Caught on the live screen rather than in a test.
  //
  // The profile row is the liveness signal: every authenticated athlete has one,
  // so an account that returns nothing at all, profile included, did not answer.
  if (
    !profile &&
    !sessions.length &&
    !planEvents.length &&
    !plan &&
    !goals.length &&
    !recovery.length
  ) {
    throw new Error("insights: the account could not be reached");
  }

  const insightRecovery: InsightRecoveryDay[] = recovery.map((r) => ({
    date: r.log_date,
    sleepQuality: r.sleep_quality,
    fatigue: r.fatigue,
    soreness: r.soreness,
    stress: r.stress,
    hours: r.rest_hours,
    readinessScore: r.readiness_score,
  }));

  return {
    today,
    age: ageFromDob(profile?.date_of_birth ?? null),
    sessions: sessions.filter((s) => s.date >= lookbackStart && s.date <= today),
    planned,
    recovery: insightRecovery,
    goals: insightGoals,
    adjustments,
    returnFromBreak: readReturnProgression(plan, today),
    competition,
    primarySport: profile?.sport ?? plan?.sport ?? null,
  };
}

// ---------------------------------------------------------------------------
// The reading, with the Phase 5 cache behind it
// ---------------------------------------------------------------------------

/**
 * Computes the reading and stores it, so the screen is readable offline.
 *
 * The write is best-effort: storage can be full or disabled, and a reading that
 * could not be cached is still a reading.
 */
export async function loadInsights(
  userId: string,
  today: string = localDateKey(),
): Promise<InsightsRead> {
  const facts = await gatherInsightFacts(userId, today);
  const insights = buildTrainingInsights(facts);
  cacheWrite(userId, INSIGHTS_CACHE_KEY, insights);
  return { insights, fromCache: false, savedAt: null, stale: false };
}

/**
 * The snapshot saved to this device, or null.
 *
 * `stale` is carried through from `cacheRead` rather than decided here: the
 * screen is the thing that has to say how old its reading is, and it can only
 * do that if the age survives the read.
 */
export function readCachedInsights(userId: string): InsightsRead | null {
  const snapshot = cacheRead<TrainingInsights>(userId, INSIGHTS_CACHE_KEY);
  if (!snapshot) return null;
  return {
    insights: snapshot.data,
    fromCache: true,
    savedAt: snapshot.savedAt,
    stale: snapshot.stale,
  };
}

/** Which importer the sessions came from, for the header's one line of source. */
export const insightsSourceLabel = (insights: TrainingInsights): string | null => {
  if (insights.importedCount === 0) return null;
  return insights.manualCount === 0
    ? `Imported from your connected app`
    : `Includes ${insights.importedCount} imported sessions`;
};

/** The importer's own id, re-exported so the screen does not hard-code it. */
export { IMPORT_SOURCE };
