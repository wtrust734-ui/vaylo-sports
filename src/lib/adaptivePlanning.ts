// ============================================================================
// ADAPTIVE PLANNING — the half of the rebuild that touches the database
// ----------------------------------------------------------------------------
// `src/lib/adaptivePlan.ts` decides *what* should change, and is pure, clockless
// and database-free so its rules can be tested directly. This file is the other
// half: it gathers the facts that decision needs, writes the result onto the
// plan, and stores the record that makes the write reversible.
//
// It is separate on purpose. Everything here is plumbing — three reads, one
// pure call, one write — and keeping it in its own file means the rules stay
// readable and this stays short enough to check by eye.
//
// What it deliberately does NOT do:
//
//   • It does not write a second copy of the plan. The rebuilt programming goes
//     into `training_plans.plan_data`, which is where the Training screen
//     already edits sessions and what every existing reader already reads, and
//     the record of the rebuild goes into `plan_adjustments`. One source of
//     truth for the programming, one for the history of what changed it.
//
//   • It does not fail the athlete's break when a context read fails. Age,
//     recovery, load history and competitions all make a rebuild *better* at
//     the margins; none of them is required for it to be correct. A failed read
//     degrades to the conservative default rather than blocking the save, which
//     matters on a phone on a train — the place breaks get added.
//
//   • It does not guess at sports — but it now reads them. Phase 3 added
//     `workouts.sport`, so an activity logged during a break can be identified
//     rather than assumed, and an identified cross-sport day earns more credit
//     than an unidentified one. What is still refused is inventing a sport for
//     a row that has none; those keep the older half weight, which is the
//     honest reading of a gap rather than an invented one. The full cross-sport
//     model lives in `src/lib/sessionLoad.ts`.
//
//   • It does not call the AI. The rebuild is arithmetic on the stored plan, so
//     it works offline, costs nothing, and cannot fail halfway through. The
//     generator is told about the break separately, when the athlete asks for a
//     new plan.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

import { localDateKey } from "./dates";
import {
  activeAdjustments,
  adjustmentForWeek,
  classifyBreak,
  planRebuild,
  returnProgression,
  undoAdjustment,
  weekDayKey,
  type AdjustmentStep,
  type BreakFacts,
  type PlanAdjustmentRecord,
  type RebuildOutcome,
  type ReturnContext,
} from "./adaptivePlan";
import { spanDays, type LifeEvent } from "./lifeEvents";
import { classifySport } from "./sessionLoad";
import { newId, updateOrQueue } from "./offlineQueue";
import {
  asPlanWeeks,
  mondayOf,
  sessionDate,
  weekOneMonday,
  type TrainingPlanLike,
} from "./planSchedule";

// ---------------------------------------------------------------------------
// Small date helpers
// ---------------------------------------------------------------------------

/**
 * A stored `YYYY-MM-DD` key as a local Date.
 *
 * Never `new Date(key)`: that parses as UTC midnight, which is the previous day
 * in every timezone west of Greenwich and would move a week boundary by one.
 */
const dayDate = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

const addDaysKey = (key: string, days: number): string => {
  const date = dayDate(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
};

/** Chronological age, or null when it cannot be known. */
export function ageFromDateOfBirth(dateOfBirth?: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = dayDate(String(dateOfBirth).slice(0, 10));
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hadBirthday =
    now.getMonth() > dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hadBirthday) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}

// ---------------------------------------------------------------------------
// Facts about the break
// ---------------------------------------------------------------------------

/** The life event as the planner needs it. */
export function breakFacts(event: LifeEvent): BreakFacts {
  return {
    eventId: event.id,
    eventType: event.event_type,
    startDate: event.start_date,
    endDate: event.end_date,
    days: spanDays(event.start_date, event.end_date),
    activityLevel: event.activity_level,
    allowTraining: event.allow_training,
  };
}

/** The Monday that plan week `week` begins on, as a calendar day. */
export const planWeekStart = (plan: TrainingPlanLike) => {
  const anchor = weekOneMonday(plan);
  return (week: number): string => sessionDate(anchor, week, 1);
};

// ---------------------------------------------------------------------------
// The context reads
// ---------------------------------------------------------------------------

/** What a medium-readiness score means here. Not a medical threshold. */
const POOR_RECOVERY = 50;
/** Days of logging that make a week "consistent". Three, not seven. */
const CONSISTENT_WEEK_DAYS = 3;

export interface ReturnContextInput {
  userId: string;
  planId: string;
  facts: BreakFacts;
  /** Age when known. `null` disables the youth rules rather than guessing. */
  age?: number | null;
  /** Injected for tests; defaults to today. */
  today?: string;
}

/**
 * Everything the progression needs that is not in the life event itself.
 *
 * Three reads, and each one is allowed to come back empty. The athlete's own
 * recovery logging decides one notch of one week; how much they actually trained
 * before and during the break decides whether the rebuild starts at 40% of a
 * peak they still have or 60% of a routine they never had.
 */
export async function loadReturnContext(input: ReturnContextInput): Promise<ReturnContext> {
  const today = input.today ?? localDateKey(new Date());
  const { facts } = input;
  const context: ReturnContext = {
    age: input.age ?? null,
    // The reason for the break is the one piece of context that is already
    // known — the athlete told us — and it is the one that caps the return
    // hardest. Derived from the event type rather than asked again.
    medical: facts.eventType === "illness" || facts.eventType === "injury",
  };

  // Their own recovery logging, last three entries. Low readiness makes the
  // first week easier — it is never grounds for holding a session back, which
  // is a medical decision this app does not make.
  const { data: recovery } = await supabase
    .from("recovery_logs")
    .select("readiness_score")
    .eq("user_id", input.userId)
    .order("log_date", { ascending: false })
    .limit(3);

  // `typeof === "number"` rather than `Number(...)`: the column is nullable,
  // and `Number(null)` is 0 — which would read a missing score as the worst
  // possible recovery and take a notch off a return week for no reason at all.
  const scores = (recovery ?? [])
    .map((row) => row.readiness_score)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (scores.length) {
    const average = scores.reduce((sum, n) => sum + n, 0) / scores.length;
    context.recoveryPoor = average < POOR_RECOVERY;
  }

  // Training actually logged in the six weeks before the break and during it.
  // One read answers both questions, and `log_date` is already a calendar day,
  // so nothing here can be shifted by a timezone.
  const from = addDaysKey(facts.startDate, -42);
  const { data: loads } = await supabase
    .from("training_loads")
    .select("log_date")
    .eq("user_id", input.userId)
    .gte("log_date", from)
    .lte("log_date", today);

  const days = [...new Set((loads ?? []).map((row) => String(row.log_date)))].sort();
  const duringBreak = days.filter((day) => day >= facts.startDate && day <= facts.endDate);

  // Whole weeks of at least three logged days, before the break. Someone who
  // was training twice a month has no fitness to lose, and cutting their first
  // week back to 40% produces a plan that asks nothing of them.
  //
  // Only reported when there is history to report it from. An athlete with no
  // logs at all is *unknown*, not untrained, and "unknown" must not trip a rule
  // that exists to undo conservatism — a new athlete would get a fuller first
  // week back than a well-logged one, which is the wrong way round.
  const weeksBefore = new Map<string, Set<string>>();
  for (const day of days.filter((d) => d < facts.startDate)) {
    const monday = localDateKey(mondayOf(dayDate(day)));
    const seen = weeksBefore.get(monday) ?? new Set<string>();
    seen.add(day);
    weeksBefore.set(monday, seen);
  }
  if (days.length) {
    context.consistentWeeksBefore = [...weeksBefore.values()].filter((s) => s.size >= CONSISTENT_WEEK_DAYS).length;
  }

  // A day logged against this plan is this plan's sport by definition. Every
  // other active day during the break was counted at half, because nothing in
  // the schema could say what sport it was and half credit was the conservative
  // reading of that gap.
  //
  // Phase 3 closes the gap. `workouts.sport` now exists, so a session logged
  // against another plan, or imported from a watch without one, can be
  // *classified* rather than assumed: it counts as same-sport when its sport
  // matches this plan's, and as other-sport otherwise. What it still cannot
  // do is claim to know a session whose sport is blank, so those keep the
  // half-credit day count — the honest reading of a gap, not an invented one.
  const [sameLogged, otherLogged] = await Promise.all([
    supabase
      .from("workouts")
      .select("completed_at")
      .eq("user_id", input.userId)
      .eq("training_plan_id", input.planId)
      .gte("completed_at", `${facts.startDate}T00:00:00`)
      .lte("completed_at", `${facts.endDate}T23:59:59`),
    supabase
      .from("workouts")
      .select("completed_at, sport, type, training_plan_id")
      .eq("user_id", input.userId)
      .is("training_plan_id", null)
      .gte("completed_at", `${facts.startDate}T00:00:00`)
      .lte("completed_at", `${facts.endDate}T23:59:59`),
  ]);

  // `.slice(0, 10)` is inside the map on purpose: it trims each timestamp to a
  // calendar day. Outside it, it would quietly truncate the *result array* to
  // ten rows instead, and every date after the tenth would stop matching the
  // day keys it is compared against.
  const sameSport = new Set(
    (sameLogged.data ?? [])
      .map((row) => String(row.completed_at ?? "").slice(0, 10))
      .filter(Boolean),
  );

  // Days an unattributed session landed on, split by whether its sport can be
  // named. A day in `otherIdentified` means "some other sport we know"; one in
  // `otherUnknown` means "some session, sport unknown". They are kept apart
  // because they deserve different credit: an athlete who trained hard in
  // another sport has kept more of their fitness than one who logged a
  // stroll, and the day count alone cannot tell those apart.
  const otherIdentified = new Set<string>();
  const otherUnknown = new Set<string>();
  for (const row of otherLogged.data ?? []) {
    const day = String(row.completed_at ?? "").slice(0, 10);
    if (!day) continue;
    if (classifySport(row.sport ?? row.type) === "unknown") otherUnknown.add(day);
    else otherIdentified.add(day);
  }

  context.activeDaysSameSport = duringBreak.filter((day) => sameSport.has(day)).length;
  context.activeDaysOtherSport = duringBreak.filter(
    (day) => !sameSport.has(day) && (otherIdentified.has(day) || otherUnknown.has(day)),
  ).length;
  // Only the days whose sport we could actually name, kept apart so
  // `creditedDays` can weight an identified sport more than an unidentified
  // session of the same length.
  context.attributedOtherSportDays = duringBreak.filter(
    (day) => !sameSport.has(day) && otherIdentified.has(day),
  ).length;

  return context;
}

/**
 * Sessions on this plan the athlete has already acted on.
 *
 * Read from the adaptive record rather than from the plan, because that is
 * where completion actually lives: `plan_events` is the only place a session
 * carries a status. The dates are projected back onto week/day keys, since the
 * planner addresses sessions by their place in the grid.
 */
export async function lockedSessionKeys(input: { userId: string; plan: TrainingPlanLike }): Promise<string[]> {
  const { data } = await supabase
    .from("plan_events")
    .select("scheduled_date, status")
    .eq("user_id", input.userId)
    .eq("training_plan_id", input.plan.id)
    .in("status", ["completed", "modified", "replaced"]);

  const done = new Set((data ?? []).map((row) => String(row.scheduled_date)));
  if (!done.size) return [];

  const anchor = weekOneMonday(input.plan);
  const locked: string[] = [];
  for (const week of asPlanWeeks(input.plan.plan_data)) {
    for (const session of week.sessions) {
      const day = Number(session.day);
      if (!Number.isFinite(day)) continue;
      if (done.has(sessionDate(anchor, Number(week.week), day))) {
        locked.push(weekDayKey(Number(week.week), day));
      }
    }
  }
  return locked;
}

// ---------------------------------------------------------------------------
// Telling the generator what it cannot see
// ---------------------------------------------------------------------------

/**
 * How recent a break has to be for a new plan to count as a return from it.
 *
 * Three weeks. Beyond that the athlete is not returning, they are simply
 * starting — and a rebuild presented as "your break" after two months would be
 * the app explaining something that is no longer the reason.
 */
const RETURN_WINDOW_DAYS = 21;

export interface GeneratorBreakBrief {
  /** Breaks the athlete is in or facing, for the prompt. */
  breaks: { label: string; from: string; to: string; days: number; activityLevel: string }[];
  /**
   * The progression for the break they have just come back from, already
   * computed from the same rules the stored plan is rebuilt with. The generator
   * is told the numbers so it can choose sessions that suit a shortened week —
   * it is not asked to apply them, because `rebuildPlanForBreak` does that
   * afterwards, deterministically and once.
   */
  returns: { days: number; eventType: string; weeks: { volumePct: number; intensityPct: number }[] }[];
  /** The event behind `returns[0]`, so the new plan can be rebuilt around it. */
  returnEvent: LifeEvent | null;
}

/**
 * What a plan generator should know about this athlete's breaks.
 *
 * Read once, at plan creation, from the same `life_events` the availability
 * screen writes. Deliberately generous about failure: the caller turns any
 * error into "no brief", and a plan generated without one is a normal plan.
 */
export async function breakBriefForGenerator(input: {
  userId: string;
  age?: number | null;
  today?: string;
}): Promise<GeneratorBreakBrief> {
  const today = input.today ?? localDateKey(new Date());
  const { data } = await supabase
    .from("life_events")
    .select("*")
    .eq("user_id", input.userId)
    .order("start_date", { ascending: false })
    .limit(8);

  const events = (data ?? []) as LifeEvent[];

  const breaks = events
    .filter((event) => event.end_date >= today)
    .map((event) => ({
      label:
        event.event_type +
        (event.allow_training === "no"
          ? " (no training)"
          : event.allow_training === "optional"
            ? " (training optional)"
            : ""),
      from: event.start_date,
      to: event.end_date,
      days: spanDays(event.start_date, event.end_date),
      activityLevel: event.activity_level,
    }));

  // The most recent break that has already ended, if it ended recently enough
  // for the athlete to still be coming back from it.
  const recent = events.find((event) => event.end_date < today && event.end_date >= addDaysKey(today, -RETURN_WINDOW_DAYS));
  if (!recent) return { breaks, returns: [], returnEvent: null };

  const days = spanDays(recent.start_date, recent.end_date);
  const category = classifyBreak(days);
  const steps = returnProgression(category, { age: input.age ?? null });
  if (category === "none" || !steps.length) return { breaks, returns: [], returnEvent: null };

  return {
    breaks,
    returns: [
      {
        days,
        eventType: recent.event_type,
        weeks: steps.map((step) => ({ volumePct: step.volumePct, intensityPct: step.intensityPct })),
      },
    ],
    returnEvent: recent,
  };
}

/** Competitions already booked from today onwards, soonest first. */
export async function upcomingCompetitions(
  userId: string,
  today: string,
  limit = 12,
): Promise<{ title: string; date: string }[]> {
  const { data } = await supabase
    .from("events")
    .select("title, event_date")
    .eq("user_id", userId)
    .gte("event_date", today)
    .order("event_date", { ascending: true })
    .limit(limit);

  return (data ?? [])
    .filter((row) => !!row.event_date)
    .map((row) => ({ title: String(row.title ?? "Competition"), date: String(row.event_date) }));
}

// ---------------------------------------------------------------------------
// Applying it
// ---------------------------------------------------------------------------

export interface RebuildRunResult {
  ok: boolean;
  /** Null when the rebuild was refused or nothing needed changing. */
  outcome: RebuildOutcome | null;
  error?: string;
}

const explain = (error: unknown): string => {
  const message = (error as { message?: string } | null)?.message;
  return message || "Something went wrong updating your plan. Please try again.";
};

/**
 * Rebuild a plan around a break and store the record.
 *
 * Called after the life event is saved, never instead of saving it: the
 * athlete's break exists whether or not the plan can be re-cut around it, and
 * the two failures are reported separately. The same break can be submitted
 * twice without effect — `planRebuild` refuses a break it has already applied.
 */
export async function rebuildPlanForBreak(input: {
  userId: string;
  plan: TrainingPlanLike;
  event: LifeEvent;
  age?: number | null;
  today?: string;
}): Promise<RebuildRunResult> {
  const today = input.today ?? localDateKey(new Date());
  const weeks = asPlanWeeks(input.plan.plan_data);
  if (!weeks.length) return { ok: false, outcome: null, error: "That plan has no weeks to rebuild yet." };

  const facts = breakFacts(input.event);
  const previous = activeAdjustments(input.plan.plan_adjustments);

  // The context reads are enrichment, so they are all attempted together and a
  // failure in any of them is not fatal — each returns `data: null` rather than
  // throwing, and the defaults are the conservative ones.
  const [context, locked, competitions] = await Promise.all([
    loadReturnContext({ userId: input.userId, planId: input.plan.id, facts, age: input.age ?? null, today }),
    lockedSessionKeys({ userId: input.userId, plan: input.plan }),
    upcomingCompetitions(input.userId, today),
  ]);

  const outcome = planRebuild({
    weeks,
    weekStart: planWeekStart(input.plan),
    facts,
    context,
    competitions,
    existing: previous,
    locked,
    id: newId(),
    today,
  });

  if (outcome.reason !== "applied" || !outcome.adjustment) return { ok: true, outcome };

  const plan_adjustments = [...previous, outcome.adjustment];
  const result = await updateOrQueue("training_plans", input.plan.id, {
    plan_data: outcome.weeks,
    plan_adjustments,
  });
  // Queued counts as success: the rebuild is computed, stored on the device and
  // will land. Recomputing it later would risk applying a different one.
  if (!result.ok) return { ok: false, outcome: null, error: explain(result.error) };

  return { ok: true, outcome };
}

/**
 * Undo one rebuild, restoring the sessions it replaced.
 *
 * Only the most recent rebuild can be undone, and that restriction is the
 * honest one rather than a limitation: each rebuild scaled what the previous
 * one left behind, so reversing an older one while a newer one is still on the
 * plan would restore numbers that were never true.
 */
export async function undoPlanRebuild(input: {
  plan: TrainingPlanLike;
  recordId: string;
}): Promise<{ ok: boolean; plan_data?: unknown; plan_adjustments?: PlanAdjustmentRecord[]; error?: string }> {
  const records = activeAdjustments(input.plan.plan_adjustments);
  const latest = records[records.length - 1];
  const record = records.find((r) => r.id === input.recordId);

  if (!record) return { ok: false, error: "That rebuild is no longer on this plan." };
  if (!latest || latest.id !== record.id) {
    return { ok: false, error: "Undo the most recent change to your plan first." };
  }

  const { weeks, removed } = undoAdjustment(asPlanWeeks(input.plan.plan_data), record);
  if (!removed) return { ok: false, error: "Nothing from that rebuild is left on this plan." };

  const plan_adjustments = records.filter((r) => r.id !== record.id);
  const result = await updateOrQueue("training_plans", input.plan.id, {
    plan_data: weeks,
    plan_adjustments,
  });
  if (!result.ok) return { ok: false, error: explain(result.error) };

  return { ok: true, plan_data: weeks, plan_adjustments };
}

/** The rebuild covering a plan week, for the tag on the week header. */
export function rebuildForWeek(
  plan: TrainingPlanLike | null | undefined,
  week: number,
): { record: PlanAdjustmentRecord; step: AdjustmentStep } | null {
  if (!plan) return null;
  return adjustmentForWeek(activeAdjustments(plan.plan_adjustments), week);
}
