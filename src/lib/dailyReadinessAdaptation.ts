// ============================================================================
// DAILY READINESS ADAPTATION — persist a bad check-in in the training plan
// ----------------------------------------------------------------------------
// A low morning check-in used to change only the copy on the Recovery screen:
// the adjusted session lived in `recovery_logs.adjusted_session`, while the
// plan itself still said to do the hard workout. That made the advice easy to
// ignore and, worse, easy to contradict everywhere else in the app.
//
// This module is the plan half of that promise. It rewrites the two affected
// days inside `training_plans.plan_data`:
//
//   • a hard session on a CAUTION or RED day becomes the next day's easy
//     session, and the hard work moves to the next day untouched;
//   • when there is no easy session to trade with, today's workout is reduced
//     (CAUTION) or replaced with recovery (RED) in place.
//
// It never invents training: rest stays rest, a missing next day is left
// alone, and a session already adapted for the same check-in is returned
// unchanged so re-saving cannot stack the same move twice.
// ============================================================================

export type DailyReadinessZone = "GREEN" | "NORMAL" | "CAUTION" | "RED";

export interface DailyPlanExercise {
  name?: string;
  sets?: string;
  [key: string]: unknown;
}

export interface DailyPlanSession {
  day: number;
  dayName?: string;
  title?: string;
  type?: string;
  description?: string;
  duration_minutes?: number;
  isRest?: boolean;
  isRecovery?: boolean;
  skipped?: boolean;
  exercises?: DailyPlanExercise[];
  warmup?: DailyPlanExercise[];
  cooldown?: DailyPlanExercise[];
  key?: boolean;
  _originalTitle?: string | null;
  _zone?: string;
  _reason?: string;
  _adaptedFor?: string;
  /**
   * The session exactly as it stood before this check-in adapted it.
   *
   * The adjustment is a decision about one morning, and it has to be a
   * reversible one: an athlete who sleeps badly, takes the easy day the app
   * offers, and then wakes up fresh should get the hard session their plan
   * intended back. Without this the adaptation was permanent — the reduced
   * duration, the swapped days and the replacement recovery session could all
   * be seen on screen but could not be taken back, because nothing recorded
   * what they replaced.
   */
  _originalSession?: DailyPlanSession;
  _movedFromWeek?: number;
  _movedFromDay?: number;
  _movedToWeek?: number;
  _movedToDay?: number;
  [key: string]: unknown;
}

export interface DailyPlanWeek {
  week: number;
  sessions: DailyPlanSession[];
  [key: string]: unknown;
}

export type DailyPlanEventStatus = "modified" | "rescheduled";

export interface DailyPlanEvent {
  week: number;
  day: number;
  date: string | null;
  title: string;
  status: DailyPlanEventStatus;
  originalDate?: string | null;
  important: boolean;
  sessionType?: string | null;
  durationMinutes?: number | null;
}

export type DailyAdaptationMode = "none" | "reduce" | "replace" | "swap";

export interface DailyPlanAdaptation {
  weeks: DailyPlanWeek[];
  changed: boolean;
  mode: DailyAdaptationMode;
  todayWeek: number;
  todayDay: number;
  nextWeek: number | null;
  nextDay: number | null;
  summary: string | null;
  events: DailyPlanEvent[];
}

export interface AdaptDailyPlanInput {
  weeks: unknown;
  week: number;
  day: number;
  zone: DailyReadinessZone | string | null | undefined;
  logDate: string;
  todayDate?: string | null;
  tomorrowDate?: string | null;
}

const HARD_SESSION_PATTERN =
  /speed|interval|sprint|tempo|threshold|race|match|power|strength|conditioning|sport[_\s-]?specific|hiit|vo2|long\s+(run|ride|swim)|upper|lower|full[_\s-]?body/i;

const HIGH_INTENSITY_TYPES = new Set([
  "speed",
  "intervals",
  "power",
  "sport_specific",
  "conditioning",
  "strength",
]);

const cloneSession = (session: DailyPlanSession): DailyPlanSession =>
  JSON.parse(JSON.stringify(session)) as DailyPlanSession;

const sessionText = (session: DailyPlanSession): string =>
  `${session.type ?? ""} ${session.title ?? ""} ${session.description ?? ""}`;

const isRestSession = (session: DailyPlanSession): boolean =>
  !!session.isRest || String(session.type ?? "").toLowerCase() === "rest";

const isEasySession = (session: DailyPlanSession): boolean => {
  if (!session || session.skipped || isRestSession(session)) return false;
  return !!session.isRecovery || String(session.type ?? "").toLowerCase() === "recovery";
};

const isHardSession = (session: DailyPlanSession): boolean => {
  if (!session || session.skipped || isRestSession(session) || session.isRecovery) return false;
  if (session.key === true) return true;
  return HARD_SESSION_PATTERN.test(sessionText(session));
};

const isImportantSession = (session: DailyPlanSession): boolean => {
  if (session.key === true) return true;
  return HIGH_INTENSITY_TYPES.has(String(session.type ?? "").toLowerCase());
};

const asSessionList = (value: unknown): DailyPlanExercise[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is DailyPlanExercise => !!item && typeof item === "object");
};

const reduceExercises = (
  exercises: DailyPlanExercise[] | undefined,
): DailyPlanExercise[] | undefined => {
  if (!exercises) return undefined;
  return exercises.map((exercise) => {
    const sets = typeof exercise.sets === "string" ? exercise.sets : "";
    const match = sets.match(/^(\d+)/);
    if (!match) return exercise;
    const count = Math.max(Math.round(parseInt(match[1], 10) * 0.75), 1);
    let nextSets = sets.replace(/^\d+/, String(count));
    nextSets = nextSets.replace(/RPE\s*\d+/i, (found) => {
      const rpe = parseInt(found.replace(/RPE\s*/i, ""), 10);
      return `RPE ${Math.max(rpe - 2, 4)}`;
    });
    return { ...exercise, sets: nextSets };
  });
};

const stampAdapted = (
  session: DailyPlanSession,
  original: DailyPlanSession,
  input: {
    originalTitle?: string | null;
    zone: DailyReadinessZone;
    reason: string;
    logDate: string;
    fromWeek?: number;
    fromDay?: number;
    toWeek?: number;
    toDay?: number;
  },
): void => {
  // The pre-adaptation session, kept whole. `_originalTitle` alone was enough
  // for the copy and not enough for the athlete: a session that lost a quarter
  // of its duration and half its sets cannot be put back from its title.
  session._originalSession = cloneSession(original);
  session._originalTitle = input.originalTitle ?? null;
  session._zone = input.zone;
  session._reason = input.reason;
  session._adaptedFor = input.logDate;
  if (input.fromWeek !== undefined) session._movedFromWeek = input.fromWeek;
  if (input.fromDay !== undefined) session._movedFromDay = input.fromDay;
  if (input.toWeek !== undefined) session._movedToWeek = input.toWeek;
  if (input.toDay !== undefined) session._movedToDay = input.toDay;
};

const reducedSession = (
  session: DailyPlanSession,
  zone: DailyReadinessZone,
  logDate: string,
): DailyPlanSession => {
  const next = cloneSession(session);
  next.title = `${session.title ?? "Session"} (Reduced)`;
  next.exercises = reduceExercises(asSessionList(session.exercises));
  next.duration_minutes = Math.round((session.duration_minutes || 30) * 0.75);
  stampAdapted(next, session, {
    originalTitle: session.title ?? null,
    zone,
    reason: "Reduced after a low morning check-in.",
    logDate,
  });
  return next;
};

const recoveryReplacement = (
  session: DailyPlanSession,
  zone: DailyReadinessZone,
  logDate: string,
): DailyPlanSession => {
  const next = cloneSession(session);
  next.title = "Easy Recovery Session";
  next.type = "recovery";
  next.description = "Your body needs rest. Light movement to promote blood flow.";
  next.duration_minutes = 20;
  next.isRest = false;
  next.isRecovery = true;
  next.skipped = false;
  next.exercises = [
    { name: "Easy walk or very light jog", sets: "10 min @ conversational pace" },
    { name: "Dynamic stretching", sets: "5 min — legs, hips, shoulders" },
    { name: "Foam rolling", sets: "5 min — quads, hamstrings, calves" },
  ];
  next.warmup = [];
  next.cooldown = [{ name: "Deep breathing", sets: "2 min — box breathing (4-4-4-4)" }];
  stampAdapted(next, session, {
    originalTitle: session.title ?? null,
    zone,
    reason: "Replaced with recovery after a very low morning check-in.",
    logDate,
  });
  return next;
};

const unchanged = (
  weeks: DailyPlanWeek[],
  week: number,
  day: number,
): DailyPlanAdaptation => ({
  weeks,
  changed: false,
  mode: "none",
  todayWeek: week,
  todayDay: day,
  nextWeek: null,
  nextDay: null,
  summary: null,
  events: [],
});

export interface RestoreDailyPlanInput {
  weeks: unknown;
  /** The check-in being logged now. A stamp for this date is never undone. */
  logDate: string;
}

export interface DailyPlanRestore {
  weeks: DailyPlanWeek[];
  changed: boolean;
  /** How many sessions were put back where their plan had them. */
  restored: number;
  /** The plan weeks that had a session put back, oldest first. */
  weeksTouched: number[];
}

/**
 * Put back the sessions an earlier check-in moved or reduced.
 *
 * A low morning check-in is a decision about one day, so it has to be revisited
 * the next day rather than standing forever. This restores every session whose
 * stamp belongs to an earlier log date — from the record each adapted session
 * carries of the session it replaced, not by re-deriving anything, because the
 * reduced and replaced sessions are not recoverable by arithmetic.
 *
 * Its place in the flow is deliberate: it runs *before* today's adaptation, on
 * the fresh plan, so today's check-in decides today and yesterday's no longer
 * outranks it. Stamps from the current log date are left exactly as they are,
 * which makes the pair idempotent when the same day is saved twice.
 */
export function restoreDailyPlanForReadiness(input: RestoreDailyPlanInput): DailyPlanRestore {
  const cloned = Array.isArray(input.weeks)
    ? (JSON.parse(JSON.stringify(input.weeks)) as DailyPlanWeek[])
    : [];

  const touched = new Set<number>();
  let restored = 0;

  for (const week of cloned) {
    if (!Array.isArray(week?.sessions)) continue;
    week.sessions = week.sessions.map((session) => {
      const stamp = session?._adaptedFor;
      if (!stamp || stamp === input.logDate) return session;
      const original = session._originalSession;
      if (!original) return session;
      restored += 1;
      touched.add(Number(week.week));
      // The stored copy is the session as it stood, including its own day and
      // day name — which is what puts a swapped day back on its original day.
      return cloneSession(original);
    });
  }

  return {
    weeks: cloned,
    changed: restored > 0,
    restored,
    weeksTouched: [...touched].sort((a, b) => a - b),
  };
}

export function adaptDailyPlanForReadiness(input: AdaptDailyPlanInput): DailyPlanAdaptation {
  const zone = String(input.zone ?? "").toUpperCase() as DailyReadinessZone;
  const weekNumber = Number(input.week);
  const dayNumber = Number(input.day);
  const cloned = Array.isArray(input.weeks)
    ? (JSON.parse(JSON.stringify(input.weeks)) as DailyPlanWeek[])
    : [];

  if (!cloned.length || !Number.isFinite(weekNumber) || !Number.isFinite(dayNumber)) {
    return unchanged(cloned, weekNumber, dayNumber);
  }
  if (zone !== "CAUTION" && zone !== "RED") return unchanged(cloned, weekNumber, dayNumber);

  const weekIndex = cloned.findIndex((week) => Number(week.week) === weekNumber);
  if (weekIndex === -1 || !Array.isArray(cloned[weekIndex].sessions)) {
    return unchanged(cloned, weekNumber, dayNumber);
  }
  const sessionIndex = cloned[weekIndex].sessions.findIndex(
    (session) => Number(session?.day) === dayNumber,
  );
  if (sessionIndex === -1) return unchanged(cloned, weekNumber, dayNumber);

  const today = cloned[weekIndex].sessions[sessionIndex];
  if (!today || today.skipped || isRestSession(today) || today.isRecovery) {
    return unchanged(cloned, weekNumber, dayNumber);
  }
  if (today._adaptedFor === input.logDate) return unchanged(cloned, weekNumber, dayNumber);

  const nextDay = dayNumber < 7 ? dayNumber + 1 : 1;
  const nextWeek = dayNumber < 7 ? weekNumber : weekNumber + 1;
  const nextWeekIndex = cloned.findIndex((week) => Number(week.week) === nextWeek);
  const nextSessionIndex =
    nextWeekIndex === -1 || !Array.isArray(cloned[nextWeekIndex].sessions)
      ? -1
      : cloned[nextWeekIndex].sessions.findIndex((session) => Number(session?.day) === nextDay);
  const next = nextSessionIndex === -1 ? null : cloned[nextWeekIndex].sessions[nextSessionIndex];
  const canSwap =
    !!next &&
    !next.skipped &&
    next._adaptedFor !== input.logDate &&
    isHardSession(today) &&
    isEasySession(next);

  if (canSwap && next) {
    const easyToday = cloneSession(next);
    easyToday.day = dayNumber;
    easyToday.dayName = today.dayName ?? easyToday.dayName;
    // The copy is the session this *cell* held before the swap — the hard one
    // that used to be today — because putting the plan back means putting each
    // cell's own session back where it was.
    stampAdapted(easyToday, today, {
      originalTitle: today.title ?? null,
      zone,
      reason: `Moved here from tomorrow after a low morning check-in; the hard session moved to tomorrow.`,
      logDate: input.logDate,
      fromWeek: nextWeek,
      fromDay: nextDay,
      toWeek: weekNumber,
      toDay: dayNumber,
    });

    const hardTomorrow = cloneSession(today);
    hardTomorrow.day = nextDay;
    hardTomorrow.dayName = next.dayName ?? hardTomorrow.dayName;
    stampAdapted(hardTomorrow, next, {
      originalTitle: next.title ?? null,
      zone,
      reason: `Moved here from today after a low morning check-in; today became the easy session.`,
      logDate: input.logDate,
      fromWeek: weekNumber,
      fromDay: dayNumber,
      toWeek: nextWeek,
      toDay: nextDay,
    });

    cloned[weekIndex].sessions[sessionIndex] = easyToday;
    cloned[nextWeekIndex].sessions[nextSessionIndex] = hardTomorrow;

    return {
      weeks: cloned,
      changed: true,
      mode: "swap",
      todayWeek: weekNumber,
      todayDay: dayNumber,
      nextWeek,
      nextDay,
      summary: `Moved “${today.title ?? "today's hard session"}” to tomorrow and put “${next.title ?? "tomorrow's easy session"}” today.`,
      events: [
        {
          week: weekNumber,
          day: dayNumber,
          date: input.todayDate ?? null,
          title: easyToday.title ?? "Easy session",
          status: "modified",
          important: false,
          sessionType: easyToday.type ?? null,
          durationMinutes: easyToday.duration_minutes ?? null,
        },
        {
          week: nextWeek,
          day: nextDay,
          date: input.tomorrowDate ?? null,
          title: hardTomorrow.title ?? "Hard session",
          status: "rescheduled",
          originalDate: input.todayDate ?? null,
          important: isImportantSession(today),
          sessionType: hardTomorrow.type ?? null,
          durationMinutes: hardTomorrow.duration_minutes ?? null,
        },
      ],
    };
  }

  const replacement =
    zone === "RED" ? recoveryReplacement(today, zone, input.logDate) : reducedSession(today, zone, input.logDate);
  cloned[weekIndex].sessions[sessionIndex] = replacement;

  return {
    weeks: cloned,
    changed: true,
    mode: zone === "RED" ? "replace" : "reduce",
    todayWeek: weekNumber,
    todayDay: dayNumber,
    nextWeek: null,
    nextDay: null,
    summary:
      zone === "RED"
        ? `Replaced “${today.title ?? "today's session"}” with recovery.`
        : `Reduced “${today.title ?? "today's session"}” in place.`,
    events: [
      {
        week: weekNumber,
        day: dayNumber,
        date: input.todayDate ?? null,
        title: replacement.title ?? "Session",
        status: "modified",
        important: isImportantSession(today),
        sessionType: replacement.type ?? null,
        durationMinutes: replacement.duration_minutes ?? null,
      },
    ],
  };
}
