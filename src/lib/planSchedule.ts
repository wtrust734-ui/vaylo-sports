// ============================================================================
// PLAN SCHEDULE — putting real dates on the training grid
// ----------------------------------------------------------------------------
// The training plan is stored as `training_plans.plan_data`: an array of weeks,
// each holding sessions keyed by DAY NUMBER (1–7) rather than by a date. That
// is the right storage shape — a plan is relative, and copying 100 absolute
// dates into JSON would go stale the moment anything moved.
//
// It is the wrong shape for the one question the adaptive calendar has to
// answer: "does this life event overlap a planned session, and which one?" That
// question has no answer without absolute dates, and answering it wrongly is
// how a holiday cancels the wrong week.
//
// So this module is the single, pure projection from relative plan weeks to
// absolute dated sessions. It anchors week 1 on the Monday of the week the plan
// was created, which is what the schema already implies: `training_plans` has
// `created_at` and `week_current`, and nothing else that could anchor it.
//
// Kept pure and separate from both Supabase and the Training screen so the
// projection can be tested directly, and so a later re-planning phase can reuse
// it rather than re-deriving dates with its own subtly different rule.
// ============================================================================

import { localDateKey } from "./dates";

/**
 * What Phase 2 writes onto a session it rebuilt.
 *
 * Absent means the session is the one the generator wrote. Present means it was
 * scaled, downgraded or dropped on the way back from a break, and says by how
 * much — so the screens can label it without re-deriving anything, and a later
 * phase can ask "what did we already take off this athlete?" without guessing.
 */
export interface ReturnSessionMeta {
  lifeEventId: string;
  /** 1 = the first week back. */
  weekBack: number;
  volumePct: number;
  intensityPct: number;
  /** The duration before the rebuild, kept so the change is legible. */
  originalDuration?: number;
  /** True when this session was dropped and became a rest day. */
  dropped?: boolean;
  /** The session's title before it was dropped. */
  originalTitle?: string;
}

/** The same, at week level: one note plus the multipliers that produced it. */
export interface ReturnWeekMeta {
  lifeEventId: string;
  weekBack: number;
  volumePct: number;
  intensityPct: number;
  /**
   * What the week is for. The first four are the return progression; `preload`
   * is the loading week BEFORE a planned break and `holiday` the eased week
   * inside one, because a break reshapes the weeks around it as well as the
   * ones after it. Kept as an explicit union rather than imported from
   * `adaptivePlan` so a new kind of week is a compile error here rather than a
   * label the screens silently cannot render.
   */
  focus: "rebuild" | "restore" | "resume" | "compete" | "preload" | "holiday";
  sessions: number;
  dropped: number;
  /** Titles of what was dropped, for the detail view rather than the summary. */
  droppedTitles?: string[];
}

/** The shape of one session inside `training_plans.plan_data`. */
export interface PlanSessionLike {
  /** 1 = the plan's first day of the week (Monday). */
  day: number;
  dayName?: string;
  title: string;
  type?: string;
  duration_minutes?: number;
  description?: string;
  isRest?: boolean;
  isRecovery?: boolean;
  skipped?: boolean;
  warmup?: unknown;
  exercises?: unknown;
  cooldown?: unknown;
  /**
   * Key-workout flag, written by Phase 2 onto every session of a rebuilt week.
   *
   * Optional on purpose: the generated plan does not carry it, and
   * `deriveImportance` remains the fallback for every session the adaptive
   * layer has never touched.
   */
  key?: boolean;
  returnFromBreak?: ReturnSessionMeta;
  [key: string]: unknown;
}

export interface PlanWeekLike {
  week: number;
  sessions: PlanSessionLike[];
  isDeload?: boolean;
  isHoliday?: boolean;
  extraNote?: string;
  returnFromBreak?: ReturnWeekMeta;
  [key: string]: unknown;
}

export interface TrainingPlanLike {
  id: string;
  created_at?: string | null;
  week_current?: number | null;
  duration_weeks?: number | null;
  plan_data?: unknown;
  /**
   * The record of every rebuild applied to this plan, oldest first.
   *
   * Typed loosely here and narrowed by `activeAdjustments` in
   * `src/lib/adaptivePlan.ts`, which owns the shape: this module's job is only
   * to know the column exists.
   */
  plan_adjustments?: unknown;
}

/** One session, placed on a real calendar day. */
export interface DatedSession {
  /** Stable across renders: `<planId>:<week>:<day>`. */
  id: string;
  planId: string;
  week: number;
  day: number;
  /** Local calendar day, `YYYY-MM-DD`. */
  scheduled_date: string;
  title: string;
  type: string;
  isRest: boolean;
  /**
   * Key-workout flag, derived (see `deriveImportance`).
   *
   * The schema does not carry an explicit key-workout flag today, so it is
   * derived from the session `type` that DOES exist rather than invented. When
   * a real flag arrives, this function is the one place that changes.
   */
  important: boolean;
}

/** "Monday" — the local Monday of the week containing `date`. */
export function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // getDay(): 0 = Sunday. The week starts on Monday here, matching the plan
  // grid, which labels day 1 "Monday".
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

/** Add whole days, returning a new local date. */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * The Monday that Week 1 begins on.
 *
 * Anchored on the plan's creation date, because that is the only durable
 * anchor the schema has. `week_current` is NOT used: it is a display cursor
 * that advances as the athlete progresses, so anchoring on it would make every
 * already-dated session shift the next time the athlete viewed the plan — the
 * one failure mode this projection exists to avoid.
 *
 * A plan with no `created_at` anchors on `fallback` (today by default) rather
 * than returning null, so an older row still produces a usable schedule.
 */
export function weekOneMonday(plan: TrainingPlanLike, fallback: Date = new Date()): Date {
  const created = plan.created_at ? new Date(plan.created_at) : null;
  const anchor = created && !Number.isNaN(created.getTime()) ? created : fallback;
  return mondayOf(anchor);
}

/**
 * The local calendar day for one session of one week.
 *
 * Week 1 starts on the anchor Monday; within a week, day 1 is that Monday. Days
 * are clamped to 1–7 because a malformed `day: 0` or `day: 12` in stored JSON
 * would otherwise silently place a session in the neighbouring week.
 */
export function sessionDate(anchor: Date, week: number, day: number): string {
  const safeWeek = Number.isFinite(week) ? Math.max(1, Math.trunc(week)) : 1;
  const safeDay = Number.isFinite(day) ? Math.min(7, Math.max(1, Math.trunc(day))) : 1;
  return localDateKey(addDays(anchor, (safeWeek - 1) * 7 + (safeDay - 1)));
}

/**
 * Session types that carry the point of the week.
 *
 * A heuristic, and labelled as one. It reads `type` — a field the generator
 * already sets — rather than a new flag, so it cannot disagree with the plan it
 * is describing. Losing an interval session is a real loss; losing an accessory
 * day is not, and a re-planner that cannot tell those apart will rebuild the
 * wrong week.
 */
const KEY_SESSION_TYPES: readonly string[] = ["speed", "intervals", "power", "sport_specific"];

export function deriveImportance(session: PlanSessionLike): boolean {
  if (session.isRest || session.isRecovery) return false;
  return KEY_SESSION_TYPES.includes(String(session.type ?? ""));
}

/** Narrows stored JSON to weeks without trusting its shape. */
export function asPlanWeeks(planData: unknown): PlanWeekLike[] {
  if (!Array.isArray(planData)) return [];
  return planData.filter(
    (w): w is PlanWeekLike =>
      !!w && typeof w === "object" && Array.isArray((w as PlanWeekLike).sessions),
  );
}

/**
 * Every session in a plan, on its real date, oldest first.
 *
 * Returns `[]` for a plan whose `plan_data` is absent or the wrong shape, which
 * is the honest answer: a plan that cannot be read has no schedule, and
 * inventing one would place sessions on days nothing ever planned.
 */
export function flattenPlan(plan: TrainingPlanLike, fallback: Date = new Date()): DatedSession[] {
  const anchor = weekOneMonday(plan, fallback);
  const out: DatedSession[] = [];

  for (const week of asPlanWeeks(plan.plan_data)) {
    for (const session of week.sessions) {
      const day = Number(session?.day);
      if (!Number.isFinite(day)) continue;
      const scheduled_date = sessionDate(anchor, Number(week.week), day);
      out.push({
        id: `${plan.id}:${week.week}:${day}`,
        planId: plan.id,
        week: Number(week.week),
        day,
        scheduled_date,
        title: String(session.title ?? "Session"),
        type: String(session.type ?? "session"),
        isRest: !!session.isRest || String(session.type ?? "") === "rest",
        important: deriveImportance(session),
      });
    }
  }

  return out.sort((a, b) =>
    a.scheduled_date < b.scheduled_date ? -1 : a.scheduled_date > b.scheduled_date ? 1 : a.day - b.day,
  );
}

/** Sessions that fall inside a period, inclusive. */
export function sessionsInPeriod(
  sessions: readonly DatedSession[],
  start: string,
  end: string,
): DatedSession[] {
  return sessions.filter((s) => s.scheduled_date >= start && s.scheduled_date <= end);
}

/** How far through a plan today is, 1-based, or null when the plan is over. */
export function currentWeekOf(plan: TrainingPlanLike, today: Date = new Date()): number | null {
  const weeks = asPlanWeeks(plan.plan_data).length;
  if (!weeks) return null;
  const anchor = weekOneMonday(plan, today);
  const days = Math.floor((mondayOf(today).getTime() - anchor.getTime()) / 86_400_000);
  const week = Math.floor(days / 7) + 1;
  if (week < 1) return null;
  return week > weeks ? null : week;
}
