// ============================================================================
// RECOVERY PLANNING — gathering the facts the decision layer needs
// ----------------------------------------------------------------------------
// `src/lib/recoveryAdjust.ts` is pure: it decides what should happen to a
// session from facts it is handed, and tests against them directly. This file
// is the other half — it reads those facts out of the database and projects the
// plan onto real dates so the decision layer can address individual sessions.
//
// It is deliberately thin. Every judgement worth arguing about is in the pure
// module, where a test can pin it; what is left here is four reads and a
// projection, and those are the parts that have to be allowed to fail without
// taking the athlete's plan down with them.
//
// Three choices worth naming:
//
//   • BOTH SESSION TABLES ARE READ. `performance_logs` is what the athlete
//     logged; `workouts` is what came in from Health Connect or a watch. An
//     unplanned football match that landed in the second table is exactly the
//     case §4 asks the model to recognise, so ignoring either table would make
//     the cross-sport integration work only for the sessions typed by hand.
//
//   • NULL IS NOT ZERO. Every load is read as `number | null`, and a session
//     with no stored load contributes nothing to a total rather than
//     contributing a zero that looks like "they did nothing". This is the bug
//     class Phase 2 already hit once with `Number(null)`.
//
//   • READS NEVER BLOCK THE SCREEN. A failed read produces an empty fact set,
//     and the decision layer's honest answer for an empty fact set is "I don't
//     have enough information" — which is a correct thing for a phone on a
//     train to say, and far better than a spinner that never resolves.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

import { ageFromDateOfBirth } from "./adaptivePlanning";
import {
  decideForWeek,
  type AdjustableSession,
  type LoadEntry,
  type RecoveryEntry,
  type RecoveryFacts,
  type WeekDecision,
} from "./recoveryAdjust";
import { sessionLoad, type SessionLoadInput, type SessionLoad } from "./sessionLoad";
import type { LifeEvent } from "./lifeEvents";
import { localDateKey } from "./dates";
import { lsGet, lsSet } from "./localStore";
import { asPlanWeeks, flattenPlan, type TrainingPlanLike } from "./planSchedule";

/** How far back the load trend looks. Four weeks, matching §3's chronic window. */
const LOAD_WINDOW_DAYS = 34;

const dayKey = (value: string): string => value.slice(0, 10);

/** Whole days before `today`. */
function daysBefore(today: string, days: number): string {
  const [y, m, d] = dayKey(today).split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Gathering
// ---------------------------------------------------------------------------

interface PerformanceRow {
  log_date: string;
  sport: string | null;
  title: string | null;
  session_load: number | null;
}

interface WorkoutRow {
  completed_at: string;
  sport: string | null;
  type: string | null;
  title: string | null;
  session_load: number | null;
}

interface RecoveryRow {
  log_date: string;
  sleep_quality: number | null;
  fatigue: number | null;
  soreness: number | null;
  mood: number | null;
  stress: number | null;
  energy: number | null;
  rest_hours: number | null;
  hrv: number | null;
  readiness_score: number | null;
}

/** A number, or null. Never `Number(value)` — see the header. */
const asLoad = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const fromPerformance = (row: PerformanceRow): LoadEntry => ({
  date: dayKey(row.log_date),
  sport: row.sport,
  title: row.title,
  load: asLoad(row.session_load),
  source: "performance_log",
});

const fromWorkout = (row: WorkoutRow): LoadEntry => ({
  // `completed_at` is the day the session happened, and the query already
  // restricts it to the window — a row without one is not a completed session
  // and is not in scope here, so there is no fallback to invent.
  date: dayKey(row.completed_at),
  sport: row.sport ?? row.type,
  title: row.title,
  load: asLoad(row.session_load),
  source: "workout",
});

/**
 * Everything the decision layer needs, read from the database.
 *
 * Four reads, run together. Each is independently allowed to come back empty,
 * and none of them throws: an athlete who is offline still gets a screen, and
 * one with nothing logged gets the honest "not enough information" answer
 * rather than an error.
 */
export async function loadRecoveryFacts(input: {
  userId: string;
  plan?: TrainingPlanLike | null;
  dateOfBirth?: string | null;
  today?: string;
}): Promise<RecoveryFacts> {
  const today = input.today ?? localDateKey(new Date());
  const from = daysBefore(today, LOAD_WINDOW_DAYS);

  const [recoveryRes, performanceRes, workoutRes, eventRes, competitionRes] = await Promise.all([
    supabase
      .from("recovery_logs")
      .select(
        "log_date, sleep_quality, fatigue, soreness, mood, stress, energy, rest_hours, hrv, readiness_score",
      )
      .eq("user_id", input.userId)
      .lte("log_date", today)
      .order("log_date", { ascending: false })
      .limit(14),
    supabase
      .from("performance_logs")
      .select("log_date, sport, title, session_load")
      .eq("user_id", input.userId)
      .gte("log_date", from)
      .lte("log_date", today),
    supabase
      .from("workouts")
      .select("completed_at, sport, type, title, session_load")
      .eq("user_id", input.userId)
      .eq("completed", true)
      .gte("completed_at", `${from}T00:00:00`)
      .lte("completed_at", `${today}T23:59:59`),
    supabase
      .from("life_events")
      .select("*")
      .eq("user_id", input.userId)
      .lte("end_date", daysBefore(today, -60)),
    supabase
      .from("events")
      .select("title, event_date")
      .eq("user_id", input.userId)
      .gte("event_date", today)
      .order("event_date", { ascending: true })
      .limit(8),
  ]);

  const recovery: RecoveryEntry[] = (recoveryRes.data ?? []) as RecoveryRow[];
  const loads: LoadEntry[] = [
    ...((performanceRes.data ?? []) as PerformanceRow[]).map(fromPerformance),
    ...((workoutRes.data ?? []) as WorkoutRow[]).map(fromWorkout),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));

  const events = (eventRes.data ?? []) as LifeEvent[];
  const competitions = (competitionRes.data ?? [])
    .filter((row: { event_date?: string | null }) => !!row.event_date)
    .map((row: { title?: string | null; event_date: string }) => ({
      title: String(row.title ?? "your competition"),
      date: dayKey(row.event_date),
    }));

  // The life-event read above reaches backwards so it can cover today and the
  // next two months; anything that ended years ago can never constrain a
  // session being decided now, and shipping it would just be noise.

  const returnWeek = returnWeekBack(input.plan, today);

  return {
    today,
    recovery,
    loads,
    sessions: input.plan ? projectSessions(input.plan) : [],
    events,
    competitions,
    age: ageFromDateOfBirth(input.dateOfBirth ?? null),
    inReturnProgression: returnWeek !== null,
    returnWeekBack: returnWeek,
  };
}

/**
 * Which week of a return-from-break rebuild the athlete is in, or null.
 *
 * Read from the plan's own `returnFromBreak` tags rather than recomputed from
 * life events, because the rebuild already knows where it put the athlete and
 * the rebuild is the thing this module is deciding whether to soften further.
 */
export function returnWeekBack(plan: TrainingPlanLike | null | undefined, today: string): number | null {
  if (!plan) return null;
  for (const session of projectSessions(plan)) {
    if (session.date > today) continue;
    if (session.returnWeekBack !== null) return session.returnWeekBack;
  }
  return null;
}

/**
 * The plan's sessions, projected onto real dates.
 *
 * `flattenPlan` is the same projection the calendar and the rebuild already
 * use, so "today's session" means the same session in all three places. It is
 * walked alongside rather than extended: `flattenPlan` returns the projected
 * identity of a session, while the fields this layer needs to judge it —
 * duration, whether Phase 2 protected it, which rebuild week it belongs to —
 * live on the plan's own session objects and are looked up here by week and
 * day. Adding them to `DatedSession` would put a recovery concern into the
 * projection every other reader of the calendar depends on.
 */
export function projectSessions(plan: TrainingPlanLike): ProjectedSession[] {
  const raw = new Map<string, RawSession>();
  for (const week of asPlanWeeks(plan.plan_data)) {
    for (const session of week.sessions) {
      const day = Number(session?.day);
      if (!Number.isFinite(day)) continue;
      raw.set(`${week.week}:${day}`, session as RawSession);
    }
  }

  return flattenPlan(plan).map((session) => {
    const source = raw.get(`${session.week}:${session.day}`);
    const rebuild = source?.returnFromBreak;
    return {
      week: session.week,
      day: session.day,
      date: session.scheduled_date,
      title: session.title,
      type: session.type,
      durationMinutes: Number(source?.duration_minutes ?? 0) || 0,
      isRest: session.isRest,
      isRecovery: !!source?.isRecovery,
      // Phase 2 wrote `key` on the sessions it protected. Honouring it here
      // means "protect the key session" means the same thing in the rebuild and
      // in the recovery layer.
      key: !!source?.key || session.important,
      returnWeekBack: typeof rebuild?.weekBack === "number" ? rebuild.weekBack : null,
    };
  });
}

/** A plan session as the projection reads it, before it becomes a decision input. */
interface RawSession {
  duration_minutes?: number;
  isRecovery?: boolean;
  key?: boolean;
  returnFromBreak?: { weekBack?: number } | null;
}

/** `AdjustableSession` plus the rebuild week, for the callers that need both. */
export interface ProjectedSession extends AdjustableSession {
  returnWeekBack: number | null;
}

// ---------------------------------------------------------------------------
// The week decision
// ---------------------------------------------------------------------------

export interface RecoveryReadResult {
  facts: RecoveryFacts;
  week: WeekDecision;
  /**
   * True when this came from the device cache because the database could not be
   * reached. The screen says so: an athlete reading "consider cutting 30%" has a
   * right to know whether that is today's advice or the last advice the app
   * managed to compute.
   */
  fromCache?: boolean;
}

// ---------------------------------------------------------------------------
// Offline
// ---------------------------------------------------------------------------

/**
 * Where the last read is kept on the device.
 *
 * §8 asks for recovery-aware adjustments to be displayable offline once
 * generated, and this is the smallest honest way to do it: the *decision* is
 * cached, not the data behind it. The week it describes expires with the day it
 * was computed on, so an athlete who opens a three-day-old plan with no signal
 * is shown what was true three days ago — clearly stamped as that — rather than
 * a stale "consider cutting 30%" presented as today's advice.
 *
 * The facts are cached alongside it because the explanation quotes them, and a
 * suggestion whose supporting numbers are missing reads as invention.
 */
const CACHE_PREFIX = "vaylo_recovery_read_v1";

const cacheKey = (userId: string, planId: string, date: string) => `${CACHE_PREFIX}:${userId}:${planId}:${date}`;

/**
 * The last read for this athlete, plan and day, or null.
 *
 * Narrowed defensively: this is a JSON blob in local storage, and a partially
 * written or older-shaped entry must read as "no cache" rather than crash the
 * plan screen on a phone that has been interrupted mid-write.
 */
export function cachedRecoveryRead(
  userId: string,
  planId: string | undefined,
  date: string,
): RecoveryReadResult | null {
  if (!planId) return null;
  try {
    const raw = lsGet<unknown>(cacheKey(userId, planId, date), null);
    if (!raw || typeof raw !== "object") return null;
    const read = raw as Partial<RecoveryReadResult>;
    if (!read.facts || !read.week || !Array.isArray(read.week.decisions)) return null;
    return read as RecoveryReadResult;
  } catch {
    return null;
  }
}

/** Remember the read so it survives losing signal. Failures are ignored. */
function cacheRecoveryRead(userId: string, planId: string | undefined, date: string, read: RecoveryReadResult): void {
  if (!planId) return;
  try {
    lsSet(cacheKey(userId, planId, date), read);
  } catch {
    // A full or unavailable local store must not cost the athlete the read they
    // can already see. Caching is an offline convenience, not a requirement.
  }
}

/**
 * The week's recovery-aware read, ready to render.
 *
 * Returns the facts alongside the decision rather than hiding them, because the
 * screen shows the athlete which of their own numbers produced the suggestion.
 * A recommendation whose inputs are invisible is indistinguishable from a guess.
 *
 * Falls back to the cached read when the database cannot be reached, so the
 * panel still answers the question offline. It never falls back to *computing*
 * from a partial read: an athlete with a working connection and a failed query
 * gets the cache, and an athlete whose data genuinely has not changed gets a
 * fresh read.
 */
export async function readRecoveryForPlan(input: {
  userId: string;
  plan?: TrainingPlanLike | null;
  dateOfBirth?: string | null;
  today?: string;
}): Promise<RecoveryReadResult | null> {
  const today = input.today ?? localDateKey(new Date());
  let facts: RecoveryFacts;
  try {
    facts = await loadRecoveryFacts({ ...input, today });
  } catch {
    const cached = cachedRecoveryRead(input.userId, input.plan?.id, today);
    return cached ? { ...cached, fromCache: true } : null;
  }

  const week = decideForWeek(facts.sessions, facts);
  const read: RecoveryReadResult = { facts, week };
  cacheRecoveryRead(input.userId, input.plan?.id, today, read);
  return read;
}

// ---------------------------------------------------------------------------
// Writing the load
// ---------------------------------------------------------------------------

/**
 * Price a session that is being logged right now.
 *
 * The return value is what the caller stores *with* the row, so a session and
 * its load are always written together. Nothing here backfills: a session
 * logged before this feature existed keeps `session_load IS NULL`, because
 * re-deriving a past session's load means guessing at a sport the athlete may
 * never have recorded, and a guess written into history is indistinguishable
 * from a measurement.
 */
export function loadForNewSession(input: SessionLoadInput): SessionLoad {
  return sessionLoad(input);
}

/**
 * Whether a stored load should be recomputed.
 *
 * Only true when there is no load stored at all. A session that already carries
 * a number is left alone: re-pricing it would silently change a figure the
 * athlete may have seen, and the rule this whole feature rests on is that a
 * historical record is not revised after the fact.
 */
export function shouldRecalculate(stored: number | null | undefined): boolean {
  return stored === null || stored === undefined;
}

/** The fields a `performance_logs` insert needs to carry its load. */
export interface LoggedSession {
  sport?: string | null;
  durationMinutes?: number | null;
  rpe?: number | null;
  distanceKm?: number | null;
  volumeLoad?: number | null;
  stroke?: string | null;
  kind?: "match" | "practice" | null;
}

/** The extra columns to write alongside a `performance_logs` row. */
export function loadColumnsFor(session: LoggedSession): { session_load: number | null } {
  const result = sessionLoad({
    sport: session.sport ?? null,
    durationMinutes: session.durationMinutes ?? null,
    rpe: session.rpe ?? null,
    distanceKm: session.distanceKm ?? null,
    volumeLoad: session.volumeLoad ?? null,
    stroke: (session.stroke as SessionLoadInput["stroke"]) ?? null,
    kind: session.kind ?? null,
  });
  return { session_load: result.load };
}

/**
 * The columns to write when an athlete corrects an imported session's sport.
 *
 * The correction re-prices the session, because the load depends on the sport
 * (Phase 3): a 65-minute ride corrected to a run is a different figure. But not
 * every sport can be priced from what an imported row holds — a strength
 * session needs lifted volume or an effort figure, and "Weekend ride · 65 min"
 * has neither. Writing that null through would erase a load the athlete may
 * already have seen, which is the one thing `shouldRecalculate` above exists to
 * prevent, and under-counting load is the direction that protects an athlete
 * least. So an unpricable correction changes the sport and leaves the stored
 * load exactly where it was.
 *
 * `session_load` is omitted rather than set to null on purpose: the queued
 * update only sends the keys it is given, so an omitted key cannot overwrite.
 */
export function correctedSportColumns(
  session: LoggedSession,
  sport: string,
): { sport: string; session_load?: number } {
  const load = loadColumnsFor({ ...session, sport }).session_load;
  return load === null ? { sport } : { sport, session_load: load };
}