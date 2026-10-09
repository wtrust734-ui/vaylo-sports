// ============================================================================
// LIFE EVENTS & AVAILABILITY
// ----------------------------------------------------------------------------
// The athlete's life is part of the training plan, not an interruption to it.
// Exams, travel, illness and a deliberate break are all normal parts of a
// season; the product failure is to pretend the planned session still happened
// and then call the athlete inconsistent for missing it.
//
// This module is the decision layer. It is deliberately pure — no Supabase, no
// React — because every rule here needs to be testable without a database and
// reused by the calendar UI, the weekly analytics and (later) the re-planner.
//
// Three rules shape everything below, and they are absolute:
//
//   1. HISTORY IS IMMUTABLE. Only a session that is still `planned` can be
//      changed by a life event. A `completed` session is a record of something
//      the athlete actually did, and no break may rewrite it — not to cancel
//      it, not to move it, not to "adjust" it. `src/lib/lifeEvents.test.ts`
//      asserts this directly rather than trusting the caller.
//
//   2. NOTHING IS AUTO-MOVED. A lost session is marked lost. It is never
//      stacked into the following days. Cramming two weeks of missed work into
//      the week after a holiday is how a training app injures someone, and it
//      is the specific behaviour this phase exists to refuse. Rescheduling is
//      an explicit athlete action that records where the session came from;
//      it is never something that happens *to* them.
//
//   3. A BREAK IS NOT A FAILURE. Cancelled and rescheduled sessions are
//      removed from the completion denominator rather than counted as misses.
//      See `countsTowardCompletion` — the completion figures behind the
//      insights read this, and before it existed a two-week holiday read as
//      fourteen failures (the weekly-summary denominator bug).
//
// On safeguarding: Vaylo is a sports-performance product. It does not
// diagnose, assess or screen for mental or physical illness, and nothing in
// this file claims to. Where a note suggests an athlete may be struggling, the
// response is a non-diagnostic message pointing at a trusted adult or a
// qualified professional — never an assessment, a score, or advice. The
// keyword net below is a safety affordance with known false negatives, which
// is exactly why the supportive message is also offered without one.
// ============================================================================

import { localDateKey } from "./dates";
// Type-only, and one-way: the projection knows nothing about availability
// rules, and this module borrows only its shape. Erased at build time.
import type { DatedSession } from "./planSchedule";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The reasons an athlete can be away.
 *
 * Closed on purpose: the database has a matching CHECK, so a type the UI has
 * no word for cannot exist. `private` and `personal` exist so an athlete never
 * has to explain themselves to keep their calendar honest.
 */
export type LifeEventType =
  | "holiday"
  | "travel"
  | "exams"
  | "competition"
  | "illness"
  | "injury"
  | "wellbeing"
  | "busy"
  | "family"
  | "other"
  | "private";

/** How much movement the period is expected to involve. */
export type ActivityLevel = "none" | "light" | "normal" | "unknown";

/** Whether training is wanted during the period. */
export type AllowTraining = "yes" | "no" | "optional";

/**
 * Session statuses. Extends the original four (planned / completed / skipped /
 * rescheduled) with the four the adaptive calendar needs; the database CHECK
 * lists exactly these.
 */
export type SessionStatus =
  | "planned"
  | "completed"
  | "modified"
  | "rescheduled"
  | "skipped"
  | "cancelled_due_to_availability"
  | "replaced"
  | "rest";

/** A stored life event, as `public.life_events` holds it. */
export interface LifeEvent {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  event_type: LifeEventType;
  activity_level: ActivityLevel;
  allow_training: AllowTraining;
  note: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * The subset of a planned session this module reasons about.
 *
 * Kept structurally small rather than importing the Supabase row type: the
 * session grid also exists as `plan_data` JSON, and both representations must
 * be able to feed the same rules.
 */
export interface PlannedSession {
  id: string;
  /** Local calendar day, `YYYY-MM-DD`. */
  scheduled_date: string;
  title: string;
  status?: SessionStatus;
  /**
   * True for a programmed rest or recovery day.
   *
   * `status: "rest"` says the same thing once a row exists, but a session can
   * also be a rest day before anything has been written down — which is the
   * normal case, because the plan itself is JSON. The exemption must hold in
   * both shapes, so the flag is carried separately from the status.
   */
  is_rest?: boolean;
  /** Key-workout flag. A lost key session is what a re-planner must see. */
  important?: boolean;
  life_event_id?: string | null;
  original_scheduled_date?: string | null;
}

/**
 * A projected session as the rules read it.
 *
 * The projection (`plan_data` → real dates) and the record (`plan_events` →
 * statuses) are two different shapes, and every caller that needs to ask "what
 * does this break do?" needs both joined the same way. Doing that join here,
 * once, is what stops the screen and the write path from disagreeing about
 * which sessions a holiday actually covers.
 *
 * @param recorded the `plan_events` row for this session, when one exists.
 */
export function asPlannedSession(
  session: DatedSession,
  recorded?: { id: string; status: SessionStatus } | null,
): PlannedSession {
  return {
    id: recorded?.id ?? session.id,
    scheduled_date: session.scheduled_date,
    title: session.title,
    status: recorded?.status ?? "planned",
    is_rest: session.isRest,
    important: session.important,
  };
}

interface TypeDefinition {
  id: LifeEventType;
  label: string;
  /** One line, shown under the option. Never asks for detail. */
  hint: string;
  /** lucide-react icon name, resolved by the screen. */
  icon: string;
  /** Pre-selected when this type is chosen; the athlete can always change it. */
  defaultAllowTraining: AllowTraining;
  defaultActivity: ActivityLevel;
  /**
   * True for types where the athlete may be in a difficult place and the copy
   * must never imply they owe an explanation or a training commitment.
   */
  sensitive?: boolean;
}

/**
 * The catalogue. Order is meaning: the common, low-stakes reasons first, so
 * the form does not open on the heaviest option available.
 */
export const LIFE_EVENT_TYPES: readonly TypeDefinition[] = [
  {
    id: "holiday",
    label: "Holiday",
    hint: "Away, resting or just not training",
    icon: "Plane",
    defaultAllowTraining: "optional",
    defaultActivity: "light",
  },
  {
    id: "busy",
    label: "Busy period",
    hint: "Work, deadlines or a packed schedule",
    icon: "CalendarClock",
    defaultAllowTraining: "optional",
    defaultActivity: "light",
  },
  {
    id: "travel",
    label: "Travel",
    hint: "Travelling, with or without training",
    icon: "Luggage",
    defaultAllowTraining: "optional",
    defaultActivity: "light",
  },
  {
    id: "exams",
    label: "School / exams",
    hint: "Study and exam time takes priority",
    icon: "GraduationCap",
    defaultAllowTraining: "optional",
    defaultActivity: "light",
  },
  {
    id: "competition",
    label: "Competition / event",
    hint: "You are competing, not training",
    icon: "Trophy",
    defaultAllowTraining: "yes",
    defaultActivity: "normal",
  },
  {
    id: "family",
    label: "Family / personal",
    hint: "Something personal that needs your time",
    icon: "Users",
    defaultAllowTraining: "optional",
    defaultActivity: "unknown",
  },
  {
    id: "illness",
    label: "Illness",
    hint: "Unwell — rest first",
    icon: "Thermometer",
    defaultAllowTraining: "no",
    defaultActivity: "none",
    sensitive: true,
  },
  {
    id: "injury",
    label: "Injury / recovery",
    hint: "Managing an injury or a niggle",
    icon: "Bandage",
    defaultAllowTraining: "no",
    defaultActivity: "none",
    sensitive: true,
  },
  {
    id: "wellbeing",
    label: "Mental wellbeing / personal break",
    hint: "A pause, for any reason or none",
    icon: "HeartHandshake",
    defaultAllowTraining: "optional",
    defaultActivity: "unknown",
    sensitive: true,
  },
  {
    id: "other",
    label: "Other",
    hint: "Anything not listed",
    icon: "CircleEllipsis",
    defaultAllowTraining: "optional",
    defaultActivity: "unknown",
  },
  {
    id: "private",
    label: "Private / no reason",
    hint: "Nothing recorded but the dates",
    icon: "Lock",
    defaultAllowTraining: "optional",
    defaultActivity: "unknown",
    sensitive: true,
  },
];

export const lifeEventType = (id: LifeEventType): TypeDefinition =>
  LIFE_EVENT_TYPES.find((t) => t.id === id) ?? LIFE_EVENT_TYPES[LIFE_EVENT_TYPES.length - 1];

export const ACTIVITY_LEVELS: readonly { id: ActivityLevel; label: string }[] = [
  { id: "none", label: "No activity" },
  { id: "light", label: "Light" },
  { id: "normal", label: "Normal" },
  { id: "unknown", label: "Not sure yet" },
];

export const ALLOW_TRAINING_OPTIONS: readonly {
  id: AllowTraining;
  label: string;
  hint: string;
}[] = [
  { id: "optional", label: "Optional", hint: "Keep my sessions — I'll train if I can" },
  { id: "no", label: "No training", hint: "Pause my sessions for these dates" },
  { id: "yes", label: "Yes, keep training", hint: "I'm away but still training" },
];

/** UI copy and a tone per status. The tone drives colour, never the wording. */
export const SESSION_STATUS_META: Record<
  SessionStatus,
  { label: string; tone: "neutral" | "good" | "info" | "muted"; detail: string }
> = {
  planned: {
    label: "Planned",
    tone: "neutral",
    detail: "Scheduled and not yet done.",
  },
  completed: {
    label: "Completed",
    tone: "good",
    detail: "Logged. This is a historical record and never changes.",
  },
  modified: {
    label: "Modified",
    tone: "good",
    detail: "Done, but not exactly as written.",
  },
  rescheduled: {
    label: "Rescheduled",
    tone: "info",
    detail: "Moved to another day by you.",
  },
  skipped: {
    label: "Skipped",
    tone: "muted",
    detail: "Not done, and no availability change explains it.",
  },
  cancelled_due_to_availability: {
    label: "Cancelled — you were unavailable",
    tone: "info",
    detail: "Removed because of a break you recorded. Not counted against you.",
  },
  replaced: {
    label: "Replaced",
    tone: "info",
    detail: "A different session took its place.",
  },
  rest: {
    label: "Rest",
    tone: "neutral",
    detail: "Rest is programmed, not missed.",
  },
};

export const sessionStatusMeta = (status: SessionStatus | undefined) =>
  SESSION_STATUS_META[status ?? "planned"];

// ---------------------------------------------------------------------------
// Completion semantics — the fix for "a break is not a failure"
// ---------------------------------------------------------------------------

/**
 * Statuses that must never be counted as a missed session.
 *
 * `skipped` is deliberately NOT in this set. An athlete choosing to skip is
 * real information about adherence and belongs in the denominator; a session
 * cancelled because the calendar said they were on holiday is not.
 */
const NOT_A_FAILURE: readonly SessionStatus[] = [
  "cancelled_due_to_availability",
  "rescheduled",
  "replaced",
  "rest",
];

/** True when a status represents something the athlete was asked to do and did not. */
export const isFailure = (status: SessionStatus | undefined): boolean => {
  const s = status ?? "planned";
  if (NOT_A_FAILURE.includes(s)) return false;
  return s !== "completed" && s !== "modified";
};

/** True when a status represents completed work (used for the numerator). */
export const isDone = (status: SessionStatus | undefined): boolean => {
  const s = status ?? "planned";
  return s === "completed" || s === "modified";
};

/**
 * Whether this session belongs in a completion percentage at all.
 *
 * Two ways a session leaves the denominator:
 *   • its status says a life event removed it (`cancelled_due_to_availability`,
 *     `rescheduled`, `replaced`), or
 *   • it sits inside a recorded availability window that does not ask for
 *     training. An `optional` window is the case a status alone cannot express:
 *     the athlete explicitly said they *might* train, so the session is not
 *     cancelled — but it is also not something to hold against them.
 *
 * `strict` windows (`allow_training: "no"`) are normally already reflected in
 * the status; passing the events here as well makes the calculation correct
 * even before the status write has synced.
 */
export function countsTowardCompletion(
  session: PlannedSession,
  events: readonly LifeEvent[] = [],
): boolean {
  const status = session.status ?? "planned";
  if (status === "rest") return false;
  if (status === "cancelled_due_to_availability") return false;
  if (status === "rescheduled") return false;
  if (status === "replaced") return false;
  if (status === "completed" || status === "modified") return true;

  // Still `planned`: excluded when the date falls inside a window where
  // training was not wanted.
  return !isInsideAvailabilityWindow(session.scheduled_date, events);
}

/**
 * True when the date is inside a window whose `allow_training` is not "yes".
 *
 * "yes" is excluded because an athlete who is away and still training wants
 * those sessions counted normally — that is the whole point of the answer.
 */
export function isInsideAvailabilityWindow(
  date: string,
  events: readonly LifeEvent[],
): boolean {
  return events.some(
    (e) => e.allow_training !== "yes" && coversDate(e, date),
  );
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Local calendar day for a Date, or pass-through for a `YYYY-MM-DD` string. */
export const dayKey = (value: Date | string): string =>
  typeof value === "string" ? value.slice(0, 10) : localDateKey(value);

/** True when `date` falls on or between the event's start and end (inclusive). */
export const coversDate = (event: Pick<LifeEvent, "start_date" | "end_date">, date: string): boolean => {
  const day = dayKey(date);
  return day >= event.start_date && day <= event.end_date;
};

/** Inclusive length in days. A one-day break is 1. */
export function spanDays(start: string, end: string): number {
  const a = new Date(`${dayKey(start)}T00:00:00`);
  const b = new Date(`${dayKey(end)}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000)) + 1;
}

/** True when two date ranges share at least one day. */
export const rangesOverlap = (
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean => dayKey(aStart) <= dayKey(bEnd) && dayKey(bStart) <= dayKey(aEnd);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "5 Oct" / "5 Oct 2027", local, no locale-dependent surprises. */
export function formatDay(date: string): string {
  const d = new Date(`${dayKey(date)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  const thisYear = new Date().getFullYear();
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === thisYear ? base : `${base} ${d.getFullYear()}`;
}

/** "5 Oct – 12 Oct", or a single day when the break is one day. */
export function formatPeriod(start: string, end: string): string {
  if (dayKey(start) === dayKey(end)) return formatDay(start);
  return `${formatDay(start)} – ${formatDay(end)}`;
}

/** "a holiday", "an exam period" — for the explanation sentence. */
function periodNoun(type: LifeEventType): string {
  switch (type) {
    case "holiday":
      return "a holiday";
    case "travel":
      return "travel";
    case "exams":
      return "an exam period";
    case "competition":
      return "a competition";
    case "illness":
      return "illness";
    case "injury":
      return "an injury or recovery period";
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

// ---------------------------------------------------------------------------
// Safety — non-diagnostic, and explicit about what it is
// ---------------------------------------------------------------------------

/**
 * Phrases that may indicate an athlete is struggling.
 *
 * This is a safety net, NOT a detector, and the distinction matters: it will
 * miss things, it will fire on things that are fine, and it must never be
 * presented to the athlete — or described internally — as an assessment. Its
 * only job is to make sure that when someone types something like this into a
 * note field, the app answers with a human direction rather than silence.
 *
 * Matched case-insensitively on word stems. Kept short and blunt rather than
 * clever, so its behaviour is obvious to whoever reads it next.
 */
const WELLBEING_SIGNALS: readonly string[] = [
  "self harm",
  "self-harm",
  "suicid",
  "kill myself",
  "end my life",
  "hurt myself",
  "eating disorder",
  "not eating",
  "starving",
  "starve myself",
  "can't cope",
  "cant cope",
  "cannot cope",
  "hopeless",
  "worthless",
  "depress",
  "panic attack",
  "anxiety attack",
  "abused",
  "abuse",
  "bullied",
  "bullying",
  "afraid of",
  "scared of",
  "hate myself",
];

/**
 * Whether a note contains a phrase worth responding to.
 *
 * Exported so the UI and its tests agree on one definition. Returns false for
 * an empty note — an athlete who chooses "private" is not asked to tell us
 * anything, and treating silence as a signal would be the opposite of safe.
 */
export function mentionsWellbeingConcern(note: string | null | undefined): boolean {
  if (!note) return false;
  const haystack = note.toLowerCase();
  return WELLBEING_SIGNALS.some((s) => haystack.includes(s));
}

export interface SafetyNotice {
  /** Short heading. Never a diagnosis, never a label. */
  title: string;
  body: string;
  /** Optional action line, e.g. "Talk to a trusted adult". */
  action: string;
  /** `support` is the standing message; `concern` is the escalation. */
  level: "support" | "concern";
}

/**
 * The message shown for a life event, or null when none is warranted.
 *
 * Two levels:
 *   • `support` — shown for the sensitive types unconditionally (a personal
 *     break, an injury, an illness). Says plainly that stopping is allowed and
 *     that nothing needs explaining. This is the message that exists precisely
 *     because keyword matching cannot be relied on.
 *   • `concern` — shown in addition when a note suggests the athlete may be
 *     having a hard time. It points at people, not at a diagnosis, and it says
 *     out loud that the app cannot assess this.
 *
 * Both levels use the same words for every age: pointing at a person rather than
 * at a diagnosis is correct whatever the athlete's age, and a different, heavier
 * message for a younger account would be a worse experience and a worse
 * safeguard.
 */
export function safetyNotice(event: {
  event_type: LifeEventType;
  note?: string | null;
}): SafetyNotice | null {
  const type = lifeEventType(event.event_type);

  if (mentionsWellbeingConcern(event.note)) {
    return {
      level: "concern",
      title: "If things are tough right now",
      body:
        "Vaylo can't assess how you're doing, and it isn't trying to — this is a training app, not a health service. What you wrote sounds like it might be bigger than training.",
      action:
        "Talking to someone you trust usually helps more than any plan: a coach, a doctor, or someone close to you — a parent or carer, a friend, a school counsellor. If you're in immediate danger, contact your local emergency number.",
    };
  }

  // `private` and `other` are here for the same reason as `wellbeing`: these
  // are the three options an athlete picks precisely BECAUSE they do not want
  // to categorise it. Answering that choice with silence would make the
  // no-reason options feel like the wrong answer.
  if (type.id === "wellbeing" || type.id === "private" || type.id === "other") {
    return {
      level: "support",
      title: "A break is part of training",
      body:
        "Nothing here needs a reason, and nothing is counted against you. Rest, recovery and time away are how athletes stay in the sport long enough to get good at it.",
      action:
        "If something is weighing on you, a coach, a doctor or someone close to you is a better place for it than a training plan.",
    };
  }

  if (type.id === "illness" || type.id === "injury") {
    return {
      level: "support",
      title: "Rest first, and let a professional guide the return",
      body:
        "Vaylo doesn't diagnose injuries or illness and can't tell you when you're ready. Recording the time away only stops the plan from asking for sessions you shouldn't be doing.",
      action:
        "If it's more than a niggle, or it isn't settling, see a doctor or physiotherapist before you build back up.",
    };
  }

  return null;
}

/**
 * The standing message for an under-18 account recording a break.
 *
 * Deliberately about permission, not protection. The most common reason an
 * athlete of any age trains through a break is the feeling that stopping is a
 * failure, and the useful product response is to remove that pressure in plain
 * words. Shown only to under-18s, because that is where the age-specific
 * pressure lands — the wording itself is age-neutral.
 */
export const YOUTH_BREAK_NOTE =
  "Taking time away is normal, and it doesn't undo your training. A developing athlete improves fastest when rest is planned, not fought.";

// ---------------------------------------------------------------------------
// The allocator — what a life event does to a plan
// ---------------------------------------------------------------------------

export interface SessionAdjustment {
  sessionId: string;
  scheduled_date: string;
  title: string;
  /** The status to write. `planned` means the session is left alone. */
  status: SessionStatus;
  lifeEventId: string | null;
  /** Machine-readable, for the explanation and for later analytics. */
  reason: "unavailable" | "optional_window" | "unchanged";
  /** True when this was a key session. The re-planner keys off this. */
  important: boolean;
}

export interface AvailabilityAssessment {
  /** Every session the event touches, including the untouched ones. */
  adjustments: SessionAdjustment[];
  /** Sessions that were cancelled outright — the real losses. */
  cancelled: SessionAdjustment[];
  /** Lost sessions carrying the key-workout flag. */
  lostKeySessions: SessionAdjustment[];
  /** One sentence naming what happened, or null when nothing changed. */
  explanation: string | null;
}

/**
 * Works out what a single life event does to a set of planned sessions.
 *
 * This is the load-bearing function of the phase. Its guarantees:
 *
 *   • Only `planned` sessions can change. Anything completed, modified,
 *     skipped, replaced or already tied to a life event is returned with
 *     `unchanged` and is never written.
 *   • Rest days are never cancelled. A rest day inside a holiday is still a
 *     rest day, and counting it as a loss would inflate every "sessions lost"
 *     number with programmed rest.
 *   • `allow_training: "yes"` changes nothing. Training is still wanted.
 *   • `allow_training: "optional"` cancels nothing. The session stays planned
 *     and is excluded from the completion denominator by
 *     `countsTowardCompletion`, because the athlete said "if I can".
 *   • `allow_training: "no"` cancels. The session becomes
 *     `cancelled_due_to_availability` and is linked to the event.
 *   • Nothing is moved. No session's `scheduled_date` is ever changed here.
 *
 * A session that a *different* event already cancelled is not touched again:
 * the first event to claim it owns the explanation, which keeps "What changed?"
 * pointing at one cause instead of two.
 */
export function assessAvailability(
  sessions: readonly PlannedSession[],
  event: LifeEvent,
  eventsInScope: readonly LifeEvent[] = [event],
): AvailabilityAssessment {
  const adjustments: SessionAdjustment[] = [];

  for (const session of sessions) {
    const status = session.status ?? "planned";
    const unchanged: SessionAdjustment = {
      sessionId: session.id,
      scheduled_date: session.scheduled_date,
      title: session.title,
      status,
      lifeEventId: session.life_event_id ?? null,
      reason: "unchanged",
      important: !!session.important,
    };

    // Rule 1: only a session that is still `planned` may change.
    if (status !== "planned") {
      adjustments.push(unchanged);
      continue;
    }

    // The rest-day exemption, and it has to be asked of the session rather
    // than the status. A rest day projected out of `plan_data` arrives as a
    // plain planned session with `is_rest` set — nothing has written a status
    // for it yet — so testing the status alone would let a holiday cancel the
    // programmed rest inside it and inflate every "sessions lost" count with
    // days that were never going to be training.
    if (session.is_rest) {
      adjustments.push({ ...unchanged, status: "rest" });
      continue;
    }
    if (!coversDate(event, session.scheduled_date)) {
      adjustments.push(unchanged);
      continue;
    }
    if (session.life_event_id && session.life_event_id !== event.id) {
      adjustments.push(unchanged);
      continue;
    }

    if (event.allow_training === "yes") {
      adjustments.push(unchanged);
      continue;
    }

    if (event.allow_training === "optional") {
      adjustments.push({
        ...unchanged,
        reason: "optional_window",
      });
      continue;
    }

    // allow_training === "no"
    adjustments.push({
      ...unchanged,
      status: "cancelled_due_to_availability",
      lifeEventId: event.id,
      reason: "unavailable",
    });
  }

  const cancelled = adjustments.filter((a) => a.status === "cancelled_due_to_availability");

  void eventsInScope; // reserved: overlap-aware explanations in a later phase

  return {
    adjustments,
    cancelled,
    lostKeySessions: cancelled.filter((a) => a.important),
    explanation: explanationFor(event, cancelled.length, eventsInScope),
  };
}

/**
 * The "What changed?" sentence.
 *
 * Names the period and how many sessions it touched. Deliberately does not
 * name the reason beyond the type the athlete chose, and never scolds: the
 * spec's example is the model, and it is information, not a reprimand.
 */
export function explanationFor(
  event: LifeEvent,
  cancelledCount: number,
  _eventsInScope: readonly LifeEvent[] = [event],
): string | null {
  if (cancelledCount === 0) {
    // An optional or "yes" window still deserves to be visible — it is context
    // for the dates, just not a change.
    return event.allow_training === "optional"
      ? `These dates are marked ${periodNoun(event.event_type)} ${windowFor(event)}. Nothing was removed — your sessions are there if you want them.`
      : null;
  }
  const noun = periodNoun(event.event_type);
  // Number agreement is not decoration here. The sentence is shown to an
  // athlete right after a break they may not have wanted to take, and "These 1
  // session were adjusted" reads like a form letter from a system that was not
  // paying attention to them. A single-day break also reads "on the 14th"
  // rather than "from the 14th", which is the difference between a sentence
  // and a fragment.
  const one = cancelledCount === 1;
  const lead = one ? "1 session was adjusted" : `These ${cancelledCount} sessions were adjusted`;
  const tail = one
    ? "It is not counted as missed, and nothing has been moved into your next week."
    : "They are not counted as missed, and nothing has been moved into your next week.";
  return `${lead} because you added ${noun} ${windowFor(event)}. ${tail}`;
}

/**
 * How a period is named inside a sentence: one day is "on 14 Oct", a range is
 * "from 14 Oct – 20 Oct". "from 14 Oct" for a single date reads as though half
 * the sentence is missing.
 */
function windowFor(event: LifeEvent): string {
  return event.start_date === event.end_date
    ? `on ${formatDay(event.start_date)}`
    : `from ${formatPeriod(event.start_date, event.end_date)}`;
}

/**
 * The sentence for a session, used by the detail view on tap.
 *
 * Progressive disclosure: the calendar shows a status chip first; this is what
 * it says when the athlete asks why.
 */
export function sessionExplanation(
  session: PlannedSession,
  events: readonly LifeEvent[],
): string | null {
  const status = session.status ?? "planned";
  const meta = sessionStatusMeta(status);

  if (status === "cancelled_due_to_availability" || status === "rescheduled") {
    const owner = events.find((e) => e.id === session.life_event_id);
    if (owner) {
      return `${meta.detail} Cause: ${periodNoun(owner.event_type)} from ${formatPeriod(owner.start_date, owner.end_date)}.`;
    }
  }
  if (
    status === "planned" &&
    isInsideAvailabilityWindow(session.scheduled_date, events)
  ) {
    return "You marked these dates as optional training, so this session is not counted against you if you miss it.";
  }
  if (status === "rescheduled" && session.original_scheduled_date) {
    return `${meta.detail} Moved from ${formatDay(session.original_scheduled_date)} to ${formatDay(session.scheduled_date)}.`;
  }
  return status === "planned" || status === "completed" ? null : meta.detail;
}

// ---------------------------------------------------------------------------
// Ordering and lookup helpers for the UI
// ---------------------------------------------------------------------------

/** Newest period first — the one you just added is the one you want to see. */
export const sortEvents = (events: readonly LifeEvent[]): LifeEvent[] =>
  [...events].sort((a, b) => (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0));

/** Events that touch any day in `[from, to]`, oldest first. */
export const eventsInRange = (
  events: readonly LifeEvent[],
  from: string,
  to: string,
): LifeEvent[] =>
  events
    .filter((e) => rangesOverlap(e.start_date, e.end_date, from, to))
    .sort((a, b) => (a.start_date > b.start_date ? 1 : -1));

/** The event covering a date, if any. Latest start wins when two overlap. */
export const eventOnDate = (
  events: readonly LifeEvent[],
  date: string,
): LifeEvent | null => {
  const hits = events.filter((e) => coversDate(e, date));
  if (!hits.length) return null;
  return hits.sort((a, b) => (a.start_date > b.start_date ? -1 : 1))[0];
};

/** True for a break that would pause training and therefore explain a gap. */
export const pausesTraining = (event: LifeEvent): boolean => event.allow_training === "no";

/**
 * Which phase a period falls in, used by the calendar band colours.
 *
 * Kept as a single word so the styling and the copy cannot describe the same
 * period differently.
 */
export function availabilityKind(event: LifeEvent): "paused" | "optional" | "training" {
  if (event.allow_training === "no") return "paused";
  if (event.allow_training === "optional") return "optional";
  return "training";
}
