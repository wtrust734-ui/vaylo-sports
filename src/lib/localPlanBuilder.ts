// ============================================================================
// LOCAL PLAN BUILDER
// ----------------------------------------------------------------------------
// Generates the weeks for a training plan on the device.
//
// This used to be an AI edge function that charged credits per week. The app is
// free now, and a plan that cannot be generated because a server is switched
// off is not a plan. The builder is deterministic: the same answers produce the
// same weeks, so an athlete can see what their quiz responses changed and no
// session depends on a model being reachable.
//
// It is deliberately conservative. Age caps are applied by the caller before
// this runs (max sessions, minimum rest days), and youth/senior plans reduce
// intensity here as well. When the answers do not support a specific drill,
// the fallback is generic sport work rather than an invented prescription.
// ============================================================================

export type PlanExercise = { name: string; sets: string };

export interface PlanSession {
  day: number;
  dayName?: string;
  title: string;
  type: string;
  duration_minutes: number;
  description?: string;
  warmup?: PlanExercise[];
  exercises?: PlanExercise[];
  cooldown?: PlanExercise[];
  isRest?: boolean;
  isRecovery?: boolean;
  skipped?: boolean;
  [key: string]: unknown;
}

export interface PlanWeek {
  week: number;
  sessions: PlanSession[];
  isDeload?: boolean;
  isHoliday?: boolean;
  [key: string]: unknown;
}

export type PlanData = PlanWeek[];

/**
 * The disability/health options the quiz offers.
 *
 * Deliberately only options that can still train with an adapted plan. A
 * condition where exercise is contraindicated is not a quiz answer here — it is
 * a conversation with a clinician, and asking it would imply this app can plan
 * around it.
 */
export type DisabilitySupport =
  | "none"
  | "mobility"
  | "chronic_pain_fatigue"
  | "vision"
  | "hearing"
  | "neurodivergent"
  | "prefer_not_to_say";

export type PlanQuiz = {
  daysPerWeek: number; hoursPerWeek: number; sessionLengthPref: "short" | "standard" | "long";
  equipment: string[]; environment: string; intensityPref: "easy" | "balanced" | "hard";
  focusAreas: string[]; timeOfDay: string; targetEvent: string; recoveryDays: number;
  /** The athlete's own words. Read for constraints and carried onto sessions. */
  notes?: string;
  /** An access need the plan should account for. */
  disability?: DisabilitySupport;
};

/** What the free-text notes and the access answer changed about the plan. */
export type PlanConstraints = {
  lowImpact: boolean;
  overheadFree: boolean;
  shortSessions: boolean;
  lowEnergy: boolean;
  /** Hard cap on a session, in minutes, when the notes name one. */
  sessionCapMinutes: number | null;
  /** Plain-language adaptations shown on every session. */
  cues: string[];
};

/**
 * Turn the notes and the disability answer into plan-level constraints.
 *
 * This is intentionally conservative and transparent: it recognises a small,
 * explicit set of training constraints (impact, overhead, session length,
 * fatigue) and otherwise keeps the athlete's words on the plan so nothing they
 * wrote is silently discarded. It does not diagnose, and a note it cannot parse
 * still reaches the athlete as a listed adaptation rather than being ignored.
 */
export function planConstraints(quiz?: PlanQuiz): PlanConstraints {
  const notes = (quiz?.notes ?? "").trim();
  const text = notes.toLowerCase();
  const disability = quiz?.disability ?? "none";
  const cues: string[] = [];

  // Body part + a problem word, in either order. A bare "back" or "shoulder"
  // is usually a training goal ("build my back"), not a restriction; matching
  // the body part alone narrowed plans for athletes who were not injured.
  const BODY = "knee|knees|ankle|ankles|shin|shins|achilles|foot|feet|hip|hips|back|shoulder|shoulders";
  const JOINT_ISSUE = "sore|pain\\w*|injur\\w*|ache\\w*|aching|stiff\\w*|tight\\w*|hurt\\w*|tweak\\w*|niggle\\w*|swell\\w*|imping\\w*|tendon\\w*|strain\\w*|bad|weak|dodgy|problem\\w*";
  const joint = new RegExp(
    `(?:${JOINT_ISSUE})[^.]{0,40}\\b(?:${BODY})\\b|\\b(?:${BODY})\\b[^.]{0,40}(?:${JOINT_ISSUE})`,
    "i",
  ).test(text) || /\binjur(?:y|ies|ed)\b(?!\s+(?:prevention|free))/.test(text);
  const noImpact = /\b(no|avoid|can'?t|cannot)\b[^.]{0,24}\b(run|running|jog|jogging|jump|jumping|impact|plyo\w*)\b/.test(text);
  const lowImpact =
    disability === "mobility" ||
    disability === "chronic_pain_fatigue" ||
    joint ||
    noImpact ||
    /\bwheelchair|seated|amputee|limb difference|mobility aid\b/.test(text);

  if (lowImpact) {
    cues.push(
      "Low-impact first: swap running, jumping and plyometrics for cycling, swimming or the elliptical. Keep landings quiet and stop a set if the joint talks to you.",
    );
  }

  // A mobility/limb-difference answer does not mean overhead pressing is
  // unsafe. Only a shoulder note (or a shoulder-specific restriction) makes
  // that call; inventing it for every mobility answer would narrow the plan
  // for no reason.
  const shoulderIssue = new RegExp(`(?:${JOINT_ISSUE})[^.]{0,40}\\bshoulder\\w*\\b|\\bshoulder\\w*\\b[^.]{0,40}(?:${JOINT_ISSUE})`, "i").test(text);
  const overheadFree = shoulderIssue || /\b(no|avoid|can'?t|cannot)\b[^.]{0,24}\boverhead\b/.test(text);
  if (overheadFree) {
    cues.push(
      "No loaded overhead pressing: use a landmine/angled press, neutral-grip floor press or bands until pressing overhead is pain-free.",
    );
  }

  const lowEnergy =
    disability === "chronic_pain_fatigue" ||
    /\b(chronic fatigue|chronic pain|chronic illness|myalgic|\bcfs\b|long covid|tired|exhaust\w*|low energy|energy crash|fatigue)\b/.test(text);
  if (lowEnergy) {
    cues.push(
      "Energy is the limiter, not effort: stop sets two reps before failure, take the longer rest option, and swap a hard day for recovery if the next morning is worse.",
    );
  }

  const shortSessions =
    disability === "neurodivergent" ||
    /\b(adhd|autis\w*|neurodiverg\w*|sensory|overwhelm\w*|short session|short sessions)\b/.test(text);
  if (shortSessions) {
    cues.push(
      "Short, single-focus blocks: one cue at a time, a written checklist, and a visible finish line. Split a session rather than pushing through a lost one.",
    );
  }

  if (disability === "vision") {
    cues.push(
      "Use a familiar, hazard-free space and a guide or tether for any outdoor work; describe the route and turning points before starting.",
    );
  }
  if (disability === "hearing") {
    cues.push(
      "Keep coaching visual: face the athlete when speaking, use written cues and demonstrate rather than call out.",
    );
  }
  if (/\bpregnan\w*\b/.test(text)) {
    cues.push(
      "Pregnancy changes what is appropriate: keep this plan conservative, avoid overheating and contact work, and clear training with your midwife or doctor.",
    );
  }
  if (/\basthma|inhaler\b/.test(text)) {
    cues.push("Keep your reliever inhaler with you and stop if wheeze or chest tightness starts.");
  }
  if (/\bdiabet\w*\b/.test(text)) {
    cues.push("Carry fast-acting carbohydrate and monitor how the session affects your glucose.");
  }
  if (/\bepilep\w*|seizure\w*\b/.test(text)) {
    cues.push("Train with someone who knows your seizure plan, and avoid unsupervised water or height work.");
  }

  const capMatch = text.match(/(?:only|max|maximum|cap|up to|have|free)[^.\n]{0,24}?(\d{2,3})\s*(?:min|mins|minute|minutes)/);
  const parsedCap = capMatch ? Number.parseInt(capMatch[1] ?? "", 10) : NaN;
  const sessionCapMinutes = Number.isFinite(parsedCap) && parsedCap >= 15 ? Math.min(parsedCap, 120) : null;
  if (sessionCapMinutes) {
    cues.push(`Sessions are capped at ${sessionCapMinutes} minutes because that is the time you said you have.`);
  }

  if (notes && !cues.length) {
    cues.push(`Your note is part of this plan's brief: ${notes.slice(0, 240)}`);
  }

  return { lowImpact, overheadFree, shortSessions, lowEnergy, sessionCapMinutes, cues };
}

/**
 * Swap a high-impact or overhead exercise for one the constraints allow.
 *
 * A cue in the session notes is not an adaptation on its own: an athlete with
 * a sore knee who is still prescribed 200 m repeats has not had their note
 * taken into account. This rewrites the handful of movements where the
 * constraint changes what is safe (sprinting, jumping, cleans, overhead
 * pressing) and leaves the rest of the prescription intact.
 */
const adaptExercisesForConstraints = (
  exercises: PlanExercise[],
  constraints: PlanConstraints,
): PlanExercise[] => {
  if (!constraints.lowImpact && !constraints.overheadFree) return exercises;
  return exercises.map((exercise) => {
    const name = exercise.name.toLowerCase();

    if (constraints.overheadFree && /overhead|push press|military press/.test(name)) {
      const isTriceps = /tricep/.test(name);
      return {
        name: isTriceps
          ? "Cable Tricep Pushdown"
          : "Landmine Press (or neutral-grip floor press)",
        sets: `${exercise.sets.split(" — ")[0]} — no loaded overhead pressing; press at an angle that stays pain-free.`,
      };
    }

    if (constraints.lowImpact) {
      if (/\b(jump|jumping|hop|hops|bound|bounds|plyo\w*|pogo\w*|skip\w*|clean|cleans|snatch\w*)\b/.test(name)) {
        return {
          name: "Step-up (low-impact power)",
          sets: "3x8 each leg · controlled, drive through the whole foot — no jumping or landing.",
        };
      }
      if (/\b(sprint\w*|run|running|jog\w*|tempo|stride\w*|interval\w*|acceleration|wicket\w*|shuttle\w*|agility ladder|cutting)\b/.test(name) || /\b\d+\s*m\b/.test(name)) {
        return {
          name: "Low-impact cardio intervals",
          sets: "6x2 min hard / 2 min easy · bike, rower, elliptical or pool — no running or jumping.",
        };
      }
    }

    return exercise;
  });
};

/** Keep the warm-up from reintroducing the impact the session just removed. */
const adaptWarmupForConstraints = (
  warmup: PlanExercise[],
  constraints: PlanConstraints,
): PlanExercise[] => {
  if (!constraints.lowImpact) return warmup;
  return warmup.map((exercise) => {
    const name = exercise.name.toLowerCase();
    if (/jog|run|stride/.test(name)) {
      return { name: "Easy bike or elliptical", sets: "5 min · conversational pace, no impact" };
    }
    if (/a-skip/.test(name)) return { name: "Marching A-drill", sets: "2x20m · drive the knee, stay tall" };
    if (/b-skip/.test(name)) return { name: "Marching B-drill", sets: "2x20m · extend and paw the ground" };
    if (/high knee/.test(name)) return { name: "Standing knee drives", sets: "2x15 each leg · controlled, no impact" };
    if (/butt kick/.test(name)) return { name: "Standing heel pulls", sets: "2x15 each leg · controlled, no impact" };
    if (/skip/.test(name)) return { name: "Marching drill", sets: "2x20m · tall posture, quiet feet" };
    return exercise;
  });
};

export function generatePlanData(sport: string, goal: string, level: string, weeks: number, age: number | null, quiz?: PlanQuiz): PlanData {
  const isYouth = age !== null && age < 18;
  const isSenior = age !== null && age > 50;
  const constraints = planConstraints(quiz);
  // Use quiz-provided days-per-week when available; fall back to legacy heuristic
  const fallbackSessions = isYouth ? Math.min(level === "beginner" ? 3 : 4, 5)
    : isSenior ? Math.min(level === "beginner" ? 3 : 4, 5)
    : level === "beginner" ? 4 : level === "intermediate" ? 5 : 6;
  const sessionsPerWeek = quiz?.daysPerWeek ? Math.max(1, Math.min(7, quiz.daysPerWeek)) : fallbackSessions;
  // Target avg session length (minutes) derived from hours/week ÷ days/week
  const avgSessionMin = quiz?.hoursPerWeek
    ? Math.max(15, Math.min(150, Math.round((quiz.hoursPerWeek * 60) / sessionsPerWeek)))
    : 45;
  const intensityScale = (quiz?.intensityPref === "hard" ? 1.15 : quiz?.intensityPref === "easy" ? 0.8 : 1) * (constraints.lowEnergy ? 0.85 : 1);
  const lengthScale = (quiz?.sessionLengthPref === "long" ? 1.2 : quiz?.sessionLengthPref === "short" ? 0.75 : 1) * (constraints.lowEnergy ? 0.85 : 1);
  const weeklyPlan = [];
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  
  // Build a structured week with rest days
  const buildWeekSessions = (weekNum: number, isDeload: boolean) => {
    const sessions = [];
    const intensityMod = isYouth ? 0.7 : isSenior ? 0.75 : 1;
    
    // Define session types for each day (7 days)
    const weekTemplate = getWeekTemplate(
      sport,
      quiz?.focusAreas ?? [],
      quiz?.recoveryDays ?? Math.max(0, 7 - sessionsPerWeek),
      sessionsPerWeek,
    );
    
    for (let d = 0; d < 7; d++) {
      const template = weekTemplate[d];
      if (template.type === "rest") {
        sessions.push({
          day: d + 1, dayName: dayNames[d], title: "Rest Day", type: "rest",
          duration_minutes: 0, description: "Full rest. Focus on sleep, nutrition, and mental recovery.",
          exercises: [
            { name: "Light stretching or yoga", sets: "10-15 min (optional)" },
            { name: "Foam rolling", sets: "5-10 min if needed" },
            { name: "Target sleep", sets: "8-9 hours tonight" },
            { name: "Hydration", sets: "3L+ throughout the day" },
          ],
          skipped: false, isRest: true,
        });
      } else if (template.type === "recovery") {
        sessions.push({
          day: d + 1, dayName: dayNames[d], title: "Active Recovery", type: "recovery",
          duration_minutes: Math.round((constraints.sessionCapMinutes ? Math.min(25, constraints.sessionCapMinutes) : 25) * intensityMod),
          description: "Low-intensity movement to promote blood flow and recovery. Keep heart rate in Zone 1.",
          exercises: getRecoveryExercises(sport),
          adaptations: constraints.cues,
          skipped: false, isRecovery: true,
        });
      } else {
        // Use quiz-driven avg duration when provided, else legacy curve
        const baseDuration = quiz?.hoursPerWeek
          ? Math.round(avgSessionMin * (isDeload ? 0.7 : 1) * lengthScale * intensityScale * intensityMod)
          : Math.round((isDeload ? 25 : 35) * intensityMod + (weekNum * 1.5) + (d * 2));
        const capped = constraints.sessionCapMinutes
          ? Math.min(constraints.sessionCapMinutes, constraints.shortSessions ? 45 : 180)
          : constraints.shortSessions
            ? 45
            : 180;
        const dur = Math.max(15, Math.min(capped, baseDuration));
        sessions.push({
          day: d + 1, dayName: dayNames[d], title: isDeload ? `${template.title} (Deload)` : template.title,
          type: template.type,
          duration_minutes: dur,
          description: `Week ${weekNum}, ${dayNames[d]} — ${template.title} for ${goal.toLowerCase()} in ${sport}${isDeload ? " (reduced volume — 60% intensity)" : ""}${isYouth ? " [Under-18 limits: lighter loads]" : ""}${isSenior ? " [Senior-adapted: joint-friendly]" : ""}${quiz?.environment ? ` · ${quiz.environment}` : ""}${quiz?.equipment?.length ? ` · equipment: ${quiz.equipment.slice(0, 2).join(", ")}` : ""}`,

          warmup: adaptWarmupForConstraints(getWarmupForType(template.type, sport), constraints),
          exercises: adaptExercisesForConstraints(getExercisesForType(template.title, sport, level, weekNum, isYouth, isDeload), constraints),
          cooldown: getCooldownForType(template.type, sport),
          // Read by the Training detail view. Kept on the session rather than
          // only on the plan row so a session saved or shared on its own still
          // carries the reason its volume was changed.
          adaptations: constraints.cues,
          skipped: false,
        });
      }
    }
    return sessions;
  };

  for (let w = 1; w <= weeks; w++) {
    const isDeload = w % 4 === 0;
    weeklyPlan.push({ week: w, sessions: buildWeekSessions(w, isDeload), isDeload, isHoliday: false });
  }
  return weeklyPlan;
}

type DayTemplate = { title: string; type: string };

/**
 * The sessions this sport can use, most important first.
 *
 * Every pool holds seven entries because a fully-available athlete can train
 * seven days; how many of them are actually used is the athlete's answer, not
 * this list's. Before 2026-10-25 the templates ignored `daysPerWeek` below five
 * (a three-day football plan still got six sessions) and dropped the chosen
 * rest days entirely, so the week on screen was not the week the athlete had
 * asked for.
 */
const SESSION_POOLS: Record<string, DayTemplate[]> = {
  Running: [
    { title: "Speed Work", type: "speed" },
    { title: "Strength Training", type: "strength" },
    { title: "Tempo Run", type: "sport_specific" },
    { title: "Interval Training", type: "intervals" },
    { title: "Long Run", type: "endurance" },
    { title: "Easy Run", type: "endurance" },
    { title: "Cross-Training", type: "cross_training" },
  ],
  "Gym/Weightlifting": [
    { title: "Upper Body Push", type: "upper_push" },
    { title: "Lower Body", type: "lower" },
    { title: "Upper Body Pull", type: "upper_pull" },
    { title: "Full Body Power", type: "power" },
    { title: "Accessory & Core", type: "accessory" },
    { title: "Upper Body", type: "upper" },
    { title: "Full Body", type: "full_body" },
  ],
  Cycling: [
    { title: "Interval Training", type: "intervals" },
    { title: "Endurance Ride", type: "endurance" },
    { title: "Tempo Ride", type: "sport_specific" },
    { title: "Strength Training", type: "strength" },
    { title: "Long Ride", type: "endurance" },
    { title: "Easy Spin", type: "endurance" },
    { title: "Cross-Training", type: "cross_training" },
  ],
  Swimming: [
    { title: "Technique Swim", type: "sport_specific" },
    { title: "Interval Swim", type: "intervals" },
    { title: "Dryland Strength", type: "strength" },
    { title: "Endurance Swim", type: "endurance" },
    { title: "Cross-Training", type: "cross_training" },
    { title: "Sprint Set", type: "speed" },
    { title: "Easy Swim", type: "endurance" },
  ],
  default: [
    { title: "Sport-Specific Drills", type: "sport_specific" },
    { title: "Strength & Power", type: "strength" },
    { title: "Speed & Agility", type: "speed" },
    { title: "Conditioning", type: "conditioning" },
    { title: "Match Simulation", type: "sport_specific" },
    { title: "Cross-Training", type: "cross_training" },
    { title: "Technique Session", type: "sport_specific" },
  ],
};

/**
 * Which session types answer a chosen focus area.
 *
 * A focus area is not decoration: picking "Speed" moves the speed and interval
 * sessions to the front of the week's pool, so a four-day plan contains the
 * work the athlete said they wanted. Areas with no matching session type
 * (`Posture`, `Mobility`…) are handled as cooldown/adaptation work instead, not
 * by inventing a session that does not exist.
 */
const FOCUS_SESSION_TYPES: Record<string, string[]> = {
  Speed: ["speed", "intervals"],
  Agility: ["speed", "sport_specific"],
  Power: ["power", "strength"],
  Explosiveness: ["power", "speed"],
  Plyometrics: ["power", "speed"],
  Strength: ["strength", "lower", "upper", "upper_push", "upper_pull", "full_body"],
  "Muscle Gain": ["strength", "lower", "upper", "upper_push", "upper_pull", "full_body"],
  Endurance: ["endurance", "intervals", "conditioning"],
  "Cardio Base": ["endurance", "conditioning"],
  "VO2 Max": ["intervals", "conditioning"],
  "Sport-Specific": ["sport_specific"],
  "Injury Prevention": ["strength", "recovery"],
  "Active Recovery": ["recovery"],
};

/** Seven days, with the training days spread rather than bunched. */
const trainingDayIndexes = (trainingDays: number): number[] => {
  const count = Math.max(1, Math.min(7, Math.round(trainingDays)));
  return Array.from({ length: count }, (_, i) => Math.floor((i * 7) / count));
};

/**
 * The seven-day template for one week.
 *
 * Training days are spread across the week and then the leftover days are
 * divided exactly as the athlete answered: `recoveryDays` of them are full rest,
 * and any remaining days are active recovery. The old templates hard-coded
 * rest on a fixed weekday and ignored both answers, so a 3-day plan could
 * contain five sessions and a "6 days + 1 rest" answer could be written as
 * 6 sessions + 2 rest.
 */
const getWeekTemplate = (
  sport: string,
  focusAreas: string[],
  recoveryDays: number,
  sessionsPerWeek: number,
): DayTemplate[] => {
  const pool = [...(SESSION_POOLS[sport] ?? SESSION_POOLS.default)];
  const preferred = new Set(focusAreas.flatMap((area) => FOCUS_SESSION_TYPES[area] ?? []));
  if (preferred.size > 0) {
    // Stable sort: matching sessions come forward without shuffling the rest
    // of the sport's own order.
    pool.sort((a, b) => Number(preferred.has(b.type)) - Number(preferred.has(a.type)));
  }

  const trainingDays = Math.max(1, Math.min(7, Math.round(sessionsPerWeek)));
  const slots = new Set(trainingDayIndexes(trainingDays));
  const nonTrainingDays = Array.from({ length: 7 }, (_, d) => d).filter((d) => !slots.has(d));
  const fullRestDays = new Set(
    nonTrainingDays.slice(Math.max(0, nonTrainingDays.length - Math.max(0, Math.round(recoveryDays)))),
  );

  const template: DayTemplate[] = [];
  let sessionIndex = 0;
  for (let day = 0; day < 7; day += 1) {
    if (slots.has(day)) {
      template.push(pool[sessionIndex % pool.length]);
      sessionIndex += 1;
    } else if (fullRestDays.has(day)) {
      template.push({ title: "Rest Day", type: "rest" });
    } else {
      template.push({ title: "Active Recovery", type: "recovery" });
    }
  }
  return template;
};

const getWarmupForType = (type: string, sport: string) => {
  if (type === "strength" || type === "upper_push" || type === "upper_pull" || type === "lower" || type === "upper" || type === "full_body" || type === "power" || type === "accessory") {
    return [
      { name: "Light rowing or cycling", sets: "3 min · easy pace, get blood flowing" },
      { name: "Arm circles (forward & back)", sets: "15 each direction" },
      { name: "Band pull-aparts", sets: "2x15 · light resistance, slow tempo" },
      { name: "Cat-cow stretches", sets: "10 reps · breathe deeply each rep" },
      { name: "Bodyweight squats", sets: "15 reps · pause at bottom 2 sec" },
      { name: "Inchworms", sets: "6 reps · walk hands out, hold plank 3 sec" },
      { name: "Warm-up sets of first exercise", sets: "2x8 @ 40-50% working weight" },
    ];
  }
  if (type === "speed" || type === "intervals" || type === "sport_specific" || type === "conditioning") {
    return [
      { name: "Light jog", sets: "4 min · conversational pace" },
      { name: "Leg swings (front & side)", sets: "12 each leg, each direction" },
      { name: "A-skips", sets: "2x20m · drive knee, dorsiflex ankle" },
      { name: "B-skips", sets: "2x20m · extend and paw ground" },
      { name: "High knees", sets: "2x15m · quick turnover, stay tall" },
      { name: "Butt kicks", sets: "2x15m · heel to glute" },
      { name: "Walking lunges with rotation", sets: "8 each leg · twist toward front leg" },
      { name: "Strides", sets: "3x50m @ 70% · smooth acceleration" },
    ];
  }
  if (type === "endurance") {
    return [
      { name: "Walk to easy jog", sets: "5 min · gradually increase pace" },
      { name: "Dynamic leg swings", sets: "10 each direction" },
      { name: "Ankle circles", sets: "10 each direction" },
      { name: "Gentle high knees", sets: "15 sec" },
      { name: "Deep breathing", sets: "1 min · box breathing 4-4-4-4" },
    ];
  }
  return [
    { name: "Light movement (jog/walk)", sets: "3 min" },
    { name: "Dynamic stretching", sets: "5 min · full body" },
    { name: "Joint circles", sets: "10 each joint" },
  ];
};

const getCooldownForType = (type: string, sport: string) => {
  if (type === "strength" || type === "upper_push" || type === "upper_pull" || type === "lower" || type === "upper" || type === "full_body" || type === "power" || type === "accessory") {
    return [
      { name: "Light walking", sets: "2 min · slow pace, let HR come down" },
      { name: "Chest doorway stretch", sets: "30s each side · gentle pull" },
      { name: "Standing quad stretch", sets: "30s each leg · hold wall for balance" },
      { name: "Seated hamstring stretch", sets: "30s each leg · reach for toes" },
      { name: "Child's pose", sets: "45s · sink hips, reach arms forward" },
      { name: "Cross-body shoulder stretch", sets: "20s each arm" },
      { name: "Deep breathing", sets: "1 min · 4-count inhale, 6-count exhale" },
    ];
  }
  return [
    { name: "Easy walk/jog", sets: "3 min · gradually slow down" },
    { name: "Standing quad stretch", sets: "30s each leg" },
    { name: "Hamstring stretch", sets: "30s each leg" },
    { name: "Hip flexor stretch", sets: "30s each side" },
    { name: "Calf stretch", sets: "30s each leg" },
    { name: "Pigeon stretch", sets: "30s each side" },
    { name: "Foam rolling (if available)", sets: "5 min · quads, hamstrings, calves, IT band" },
    { name: "Deep breathing", sets: "1 min · box breathing 4-4-4-4" },
  ];
};

const getRecoveryExercises = (sport: string) => [
  { name: "Easy walk or light swim", sets: "15 min · Zone 1 HR, should feel effortless" },
  { name: "Foam rolling (full body)", sets: "10 min · 30-45s per muscle group, focus tight areas" },
  { name: "Yoga flow (Sun Salutation A)", sets: "3 rounds · slow, controlled breathing" },
  { name: "Hip 90/90 stretches", sets: "45s each side · gently rock into stretch" },
  { name: "Cat-cow + Thread the needle", sets: "10 reps each · follow breath" },
  { name: "Couch stretch (hip flexors)", sets: "60s each side · lean into stretch gently" },
  { name: "Supine spinal twist", sets: "30s each side" },
  { name: "Deep breathing (box breathing)", sets: "3 min · 4-4-4-4 pattern" },
];

const getExercisesForType = (type: string, sport: string, level: string, week: number, isYouth: boolean, isDeload: boolean = false) => {
  const s = isDeload ? 3 : level === "beginner" ? 3 : level === "intermediate" ? 4 : 5;
  const r = isYouth ? 8 : isDeload ? 8 : level === "beginner" ? 8 : level === "intermediate" ? 10 : 12;
  const reps = `${s}x${r}`;
  const heavyReps = `${s}x${Math.max(r - 4, 3)}`;
  const wk = Math.min(week, 12);
  const restSec = level === "beginner" ? "90s" : level === "intermediate" ? "75s" : "60s";
  const rpe = isDeload ? 5 : 6 + Math.min(wk, 4);
  const deloadNote = isDeload ? " (DELOAD: reduce weight 40%)" : "";

  if (type === "Strength Training" || type === "Strength & Power") return [
    { name: "Back Squat", sets: `${reps} @ RPE ${rpe} · ${restSec} rest${deloadNote} — feet shoulder-width, brace core, break parallel, drive through heels` },
    { name: "Romanian Deadlift (RDL)", sets: `${reps} @ RPE ${Math.max(rpe - 1, 5)} · ${restSec} rest — hip hinge, soft knees, feel hamstring stretch, bar close to legs` },
    { name: "Bench Press", sets: `${reps} @ RPE ${rpe} · ${restSec} rest — retract scapulae, feet flat, control descent 2-3 sec, pause at chest` },
    { name: "Bent-Over Barbell Row", sets: `${reps} @ RPE ${Math.max(rpe - 1, 5)} · ${restSec} rest — 45° torso angle, pull to lower chest, squeeze lats 1 sec` },
    { name: "Overhead Press (Standing)", sets: `${s}x${r - 2} @ RPE ${rpe} · ${restSec} rest — brace core+glutes, slight arc, full lockout overhead` },
    { name: "Weighted Pull-ups (or Lat Pulldown)", sets: `${heavyReps} · 90s rest — full hang, chin over bar, controlled descent 3 sec` },
    { name: "Barbell Hip Thrust", sets: `${s}x${r} · ${restSec} rest — shoulders on bench, full lockout, squeeze glutes 2 sec at top` },
    { name: "Plank + Side Plank", sets: `3x45s each (plank, left, right) · 30s rest between — neutral spine, brace hard` },
  ];

  if (type === "Upper Body Push") return [
    { name: "Bench Press", sets: `${s}x${r} @ RPE ${rpe} · ${restSec} rest${deloadNote} — retract scapulae, arch slightly, control 3 sec eccentric` },
    { name: "Incline Dumbbell Press (30°)", sets: `${s}x${r} · ${restSec} rest — squeeze at top, lower to chest level, 2 sec pause` },
    { name: "Standing Overhead Press", sets: `${s}x${r - 2} @ RPE ${rpe} · ${restSec} rest — strict form, no leg drive, full lockout` },
    { name: "Dumbbell Lateral Raises", sets: `3x15 · 45s rest — slight lean, pinky up, control the weight down 3 sec` },
    { name: "Tricep Dips (weighted if able)", sets: `${s}x${r} · 60s rest — lean slightly forward, full range of motion` },
    { name: "Cable Flyes", sets: `3x12 · 45s rest — slight bend in elbows, squeeze chest at centre` },
    { name: "Face Pulls", sets: `3x15 · 45s rest — pull to forehead, external rotate, squeeze 2 sec` },
  ];

  if (type === "Upper Body Pull") return [
    { name: "Weighted Pull-ups (or Lat Pulldown)", sets: `${s}x${r - 2} · 90s rest${deloadNote} — full dead hang, pull to chest, 3 sec negative` },
    { name: "Barbell Bent-Over Row", sets: `${s}x${r} @ RPE ${rpe} · ${restSec} rest — 45° angle, pull to navel, squeeze 1 sec` },
    { name: "Seated Cable Row", sets: `${s}x${r} · 60s rest — pull to lower chest, squeeze shoulder blades together` },
    { name: "Dumbbell Rear Delt Flyes", sets: `3x15 · 45s rest — chest on bench, squeeze rear delts 2 sec` },
    { name: "Barbell Curl", sets: `3x${r} · 60s rest — no swinging, full range, 2 sec eccentric` },
    { name: "Hammer Curls", sets: `3x12 · 45s rest — neutral grip, control throughout` },
    { name: "Face Pulls", sets: `3x15 · 45s rest — high cable, external rotate at end` },
  ];

  if (type === "Lower Body") return [
    { name: "Back Squat", sets: `${s}x${r} @ RPE ${rpe} · ${restSec} rest${deloadNote} — brace core, knees track toes, break parallel, 2 sec pause at bottom` },
    { name: "Romanian Deadlift", sets: `${s}x${r} @ RPE ${Math.max(rpe - 1, 5)} · ${restSec} rest — hip hinge, bar close, feel hamstring stretch at bottom` },
    { name: "Bulgarian Split Squat", sets: `3x10 each leg · 60s rest — rear foot on bench, torso upright, full depth` },
    { name: "Leg Press", sets: `${s}x${r} · ${restSec} rest — feet shoulder-width, don't lock out, controlled eccentric 3 sec` },
    { name: "Leg Curl (lying or seated)", sets: `3x12 · 45s rest — squeeze at peak, 3 sec eccentric` },
    { name: "Calf Raises (standing)", sets: `4x15 · 45s rest — full stretch at bottom, pause at top 2 sec` },
    { name: "Weighted Plank", sets: `3x45s · 30s rest — plate on back, brace hard, neutral spine` },
  ];

  if (type === "Upper Body") return [
    { name: "Bench Press", sets: `${s}x${r} @ RPE ${rpe} · ${restSec} rest — retract scapulae, 3 sec descent, pause at chest` },
    { name: "Barbell Row", sets: `${s}x${r} @ RPE ${Math.max(rpe - 1, 5)} · ${restSec} rest — 45° angle, pull to navel` },
    { name: "Overhead Press", sets: `${s}x${r - 2} · ${restSec} rest — strict, no leg drive` },
    { name: "Pull-ups/Lat Pulldown", sets: `${s}x${r - 2} · 90s rest — full range, control negative` },
    { name: "Lateral Raises", sets: `3x15 · 45s rest — controlled, slight lean forward` },
    { name: "Tricep Pushdowns", sets: `3x12 · 45s rest — elbows pinned, full extension` },
    { name: "Barbell Curl", sets: `3x12 · 45s rest — strict form, no swing` },
  ];

  if (type === "Full Body" || type === "Full Body Power") return [
    { name: "Power Clean (or Hang Clean)", sets: `${s}x${Math.max(r - 5, 3)} @ RPE ${rpe} · 2 min rest${deloadNote} — explosive hip extension, catch in front squat position` },
    { name: "Front Squat", sets: `${s}x${r - 2} · 90s rest — elbows high, brace hard, break parallel` },
    { name: "Push Press", sets: `${s}x${r - 2} · 90s rest — quarter dip, explosive press, use legs to drive` },
    { name: "Pendlay Row", sets: `${s}x${r} · 75s rest — dead stop each rep, explosive pull to sternum` },
    { name: "Dumbbell Walking Lunges", sets: `3x12 each leg · 60s rest — long stride, knee tracks toe, upright torso` },
    { name: "Plank to Push-up", sets: `3x10 · 45s rest — plank position, press up one hand at a time, alternate lead hand` },
  ];

  if (type === "Accessory & Core") return [
    { name: "Dumbbell Lateral Raises", sets: `4x15 · 45s rest — slight lean, control the negative 3 sec` },
    { name: "Cable Face Pulls", sets: `4x15 · 45s rest — pull to forehead, external rotate, squeeze 2 sec` },
    { name: "Incline Dumbbell Curl", sets: `3x12 · 45s rest — full stretch at bottom, squeeze at top` },
    { name: "Overhead Tricep Extension (cable)", sets: `3x12 · 45s rest — full stretch, lock out at bottom` },
    { name: "Hanging Leg Raises", sets: `4x12 · 45s rest — control the swing, curl pelvis up` },
    { name: "Cable Woodchops", sets: `3x12 each side · 45s rest — rotate through core, arms stay straight` },
    { name: "Ab Wheel Rollouts (or Plank)", sets: `3x10 · 45s rest — brace core, don't let hips sag` },
    { name: "Farmer's Walk", sets: `3x40m · 60s rest — heavy dumbbells/kettlebells, upright posture, squeeze grip` },
  ];

  if (type === "Speed Work" || type === "Speed & Agility") {
    if (sport === "Running" || sport === "Athletics") return [
      { name: "200m Repeats", sets: `${3 + Math.min(wk, 3)}x200m @ 85-90% effort · 2-3 min walk/jog recovery — focus on relaxed speed, pumping arms, driving knees` },
      { name: "Flying 30m Sprints", sets: `4x30m @ 95% · full walking recovery (2-3 min) — build-up run 20m then sprint 30m, stay relaxed` },
      { name: "Hill Sprints", sets: `${4 + Math.min(wk, 4)}x60m steep hill · jog down recovery — short, choppy steps, drive arms hard, lean into hill` },
      { name: "Wicket Runs", sets: `4x40m · walk back recovery — set mini-hurdles at stride length, focus on turnover speed and dorsiflexion` },
      { name: "Acceleration Drills (3-point start)", sets: `5x20m · 90s rest — powerful push-off, low drive phase, pump arms, gradual rise` },
    ];
    if (sport === "Football" || sport === "Basketball" || sport === "Rugby") return [
      { name: "T-Test Agility Drill", sets: `5 reps · 90s rest — sprint forward 10m, shuffle left 5m, shuffle right 10m, shuffle left 5m, backpedal 10m` },
      { name: "5-10-5 Pro Shuttle", sets: `6 reps · 90s rest — sprint 5yd, plant & turn 180°, sprint 10yd, plant & turn, sprint 5yd` },
      { name: "Cone Weave Sprints", sets: `4x30m · 60s rest — weave through 8 cones, stay low, push off outside foot` },
      { name: "Reaction Sprints", sets: `6x10m · full rest — partner calls direction, explode and sprint` },
      { name: "Sprint Intervals", sets: `8x30m · 90s rest — max effort, walk back to start` },
    ];
    return [
      { name: `${sport}-specific speed drills`, sets: `${20 + wk * 2} min total · match intensity intervals with full recovery` },
      { name: "Agility ladder", sets: `3x through full pattern · 30s rest between — in-in-out-out, ickey shuffle, 2-in/2-out` },
      { name: "Reaction sprints", sets: `6x10m · full rest — visual or auditory cue, explosive first step` },
    ];
  }

  if (type === "Tempo Run") return [
    { name: "Tempo Run", sets: `${20 + wk * 2} min @ lactate threshold pace (comfortably hard — can speak in 3-4 word phrases) — steady effort, don't speed up mid-run` },
    { name: "Strides after tempo", sets: `4x100m @ 80% · walk back — smooth, tall, relaxed` },
  ];

  if (type === "Interval Training") {
    if (sport === "Running" || sport === "Athletics") return [
      { name: "400m Repeats", sets: `${4 + Math.min(wk, 4)}x400m @ 90-95% · 90s-2 min jog recovery — hold consistent pace, don't start too fast` },
      { name: "200m at Race Pace", sets: `3x200m @ race pace · full recovery — practice target pace, feel the rhythm` },
    ];
    if (sport === "Cycling") return [
      { name: "4 min On / 3 min Off Intervals", sets: `${4 + Math.min(wk, 3)} sets @ 105-110% FTP · recover at 50% FTP — seated, smooth pedal stroke` },
      { name: "30/30 Intervals", sets: `10x(30s hard / 30s easy) · high cadence, explosive power` },
    ];
    if (sport === "Swimming") return [
      { name: "100m Repeats", sets: `${6 + Math.min(wk, 4)}x100m @ threshold pace · 15-20s rest — focus on stroke count, smooth catch` },
      { name: "50m Sprint Intervals", sets: `4x50m @ race pace · 30s rest — explosive off the wall, strong kick` },
    ];
    return [
      { name: "High-intensity interval training", sets: `${20 + wk} min — 30s work / 30s rest × 10-15 rounds, max effort each interval` },
    ];
  }

  if (type === "Long Run") return [
    { name: "Long Run", sets: `${40 + wk * 3} min @ Zone 2 (easy conversational pace — you should be able to hold a full conversation)` },
    { name: "Negative split last 10 min", sets: "Increase pace slightly — feel strong, don't sprint, just pick it up" },
  ];

  if (type === "Endurance Ride" || (type === "Long Ride" && sport === "Cycling")) return [
    { name: "Endurance Ride", sets: `${50 + wk * 3} min · Zone 2-3 — steady cadence 80-90 RPM, stay aero, focus on smooth pedalling` },
    { name: "Cadence Drills (last 15 min)", sets: `3x3 min @ 100+ RPM · 2 min easy — spin faster, not harder` },
  ];

  if (type === "Conditioning") return [
    { name: "Shuttle Runs", sets: `6x20m · 60s rest — touch line, turn, sprint back, all out effort` },
    { name: "Burpee to Broad Jump", sets: `4x8 · 75s rest — chest to floor, explosive jump forward` },
    { name: "Medicine Ball Slams", sets: `3x12 · 45s rest — overhead, slam hard, catch on bounce, repeat fast` },
    { name: "Battle Ropes", sets: `4x30s · 45s rest — alternating waves, full amplitude, stay low` },
    { name: "Box Jumps", sets: `3x8 · 60s rest — step down (don't jump), explosive drive, land soft` },
  ];

  if (type === "Cross-Training") return [
    { name: sport === "Running" ? "Swimming (easy technique)" : "Easy Run", sets: `${25 + wk} min · Zone 2 heart rate — cross-training improves aerobic base without impact stress` },
    { name: sport === "Cycling" ? "Rowing" : "Cycling (steady)", sets: `${20 + wk} min · conversational pace — low impact, maintain cadence` },
    { name: "Core Circuit", sets: `3 rounds: 30s plank, 15 sit-ups, 10 back extensions, 20 bicycle crunches · 60s rest between rounds — no rushing, quality reps` },
  ];

  if (type === "Sport-Specific Drills" || type === "Sport-Specific" || type === "Match Simulation") {
    if (sport === "Running" || sport === "Athletics") return [
      { name: "Easy Run (Zone 2)", sets: `${25 + wk * 2} min · conversational pace — nasal breathing if possible, 180+ cadence` },
      { name: "Strides", sets: `${4 + Math.min(wk, 4)}x100m @ 80% · walk back — smooth, tall, relaxed form` },
      { name: "Drills (A-skip, B-skip, high knees)", sets: "2x30m each drill — focus on technique, not speed" },
    ];
    if (sport === "Gym/Weightlifting") return [
      { name: "Clean & Jerk", sets: `${s}x${Math.max(r - 5, 2)} @ RPE ${rpe} · 2 min rest — explosive hip drive, fast elbows, catch in front rack, drive press overhead` },
      { name: "Snatch", sets: `${s}x${Math.max(r - 5, 2)} @ RPE ${rpe} · 2 min rest — wide grip, pull close, fast turnover, catch overhead with locked arms` },
      { name: "Front Squat", sets: `${reps} · 90s rest — high elbows, brace core, break parallel` },
      { name: "Pendlay Row", sets: `${reps} · 75s rest — dead stop each rep, explosive pull to sternum` },
    ];
    if (sport === "Swimming") return [
      { name: "Warm-up swim", sets: "400m easy mixed stroke — loosen up, focus on body position" },
      { name: "Main set", sets: `${4 + Math.min(wk, 4)}x100m @ threshold · 20s rest — hold stroke count, smooth catch and pull` },
      { name: "Kick set", sets: "4x50m with board · 15s rest — kick from hips, pointed toes, steady rhythm" },
      { name: "Cool-down", sets: "200m easy — choice of stroke, relax" },
    ];
    if (sport === "Cycling") return [
      { name: "Endurance Ride", sets: `${40 + wk * 3} min · Zone 2-3 — steady cadence 80-90 RPM` },
      { name: "Cadence Drills", sets: "4x3 min @ 100+ RPM · 2 min easy spin — focus on smooth circular pedalling" },
      { name: "Seated Climbs", sets: `3x5 min @ threshold · 3 min recovery — stay seated, gear up, grind` },
    ];
    if (sport === "Football" || sport === "Basketball" || sport === "Rugby") return [
      { name: "Agility Ladder Drills", sets: "3x full pattern · 45s rest — quick feet, stay low, eyes up, precise footwork" },
      { name: "Cone Drills (T-test, 5-10-5)", sets: `${4 + Math.min(wk, 3)} reps · 60s rest — plant hard, push off outside foot, stay low through turns` },
      { name: "Small-Sided Game Simulation", sets: `${15 + wk} min — match intensity with short recovery, replicate game scenarios` },
      { name: "Sprint Intervals", sets: `6x30m · 90s rest — max effort, replicate game-speed bursts` },
    ];
    return [
      { name: `${sport} skill practice`, sets: `${25 + wk * 2} min · focused technique — deliberate practice, quality over quantity` },
      { name: "Sport-specific conditioning", sets: `${15 + wk} min · match intensity intervals — replicate competition demands` },
    ];
  }

  if (type === "Technique Swim" || type === "Dryland Strength" || type === "Endurance Swim") {
    if (type === "Technique Swim") return [
      { name: "Catch-up drill", sets: "4x50m · 15s rest — one arm completes full stroke before other starts" },
      { name: "Fingertip drag drill", sets: "4x50m · 15s rest — drag fingertips along surface, high elbow recovery" },
      { name: "Kick on side drill", sets: "4x25m each side · 10s rest — one arm extended, body rotated" },
      { name: "Build swims", sets: "4x100m · 20s rest — start easy, finish at race pace" },
    ];
    if (type === "Dryland Strength") return [
      { name: "Push-ups", sets: `${s}x15 · 45s rest — chest to floor, full lockout` },
      { name: "Lat Pulldowns", sets: `${s}x${r} · 60s rest — wide grip, pull to upper chest` },
      { name: "Tricep Dips", sets: `${s}x${r} · 60s rest — full depth, controlled` },
      { name: "Plank", sets: "3x45s · 30s rest — core tight, flat back" },
      { name: "Russian Twists", sets: "3x20 · 30s rest — feet elevated, medicine ball" },
    ];
    return [
      { name: "Endurance Swim", sets: `${wk * 50 + 800}m continuous · Zone 2 — steady stroke, breathe every 3 strokes` },
      { name: "Pull buoy set", sets: "4x100m · 15s rest — focus on upper body catch and pull" },
    ];
  }

  return [{ name: `${sport} ${type} Training`, sets: `${30 + week * 2} min · sport-specific work at moderate intensity` }];
};
