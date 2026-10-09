// ============================================================================
// PLAN SETUP ADVICE — a recommended answer for nearly every choice
// ----------------------------------------------------------------------------
// The create-plan wizard asks ten questions, and most of them are only
// answerable if the athlete already knows how training works: "days per week
// you can train", "dedicated full rest days", "session length", "hours per
// week". A beginner looking at that grid has two options — guess, or leave —
// and guessing produces a plan that is too much for them and then gets blamed
// on the app.
//
// So every answerable field gets a recommendation here, and the wizard shows it
// next to the control. This module is deliberately pure: no React, no Supabase,
// no AI. It is the numbers and the reasoning behind them, unit-tested in
// `planSetupAdvice.test.ts`, so the wizard's job stays presentation.
//
// Two rules shaped everything below:
//
//  1. A recommendation is not a lock. The athlete can always override it, and
//     an advanced athlete is told plainly that the fields are theirs to set.
//     What they must never face is an empty choice with no suggested default.
//  2. Nothing here can exceed the age caps. Youth and masters athletes get
//     clamped advice exactly like they get clamped input, because a
//     recommendation is still an instruction to train.
//
// Two fields deliberately get no recommendation: equipment (a factual
// inventory — only the athlete knows what their gym has, and recommending gear
// they do not own is how a plan prescribes a barbell to somebody with a
// bedroom floor) and training time of day (a life constraint, not a training
// decision — the honest advice is "the slot you can keep", which is what the
// wizard says instead of inventing a number).
// ============================================================================

export type PlanLevel = "beginner" | "intermediate" | "advanced";
export type SessionLengthPref = "short" | "standard" | "long";
export type IntensityPref = "easy" | "balanced" | "hard";
export type TrainingEnvironment = "Indoor" | "Outdoor" | "Mixed" | "Altitude";

/** The subset of `getAgeCaps()` this module reasons about. */
export type AdviceCaps = {
  maxSessionsPerWeek: number;
  minRestDays: number;
  maxMinutesPerSession: number;
};

export type SetupAdviceInput = {
  level: string;
  goals?: string[];
  sport?: string;
  age?: number | null;
  /** Age caps from the same helper the submit path clamps with. */
  caps?: AdviceCaps | null;
};

export type SetupAdvice = {
  daysPerWeek: number;
  restDays: number;
  sessionLengthPref: SessionLengthPref;
  hoursPerWeek: number;
  intensityPref: IntensityPref;
  environment: TrainingEnvironment;
  focusAreas: string[];
  durationWeeks: number;
  /** True when the level is advanced — the wizard drops its "recommended" tone. */
  athleteKnowsBest: boolean;
  /** One line per field explaining the number, shown behind a "why". */
  reasons: {
    daysPerWeek: string;
    restDays: string;
    hoursPerWeek: string;
    sessionLength: string;
    intensity: string;
    environment: string;
    focusAreas: string;
    duration: string;
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
  const trimmedFocus = focusAreas.slice(0, 4);

  const restWord = restDays === 1 ? "rest day" : "rest days";
  const reasons: SetupAdvice["reasons"] = {
    daysPerWeek:
      level === "beginner"
        ? `${daysPerWeek} training days: three full-body sessions with a day between them is where a beginner adapts fastest. More sessions mostly adds fatigue you cannot yet recover from.`
        : level === "intermediate"
        ? `${daysPerWeek} training days: enough frequency to build each quality twice a week without stacking hard days back to back.`
        : `${daysPerWeek} training days: the frequency a trained athlete needs to keep progressing. You know your own week — adjust it.`,
    restDays: restDays === 0
      ? "No dedicated full rest days — only sensible at a high training age, and only if your easy days are genuinely easy."
      : `${restDays} full ${restWord}: a full rest day is where the adaptation you trained for actually happens. ${level === "beginner" ? "Beginners need more of them than they expect." : "Keep at least one."}`,
    hoursPerWeek: `About ${hoursPerWeek}h a week at ${minutes} minutes a session — the total follows from your days and session length, so treat it as a check, not a target.`,
    sessionLength:
      sessionLengthPref === "short"
        ? `Short (about ${minutes} min): enough for a warm-up, the main work and a cooldown once the plan stops diluting it.`
        : sessionLengthPref === "standard"
        ? `Standard (about ${minutes} min): the length most sessions in the plan are written for.`
        : `Long (about ${minutes} min): only worth it if the sessions in your plan are genuinely long — a long slot filled with filler is worse than a short one used well.`,
    intensity: youth
      ? "Easy: while you are still growing, technique and consistency beat intensity. Loading stays sub-maximal."
      : masters
      ? "Balanced: at 45+ the recovery cost of hard sessions rises faster than the benefit. Hard work stays, it just gets spaced out."
      : intensityPref === "hard"
      ? "Hard: as an advanced athlete you can hold high intensity — ride it, and let the deload weeks do their job."
      : "Balanced: hard sessions earn their place when they are the minority of the week, and the weekly deload is not optional.",
    environment: `Mirrors where ${sport ? `a ${sport.toLowerCase()} athlete` : "this sport"} normally trains — change it if your week is really built the other way.`,
    focusAreas: `The stage that matches your level${trimmedFocus.length > LEVEL_FOCUS[level].length ? " plus the goals you picked" : ""}. The plan blends these rather than training them one at a time.`,
    duration: "8 weeks: two 4-week blocks, each ending in a deload — long enough to adapt twice, short enough that you re-plan with better information afterwards.",
    equipment: "Tell us what you actually have. The plan can only prescribe what exists, so it is the one answer only you can give.",
    timeOfDay: "Whatever slot you can keep every week — a plan followed at 6am beats a better one that never happens at 6pm.",
  };

  return {
    daysPerWeek,
    restDays,
    sessionLengthPref,
    hoursPerWeek,
    intensityPref,
    environment,
    focusAreas: trimmedFocus,
    durationWeeks: 8,
    athleteKnowsBest: level === "advanced",
    reasons,
  };
}

/** True when the athlete's current answer already equals the recommendation. */
export function matchesAdvice(advice: SetupAdvice, field: keyof SetupAdvice, value: unknown): boolean {
  const target = advice[field];
  if (Array.isArray(target)) {
    return Array.isArray(value) && value.length === target.length && target.every((v) => value.includes(v));
  }
  return target === value;
}

/** The label the wizard shows on a recommended chip, e.g. `Recommended · 3`. */
export function recommendedLabel(prefix: string, value: number | string): string {
  return `${prefix}${value}`;
}
