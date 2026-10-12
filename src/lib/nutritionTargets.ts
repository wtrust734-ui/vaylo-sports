// ============================================================================
// NUTRITION TARGETS — a starting number, derived rather than guessed
// ----------------------------------------------------------------------------
// The plan used to open with four empty boxes: Daily Calories, Protein, Carbs,
// Fat. An athlete who has never counted a macro has no idea what belongs in
// them, so the app asked the one question it could not answer for them and
// stored whatever they typed. That is the opposite of help.
//
// This module is the answer. It takes the things that actually decide a daily
// intake — age, body size, how much they train and what they are training for —
// and returns a number with its reasoning attached, so the athlete can see WHY
// it is what it is and disagree with it deliberately instead of guessing.
//
// Two rules run through everything below:
//
//   • It is arithmetic, not advice. Nothing here diagnoses, treats or promises
//     a body-composition outcome, and it is adult-only by construction (the
//     screen refuses anyone under 18 before this is ever called).
//   • Every output is clamped. A typo in a weight field, an age of 3, 99
//     sessions a week — none of them may produce a target the app then stores
//     and an athlete then eats to. The bounds are wide enough to be useful and
//     hard enough that no input can escape them.
//
// Pure: no React, no Supabase, no provider call. The plan's MEALS come from the
// model; what to aim at comes from here.
// ============================================================================

/** The goals the generator accepts, in its own spelling. */
export const NUTRITION_GOALS = ["Cut", "Maintain", "Bulk"] as const;
export type NutritionGoal = (typeof NUTRITION_GOALS)[number];

/** How the athlete spends the day outside training. */
export const ACTIVITY_LEVELS = ["desk", "on_feet", "manual"] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/** Dietary patterns the plan writer must respect. */
export const DIETARY_PATTERNS = ["omnivore", "vegetarian", "vegan", "pescatarian", "halal", "kosher"] as const;
export type DietaryPattern = (typeof DIETARY_PATTERNS)[number];

/**
 * Only used by the BMR equation, which is calibrated on binary sex. An athlete
 * who does not want to say gets the midpoint of the two constants rather than a
 * lecture — the honest description of what an unspecified answer does.
 */
export const BIOLOGICAL_SEXES = ["male", "female", "unspecified"] as const;
export type BiologicalSex = (typeof BIOLOGICAL_SEXES)[number];

export type NutritionIntake = {
  goal: NutritionGoal;
  /** 1–12, the server's own bound. */
  weeks: number;
  trainingDaysPerWeek: number;
  sessionMinutes: number;
  activityLevel: ActivityLevel;
  weightKg: number | null;
  heightCm: number | null;
  sex: BiologicalSex;
  dietaryPattern: DietaryPattern;
  /** Free text: foods they avoid or react to. Passed to the writer verbatim. */
  foodDislikes: string;
  mealsPerDay: number;
  /** Anything else for the coach: allergies, shift work, what they hate eating. */
  notes: string;
};

export type TargetRecommendation = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** Mifflin-St Jeor, before activity. */
  bmr: number;
  /** BMR x the activity factor, before the goal adjustment. */
  maintenance: number;
  /** Two to four short sentences saying which inputs moved the number. */
  basis: string[];
};

export const NUTRITION_INTAKE_DEFAULTS: NutritionIntake = {
  goal: "Maintain",
  weeks: 4,
  trainingDaysPerWeek: 4,
  sessionMinutes: 60,
  activityLevel: "on_feet",
  weightKg: null,
  heightCm: null,
  sex: "unspecified",
  dietaryPattern: "omnivore",
  foodDislikes: "",
  mealsPerDay: 4,
  notes: "",
};

/** The one place the numbers inside `recommendTargets` are allowed to live. */
export const RECOMMENDATION_BOUNDS = {
  age: { min: 18, max: 90 },
  weightKg: { min: 30, max: 250 },
  heightCm: { min: 130, max: 230 },
  days: { min: 0, max: 7 },
  minutes: { min: 15, max: 240 },
  mealsPerDay: { min: 2, max: 6 },
  calories: { min: 1200, max: 6000 },
  protein: { min: 40, max: 400 },
  fat: { min: 20, max: 300 },
  carbs: { min: 0, max: 900 },
} as const;

/** Weight/height assumed when the athlete has not given them, named in `basis`. */
export const ASSUMED_WEIGHT_KG = 75;
export const ASSUMED_HEIGHT_CM = 175;

/**
 * Round into a range. A value that is not a finite number lands on the FLOOR of
 * the range rather than travelling through as NaN.
 *
 * That guard is not defensive noise: `Math.max(0, Math.min(7, Math.round(NaN)))`
 * is NaN in JavaScript, so a single junk field (a blank weight, a cleared input
 * posted as NaN) would have produced `calories: NaN` all the way to the screen
 * and into the stored plan. Passing through a NaN is how a form that cannot
 * afford one does.
 */
const clampInt = (value: number, min: number, max: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
};

const inRange = (value: unknown, min: number, max: number): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(String(value) as T) ? (String(value) as T) : fallback;

// ---------------------------------------------------------------------------
// What the questionnaire starts from
// ---------------------------------------------------------------------------

/** Total daily energy: 1.2 sitting all day, 1.55 physical work all day. */
const ACTIVITY_BASE: Record<ActivityLevel, number> = {
  desk: 1.2,
  on_feet: 1.35,
  manual: 1.55,
};

/** Each hour of training a week adds this much to the multiplier. */
const PER_TRAINING_HOUR = 0.025;
/** Above this the multiplier stops being plausible for a human being. */
const MAX_ACTIVITY_FACTOR = 2.1;

/** Where a saved profile suggests the goal should start. */
export function goalFromProfile(goals: string | null | undefined): NutritionGoal {
  const text = String(goals ?? "").toLowerCase();
  if (/(cut|lose|lean|deficit|fat loss|weight loss)/.test(text)) return "Cut";
  if (/(bulk|gain|muscle|hypertroph|mass)/.test(text)) return "Bulk";
  return "Maintain";
}

/**
 * The intake the questionnaire opens with: the athlete's own profile where it
 * has an answer, anything they saved on a previous visit on top, and the
 * documented defaults everywhere else.
 */
export function prefillIntake(input: {
  weightKg?: number | null;
  heightCm?: number | null;
  goals?: string | null;
  saved?: Partial<NutritionIntake> | null;
}): NutritionIntake {
  const saved = input.saved ?? {};
  return {
    ...NUTRITION_INTAKE_DEFAULTS,
    ...saved,
    goal: saved.goal ?? goalFromProfile(input.goals),
    weightKg:
      saved.weightKg ??
      inRange(input.weightKg, RECOMMENDATION_BOUNDS.weightKg.min, RECOMMENDATION_BOUNDS.weightKg.max),
    heightCm:
      saved.heightCm ??
      inRange(input.heightCm, RECOMMENDATION_BOUNDS.heightCm.min, RECOMMENDATION_BOUNDS.heightCm.max),
  };
}

/**
 * A row from `user_settings` — strings, numbers and nulls, written by whichever
 * build last saved them — turned back into a usable intake.
 *
 * Every field falls back rather than throwing: a column added by a newer build
 * is absent here, a value a future build renames is simply not recognised, and
 * the questionnaire still opens with something sensible instead of a blank
 * screen over a lint error.
 */
export function normalizeIntake(
  raw: Record<string, unknown> | null | undefined,
  fallback: NutritionIntake = NUTRITION_INTAKE_DEFAULTS,
): NutritionIntake {
  if (!raw) return { ...fallback };
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
  return {
    goal: oneOf(raw.goal ?? raw.nutrition_goal, NUTRITION_GOALS, fallback.goal),
    weeks: clampInt(
      inRange(raw.weeks, 1, 12) ?? fallback.weeks,
      1,
      12,
    ),
    trainingDaysPerWeek: clampInt(
      inRange(raw.training_days_per_week, RECOMMENDATION_BOUNDS.days.min, RECOMMENDATION_BOUNDS.days.max) ??
        fallback.trainingDaysPerWeek,
      RECOMMENDATION_BOUNDS.days.min,
      RECOMMENDATION_BOUNDS.days.max,
    ),
    sessionMinutes: clampInt(
      inRange(raw.typical_session_minutes, RECOMMENDATION_BOUNDS.minutes.min, RECOMMENDATION_BOUNDS.minutes.max) ??
        fallback.sessionMinutes,
      RECOMMENDATION_BOUNDS.minutes.min,
      RECOMMENDATION_BOUNDS.minutes.max,
    ),
    activityLevel: oneOf(raw.activity_level, ACTIVITY_LEVELS, fallback.activityLevel),
    weightKg:
      inRange(raw.weight, RECOMMENDATION_BOUNDS.weightKg.min, RECOMMENDATION_BOUNDS.weightKg.max) ?? fallback.weightKg,
    heightCm:
      inRange(raw.height, RECOMMENDATION_BOUNDS.heightCm.min, RECOMMENDATION_BOUNDS.heightCm.max) ?? fallback.heightCm,
    sex: oneOf(raw.sex, BIOLOGICAL_SEXES, fallback.sex),
    dietaryPattern: oneOf(raw.dietary_pattern, DIETARY_PATTERNS, fallback.dietaryPattern),
    foodDislikes: text(raw.food_dislikes, 300),
    mealsPerDay: clampInt(
      inRange(raw.meals_per_day, RECOMMENDATION_BOUNDS.mealsPerDay.min, RECOMMENDATION_BOUNDS.mealsPerDay.max) ??
        fallback.mealsPerDay,
      RECOMMENDATION_BOUNDS.mealsPerDay.min,
      RECOMMENDATION_BOUNDS.mealsPerDay.max,
    ),
    notes: text(raw.notes, 400),
  };
}

// ---------------------------------------------------------------------------
// The recommendation
// ---------------------------------------------------------------------------

const goalLabel = (goal: NutritionGoal): string =>
  goal === "Cut" ? "a deficit" : goal === "Bulk" ? "a surplus" : "maintenance";

/**
 * A starting target, with its working shown.
 *
 * Mifflin-St Jeor for BMR (the equation the sports-nutrition literature
 * recommends for a general athletic population), an activity factor built from
 * the athlete's own training week rather than a dropdown guess, then the goal
 * adjustment. Protein and fat are set per kg of body weight; carbohydrate is
 * whatever is left, which is the order that protects the two that matter.
 */
export function recommendTargets(intake: NutritionIntake, age: number): TargetRecommendation {
  const basis: string[] = [];

  // An age outside the adult band is moved to the NEAREST end of it rather than
  // replaced by the midpoint: if a child's age ever reaches this function the
  // result must be an adult's floor, not an adult's average, and an age that is
  // not a number at all (no date of birth) is the one case that falls back to a
  // typical adult.
  const rawAge = typeof age === "number" ? age : Number(age);
  const safeAge = Number.isFinite(rawAge)
    ? clampInt(rawAge, RECOMMENDATION_BOUNDS.age.min, RECOMMENDATION_BOUNDS.age.max)
    : 30;

  const givenWeight = inRange(intake.weightKg, RECOMMENDATION_BOUNDS.weightKg.min, RECOMMENDATION_BOUNDS.weightKg.max);
  const givenHeight = inRange(intake.heightCm, RECOMMENDATION_BOUNDS.heightCm.min, RECOMMENDATION_BOUNDS.heightCm.max);
  const weight = givenWeight ?? ASSUMED_WEIGHT_KG;
  const height = givenHeight ?? ASSUMED_HEIGHT_CM;

  // Mifflin-St Jeor. +5 male, -161 female, and the midpoint of the two (-78)
  // when the athlete has not said — which is what they are told below.
  const sexOffset = intake.sex === "male" ? 5 : intake.sex === "female" ? -161 : -78;
  const bmr = clampInt(10 * weight + 6.25 * height - 5 * safeAge + sexOffset, 800, 4000);

  const days = clampInt(intake.trainingDaysPerWeek, RECOMMENDATION_BOUNDS.days.min, RECOMMENDATION_BOUNDS.days.max);
  const minutes = clampInt(intake.sessionMinutes, RECOMMENDATION_BOUNDS.minutes.min, RECOMMENDATION_BOUNDS.minutes.max);
  const trainingHours = (days * minutes) / 60;
  const base = ACTIVITY_BASE[intake.activityLevel] ?? ACTIVITY_BASE.on_feet;
  const factor = Math.min(MAX_ACTIVITY_FACTOR, base + trainingHours * PER_TRAINING_HOUR);
  const maintenance = clampInt(bmr * factor, 1000, 7000);

  const goalAdjustment = intake.goal === "Cut" ? 0.85 : intake.goal === "Bulk" ? 1.1 : 1;
  let calories = clampInt(
    maintenance * goalAdjustment,
    RECOMMENDATION_BOUNDS.calories.min,
    RECOMMENDATION_BOUNDS.calories.max,
  );

  const proteinPerKg = intake.goal === "Cut" ? 2.0 : intake.goal === "Bulk" ? 1.7 : 1.8;
  const fatPerKg = intake.goal === "Cut" ? 0.8 : 1.0;
  let protein = clampInt(weight * proteinPerKg, RECOMMENDATION_BOUNDS.protein.min, RECOMMENDATION_BOUNDS.protein.max);
  let fat = clampInt(weight * fatPerKg, RECOMMENDATION_BOUNDS.fat.min, RECOMMENDATION_BOUNDS.fat.max);

  // Carbohydrate is the remainder, so the protein and fat targets must leave
  // room for some: if they would eat the whole day, they scale down together
  // rather than the app recommending a target with no fuel around training.
  const CARB_FLOOR_KCAL = 100;
  const macroKcal = protein * 4 + fat * 9;
  if (macroKcal > calories - CARB_FLOOR_KCAL) {
    const scale = Math.max(0.1, (calories - CARB_FLOOR_KCAL) / macroKcal);
    protein = clampInt(protein * scale, RECOMMENDATION_BOUNDS.protein.min, RECOMMENDATION_BOUNDS.protein.max);
    fat = clampInt(fat * scale, RECOMMENDATION_BOUNDS.fat.min, RECOMMENDATION_BOUNDS.fat.max);
    // The floors above could still leave no room (a very heavy athlete on a
    // small deficit), so if they did, the day moves up to fit them.
    const floorKcal = protein * 4 + fat * 9 + CARB_FLOOR_KCAL;
    if (floorKcal > calories) {
      calories = clampInt(floorKcal, RECOMMENDATION_BOUNDS.calories.min, RECOMMENDATION_BOUNDS.calories.max);
    }
  }

  const carbs = clampInt(
    (calories - protein * 4 - fat * 9) / 4,
    RECOMMENDATION_BOUNDS.carbs.min,
    RECOMMENDATION_BOUNDS.carbs.max,
  );

  // ---- The working, in the athlete's own terms ---------------------------
  basis.push(
    givenWeight && givenHeight
      ? `Base metabolism ${bmr} kcal — from your ${weight} kg, ${height} cm and age ${safeAge} (Mifflin-St Jeor).`
      : `Base metabolism ${bmr} kcal — estimated from your age ${safeAge}, using ${weight} kg and ${height} cm because they are not on your profile yet. Add them in Profile and this number sharpens.`,
  );

  basis.push(
    `Maintenance about ${maintenance} kcal: ${days} session${days === 1 ? "" : "s"} of ${minutes} min a week, on top of a ${
      intake.activityLevel === "desk" ? "mostly seated" : intake.activityLevel === "manual" ? "physically demanding" : "on-your-feet"
    } day.`,
  );

  basis.push(
    intake.goal === "Maintain"
      ? `Maintaining, so the intake is your maintenance: ${calories} kcal.`
      : `${intake.goal === "Cut" ? "Cutting" : "Bulking"} is ${goalAdjustment === 0.85 ? "a 15% reduction" : "a 10% increase"} on maintenance — ${calories} kcal, ${goalLabel(
          intake.goal,
        )} that is meant to be slow rather than dramatic.`,
  );

  basis.push(
    `Protein ${protein} g (about ${proteinPerKg} g per kg), fat ${fat} g, and ${carbs} g of carbohydrate to fill what is left — carbohydrate is where training fuel comes from, so it takes whatever protein and fat do not.`,
  );

  if (intake.dietaryPattern !== "omnivore") {
    basis.push(`Your ${intake.dietaryPattern} preference does not change these numbers — it goes to the plan itself, which writes meals around it.`);
  }

  return { calories, protein_g: protein, carbs_g: carbs, fat_g: fat, bmr, maintenance, basis };
}

/** The daily targets as the generator's own field names, so nothing is renamed on the way. */
export function targetsForRequest(targets: Pick<TargetRecommendation, "calories" | "protein_g" | "carbs_g" | "fat_g">) {
  return {
    calories: targets.calories,
    protein: targets.protein_g,
    carbs: targets.carbs_g,
    fat: targets.fat_g,
  };
}
