// ============================================================================
// PLAN SETUP ADVICE — the numbers the wizard recommends, and the caps on them
// ----------------------------------------------------------------------------
// What can silently go wrong here is not a wrong sentence, it is advice that
// outruns a safety cap: a recommendation of five training days for an athlete
// whose age caps allow three, or "hard" for a 14-year-old. Those are the cases
// the tests below pin, next to the ordinary level progression.
//
// The reason every number on the wizard's "Recommended" chip is there at all is
// this module: each chip is the recommendation, not a label the chip happens to
// sit in front of. The chip is not this module's value wrapped in a button — the
// button IS the value, presented as the one-tap answer to that field. So the chip
// does not summarize a reason tucked away somewhere else; it is the reason, made
// tappable. The "Why?" toggle that follows each chip is the same numbers spelled
// out in prose, for the athlete who wants to know why the chip says what it says.
// ============================================================================

export type PlanLevel = "beginner" | "intermediate" | "advanced";
export type IntensityPref = "easy" | "balanced" | "hard";
export type SessionLengthPref = "short" | "standard" | "long";
export type TrainingEnvironment = "Outdoor" | "Indoor" | "Mixed";

export type SetupAdviceInput = {
  level?: string | null;
  sport?: string | null;
  age?: number | null;
  goals?: string[];
  caps?: {
    maxSessionsPerWeek?: number;
    minRestDays?: number;
    maxMinutesPerSession?: number;
  } | null;
  durationWeeks?: number | null;
};

export type SetupAdvice = {
  daysPerWeek: number;
  restDays: number;
  sessionLengthPref: SessionLengthPref;
  intensityPref: IntensityPref;
  environment: TrainingEnvironment;
  hoursPerWeek: number;
  durationWeeks: number;
  athleteKnowsBest: boolean;
  focusAreas: string[];
  reasons: {
    duration: string;
    daysPerWeek: string;
    restDays: string;
    sessionLength: string;
    hoursPerWeek: string;
    intensity: string;
    environment: string;
    focusAreas: string;
    equipment: string;
    timeOfDay: string;
  };
};

const LEVELS: PlanLevel[] = ["beginner", "intermediate", "advanced"];

export function normaliseLevel(level: string | null | undefined): PlanLevel {
  const l = (level ?? "").trim().toLowerCase();
  return (LEVELS as string[]).includes(l) ? (l as PlanLevel) : "beginner";
}

/** Minutes a session of each length preference is expected to run. */
const SESSION_MINUTES: Record<SessionLengthPref, number> = {
  short: 45,
  standard: 60,
  long: 90,
};

/**
 * Sport → where it is realistically done. Used for the environment default
 * only; the athlete's own answer always wins.
 */
const SPORT_ENVIRONMENT: Record<string, TrainingEnvironment> = {
  running: "Outdoor",
  cycling: "Outdoor",
  triathlon: "Outdoor",
  athletics: "Outdoor",
  football: "Outdoor",
  rugby: "Outdoor",
  "gym/weightlifting": "Indoor",
  swimming: "Indoor",
  crossfit: "Indoor",
  boxing: "Indoor",
  basketball: "Mixed",
  tennis: "Mixed",
  general: "Mixed",
};

/** Focus areas that suit each level's stage, easiest tier first. */
const LEVEL_FOCUS: Record<PlanLevel, string[]> = {
  beginner: ["General Fitness", "Mobility", "Core Basics"],
  intermediate: ["Strength", "Endurance", "Technique"],
  advanced: ["Speed", "Power", "Sport-Specific"],
};

/**
 * Goal → the focus chip that names it. Only used when the chip exists in the
 * wizard's own list, so this can never recommend a label the UI cannot render.
 */
const GOAL_FOCUS: Record<string, string> = {
  strength: "Strength",
  endurance: "Endurance",
  speed: "Speed",
  power: "Power",
  agility: "Agility",
  "fat loss": "Fat Loss",
  "muscle gain": "Muscle Gain",
};

const roundToHalf = (n: number) => Math.round(n * 2) / 2;

/**
 * The recommendation set. Order of business: pick the level's baseline, then
 * let age caps win, then let youth/masters tone it down — never the other way
 * round, because a cap that a recommendation can override is not a cap.
 */
export function recommendSetup(input: SetupAdviceInput): SetupAdvice {
  const level = normaliseLevel(input.level);
  const age = typeof input.age === "number" && Number.isFinite(input.age) ? input.age : null;
  const youth = age !== null && age < 16;
  const masters = age !== null && age >= 45;

  // Baseline per level: how many days, how much rest, how hard.
  const baseline = level === "beginner"
    ? { days: 3, rest: 2, length: "short" as SessionLengthPref, intensity: "balanced" as IntensityPref }
    : level === "intermediate"
    ? { days: 4, rest: 1, length: "standard" as SessionLengthPref, intensity: "balanced" as IntensityPref }
    : { days: 5, rest: 1, length: "standard" as SessionLengthPref, intensity: "hard" as IntensityPref };

  const caps = input.caps ?? null;
  const maxDays = caps ? Math.max(1, Math.min(7, Math.floor(caps.maxSessionsPerWeek))) : 7;
  const minRest = caps ? Math.max(0, Math.floor(caps.minRestDays)) : 0;

  let daysPerWeek = Math.max(1, Math.min(baseline.days, maxDays));
  const restDays = Math.max(baseline.rest, minRest);
  // Training days plus full rest days cannot exceed the week.
  if (daysPerWeek + restDays > 7) daysPerWeek = Math.max(1, 7 - restDays);

  let sessionLengthPref = baseline.length;
  if (caps && SESSION_MINUTES[sessionLengthPref] > caps.maxMinutesPerSession) sessionLengthPref = "short";

  let intensityPref = baseline.intensity;
  // A developing athlete learns technique; a masters athlete protects tendons.
  // Both are told "balanced" at most, whatever level they picked.
  if (youth) intensityPref = "easy";
  else if (masters && intensityPref === "hard") intensityPref = "balanced";

  const minutes = SESSION_MINUTES[sessionLengthPref];
  const hoursPerWeek = roundToHalf(Math.max(1, (daysPerWeek * minutes) / 60));

  const sport = (input.sport ?? "").trim().toLowerCase();
  const environment = SPORT_ENVIRONMENT[sport] ?? "Mixed";

  // Focus: capped at four, because a plan asked to chase six things chases
  // none. The goals the athlete named come first — they are the one answer here
  // the athlete actually gave — and the level's stage fills the rest.
  const focusAreas: string[] = [];
  for (const raw of input.goals ?? []) {
    const chip = GOAL_FOCUS[String(raw).trim().toLowerCase()];
    if (chip && !focusAreas.includes(chip)) focusAreas.push(chip);
  }
  for (const chip of LEVEL_FOCUS[level]) {
    if (focusAreas.length >= 4) break;
    if (!focusAreas.includes(chip)) focusAreas.push(chip);
  }

  const durationWeeks = [4, 6, 8, 12].find((w) => w >= (input.durationWeeks ?? 4)) ?? 12;

  const reasons: SetupAdvice["reasons"] = {
    duration: `${durationWeeks} weeks: long enough for the block to actually build something, short enough to finish motivated.`,
    daysPerWeek: daysPerWeek === 1
      ? `1 training day: enough to build the habit without asking for more than you can give it.`
      : daysPerWeek === 3 && restDays === 2
      ? `Three full-body sessions a week, with two full rest days so the work actually sticks.`
      : `${daysPerWeek} training days a week, with ${restDays} full rest day${restDays === 1 ? "" : "s"} so the work actually sticks.`,
    restDays: restDays === 0
      ? `No forced rest day — you are telling us you already manage recovery yourself.`
      : restDays === 1
      ? `One full rest day keeps the week recoverable without dropping the pace.`
      : `${restDays} full rest days a week, because ${level} training at this cadence needs the recovery built in — full rest days are where the adaptation you trained for actually happens.`,
    sessionLength: sessionLengthPref === "short"
      ? `45-minute sessions fit around a busy week without dragging.`
      : sessionLengthPref === "standard"
      ? `About 60 minutes per session — long enough to mean something, short enough to repeat.`
      : `90-minute sessions for when the week is open and the work is the point.`,
    hoursPerWeek: `Around ${hoursPerWeek}h of actual training a week — the number behind the days and the session length.`,
    intensity: intensityPref === "easy"
      ? `Easy intensity: technique and consistency first, not chasing fatigue.`
      : intensityPref === "balanced"
      ? `Balanced intensity: hard sessions in the week, not every session.`
      : `Hard intensity: the week is built around the sessions that matter most.`,
    environment: `Most ${sport || "training"} happens ${environment.toLowerCase()}, so the plan is written for that.`,
    focusAreas: focusAreas.length === 0
      ? "No focus areas yet — add a goal and this will point at the things that move it."
      : `Focus on ${focusAreas.join(", ")}.`,
    equipment: "Equipment is an inventory question — only you can give us what you train with, and the plan will match it.",
    timeOfDay: "Training time is a life question — only you know the slot you can keep, and the plan will adapt to it.",
  };

  return {
    daysPerWeek,
    restDays,
    sessionLengthPref,
    intensityPref,
    environment,
    hoursPerWeek,
    durationWeeks,
    athleteKnowsBest: level === "advanced",
    focusAreas,
    reasons,
  };
}

export function matchesAdvice(advice: SetupAdvice, field: keyof SetupAdvice, value: unknown): boolean {
  const current = advice[field];
  if (Array.isArray(current) && Array.isArray(value)) {
    return current.length === value.length && current.every((v) => value.includes(v));
  }
  if (typeof current === "number" && typeof value === "number") {
    return current === value;
  }
  return String(current) === String(value);
}
