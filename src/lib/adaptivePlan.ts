// ============================================================================
// ADAPTIVE PLAN — coming back from a break without stacking the missed work
// ----------------------------------------------------------------------------
// Phase 1 recorded that a break happened. This module decides what the plan
// should say next, and it exists because the obvious answer is the wrong one:
//
//   The wrong answer is to move every missed session into the days after the
//   break. It feels diligent — nothing is lost, it says — and it is how a
//   training app injures an athlete. Two weeks of missed work landing in one
//   week is not the plan they were following, it is a spike, and the athletes
//   most likely to accept it are the youngest and the most conscientious.
//
//   The right answer is to accept the loss, rebuild the weeks that follow at a
//   volume the athlete can actually absorb, keep the sessions that carry the
//   point of the week, and say plainly what was dropped. Detraining is real, it
//   is recoverable, and it is not a debt to be repaid.
//
// Three rules shape everything below, and they are absolute:
//
//   1. NOTHING IS MOVED. Not one session changes its day because of a break.
//      A dropped session becomes a rest day in place; it never reappears in
//      next week. The tests assert this directly rather than trusting callers.
//
//   2. HISTORY IS NOT TOUCHED. A completed or modified session is never scaled,
//      downgraded or dropped, and a week that is already behind the athlete is
//      never rewritten. Only future programming is rebuilt.
//
//   3. THE ATHLETE CAN ALWAYS UNDO IT. A rebuild writes real values into
//      `plan_data`, so it also records the exact sessions it replaced. "Undo"
//      restores them; it does not re-derive them.
//
// Pure on purpose: no Supabase, no React, no clock and no AI. Every rule here
// is arithmetic on the stored plan, so it is testable without a database, it
// runs offline, and it costs nothing to re-run. The percentages come from the
// specification; the judgement calls are named and commented where they are
// made rather than hidden in a prompt.
//
// What this module deliberately does NOT do: rewrite exercise prescriptions.
// Scaling a session's `exercises` (sets, reps, loads) is a programming decision
// that belongs to the generator, not to a deterministic rule set, and inventing
// substitute exercises here would be faking a capability. Volume is scaled
// concretely — durations and session count — and intensity is capped
// structurally: the session's type is downgraded, the ceiling is written into
// the session, and the note tells the athlete what to hold back. When the
// athlete regenerates a plan, the AI is briefed on the break instead.
// ============================================================================

import {
  deriveImportance,
  type PlanSessionLike,
  type PlanWeekLike,
  type ReturnWeekMeta,
} from "./planSchedule";
import type { ActivityLevel, LifeEventType } from "./lifeEvents";

// ---------------------------------------------------------------------------
// Break classification
// ---------------------------------------------------------------------------

/**
 * How long the athlete was away, in bands.
 *
 * `none` is 1–3 days: a long weekend is not a training interruption, and
 * building a structured rebuild for it would teach the athlete that ordinary
 * life makes their plan fragile. They resume normal training.
 */
export type BreakCategory = "none" | "week" | "fortnight" | "extended" | "reset";

export function classifyBreak(days: number): BreakCategory {
  if (!Number.isFinite(days) || days <= 0) return "none";
  if (days <= 3) return "none";
  if (days <= 7) return "week";
  if (days <= 14) return "fortnight";
  // The specification's bands overlap at 28 days, which it calls both the end
  // of "15–28" and the start of "28+". Where two readings disagree the more
  // conservative one wins, so 28 days is a reset: a four-week break is a
  // month away from training, and starting the rebuild at 45% of a peak the
  // athlete no longer has is the mistake this whole module is written against.
  if (days < 28) return "extended";
  return "reset";
}

/** What one week is for, which drives the copy and the styling. */
export type ReturnFocus =
  | "rebuild"
  | "restore"
  | "resume"
  | "compete"
  | "preload"
  | "holiday"
  /** A week the athlete said they would not train in, emptied rather than eased. */
  | "paused";

export interface ProgressionStep {
  /** 1 = the first week back. */
  back: number;
  volumePct: number;
  intensityPct: number;
  focus: ReturnFocus;
}

/**
 * The bands, before any adjustment for the athlete.
 *
 * Read as "week N back is programmed at X% of the athlete's usual volume, with
 * intensity capped at Y%". `resume` at 90/95 is deliberately not 100: the last
 * week of a rebuild is where an athlete is most likely to sprint for the level
 * they were at, and a 5% softness costs nothing and prevents the week that
 * undoes the whole return.
 */
const BASE_PROGRESSION: Record<Exclude<BreakCategory, "none">, ProgressionStep[]> = {
  // 4–7 days. Two weeks, not one: the athlete comes back at 70%, climbs to 85%,
  // and only then resumes their normal programming. A single rebuild week
  // followed by a full-volume week is a step down and straight back in, which
  // is the shape of a return that goes well on Tuesday and hurts by Sunday.
  // Every other band already climbs; this one is the shortest and still needs
  // to arrive rather than land.
  week: [
    { back: 1, volumePct: 70, intensityPct: 80, focus: "rebuild" },
    { back: 2, volumePct: 85, intensityPct: 90, focus: "resume" },
  ],
  // 8–14 days.
  fortnight: [
    { back: 1, volumePct: 55, intensityPct: 65, focus: "rebuild" },
    { back: 2, volumePct: 75, intensityPct: 80, focus: "restore" },
  ],
  // 15–28 days.
  extended: [
    { back: 1, volumePct: 45, intensityPct: 55, focus: "rebuild" },
    { back: 2, volumePct: 65, intensityPct: 75, focus: "restore" },
    { back: 3, volumePct: 85, intensityPct: 88, focus: "restore" },
  ],
  // 29 days and beyond. A reset, not a deficit: rebuilt from a conservative
  // base over four weeks rather than aimed back at the old peak.
  reset: [
    { back: 1, volumePct: 40, intensityPct: 50, focus: "rebuild" },
    { back: 2, volumePct: 55, intensityPct: 65, focus: "rebuild" },
    { back: 3, volumePct: 70, intensityPct: 80, focus: "restore" },
    { back: 4, volumePct: 85, intensityPct: 90, focus: "resume" },
  ],
};

export interface BreakFacts {
  /** The life event this rebuild belongs to. */
  eventId: string;
  eventType: LifeEventType;
  startDate: string;
  endDate: string;
  /** Whole days away, inclusive of both ends. */
  days: number;
  /** What the athlete said they would be doing. */
  activityLevel: ActivityLevel;
  /** Whether they asked for training during the window. */
  allowTraining: "yes" | "no" | "optional";
}

export interface ReturnContext {
  /** Chronological age, when it is known. */
  age?: number | null;
  /**
   * True when the athlete's own recovery logging says they are not recovered.
   * One notch easier for the first week — never a diagnosis, never a hold.
   */
  recoveryPoor?: boolean;
  /** True when the break was recorded as illness or injury. */
  medical?: boolean;
  /**
   * Whole weeks of actually-logged training in the six weeks before the break.
   * Someone who was not training consistently has no fitness to lose, and
   * cutting their first week back to 45% of very little is not conservatism.
   *
   * Deliberately training history rather than the self-declared
   * `profiles.experience_level`: "beginner" is a statement about how someone
   * sees themselves, and this decides how much load to prescribe. The declared
   * level is still sent to the generator, where a prompt can weigh it.
   */
  consistentWeeksBefore?: number;
  /** Days of training actually logged during the break, in this plan's sport. */
  activeDaysSameSport?: number;
  /**
   * The same, in another sport. Counted at half weight — a week of swimming
   * maintains general fitness but does not maintain running legs, and treating
   * it as equivalent is the assumption the specification warns against.
   */
  activeDaysOtherSport?: number;
  /**
   * The subset of `activeDaysOtherSport` whose sport could actually be named.
   *
   * Phase 3: `workouts` carries a sport, so an activity logged against another
   * plan — or imported from a watch — can be identified instead of assumed. An
   * identified day counts for more than an unidentified one, because "a
   * football match on Tuesday" is evidence of fitness maintained and "some
   * session on Tuesday" is evidence of a Tuesday. Left absent when nothing was
   * identified, in which case every other-sport day keeps the older half
   * credit and nothing changes for an athlete with no attributable activity.
   */
  attributedOtherSportDays?: number;
}

/**
 * How much of the break to forgive because the athlete kept training.
 *
 * Capped at half the break. Someone who trained every day of a three-week
 * break was not away for three weeks, but they were also not following the
 * plan, and crediting the whole period would silently skip the rebuild for the
 * athlete who most needs the numbers to be conservative.
 */
export function creditedDays(facts: BreakFacts, context: ReturnContext): number {
  const same = Math.max(0, context.activeDaysSameSport ?? 0);
  const otherTotal = Math.max(0, context.activeDaysOtherSport ?? 0);
  const otherNamed = Math.max(0, context.attributedOtherSportDays ?? 0);
  // Named cross-sport days earn 0.75, unnamed ones 0.5. The gap is
  // deliberately modest: the app can now tell a football match from a blank
  // row, but it still cannot tell how hard either was, so it does not claim to.
  const other = otherNamed * 0.75 + (otherTotal - otherNamed) * 0.5;
  const declared = facts.activityLevel === "normal" ? 0.35 : facts.activityLevel === "light" ? 0.15 : 0;
  const raw = same + other + facts.days * declared;
  return Math.min(facts.days * 0.5, raw);
}

/**
 * The progression for one break.
 *
 * Order of operations matters and is not arbitrary: the athlete's own facts set
 * the band, and each modifier can only ever make the first week *lighter*, with
 * the single exception of `consistentWeeksBefore`, which exists to stop the
 * app from being absurdly conservative with someone who had almost no training
 * to lose.
 */
export function returnProgression(category: BreakCategory, context: ReturnContext = {}): ProgressionStep[] {
  if (category === "none") return [];

  const steps = BASE_PROGRESSION[category].map((s) => ({ ...s }));
  const youth = context.age !== null && context.age !== undefined && context.age < 18;

  // The under-18 rule: a developing athlete detrains slower and their long-term
  // development is the objective, so a rebuild is gentler and, for a long break,
  // longer. This is the one place the rules spend extra time to ask for less.
  // Unchanged by the 18–30 reposition — it is a safety floor, not audience copy.
  if (youth) {
    for (const step of steps) {
      step.volumePct -= 5;
      step.intensityPct -= 5;
    }
    if (category === "reset") {
      steps.push({ back: 5, volumePct: 90, intensityPct: 95, focus: "resume" });
    }
  }

  // Illness or injury. Never a treatment plan — the copy says so — but the
  // programming is capped hard, because the failure mode of a return from
  // injury is doing what felt fine on Tuesday and paying for it for a month.
  if (context.medical) {
    steps[0].intensityPct = Math.min(steps[0].intensityPct, 60);
    steps[0].volumePct -= 5;
    if (steps[1]) steps[1].intensityPct = Math.min(steps[1].intensityPct, 70);
  }

  // Poor recovery, by the athlete's own logging, makes the first week easier
  // still. One notch, not a collapse: the answer to "I slept badly" is not
  // "stop training", it is "do less today".
  if (context.recoveryPoor) {
    steps[0].volumePct -= 10;
    steps[0].intensityPct -= 10;
  }

  // A floor, not a target. Nothing here programs under a third of normal
  // volume: below that the athlete is not rebuilding, they are still resting,
  // and that is what the break was for.
  for (const step of steps) {
    step.volumePct = clamp(Math.round(step.volumePct), 33, 95);
    step.intensityPct = clamp(Math.round(step.intensityPct), 40, 95);
  }

  // No base to lose. Someone who trained once or not at all in the six weeks
  // before a break is not de-trained, and cutting them to 45% produces a plan
  // that asks almost nothing of them and teaches them nothing.
  //
  // Never for a medical break, though. That rule exists to stop the app being
  // pointlessly cautious about a thin training history, and a thin history is
  // not a reason to raise a week that illness or injury already capped.
  if (!context.medical && (context.consistentWeeksBefore ?? 6) <= 1 && steps[0].volumePct < 60) {
    steps[0].volumePct = 60;
    steps[0].intensityPct = Math.max(steps[0].intensityPct, 65);
  }

  return steps;
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

// ---------------------------------------------------------------------------
// The record of a rebuild
// ---------------------------------------------------------------------------

export interface AdjustmentStep {
  /** The plan week this step was applied to. */
  week: number;
  back: number;
  volumePct: number;
  intensityPct: number;
  focus: ReturnFocus;
  /** How many sessions the week holds after the rebuild. */
  sessions: number;
  dropped: number;
  /** The week's own note before the rebuild, if it had one, so undo is exact. */
  previousNote?: string;
  /**
   * The week's own `returnFromBreak` tag before this rebuild — which is not
   * always absent, because a second break can land inside the first rebuild's
   * window. Undo has to put that tag back rather than simply removing one.
   */
  previousTag?: ReturnWeekMeta;
}

/** One session as it was before the rebuild, so undo is exact. */
export interface SessionSnapshot {
  week: number;
  session: PlanSessionLike;
}

/**
 * A rebuild that has been applied.
 *
 * `before` is the whole reason this is stored rather than recomputed: once the
 * new durations are in `plan_data` the old ones are gone, and "we can work out
 * what it used to be" is false the moment the athlete edits anything. The
 * snapshot is bounded by the four-week cap on a rebuild, so it stays small.
 */
export interface PlanAdjustmentRecord {
  id: string;
  kind: "return_from_break";
  lifeEventId: string;
  createdAt: string;
  break: {
    startDate: string;
    endDate: string;
    days: number;
    eventType: LifeEventType;
    activityLevel: ActivityLevel;
  };
  /** Days of the break forgiven because the athlete kept training. */
  creditedDays: number;
  steps: AdjustmentStep[];
  headline: string;
  /** The "why my plan changed" sentence, shown on the plan screen. */
  explanation: string;
  /** Shown alongside the explanation when the break was illness or injury. */
  medicalNote: string | null;
  /** True when a competition fell inside the rebuild window. */
  competingSoon: boolean;
  before: SessionSnapshot[];
}

export type RebuildReason =
  | "applied"
  | "break-too-short"
  | "no-remaining-weeks"
  | "nothing-planned"
  | "already-applied";

export interface RebuildOutcome {
  reason: RebuildReason;
  adjustment: PlanAdjustmentRecord | null;
  /** The full week list, with the rebuilt weeks replaced. Never null. */
  weeks: PlanWeekLike[];
}

/**
 * Why a rebuild did not happen, in the athlete's words, or null when it did.
 *
 * `planRebuild` refuses for four different reasons and they mean quite
 * different things to the person reading them: a long weekend needs no rebuild
 * at all, while a break with nothing left ahead of it is a fact about the plan
 * the athlete should be told. Every caller used to answer each of them with
 * "Nothing needed changing on your plan.", which is how four days off gets read
 * as the app ignoring the athlete.
 */
export function rebuildRefusalNote(reason: RebuildReason): string {
  switch (reason) {
    case "break-too-short":
      return "Three days or less is a long weekend rather than an interruption, so your plan stays as it is.";
    case "no-remaining-weeks":
      return "There are no plan weeks left after that break, so there was nothing to rebuild.";
    case "nothing-planned":
      return "Nothing was still ahead of you inside that break, so there was nothing to rebuild.";
    case "already-applied":
      return "That break is already built into your plan, so nothing changed a second time.";
    case "applied":
    default:
      return "Nothing needed changing on your plan.";
  }
}

export interface RebuildInput {
  /** Every week of the plan, in order. */
  weeks: readonly PlanWeekLike[];
  /** First calendar day of a plan week, `YYYY-MM-DD`. Injected so this module stays date-free. */
  weekStart: (week: number) => string;
  facts: BreakFacts;
  context?: ReturnContext;
  /** Competition dates already booked, for the "immediately after a break" case. */
  competitions?: readonly { title: string; date: string }[];
  /** Adjustments already on the plan, so the same break is never applied twice. */
  existing?: readonly PlanAdjustmentRecord[];
  /**
   * Sessions the athlete has already acted on, as `weekDayKey` strings.
   *
   * Supplied by the caller from `plan_events` (`completed`, `modified`,
   * `replaced`) and from `workouts`. A locked session is never scaled, never
   * downgraded and never dropped, because the athlete has already done it and
   * rewriting the plan underneath a session that happened is how an app starts
   * lying about history.
   */
  locked?: Iterable<string>;
  /** Stable id for the new record. Injected so the module stays clock-free. */
  id: string;
  /** `YYYY-MM-DD`, the day the rebuild was computed. */
  today: string;
}

/**
 * How a session is addressed across the plan.
 *
 * Day numbers alone are not identity: every week has a day 3. The week is part
 * of the key so a locked session can only ever lock itself.
 */
export function weekDayKey(week: number, day: number): string {
  return `${week}:${day}`;
}

/** Add whole days to a `YYYY-MM-DD` day key, staying in local time. */
function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

// The canonical day-delta lives in ./dates — one implementation, one null
// contract (the 2026-10-06 audit found this body duplicated in recoveryAdjust
// with a second contract). Re-exported because roadmap.ts and its tests import
// it from this module.
export { daysBetween } from "./dates";

/** The plan week whose Mon–Sun span contains a date, or null. */
export function weekContaining(weeks: readonly PlanWeekLike[], weekStart: (w: number) => string, date: string): number | null {
  for (const week of weeks) {
    const start = weekStart(week.week);
    const end = addDays(start, 6);
    if (date >= start && date <= end) return week.week;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The transform
// ---------------------------------------------------------------------------

/** Session types that carry real intensity. */
const HIGH_INTENSITY = new Set(["speed", "intervals", "power", "sport_specific", "conditioning", "strength"]);

/**
 * Where a high-intensity session goes when the ceiling is below 85%.
 *
 * Deliberately conservative about which way to fall: intervals and speed work
 * become steady endurance, power becomes strength, and sport-specific work
 * becomes conditioning. The prescription inside the session is left alone —
 * see the module header — so the *type* is what carries the intent.
 */
const DOWNGRADE: Record<string, string> = {
  speed: "endurance",
  intervals: "endurance",
  power: "strength",
  sport_specific: "endurance",
  conditioning: "endurance",
};

/** True for a rest or recovery day: never dropped, never scaled, never counted. */
const isRestDay = (session: PlanSessionLike): boolean =>
  !!session.isRest || session.type === "rest" || !!session.isRecovery;

/**
 * Whether this session is one to protect.
 *
 * The explicit `key` flag wins when a rebuild has written one. Otherwise the
 * Phase 1 heuristic on session type decides — one rule for the whole app, in
 * one place, so the rebuild and the "key session lost" count cannot disagree.
 */
const isKeySession = (session: PlanSessionLike): boolean =>
  session.key ?? deriveImportance(session);

/** Circular distance in days between two days of a 7-day week. */
function dayGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 7;
  return Math.min(d, 7 - d);
}

/**
 * Which sessions survive a reduced week.
 *
 * Key sessions first, always — the specification's rule, and the one a coach
 * would give. Then the remaining budget is filled by *spacing*: at each step
 * the candidate furthest from everything already kept wins, because after a
 * break the thing an athlete has lost is the ability to absorb load, and three
 * sessions on consecutive days is how a rebuild week turns into an injury. Ties
 * go to the longer session, then the earlier day, so the result is stable.
 */
export function chooseKeptSessions(sessions: readonly PlanSessionLike[], budget: number): PlanSessionLike[] {
  const playable = sessions.filter((s) => !isRestDay(s));
  const key = playable.filter(isKeySession).sort((a, b) => a.day - b.day);
  const kept = [...key.slice(0, Math.max(budget, key.length))];
  const pool = playable.filter((s) => !kept.includes(s));

  while (kept.length < Math.max(budget, key.length) && pool.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    pool.forEach((candidate, index) => {
      const gap = kept.length ? Math.min(...kept.map((k) => dayGap(k.day, candidate.day))) : 7;
      const score = gap * 1000 + (candidate.duration_minutes ?? 0);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    kept.push(pool.splice(bestIndex, 1)[0]);
  }

  return kept;
}

/** Round to a five-minute boundary — a plan that says 37 minutes is noise. */
const round5 = (n: number): number => Math.max(0, Math.round(n / 5) * 5);

/**
 * Apply one step of a progression to one week.
 *
 * Returns the rebuilt week plus the snapshots a reversal needs. Rest days are
 * carried through untouched; dropped sessions become rest days *in place*, with
 * a note, because an empty slot in a 7-day grid reads as a bug while a rest day
 * with a reason reads as a plan.
 *
 * Three kinds of session are never touched, and they share a reason: the plan
 * must not be rewritten underneath something that already happened.
 *
 *   • Rest and recovery days — there is nothing to reduce.
 *   • `locked` sessions — the athlete completed, modified or replaced them.
 *   • Sessions before `fromDay` — the part of the return week that is already
 *     behind them, when a break ends mid-week.
 *
 * Untouched sessions are also not snapshotted. A reversal record only needs to
 * hold what the rebuild changed.
 */
export function rebuildWeek(
  week: PlanWeekLike,
  step: ProgressionStep & { weekNumber: number; fromDay?: number; toDay?: number },
  lifeEventId: string,
  locked?: Iterable<string>,
): { week: PlanWeekLike; snapshot: SessionSnapshot[]; droppedTitles: string[] } {
  const from = clamp(Math.trunc(step.fromDay ?? 1), 1, 7);
  // The other end of the window, used by the loading week before a break: the
  // days of the pre-week that fall *after* the break has begun are not days the
  // athlete can bank anything on. Before it existed, a holiday starting on a
  // Wednesday had its own Wednesday-to-Sunday sessions loaded 10% harder by the
  // loading step, on top of being cancelled for the holiday.
  const to = clamp(Math.trunc(step.toDay ?? 7), 1, 7);
  const lockedKeys = locked ? new Set(locked) : null;
  const playable = week.sessions.filter((s) => !isRestDay(s));

  // A session the athlete has already acted on. `skipped` is the plan's own
  // marker (the Training screen toggles it); the locked set comes from the
  // adaptive record, which is where completion actually lives.
  const isLocked = (s: PlanSessionLike) =>
    !!s.skipped || !!lockedKeys?.has(weekDayKey(week.week, s.day));
  const touchable = playable.filter((s) => !isLocked(s) && s.day >= from && s.day <= to);

  // The budget is a share of the whole week rather than of the touchable
  // sessions, so a locked session still counts against it: a week that keeps a
  // completed session should be no fuller for it. `chooseKeptSessions` floors
  // the result at the number of key sessions, so the point of the week survives
  // even when the percentage would cut it.
  const budget = Math.max(1, Math.round((playable.length * step.volumePct) / 100));
  const kept = chooseKeptSessions(touchable, budget);
  const keptDays = new Set(kept.map((s) => s.day));

  const snapshot: SessionSnapshot[] = [];
  const droppedTitles: string[] = [];

  const sessions = week.sessions.map((session) => {
    // Locked and already-passed sessions are excluded from the reversal record
    // too: nothing about them changes, so copying them would be noise that has
    // to be reasoned about later.
    if (isRestDay(session) || isLocked(session) || session.day < from || session.day > to) return session;

    snapshot.push({ week: week.week, session: { ...session } });

    const meta = {
      lifeEventId,
      weekBack: step.back,
      volumePct: step.volumePct,
      intensityPct: step.intensityPct,
      originalDuration: session.duration_minutes ?? 0,
    };

    if (!keptDays.has(session.day)) {
      droppedTitles.push(session.title);
      return {
        ...session,
        title: "Rest",
        type: "rest",
        duration_minutes: 0,
        isRest: true,
        isRecovery: false,
        warmup: [],
        exercises: [],
        cooldown: [],
        description: `${session.title} is not programmed while you rebuild — nothing has been moved into next week.`,
        key: isKeySession(session),
        returnFromBreak: { ...meta, dropped: true, originalTitle: session.title },
      } satisfies PlanSessionLike;
    }

    const duration = round5(((session.duration_minutes ?? 0) * step.volumePct) / 100);
    const type = String(session.type ?? "");
    const downgraded = step.intensityPct < 85 && HIGH_INTENSITY.has(type) ? DOWNGRADE[type] ?? type : type;
    const ceiling =
      step.intensityPct < 100
        ? ` · Rebuilding: hold this to about ${step.intensityPct}% of your usual intensity.`
        : "";

    return {
      ...session,
      type: downgraded,
      // A session that loses half its duration can legitimately fall under the
      // cap; keep it at 10 minutes rather than programming a walk.
      duration_minutes: Math.max(duration, 10),
      // Deliberately NOT `isRecovery`: that flag means "this is an active
      // recovery day" everywhere else in the app, and every reader that asks
      // "is this day playable?" treats it as a rest day. Stamping it on a
      // rebuilt session would hide that session from the next rebuild and
      // count it as zero in the week summary. What makes this session gentle
      // is the type downgrade, the duration, the ceiling written into it, and
      // `returnFromBreak` — all of which the screens can read without guessing.
      description: `${String(session.description ?? "").trim()}${ceiling}`.trim(),
      key: isKeySession(session),
      returnFromBreak: meta,
    } satisfies PlanSessionLike;
  });

  return {
    week: {
      ...week,
      sessions,
      extraNote: weekNote(step),
      returnFromBreak: {
        lifeEventId,
        weekBack: step.back,
        volumePct: step.volumePct,
        intensityPct: step.intensityPct,
        focus: step.focus,
        sessions: sessions.filter((s) => !isRestDay(s)).length,
        dropped: droppedTitles.length,
        droppedTitles,
      },
    },
    snapshot,
    droppedTitles,
  };
}

/**
 * Empty a week the athlete has said they will not train in.
 *
 * `allowTraining: "no"` is the athlete saying "nothing here", and until this
 * existed the app did not take them at their word in the place that mattered.
 * The availability layer does record those sessions as
 * `cancelled_due_to_availability` — but that is a record of a cancellation, not
 * a change to the plan, and the week stored in `plan_data` still read as a
 * normal week of training on the Training screen. An athlete who said "no
 * training" and then opened their plan found five sessions waiting to be made
 * up, which is the app arguing with them about their own holiday.
 *
 * So every session in the covered days becomes a rest day *in place*, in exactly
 * the shape `rebuildWeek` writes when it drops one, and each is snapshotted
 * first so undo restores the week byte for byte. Nothing is moved into the days
 * after the break, and nothing is deleted: the week still holds seven days with
 * a reason on each of them.
 *
 * The days before `fromDay` and any session the athlete has already acted on are
 * left exactly as they are, for the same reason `rebuildWeek` leaves them: a
 * break logged today cannot reach back into a Monday that has already happened.
 */
function clearWeek(
  week: PlanWeekLike,
  step: ProgressionStep & { weekNumber: number; fromDay?: number; toDay?: number },
  lifeEventId: string,
  locked?: Iterable<string>,
): { week: PlanWeekLike; snapshot: SessionSnapshot[]; droppedTitles: string[] } {
  const from = clamp(Math.trunc(step.fromDay ?? 1), 1, 7);
  const to = clamp(Math.trunc(step.toDay ?? 7), 1, 7);
  const lockedKeys = locked ? new Set(locked) : null;
  const isLocked = (s: PlanSessionLike) =>
    !!s.skipped || !!lockedKeys?.has(weekDayKey(week.week, s.day));

  const snapshot: SessionSnapshot[] = [];
  const droppedTitles: string[] = [];

  const sessions = week.sessions.map((session) => {
    if (isRestDay(session) || isLocked(session) || session.day < from || session.day > to) return session;

    snapshot.push({ week: week.week, session: { ...session } });
    droppedTitles.push(session.title);

    return {
      ...session,
      title: "No training",
      type: "rest",
      duration_minutes: 0,
      isRest: true,
      isRecovery: false,
      warmup: [],
      exercises: [],
      cooldown: [],
      description: `${session.title} is not programmed — you told the app you are not training in these days. Nothing has been moved into the days after.`,
      key: isKeySession(session),
      returnFromBreak: {
        lifeEventId,
        weekBack: step.back,
        volumePct: step.volumePct,
        intensityPct: step.intensityPct,
        originalDuration: session.duration_minutes ?? 0,
        dropped: true,
        originalTitle: session.title,
      },
    } satisfies PlanSessionLike;
  });

  return {
    week: {
      ...week,
      sessions,
      extraNote: weekNote(step),
      returnFromBreak: {
        lifeEventId,
        weekBack: step.back,
        volumePct: step.volumePct,
        intensityPct: step.intensityPct,
        focus: step.focus,
        sessions: sessions.filter((s) => !isRestDay(s)).length,
        dropped: droppedTitles.length,
        droppedTitles,
      },
    },
    snapshot,
    droppedTitles,
  };
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const WEEK_FOCUS_COPY: Record<ReturnFocus, { lead: string; ask: string }> = {
  rebuild: { lead: "This is a rebuild week", ask: "keep it comfortable" },
  restore: { lead: "Still rebuilding", ask: "a little more than last week" },
  resume: { lead: "Almost back", ask: "nearly your normal training" },
  compete: { lead: "Competition week", ask: "stay fresh rather than fit" },
  preload: { lead: "Loading week", ask: "bank a little extra before your break" },
  holiday: { lead: "Holiday week", ask: "easy movement only while you are away" },
  paused: { lead: "No training", ask: "nothing is programmed while you are away" },
};

/** The line the Training screen shows above the week. */
export function weekNote(step: ProgressionStep): string {
  const copy = WEEK_FOCUS_COPY[step.focus];
  if (step.focus === "preload") {
    return `${copy.lead} — about ${step.volumePct}% of your usual volume, ${copy.ask} at up to ${step.intensityPct}% intensity. Bank it now; the break does the resting.`;
  }
  if (step.focus === "holiday") {
    return `${copy.lead} — about ${step.volumePct}% of your usual volume, ${copy.ask} at up to ${step.intensityPct}% intensity. The fitness comes back after, not during.`;
  }
  if (step.focus === "paused") {
    return `${copy.lead} — you said you are not training in these days, so ${copy.ask}. Nothing has been moved into the days after, and your rebuild starts the week the break ends.`;
  }
  return `${copy.lead} — about ${step.volumePct}% of your usual volume, ${copy.ask} at up to ${step.intensityPct}% intensity. Nothing was moved from your break into this week.`;
}

/** A break named in a sentence: "a holiday", "an injury", "a personal break". */
function breakNoun(type: LifeEventType): string {
  switch (type) {
    case "holiday":
      return "a holiday";
    case "travel":
      return "travel";
    case "exams":
      return "your exams";
    case "competition":
      return "a competition";
    case "illness":
      return "illness";
    case "injury":
      return "an injury";
    case "wellbeing":
      return "a personal break";
    case "busy":
      return "a busy period";
    case "family":
      return "time with family";
    case "private":
    case "other":
    default:
      return "a break";
  }
}

const MEDICAL_NOTE =
  "This is a conservative rebuild, not a treatment plan. Follow your doctor's or physiotherapist's guidance, and stop if something hurts.";

const YOUTH_NOTE =
  "You are still developing, so this rebuild is deliberately gentle. Staying healthy matters more than getting back to full training quickly.";

/**
 * The "why has my plan changed?" sentence.
 *
 * One sentence, the break named once, and the reassurance in the same breath as
 * the change. The athlete did not do anything wrong, and the copy is written so
 * that reading it cannot produce the feeling that they did.
 */
export function rebuildExplanation(input: {
  facts: BreakFacts;
  steps: AdjustmentStep[];
  creditedDays: number;
  youth: boolean;
  medical: boolean;
  competingSoon: boolean;
}): string {
  const { facts, steps, creditedDays: credited, youth, medical, competingSoon } = input;
  const noun = breakNoun(facts.eventType);
  const weeks = steps.length;
  const range =
    facts.startDate === facts.endDate
      ? `on ${formatDay(facts.startDate)}`
      : `from ${formatDay(facts.startDate)} to ${formatDay(facts.endDate)}`;

  const parts: string[] = [];
  parts.push(
    `Your plan has been rebuilt because of ${noun} ${range}. We have rebuilt the next ` +
      `${weeks} week${weeks === 1 ? "" : "s"} around your most important sessions rather than trying to make up everything you missed.`,
  );

  if (steps.some((s) => s.focus === "preload")) {
    parts.push("The week before is loaded a little higher (about 110% of your usual volume) so you bank fitness going in.");
  }
  if (steps.some((s) => s.focus === "holiday")) {
    parts.push("The holiday week itself is eased right back to easy movement rather than left as normal training.");
  }
  if (steps.some((s) => s.focus === "paused")) {
    parts.push("The days you are not training are cleared out of your plan, so there is nothing sitting there asking to be made up.");
  }
  if (credited >= 1) {
    parts.push(
      `You kept training during some of it, so ${Math.floor(credited)} of those days ${Math.floor(credited) === 1 ? "is" : "are"} already accounted for.`,
    );
  }
  if (competingSoon) {
    parts.push("You have a competition in that window, so the week around it stays light and sharp rather than heavy.");
  }
  if (medical) parts.push(MEDICAL_NOTE);
  if (youth) parts.push(YOUTH_NOTE);

  return parts.join(" ");
}

/** `2026-10-05` → `5 Oct`. Duplicated from lifeEvents to keep this module free of that import. */
function formatDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1] ?? ""}`.trim();
}

// ---------------------------------------------------------------------------
// Putting it together
// ---------------------------------------------------------------------------

/** 1 = Monday … 7 = Sunday for a `YYYY-MM-DD` key. */
function dayOfWeek(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/**
 * Compute and apply the rebuild for one break.
 *
 * Returns the whole week list, so the caller writes one value rather than
 * splicing. The rules that decide *whether* to rebuild are all here:
 *
 *   • 1–3 days off changes nothing.
 *   • A week that has already finished is never rewritten, so a break logged
 *     after the fact cannot reach back into training the athlete did.
 *   • The same break is never applied twice.
 *   • A week with no playable sessions is left alone.
 */
export function planRebuild(input: RebuildInput): RebuildOutcome {
  const { weeks, weekStart, facts, existing = [], id, today } = input;
  const context = input.context ?? {};

  const alreadyApplied = existing.some((a) => a.kind === "return_from_break" && a.lifeEventId === facts.eventId);
  if (alreadyApplied) return { reason: "already-applied", adjustment: null, weeks: [...weeks] };

  const credited = creditedDays(facts, context);
  const effectiveDays = Math.max(0, facts.days - credited);
  const category = classifyBreak(effectiveDays);
  if (category === "none") return { reason: "break-too-short", adjustment: null, weeks: [...weeks] };

  // The window starts the day after the break ends. A break that ends mid-week
  // returns the athlete into that same week, which is right: the sessions
  // before the return were cancelled, so the week is already short.
  const firstDayBack = addDays(facts.endDate, 1);
  const earliest = weeks.length ? Math.min(...weeks.map((w) => w.week)) : null;
  if (earliest === null) return { reason: "no-remaining-weeks", adjustment: null, weeks: [...weeks] };

  // A plan that starts *after* the break is a return from a break, so week 1 is
  // already the first week back. Without this, the most relevant case of all —
  // an athlete whose season starts the week they come back — would fall through
  // as "nothing to do".
  let firstWeek = weekContaining(weeks, weekStart, firstDayBack);
  if (firstWeek === null && firstDayBack < weekStart(earliest)) firstWeek = earliest;
  if (firstWeek === null) return { reason: "no-remaining-weeks", adjustment: null, weeks: [...weeks] };

  // Weeks that have already finished are out of scope: a break entered after
  // the fact — "I was ill last week" — must not rewrite a week the athlete has
  // trained through. The return therefore begins at the later of the first week
  // back and the week today falls in, and when the plan has no week left at
  // all, the honest answer is that there is nothing left to rebuild.
  const pending = weeks
    .map((w) => w.week)
    .filter((n) => n >= firstWeek && addDays(weekStart(n), 6) >= today)
    .sort((a, b) => a - b);
  const startWeek = pending[0];
  if (startWeek === undefined) return { reason: "no-remaining-weeks", adjustment: null, weeks: [...weeks] };
  const lastWeek = pending[pending.length - 1];

  const steps = returnProgression(category, context);
  const youth = context.age !== null && context.age !== undefined && context.age < 18;
  const locked = new Set(input.locked ?? []);

  const applied: AdjustmentStep[] = [];
  const snapshots: SessionSnapshot[] = [];
  const rebuilt = new Map<number, PlanWeekLike>();

  const playableCount = (week: PlanWeekLike): number =>
    week.sessions.filter((s) => !isRestDay(s)).length;

  const recordStep = (
    week: PlanWeekLike,
    step: ProgressionStep & { weekNumber: number; fromDay?: number },
    result: { week: PlanWeekLike; snapshot: SessionSnapshot[]; droppedTitles: string[] },
  ): void => {
    rebuilt.set(step.weekNumber, result.week);
    snapshots.push(...result.snapshot);
    applied.push({
      week: step.weekNumber,
      back: step.back,
      volumePct: step.volumePct,
      intensityPct: step.intensityPct,
      focus: step.focus,
      sessions: result.week.sessions.filter((s) => !isRestDay(s)).length,
      dropped: result.droppedTitles.length,
      previousNote: typeof week.extraNote === "string" ? week.extraNote : undefined,
      previousTag: week.returnFromBreak,
    });
  };

  // A planned break reshapes the weeks around it, not just the ones after.
  // Someone on holiday in week 5 of 10 gets three things: the week before
  // loaded a little higher to bank fitness, the holiday week itself eased back
  // to easy movement, and the existing return progression climbing back after.
  // Only for breaks that can be seen coming (holiday, travel): preloading an
  // illness is nonsense advice, and rewriting the weeks inside a medical break
  // would fight the conservatism the progression applies to it.
  const shapesSurroundings =
    (facts.eventType === "holiday" || facts.eventType === "travel") && !context.medical;

  if (shapesSurroundings) {
    // The week before: about 10% more volume, banked while the athlete can
    // still train. Only when the week is still ahead of them — a week that has
    // already finished is history, and days already behind them inside the
    // current week stay exactly as they are.
    const preWeek = weekContaining(weeks, weekStart, addDays(facts.startDate, -1));
    if (preWeek !== null) {
      const week = weeks.find((w) => w.week === preWeek);
      const startKey = weekStart(preWeek);
      // The loading week has to still have days ahead of the athlete, not start
      // in the future. Requiring `startKey >= today` meant the loading week
      // could only ever fire when the break was recorded exactly on the Monday
      // a week out — a holiday entered on any other day got the eased (or
      // cancelled) holiday week and no loading week at all, which is the
      // "before it, you should probably get some hard work" half of the plan
      // silently never happening. `fromDay` below already limits the loading to
      // the days of that week that are still ahead, so a partly-elapsed week is
      // loaded only from today onwards. A week that has finished entirely is
      // still history and is still left alone.
      // Where the loading stops. When the break starts inside this same week
      // (a holiday beginning on the Wednesday, say), only the days before it
      // can be loaded — the ones after it belong to the break, and loading them
      // would be the app asking for harder training on a day it has just been
      // told the athlete is away.
      const breakWeek = weekContaining(weeks, weekStart, facts.startDate);
      const toDay = breakWeek === preWeek ? dayOfWeek(facts.startDate) - 1 : 7;
      const fromDay = today > startKey && today <= addDays(startKey, 6) ? dayOfWeek(today) : 1;
      if (
        week &&
        addDays(startKey, 6) >= today &&
        toDay >= fromDay &&
        playableCount(week) > 0 &&
        !rebuilt.has(preWeek)
      ) {
        const step = {
          back: 0,
          volumePct: 110,
          intensityPct: 100,
          focus: "preload" as ReturnFocus,
          weekNumber: preWeek,
          fromDay,
          toDay,
        };
        const result = rebuildWeek(week, step, facts.eventId, locked);
        if (result.snapshot.length) recordStep(week, step, result);
      }
    }

    // The weeks the break falls in. What happens to them turns on the one
    // answer that actually changes the plan: whether the athlete is training.
    //
    //   • "no" — the week is emptied. This used to be skipped on the grounds
    //     that the availability layer had already cancelled those sessions,
    //     and that rewriting them "would destroy the record of what was
    //     planned". Both halves of that were wrong. The cancellation is a
    //     record, not a change: the plan itself still read as a normal week of
    //     training, so an athlete who said "no training" opened their plan and
    //     found five sessions waiting to be made up. And the record is not
    //     destroyed by the rewrite — every session is snapshotted first and
    //     `undoAdjustment` puts it back exactly.
    //
    //   • "optional" — eased back to easy movement, so opening the plan
    //     mid-holiday shows sessions that are actually doable.
    //
    //   • "yes" — left alone. An athlete training through their holiday has
    //     not been away; the loading week before and the ramp after are still
    //     theirs, but nothing about their own week is second-guessed.
    if (facts.allowTraining !== "yes") {
      const paused = facts.allowTraining === "no";
      for (const week of weeks) {
        const startKey = weekStart(week.week);
        const endKey = addDays(startKey, 6);
        if (endKey < facts.startDate || startKey > facts.endDate) continue;
        if (endKey < today) continue;
        // Which days of this week the break actually covers. A break that
        // starts or ends mid-week must not reach past it: the days before it
        // are the athlete's own training (and the loading step may already have
        // banked them), and the days after it are the return, which is rebuilt
        // by the progression below on top of whatever is left here.
        const fromDay = Math.max(
          dayOfWeek(facts.startDate > startKey ? facts.startDate : startKey),
          today > startKey ? dayOfWeek(today) : 1,
        );
        const toDay = dayOfWeek(facts.endDate < endKey ? facts.endDate : endKey);
        if (toDay < fromDay) continue;
        // A week the loading step above already rewrote is the base here, so
        // the banked days before a mid-week break and the break's own days
        // compose rather than one of them overwriting the other.
        const base = rebuilt.get(week.week) ?? week;
        if (playableCount(base) === 0) continue;
        const step = paused
          ? { back: 0, volumePct: 0, intensityPct: 0, focus: "paused" as ReturnFocus, weekNumber: week.week, fromDay, toDay }
          : { back: 0, volumePct: 50, intensityPct: 60, focus: "holiday" as ReturnFocus, weekNumber: week.week, fromDay, toDay };
        const result = paused
          ? clearWeek(base, step, facts.eventId, locked)
          : rebuildWeek(base, step, facts.eventId, locked);
        // Recorded against the *original* week, exactly as the return loop
        // below does: the note and tag undo has to restore are the ones this
        // week had before anything in this run touched it.
        if (result.snapshot.length) recordStep(week, step, result);
      }
    }
  }

  /**
   * The week of a competition, which is a taper rather than a rebuild.
   *
   * Arriving fresh is the only thing left to optimise, so volume drops to half
   * or less of the step and intensity stays high. The one exception is a break
   * that was illness or injury: a competition reshapes the week, but it does
   * not talk an athlete recovering from a broken bone into sharpening work the
   * progression had already taken away from them.
   */
  const competeWeek = (step: ProgressionStep, medical: boolean) => ({
    volumePct: Math.min(step.volumePct, 50),
    intensityPct: medical ? Math.min(90, Math.max(step.intensityPct, 60)) : 90,
  });

  // Competitions inside the window. The week around one is a taper, not a
  // rebuild: arriving fresh is the only thing left to optimise, and volume at
  // 50% with intensity kept high is how that is done. The rest of the
  // progression is unchanged, so the rebuild resumes after the event.
  const competitions = input.competitions ?? [];
  const windowStart = weekStart(startWeek);
  const windowEnd = addDays(weekStart(lastWeek), 6);
  const windowCompetitions = competitions.filter((c) => c.date >= windowStart && c.date <= windowEnd);
  const competingSoon = windowCompetitions.length > 0;
  const competitionWeek = competingSoon
    ? weekContaining(weeks, weekStart, windowCompetitions[0].date)
    : null;

  // The steps are consumed one per week, but only by a week that can take one.
  //
  // A 4-day break ending on a Saturday returns the athlete on the Sunday — the
  // last day of that plan week — so the week it "returns into" has nothing
  // ahead of them to rebuild, and every session in it is either behind them or
  // a rest day. The older code dropped the step along with that week, which
  // quietly turned the entire return progression into nothing: no rebuild week,
  // no ramp, straight back to full volume the following Monday. Carrying the
  // step forward to the first week with room is what makes the ramp exist.
  let nextStep = 0;
  for (const weekNumber of pending) {
    if (nextStep >= steps.length) break;
    const step = steps[nextStep];
    const original = weeks.find((w) => w.week === weekNumber);
    if (!original) continue;
    // A week the loading step above already rebuilt is the base here, so the
    // ramp composes with it rather than overwriting it. It can be the same
    // week: a break that both starts and ends mid-week has its pre-break days
    // loaded and its post-return days rebuilt inside one plan week. The record
    // still names the original week as what it replaced, because that is what
    // undo has to restore.
    const week = rebuilt.get(weekNumber) ?? original;
    if (playableCount(week) === 0) continue;

    // A break that ends on, say, Wednesday returns the athlete into that same
    // week. Monday to Wednesday are already behind them — some of them
    // cancelled by the break, some possibly trained — so the rebuild starts at
    // Thursday and leaves the earlier days exactly as they are.
    const weekStartKey = weekStart(weekNumber);
    const weekEndKey = addDays(weekStartKey, 6);
    const fromDay =
      firstDayBack > weekStartKey && firstDayBack <= weekEndKey ? dayOfWeek(firstDayBack) : 1;


    const isCompetitionWeek = weekNumber === competitionWeek;
    const effectiveStep = {
      ...step,
      weekNumber,
      fromDay,
      ...(isCompetitionWeek ? { ...competeWeek(step, !!context.medical), focus: "compete" as ReturnFocus } : {}),
    };

    const result = rebuildWeek(week, effectiveStep, facts.eventId, locked);
    // A step that could not change anything — every session in the week either
    // still ahead of the athlete is locked, or already behind them — is not
    // recorded. Writing a note that says "about 70% of your usual volume" onto
    // a week nothing was scaled in would be the app describing a change it did
    // not make. The step is not spent either: it moves to the next week that
    // can take it.
    if (!result.snapshot.length) continue;
    recordStep(original, effectiveStep, result);
    nextStep += 1;
  }

  // Pre-break and in-break steps are recorded before the return progression
  // above; chronological order is what every reader expects.
  applied.sort((a, b) => a.week - b.week);

  if (!applied.length) return { reason: "nothing-planned", adjustment: null, weeks: [...weeks] };

  const adjustment: PlanAdjustmentRecord = {
    id,
    kind: "return_from_break",
    lifeEventId: facts.eventId,
    createdAt: today,
    break: {
      startDate: facts.startDate,
      endDate: facts.endDate,
      days: facts.days,
      eventType: facts.eventType,
      activityLevel: facts.activityLevel,
    },
    creditedDays: Math.round(credited * 10) / 10,
    steps: applied,
    headline: `Rebuilt for ${breakNoun(facts.eventType)}`,
    explanation: rebuildExplanation({
      facts,
      steps: applied,
      creditedDays: credited,
      youth,
      medical: !!context.medical,
      competingSoon,
    }),
    medicalNote: context.medical ? MEDICAL_NOTE : null,
    competingSoon,
    before: snapshots,
  };

  return {
    reason: "applied",
    adjustment,
    weeks: weeks.map((w) => rebuilt.get(w.week) ?? w),
  };
}

/**
 * Undo one rebuild, exactly.
 *
 * Restores the sessions from the record's own snapshot and removes the record.
 * Deliberately does not "work out" the original values: the athlete has had the
 * rebuilt plan in front of them, and may have edited durations in the meantime.
 * Restoring the copy is the only version of undo that is actually a restore.
 */
export function undoAdjustment(
  weeks: readonly PlanWeekLike[],
  record: PlanAdjustmentRecord,
): { weeks: PlanWeekLike[]; removed: boolean } {
  const byWeek = new Map<number, Map<number, PlanSessionLike>>();
  for (const snap of record.before) {
    if (!byWeek.has(snap.week)) byWeek.set(snap.week, new Map());
    byWeek.get(snap.week)!.set(snap.session.day, snap.session);
  }
  const previousNotes = new Map<number, string | undefined>();
  const previousTags = new Map<number, ReturnWeekMeta | undefined>();
  for (const step of record.steps) {
    previousNotes.set(step.week, step.previousNote);
    previousTags.set(step.week, step.previousTag);
  }

  let removed = false;
  const next = weeks.map((week) => {
    const restore = byWeek.get(week.week);
    if (!restore) return week;
    removed = true;
    const sessions = week.sessions.map((s) => restore.get(s.day) ?? s);
    // The week's own note and tag go back to whatever the week said before this
    // rebuild — which is usually nothing, but not always: a second break can
    // land inside the first rebuild's window, and undoing it must put the first
    // one's tag back rather than deleting a tag it did not write. Anything else
    // on the week is left alone, because the rebuild did not put it there.
    return {
      ...week,
      sessions,
      extraNote: previousNotes.get(week.week),
      returnFromBreak: previousTags.get(week.week),
    } as PlanWeekLike;
  });

  return { weeks: next, removed };
}

/** Narrow whatever `plan_adjustments` holds into the records this module wrote. */
export function activeAdjustments(value: unknown): PlanAdjustmentRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (a): a is PlanAdjustmentRecord =>
      !!a &&
      typeof a === "object" &&
      (a as PlanAdjustmentRecord).kind === "return_from_break" &&
      typeof (a as PlanAdjustmentRecord).lifeEventId === "string" &&
      Array.isArray((a as PlanAdjustmentRecord).before),
  );
}

/** The rebuild covering a plan week, for the tag on the week header. */
export function adjustmentForWeek(
  adjustments: readonly PlanAdjustmentRecord[],
  week: number,
): { record: PlanAdjustmentRecord; step: AdjustmentStep } | null {
  for (const record of adjustments) {
    const step = record.steps.find((s) => s.week === week);
    if (step) return { record, step };
  }
  return null;
}
