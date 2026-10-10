// ============================================================================
// RECOVERY-AWARE ADAPTATION — the decision layer between data and advice
// ----------------------------------------------------------------------------
// `src/lib/sessionLoad.ts` says how hard a session was. This module says what
// to do about it, and it exists as a separate, pure, testable layer because the
// specification's actual requirement is not "adjust the plan" — it is that the
// AI must not have unrestricted authority to rewrite training, and that there
// be a controlled rule set between the raw recovery data and any
// recommendation.
//
// Three commitments shape every line below:
//
//   1. HARD CONSTRAINTS WIN, ALWAYS. An athlete who said they are unavailable,
//     who paused, who is ill or injured, who has a competition, or who has been
//     told to rest, is not offered a "you could try going a bit easier". Those
//     come back as `blocked`, and the reason is the athlete's own record. There
//     is no threshold, no severity score and no override.
//
//   2. "I DON'T KNOW" IS A FIRST-CLASS ANSWER. When the data is thin — no
//     recovery logged, no load logged, a session the model could not price —
//     the output is `insufficient` with the "I don't have enough information
//     to confidently adjust this session" wording the specification asks for.
//     It is not a pass-through and it is not a guess dressed as advice. A
//     module that could only ever say "proceed" would be indistinguishable from
//     one that had no rules.
//
//   3. NO MEDICAL CERTAINTY. Nothing here estimates injury risk, diagnoses, or
//     claims a probability. The copy says what the athlete reported and what
//     their load was, and offers a conservative training suggestion. "Your
//     recent load and recovery indicators suggest that reducing today's intensity
//     may be appropriate" — that is the register this whole file is written in.
//
// It is pure and clockless: every date and every input is injected, so the rules
// can be tested directly without a database, a fake clock, or a Supabase mock.
// The DB glue that gathers `RecoveryFacts` lives in `recoveryPlanning.ts`.
// ============================================================================

import { formatNumber } from "@/i18n/locale";
import type { LifeEvent } from "./lifeEvents";
import { loadTotals } from "./sessionLoad";
import { daysBetween as canonicalDaysBetween } from "./dates";

// ---------------------------------------------------------------------------
// What the decision layer is given
// ---------------------------------------------------------------------------

/** One row of `recovery_logs`, as far as adaptation is concerned. */
export interface RecoveryEntry {
  log_date: string;
  /** 1–10, where 10 is the best night. */
  sleep_quality?: number | null;
  /** 1–10, where 10 is the worst. */
  fatigue?: number | null;
  soreness?: number | null;
  mood?: number | null;
  stress?: number | null;
  energy?: number | null;
  /** Sleep duration in hours. */
  rest_hours?: number | null;
  /** 10–300 ms, when the athlete logs it. */
  hrv?: number | null;
  /** 0–100, computed by the Recovery screen. Nullable — never `Number()` it. */
  readiness_score?: number | null;
}

/** One completed session with its load, from either `performance_logs` or `workouts`. */
export interface LoadEntry {
  date: string;
  sport: string | null;
  title?: string | null;
  load: number | null;
  /** Where it came from, for the explanation. */
  source: "performance_log" | "workout" | "plan_event";
}

/** A session the plan holds for a given day. */
export interface AdjustableSession {
  week: number;
  day: number;
  date: string;
  title: string;
  type: string;
  durationMinutes: number;
  /** Rest and recovery days are never scaled — they are the recovery. */
  isRest?: boolean;
  isRecovery?: boolean;
  /** Phase 1/2 mark this; the specification says protect the important session. */
  key?: boolean;
}

/** Everything the rules need, gathered from the database by the caller. */
export interface RecoveryFacts {
  /** `YYYY-MM-DD`. Injected so the module stays clockless. */
  today: string;
  /** Recovery logs, newest first is not required. */
  recovery: RecoveryEntry[];
  /** Completed sessions with a load, from every sport. */
  loads: LoadEntry[];
  /** The plan's sessions with real dates, in any order. */
  sessions: AdjustableSession[];
  /** Life events — the athlete's own record of unavailability and rest. */
  events?: LifeEvent[];
  /** Competitions already booked. */
  competitions?: { title: string; date: string }[];
  /** Chronological age, when known. Drives the youth rules. */
  age?: number | null;
  /** True when the athlete is inside a Phase 2 return-from-break progression. */
  inReturnProgression?: boolean;
  /** Which week back, when in one. 1 is the first week. */
  returnWeekBack?: number | null;
}

// ---------------------------------------------------------------------------
// What the decision layer answers
// ---------------------------------------------------------------------------

export type AdjustmentAction =
  /** Leave the plan alone. The data supports it. */
  | "proceed"
  /** Do less. Volume and/or intensity down. */
  | "reduce"
  /** Swap a hard session for an easy one. */
  | "swap"
  /** The session may be moved to another day. */
  | "move"
  /** Add recovery in place of the session. */
  | "recover"
  /** Keep the session exactly as written, whatever else the data says. */
  | "preserve"
  /** Hard constraint: the athlete may not train this. */
  | "blocked"
  /** Not enough data to say anything honest. */
  | "insufficient";

export interface Evidence {
  /** The athlete-facing sentence. Cites real numbers only. */
  text: string;
  /** Where the number came from, for the UI's secondary line. */
  source: "recovery" | "load" | "plan" | "calendar" | "break";
}

export interface AdjustmentDecision {
  action: AdjustmentAction;
  /** `YYYY-MM-DD` of the session this is about. */
  date: string;
  title: string;
  /**
   * How much of the session to keep. Null means "no change proposed" — which is
   * different from 100, because a blocked session is not reduced, it is off.
   */
  volumePct: number | null;
  intensityPct: number | null;
  /** Why. Every line is a fact from the athlete's own record. */
  evidence: Evidence[];
  /** The one-line recommendation. */
  headline: string;
  /** Present when `action === "insufficient"`. */
  uncertainty: string | null;
  /** True when a hard constraint stopped this, whatever the data said. */
  blockedBy: string | null;
}

/** The wording the specification asks for when the data is thin. */
export const NOT_ENOUGH_INFORMATION =
  "I don't have enough information to confidently adjust this session.";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Where the bands sit, on the app's own 1–10 scales.
 *
 * These are conventions for reading a slider, not measured thresholds. They are
 * named, exported and commented precisely so nobody later mistakes them for
 * findings: nothing in this product has been validated against an outcome, and
 * the copy never claims otherwise.
 */
export const POOR_SLEEP = 4;
export const GOOD_SLEEP = 7;
export const HIGH_FATIGUE = 7;
export const HIGH_SORENESS = 7;
export const HIGH_STRESS = 7;
export const POOR_READINESS = 55;
export const GOOD_READINESS = 70;
export const POOR_HOURS = 6;

/**
 * Load ratio above which recent work counts as elevated.
 *
 * Acute (last 7 days) over chronic (the 28 before it), both divided by their
 * day counts so a short window and a long one are comparable. 1.3 is the
 * conventional reading of "spiking"; the band is wide on purpose, because the
 * consequence of being wrong in either direction is a missed session or an
 * unnecessary one, and both are cheap.
 */
export const ELEVATED_LOAD_RATIO = 1.3;

/**
 * Load below the window before it by this factor is called a drop. One
 * definition: the band classification on /insights, the undertraining alert
 * on /metrics and the (previously dead) copy in explanations.ts all mean this
 * same number.
 */
export const REDUCED_LOAD_RATIO = 0.7;

/**
 * Floor of the steady band: below this the ratio reads as drifting down, at
 * or above `ELEVATED_LOAD_RATIO` it reads as elevated. The 0.8–1.3 band was
 * hard-coded as string literals and comparisons in three files (audit S3);
 * screens derive both the maths and the message from these.
 */
export const STEADY_LOAD_FLOOR = 0.8;

/** Recovery alone, with no load data, is not enough to cut a session. */
const HIGH_FATIGUE_CUT = 7;
const POOR_SLEEP_CUT = 4;

// ---------------------------------------------------------------------------
// Reading the data
// ---------------------------------------------------------------------------

const num = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

const dayKey = (key: string): string => key.slice(0, 10);

/**
 * Whole days between two day keys (or ISO timestamps — the `dayKey` trim
 * keeps both), signed.
 *
 * A thin wrapper over the canonical `daysBetween` in ./dates: the arithmetic
 * is one implementation, but this module's contract is total — filters here
 * compare the result numerically, and null would coerce to 0 and make a
 * garbage key look like "today", so unreadable input yields NaN instead.
 */
export function daysBetween(a: string, b: string): number {
  return canonicalDaysBetween(dayKey(a), dayKey(b)) ?? NaN;
}

/**
 * A `YYYY-MM-DD` key as UTC epoch milliseconds.
 *
 * Every date in this module is a calendar day, never an instant, so the
 * arithmetic runs in UTC throughout. Parsing with `Date.UTC` rather than
 * `new Date(key)` is what stops a day key west of Greenwich from sliding back
 * into the previous day — the same trap `adaptivePlanning.ts` documents.
 */
const toUtcMs = (key: string): number => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

/** The `YYYY-MM-DD` key for the day before `key`. */
export function previousDay(key: string): string {
  return new Date(toUtcMs(key) - 86_400_000).toISOString().slice(0, 10);
}

/** The most recent recovery log within `windowDays` of today, or null. */
export function latestRecovery(recovery: RecoveryEntry[], today: string, windowDays = 3): RecoveryEntry | null {
  const candidates = recovery
    .map((entry) => ({ entry, age: daysBetween(dayKey(entry.log_date), today) }))
    .filter((row) => row.age >= -1 && row.age <= windowDays)
    .sort((a, b) => a.age - b.age);
  return candidates.length ? candidates[0].entry : null;
}

/**
 * Load over two windows, and whether the recent one is elevated.
 *
 * The ratio is only meaningful when both windows have data. An athlete with one
 * logged session has no chronic baseline, so `elevated` is false and, crucially,
 * `known` is false — and a caller that sees `known: false` must not treat the
 * absence of elevation as evidence of good recovery.
 */
export function loadTrend(loads: LoadEntry[], today: string): {
  acute: number;
  chronic: number;
  ratio: number | null;
  elevated: boolean;
  known: boolean;
  hardSessions: number;
  /** Sports seen in the acute window, for "you played a match" copy. */
  acuteSports: string[];
} {
  const day = (entry: LoadEntry) => daysBetween(dayKey(entry.date), today);
  const inAcute = loads.filter((e) => day(e) <= 6 && day(e) >= 0);
  const inChronic = loads.filter((e) => day(e) >= 7 && day(e) <= 34);

  const acuteTotals = loadTotals(inAcute.map((e) => ({ date: e.date, load: e.load })));
  const chronicTotals = loadTotals(inChronic.map((e) => ({ date: e.date, load: e.load })));

  // A hard session is one priced into the top band, or any field/court match.
  // Both are what the specification means by "previous hard sessions from
  // session history and any intensity markers".
  const hardSessions = inAcute.filter((e) => {
    if (e.load === null) return false;
    const text = `${e.sport ?? ""} ${e.title ?? ""}`.toLowerCase();
    if (/match|game|football|soccer|basketball|hockey|rugby/.test(text)) return true;
    return e.load >= 60;
  }).length;

  const acutePerDay = acuteTotals.daysLogged ? acuteTotals.total / acuteTotals.daysLogged : 0;
  const chronicPerDay = chronicTotals.daysLogged ? chronicTotals.total / chronicTotals.daysLogged : 0;

  const known = chronicTotals.daysLogged >= 3;
  const ratio = known && chronicPerDay > 0 ? acutePerDay / chronicPerDay : null;

  return {
    acute: acuteTotals.total,
    chronic: chronicTotals.total,
    ratio,
    elevated: ratio !== null && ratio >= ELEVATED_LOAD_RATIO,
    known,
    hardSessions,
    acuteSports: [...new Set(inAcute.map((e) => e.sport).filter((s): s is string => !!s))],
  };
}

// ---------------------------------------------------------------------------
// Hard constraints
// ---------------------------------------------------------------------------

interface Block {
  reason: string;
  text: string;
}

/**
 * The reasons an athlete may not train, from their own record.
 *
 * Ordered so the most fundamental is reported first, because when several apply
 * the athlete only needs to be told the one that actually governs. Nothing here
 * is a threshold and nothing here can be overridden by recovery data — that is
 * the point of a hard constraint.
 */
export function hardConstraintFor(
  session: AdjustableSession,
  facts: RecoveryFacts,
): Block | null {
  const events = facts.events ?? [];

  // 1. A competition on this day. The athlete is competing, not training, and
  //    the plan's session for today is not theirs to modify.
  const comp = (facts.competitions ?? []).find((c) => dayKey(c.date) === session.date);
  if (comp) {
    return { reason: "competition", text: `You have ${comp.title} on this day, so this session is not something to adjust.` };
  }

  // 2. Illness or injury on the date, checked BEFORE the pause because an
  //    athlete who paused for illness did so for a reason, and "you are
  //    training paused" is a worse answer than "follow your doctor's
  //    guidance". Both block; only the explanation differs.
  const covering = events.find((e) => {
    const start = dayKey(e.start_date);
    const end = dayKey(e.end_date);
    return session.date >= start && session.date <= end;
  });
  if (covering && (covering.event_type === "illness" || covering.event_type === "injury")) {
    return {
      reason: "medical",
      text: `You have recorded ${covering.event_type === "illness" ? "illness" : "an injury"} covering this day. Follow your doctor's or physiotherapist's guidance.`,
    };
  }

  // 3. The athlete said they are unavailable, or paused training.
  if (covering && covering.allow_training === "no") {
    return {
      reason: "unavailable",
      text: `You recorded ${covering.event_type.replace(/_/g, " ")} from ${covering.start_date} to ${covering.end_date}, with training paused.`,
    };
  }

  // 4. The day after a competition is a required rest period. Not a rule about
  //    physiology — it is the one thing the app is certain about, because it is
  //    in the athlete's own calendar.
  const previous = previousDay(session.date);
  const yesterdayComp = (facts.competitions ?? []).find((c) => dayKey(c.date) === previous);
  if (yesterdayComp) {
    return {
      reason: "post-competition",
      text: `You competed in ${yesterdayComp.title} yesterday. The day after a competition is rest.`,
    };
  }

  // 5. Post-illness rest inside an active medical break is covered by (3), and
  //    the pause itself by (2). Nothing else is a hard constraint: a soft one
  //    — a preferred day, a preferred time — is an optimisation, and this layer
  //    has no business turning a preference into a veto.
  return null;
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const evidence = (text: string, source: Evidence["source"]): Evidence => ({ text, source });

// This was `toLocaleString("en")`, which printed English thousands separators
// (1,200) in all twelve languages. `formatNumber` follows the language chosen in
// Settings — a German athlete reads 1.200 in the sentence that explains their
// load. It comes from `src/i18n/locale`, which imports no React, so this stays a
// pure decision module.
const fmt = (n: number): string => formatNumber(Math.round(n));

/**
 * What should happen to one session, and why.
 *
 * The order is the specification's order and it matters:
 *
 *   1. Hard constraints. Checked first, never negotiated.
 *   2. Nothing to adjust. A rest day is the recovery; a session inside a return
 *      progression that the athlete is reporting well against is left alone.
 *   3. Not enough data. The honest answer when the record cannot support a
 *      recommendation.
 *   4. The heuristics, most conservative first.
 *
 * Note what this function does *not* do: it never returns a recommendation
 * above the session's existing volume or intensity. Every percentage is a
 * reduction, and `proceed` is the only way to keep the plan as written.
 */
export function decideForSession(session: AdjustableSession, facts: RecoveryFacts): AdjustmentDecision {
  const base: AdjustmentDecision = {
    action: "proceed",
    date: session.date,
    title: session.title,
    volumePct: null,
    intensityPct: null,
    evidence: [],
    headline: "",
    uncertainty: null,
    blockedBy: null,
  };

  // -- 1. Hard constraints ---------------------------------------------------
  const block = hardConstraintFor(session, facts);
  if (block) {
    return {
      ...base,
      action: "blocked",
      evidence: [evidence(block.text, "break")],
      headline: block.reason === "competition" ? "Competing day — leave this session." : "This day is not available for training.",
      blockedBy: block.reason,
    };
  }

  // -- 2. Nothing to adjust --------------------------------------------------
  if (session.isRest || session.isRecovery || session.type === "rest") {
    return { ...base, action: "preserve", headline: "Rest day — this is the recovery." };
  }
  if (session.durationMinutes <= 0) {
    return { ...base, action: "preserve", headline: "This session has no duration, so there is nothing to scale." };
  }

  const trend = loadTrend(facts.loads, facts.today);
  const recovery = latestRecovery(facts.recovery, facts.today);
  const evidenceList: Evidence[] = [];

  // -- 3. Not enough information --------------------------------------------
  if (!recovery && !trend.known) {
    return {
      ...base,
      action: "insufficient",
      headline: "No recommendation yet.",
      uncertainty: `${NOT_ENOUGH_INFORMATION} Log a recovery check-in and a few sessions, and I can suggest something specific.`,
    };
  }

  const sleep = num(recovery?.sleep_quality) ?? null;
  const fatigue = num(recovery?.fatigue) ?? null;
  const soreness = num(recovery?.soreness) ?? null;
  const stress = num(recovery?.stress) ?? null;
  const hours = num(recovery?.rest_hours) ?? null;
  // `typeof === "number"`, never `Number()`: the column is nullable and
  // `Number(null)` is 0, which would read as the worst possible readiness.
  const readiness = typeof recovery?.readiness_score === "number" ? recovery.readiness_score : null;

  // -- Evidence, built from what is actually there ---------------------------
  if (fatigue !== null && fatigue >= HIGH_FATIGUE) {
    evidenceList.push(evidence(`You reported your fatigue as ${fatigue}/10.`, "recovery"));
  }
  if (sleep !== null && sleep <= POOR_SLEEP) {
    evidenceList.push(evidence(`You rated your sleep ${sleep}/10.`, "recovery"));
  }
  if (hours !== null && hours < POOR_HOURS) {
    evidenceList.push(evidence(`You logged ${hours} hours of sleep.`, "recovery"));
  }
  if (soreness !== null && soreness >= HIGH_SORENESS) {
    evidenceList.push(evidence(`You reported soreness at ${soreness}/10.`, "recovery"));
  }
  if (stress !== null && stress >= HIGH_STRESS) {
    evidenceList.push(evidence(`You reported stress at ${stress}/10.`, "recovery"));
  }
  if (readiness !== null && readiness < POOR_READINESS) {
    evidenceList.push(evidence(`Your readiness score was ${readiness}/100.`, "recovery"));
  }
  if (trend.hardSessions > 0) {
    const noun = trend.hardSessions === 1 ? "hard session" : "hard sessions";
    evidenceList.push(evidence(`${trend.hardSessions} ${noun} in your last 7 days.`, "load"));
  }
  if (trend.elevated) {
    evidenceList.push(
      evidence(
        `Your last 7 days carried ${fmt(trend.acute)} load against ${fmt(trend.chronic)} over the four weeks before — about ${trend.ratio?.toFixed(1)}× your usual.`,
        "load",
      ),
    );
  } else if (trend.known) {
    evidenceList.push(evidence(`Your recent load is close to your usual — about ${fmt(trend.acute)} over 7 days.`, "load"));
  }

  const poorSleep = (sleep !== null && sleep <= POOR_SLEEP) || (hours !== null && hours < POOR_HOURS);
  const highFatigue = fatigue !== null && fatigue >= HIGH_FATIGUE_CUT;
  const lowReadiness = readiness !== null && readiness < POOR_READINESS;

  // -- 4a. High fatigue AND poor sleep AND elevated load ---------------------
  // The specification's first heuristic, and the only one that names all three
  // conditions. Any one alone is not enough to cut a session: an athlete who
  // slept badly the night before a planned session has a bad night, not a bad
  // week.
  if (highFatigue && poorSleep && trend.elevated) {
    const reduction = 30;
    return {
      ...base,
      action: "reduce",
      volumePct: 100 - reduction,
      intensityPct: 100 - reduction,
      evidence: evidenceList,
      headline: `Consider cutting about ${reduction}% from this session.`,
      uncertainty: null,
    };
  }

  // -- 4b. High fatigue AND poor sleep, no load history ----------------------
  // The load half of the heuristic is unknowable for a new athlete, so the
  // recommendation is halved rather than dropped: enough signal to suggest
  // something gentle, not enough to claim the full cut is justified.
  if (highFatigue && poorSleep && !trend.known) {
    return {
      ...base,
      action: "reduce",
      volumePct: 85,
      intensityPct: 85,
      evidence: evidenceList,
      headline: "Consider taking about 15% off this session.",
      uncertainty: `${NOT_ENOUGH_INFORMATION} Your load history is what is missing, so this is a small, conservative suggestion rather than a full adjustment.`,
    };
  }

  // -- 4c. Hard session with elevated load and poor recovery -----------------
  // The second half of the first heuristic: replace hard with easy. Only for a
  // session that actually carries intensity, so an easy run is never swapped for
  // an even easier one on the strength of a bad night's sleep.
  const isHardSession = /speed|interval|power|sport_specific|tempo|threshold|race/.test(session.type);
  if (isHardSession && (highFatigue || lowReadiness) && (trend.elevated || trend.hardSessions >= 2)) {
    return {
      ...base,
      action: "swap",
      volumePct: 60,
      intensityPct: 50,
      evidence: evidenceList,
      headline: "Swap this for an easy session you can hold back on.",
      uncertainty: null,
    };
  }

  // -- 4d. Low readiness AND a key session tomorrow -------------------------
  // The specification's second heuristic, and it is about tomorrow, not today.
  // The point is to protect the important session rather than to protect the
  // athlete from it — so today's session gives way, and today's session is
  // only touched if it is not itself the key one.
  const tomorrowKey = (facts.sessions ?? []).some(
    (s) => s.date > session.date && daysBetween(session.date, s.date) === 1 && (s.key || /speed|interval|power|race|tempo/.test(s.type)),
  );
  if (lowReadiness && tomorrowKey && !session.key) {
    return {
      ...base,
      action: "reduce",
      volumePct: 70,
      intensityPct: 60,
      evidence: [
        ...evidenceList,
        evidence("An important session is scheduled tomorrow.", "plan"),
      ],
      headline: "Keep today easy so you can perform tomorrow's session.",
      uncertainty: null,
    };
  }

  // -- 4e. In a return-from-break week, with poor recovery ------------------
  // The specification: a further 10–20% for that week. Applied here on top of
  // the Phase 2 progression already written into the plan, so the two compose
  // rather than one overriding the other.
  if (facts.inReturnProgression && facts.returnWeekBack === 1 && (lowReadiness || (highFatigue && poorSleep))) {
    return {
      ...base,
      action: "reduce",
      volumePct: 85,
      intensityPct: 85,
      evidence: [
        ...evidenceList,
        evidence("This is week 1 of your return-from-break rebuild.", "break"),
      ],
      headline: "Take a further 15% off this week — your rebuild is already conservative.",
      uncertainty: null,
    };
  }

  // -- 4f. In a return-from-break week, with good recovery ------------------
  // The specification is explicit: keep the planned progression and do NOT
  // accelerate. So this returns `proceed` with the reason attached, because
  // "nothing changed, and here is why nothing changed" is worth saying out loud
  // to an athlete who has just been told their plan was rebuilt.
  if (facts.inReturnProgression && readiness !== null && readiness >= GOOD_READINESS) {
    return {
      ...base,
      action: "proceed",
      evidence: [
        ...evidenceList,
        evidence("You are week 1 of your return rebuild, so this stays conservative on purpose.", "break"),
      ],
      headline: "Keep the planned session — your rebuild stays gentle even on a good day.",
      uncertainty: null,
    };
  }

  // -- 4g. High readiness, moderate load, no imminent competition ------------
  // The specification's condition is three-part and all three are required: a
  // competition inside three days means the athlete is racing, not building,
  // and telling them to "go ahead as written" in the run-up to one is how a
  // good week gets spent on the wrong session. Those days fall through to the
  // taper below rather than being answered here.
  if (
    readiness !== null &&
    readiness >= GOOD_READINESS &&
    !trend.elevated &&
    !soonCompetition(facts, session)
  ) {
    return {
      ...base,
      action: "proceed",
      evidence: [
        ...evidenceList,
        evidence("Nothing is competing for the training today.", "calendar"),
      ],
      headline: "Go ahead with this session as written.",
      uncertainty: null,
    };
  }

  // -- 4h. Good recovery but a competition is imminent ------------------------
  // §5: "ensure the athlete is not overloaded in the days leading into the
  // event". A hard session three days out from a race is the single clearest
  // thing to take out of a week, and it is a substitution rather than a cut —
  // the athlete keeps the session, it just stops being the hardest thing they
  // did that week.
  if (soonCompetition(facts, session) && isHardSession) {
    const daysOut = (facts.competitions ?? [])
      .map((c) => daysBetween(session.date, dayKey(c.date)))
      .filter((d) => d >= 0 && d <= 3)
      .sort((a, b) => a - b)[0];
    return {
      ...base,
      action: "reduce",
      volumePct: 70,
      intensityPct: 60,
      evidence: [
        ...evidenceList,
        evidence(
          daysOut === 0
            ? "Your competition is today."
            : `Your competition is in ${daysOut} day${daysOut === 1 ? "" : "s"}.`,
          "calendar",
        ),
      ],
      headline: "Keep this session easy — your competition is close, and staying fresh matters more than one hard day.",
      uncertainty: null,
    };
  }

  // -- 5. Nothing to suggest, and not enough to say so -----------------------
  if (!evidenceList.length) {
    return {
      ...base,
      action: "insufficient",
      headline: "No recommendation yet.",
      uncertainty: `${NOT_ENOUGH_INFORMATION} Log how you slept and how you feel, and I can look at this session properly.`,
    };
  }

  return {
    ...base,
    action: "proceed",
    evidence: evidenceList,
    headline: "Your plan looks right for today — keep it as written.",
    uncertainty: null,
  };
}

/** Is a competition inside the next three days? */
export function soonCompetition(facts: RecoveryFacts, session: AdjustableSession): boolean {
  return (facts.competitions ?? []).some((c) => {
    const gap = daysBetween(session.date, dayKey(c.date));
    return gap >= 0 && gap <= 3;
  });
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

export interface WeekDecision {
  /** One decision per session with a date, oldest first. */
  decisions: AdjustmentDecision[];
  /**
   * The suggested reduction for the whole week, when more than one session is
   * being changed. The specification asks for "consider reducing this week's
   * volume by ~N%"; this is that number, and null when the week is left alone.
   */
  volumeReductionPct: number | null;
  /** The week-level explanation, or null when there is nothing to say. */
  explanation: string | null;
  /** Present when the week could not be assessed honestly. */
  uncertainty: string | null;
}

/**
 * Decide a whole week.
 *
 * One function rather than a screen that loops, so the Training screen, the
 * Recovery screen and any future surface cannot disagree about what this week
 * needs. It is also where the youth rule lives: a developing athlete's week is
 * never scaled *up* by anything here, and their copy never asks them to prove
 * anything with their body.
 */
export function decideForWeek(sessions: AdjustableSession[], facts: RecoveryFacts): WeekDecision {
  const dated = [...sessions].filter((s) => !!s.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const decisions = dated.map((s) => decideForSession(s, facts));

  const changed = decisions.filter((d) => d.action === "reduce" || d.action === "swap" || d.action === "recover");
  if (!changed.length) {
    const uncertain = decisions.find((d) => d.action === "insufficient");
    return {
      decisions,
      volumeReductionPct: null,
      explanation: null,
      uncertainty: uncertain?.uncertainty ?? null,
    };
  }

  // The week-level number is the average of what was actually proposed, not the
  // largest cut in the week. An athlete told "reduce your week by 45%" because
  // one session needed it would be right to distrust the app.
  const average = changed.reduce((sum, d) => sum + (d.volumePct === null ? 0 : 100 - d.volumePct), 0) / changed.length;
  const pct = Math.max(10, Math.min(40, Math.round(average / 5) * 5));

  const reasons = [...new Set(changed.flatMap((d) => d.evidence.map((e) => e.text)))];
  const youth = facts.age !== null && facts.age !== undefined && facts.age < 18;

  const lines = [
    `Consider reducing this week's volume by about ${pct}%.`,
    ...reasons,
    changed.length === 1
      ? "One session is affected; the rest of your week is unchanged."
      : `${changed.length} sessions are affected; nothing has been moved to another day.`,
  ];
  if (facts.inReturnProgression) {
    lines.push("You are still rebuilding, so this is on top of a plan that is already reduced.");
  }
  if (youth) {
    lines.push(
      "You are still developing, so this is deliberately gentle. Rest is part of getting stronger, not a break from it.",
    );
  }

  return {
    decisions,
    volumeReductionPct: pct,
    explanation: lines.join(" "),
    uncertainty: null,
  };
}

// ---------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------

/**
 * The sentence an athlete reads under the recommendation.
 *
 * Assembled from `decision.evidence`, which is why every line in it is a fact
 * the athlete entered or a number the app computed from their own sessions —
 * there is no path here from a decision to an invented statement.
 */
export function decisionText(decision: AdjustmentDecision): string {
  if (decision.action === "blocked") {
    return `${decision.headline} ${decision.evidence.map((e) => e.text).join(" ")}`;
  }
  const why = decision.evidence.length
    ? ` Why: ${decision.evidence.map((e) => e.text).join(" ")}`
    : "";
  const uncertainty = decision.uncertainty ? ` ${decision.uncertainty}` : "";
  return `${decision.headline}${why}${uncertainty}`;
}

/**
 * The load of a session, for callers that want to write it at log time.
 *
 * Re-exported rather than reimplemented so the number stored and the number
 * reasoned about come from the same function.
 */
export { sessionLoad } from "./sessionLoad";
export type { SessionLoadInput, SessionLoad } from "./sessionLoad";