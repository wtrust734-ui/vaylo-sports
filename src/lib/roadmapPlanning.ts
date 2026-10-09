// ============================================================================
// ROADMAP PLANNING — gathering the facts a roadmap is built from
// ----------------------------------------------------------------------------
// `src/lib/roadmap.ts` is pure: it turns a goal plus the athlete's record into
// a roadmap, and a test can pin every judgement it makes. This file is the
// other half — it reads that record out of the database, and writes the
// derived roadmap back so the guardian overview and an offline session can both
// read it without rebuilding it.
//
// Three things worth naming:
//
//   • READS NEVER BLOCK THE SCREEN. Every read is allowed to fail and produce
//     an empty fact set, because the honest roadmap for no data is a shorter
//     roadmap, not a spinner that never resolves.
//
//   • THE NUMBERS MATCH THE DATABASE'S. Consistency here is counted with the
//     same statuses, the same 28-day window and the same completed/planned
//     definition as `guardian_athlete_overview`, so an athlete and their
//     guardian cannot be shown two different percentages for the same week.
//
//   • NULL IS NOT ZERO. A readiness score that was never recorded contributes
//     nothing rather than a zero that reads as a terrible week.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

import { activeAdjustments } from "./adaptivePlan";
import { localDateKey } from "./dates";
import { asPlanWeeks } from "./planSchedule";
import {
  asIsoDate,
  roadmapPatch,
  type GoalRoadmap,
  type RecoveryBand,
  type RoadmapContext,
  type RoadmapGoalRow,
  type RoadmapPatch,
} from "./roadmap";

/** Statuses that mean the session happened, matching the SQL overview. */
const DONE_STATUSES = ["completed", "modified", "replaced"];

/** The consistency window, in days. Matches `guardian_athlete_overview`. */
export const CONSISTENCY_WINDOW_DAYS = 28;

/** How far back a break still shapes the roadmap. */
export const LIFE_EVENT_LOOKBACK_DAYS = 60;

const isoDaysAgo = (days: number, today = new Date()): string => {
  const d = new Date(today);
  d.setDate(d.getDate() - days);
  return localDateKey(d);
};

export interface RoadmapFactsInput {
  userId: string;
  /** Local calendar day. Defaults to today. */
  today?: string;
  /** The athlete's sports, from `profiles.sport`. */
  sports?: string[];
  age?: number | null;
}

/** The recovery band from a set of readiness scores, or `unknown` for none. */
export function recoveryBandFrom(scores: readonly (number | null | undefined)[]): RecoveryBand {
  const known = scores.filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  if (!known.length) return "unknown";
  const mean = known.reduce((total, s) => total + s, 0) / known.length;
  if (mean >= 70) return "good";
  if (mean >= 50) return "moderate";
  return "low";
}

/** Completed against planned, the way the database counts it. */
export function consistencyFrom(
  rows: readonly { status: string | null }[],
): { completed: number; planned: number; percent: number | null } {
  const planned = rows.length;
  const completed = rows.filter((r) => DONE_STATUSES.includes(r.status ?? "")).length;
  return {
    completed,
    planned,
    percent: planned > 0 ? Math.round((completed / planned) * 100) : null,
  };
}

/**
 * Read everything a roadmap for this athlete is built from.
 *
 * Six reads in parallel. Any of them failing contributes nothing rather than
 * failing the page: a roadmap built from five of six reads is still a better
 * answer than an error.
 */
export async function loadRoadmapContext(input: RoadmapFactsInput): Promise<RoadmapContext> {
  const today = input.today ?? localDateKey(new Date());
  const todayDate = new Date(`${today}T12:00:00`);

  const [lifeRes, planRes, eventRes, recoveryRes, sessionRes] = await Promise.all([
    supabase
      .from("life_events")
      .select("id, start_date, end_date, event_type, activity_level, allow_training")
      .eq("user_id", input.userId)
      .gte("end_date", isoDaysAgo(LIFE_EVENT_LOOKBACK_DAYS, todayDate)),
    supabase
      .from("training_plans")
      .select("id, created_at, plan_data, plan_adjustments")
      .eq("user_id", input.userId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("events")
      .select("title, event_date, sport")
      .eq("user_id", input.userId)
      .gte("event_date", isoDaysAgo(7, todayDate))
      .order("event_date")
      .limit(10),
    supabase
      .from("recovery_logs")
      .select("log_date, readiness_score")
      .eq("user_id", input.userId)
      .gte("log_date", isoDaysAgo(7, todayDate)),
    supabase
      .from("plan_events")
      .select("status, scheduled_date")
      .eq("user_id", input.userId)
      .gte("scheduled_date", isoDaysAgo(CONSISTENCY_WINDOW_DAYS - 1, todayDate))
      .lte("scheduled_date", today),
  ]);

  const planRow = (planRes?.data ?? null) as unknown as {
    plan_data?: unknown;
    plan_adjustments?: unknown;
  } | null;

  const lifeEvents = Array.isArray(lifeRes?.data) ? (lifeRes.data as RoadmapContext["lifeEvents"]) : [];
  // `events.event_date` is a timestamptz, so it comes back as a full ISO
  // timestamp. Everything downstream compares and prints calendar days, so it
  // is narrowed here rather than in three places later.
  const competitions = Array.isArray(eventRes?.data)
    ? (eventRes.data as { title: string; event_date: string; sport: string | null }[])
        .map((e) => ({
          title: e.title,
          date: asIsoDate(e.event_date) ?? "",
          sport: e.sport,
        }))
        .filter((e) => e.date.length === 10)
    : [];
  const scores = Array.isArray(recoveryRes?.data)
    ? (recoveryRes.data as { readiness_score: number | null }[]).map((r) => r.readiness_score)
    : [];
  const consistency = consistencyFrom(
    Array.isArray(sessionRes?.data) ? (sessionRes.data as { status: string | null }[]) : [],
  );

  return {
    today,
    age: input.age ?? null,
    sports: input.sports ?? [],
    lifeEvents,
    weeks: planRow ? asPlanWeeks(planRow.plan_data) : [],
    adjustments: planRow ? activeAdjustments(planRow.plan_adjustments) : [],
    recovery: { band: recoveryBandFrom(scores) },
    competitions,
    consistency,
  };
}

/**
 * Persist the derived roadmap columns for every goal whose roadmap has moved.
 *
 * Returns how many rows were written, which is what makes this safe to call
 * after every load: `roadmapPatch` returns null when the derived values already
 * match the stored ones, so a stable roadmap writes nothing at all.
 */
export async function persistRoadmapPatches(
  roadmaps: readonly GoalRoadmap[],
  goals: readonly RoadmapGoalRow[],
  now: Date = new Date(),
): Promise<number> {
  const stored = new Map(goals.map((g) => [g.id, g]));
  const updates: { id: string; patch: RoadmapPatch }[] = [];
  for (const roadmap of roadmaps) {
    const row = stored.get(roadmap.goalId);
    if (!row) continue;
    const patch = roadmapPatch(roadmap, row, now.toISOString());
    if (patch) updates.push({ id: roadmap.goalId, patch });
  }

  if (!updates.length) return 0;

  // `milestones` is cast because TypeScript will not infer an index signature
  // for an interface array, and the column is `jsonb`. The shape is pinned by
  // `roadmap.test.ts`, which is a stronger check than the cast is weak.
  const results = await Promise.all(
    updates.map((u) =>
      supabase
        .from("outcome_goals")
        .update({
          phase: u.patch.phase,
          development_areas: u.patch.development_areas,
          milestones: u.patch.milestones as unknown as Json,
          progress_status: u.patch.progress_status,
          roadmap_updated_at: u.patch.roadmap_updated_at,
        })
        .eq("id", u.id),
    ),
  );
  return results.filter((r) => !r?.error).length;
}
