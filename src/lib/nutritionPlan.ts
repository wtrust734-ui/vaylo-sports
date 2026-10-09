// ============================================================================
// NUTRITION PLAN — the client half of the AI meal plan
// ----------------------------------------------------------------------------
// The nutrition plan used to be a form: the athlete typed their own calorie and
// macro targets and the app stored them. That is a spreadsheet, not a plan —
// nothing in it says what to eat on a Tuesday. It is now written by the model
// (`generate-nutrition-plan`, OpenAI), charged per week through
// `nutrition_plan_week`, and refunded on every failure path.
//
// What lives here is everything that has to be true BEFORE that request is
// worth making and AFTER the answer arrives:
//
//   * an unanswerable request (no goal, absurd length) is rejected here, so it
//     never becomes a charge,
//   * the returned plan is validated defensively — a model that omits a week, a
//     day or a meal must produce a plan the screen can still read, not a crash
//     on `meals.map`, and never a plan that silently renders as empty,
//   * and the week/day/meal shape is one definition shared by the generator's
//     renderer and the stored `nutrition_plans.plan_data` reader, so an old
//     plan and a fresh one render through the same code path.
//
// Pure: no React, no Supabase. The component's job stays presentation.
// ============================================================================

export const NUTRITION_GOALS = ["Cut", "Maintain", "Bulk"] as const;
export type NutritionGoal = (typeof NUTRITION_GOALS)[number];

/** The server's own bound (`generate-nutrition-plan` clamps to the same range). */
export const MIN_PLAN_WEEKS = 1;
export const MAX_PLAN_WEEKS = 12;

/** Meal slots the prompt asks for; not enforced, only used for ordering. */
export const MEAL_SLOTS = [
  "Breakfast",
  "Lunch",
  "Dinner",
  "Snack",
  "Pre-workout",
  "Post-workout",
] as const;

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type PlanMeal = {
  slot: string;
  name: string;
  description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export type PlanDay = {
  /** 1 = Monday … 7 = Sunday. */
  day: number;
  dayName: string;
  meals: PlanMeal[];
  notes: string;
};

export type PlanWeek = {
  week: number;
  /** e.g. "Base" | "Build" | "Deload" — the model's one-word theme for the week. */
  focus: string;
  /** The week's daily targets, from the model rather than from arithmetic. */
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  days: PlanDay[];
};

export type GeneratedPlan = {
  /** One or two sentences on how the weeks differ. */
  summary: string;
  weeks: PlanWeek[];
};

export type NutritionPlanRequest = {
  goal: NutritionGoal;
  weeks: number;
  sport: string;
  level: string;
  calories_target?: number;
  protein_target?: number;
  carbs_target?: number;
  fat_target?: number;
  notes?: string;
  userLocale?: string;
  request_id: string;
};

/** A fresh id per generation attempt; reused only when retrying the same one. */
export function newNutritionPlanRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the timestamp form */
  }
  return `nutrition-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export type PlanRequestCheck = {
  ok: boolean;
  goal: NutritionGoal;
  weeks: number;
  /** Present when not `ok` — what to tell the athlete. */
  error?: string;
};

/**
 * Normalise and bound the request. The server checks all of this again (a
 * client is not a place to enforce anything); checking here means the athlete
 * is told what is wrong before a request leaves the phone.
 */
export function validatePlanRequest(input: {
  goal?: string | null;
  weeks?: number | string | null;
}): PlanRequestCheck {
  const rawGoal = String(input.goal ?? "").trim();
  const goal = (NUTRITION_GOALS as readonly string[]).includes(rawGoal)
    ? (rawGoal as NutritionGoal)
    : null;

  const parsedWeeks = Math.floor(Number(input.weeks));
  const weeks = Number.isFinite(parsedWeeks) ? parsedWeeks : NaN;

  if (!goal) return { ok: false, goal: "Maintain", weeks: 4, error: "Pick a goal: Cut, Maintain or Bulk." };
  if (!Number.isFinite(weeks) || weeks < MIN_PLAN_WEEKS || weeks > MAX_PLAN_WEEKS) {
    return {
      ok: false,
      goal,
      weeks: 4,
      error: `Choose a length between ${MIN_PLAN_WEEKS} and ${MAX_PLAN_WEEKS} weeks.`,
    };
  }
  return { ok: true, goal, weeks };
}

// ---------------------------------------------------------------------------
// Defensive parsing
// ---------------------------------------------------------------------------
// Every number is coerced and clamped rather than trusted: a model that answers
// "about 2400" or "~30g" where a number was asked for must not put NaN on the
// screen, and a plan that arrives one week short must still render the weeks it
// does have (with the shortfall reported) instead of failing wholesale.

const WHOLE_MAX = 100_000;

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(WHOLE_MAX, value));
  }
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (match) {
      const n = Number(match[0]);
      if (Number.isFinite(n)) return Math.max(0, Math.min(WHOLE_MAX, n));
    }
  }
  return fallback;
};

const toText = (value: unknown, max = 400): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const readMeal = (raw: unknown): PlanMeal | null => {
  if (!isObject(raw)) return null;
  const name = toText(raw.name, 160) || toText(raw.description, 160);
  if (!name) return null;
  return {
    slot: toText(raw.slot, 40),
    name,
    description: toText(raw.description, 400),
    calories: Math.round(toNumber(raw.calories)),
    protein_g: Math.round(toNumber(raw.protein_g ?? raw.protein)),
    carbs_g: Math.round(toNumber(raw.carbs_g ?? raw.carbs)),
    fat_g: Math.round(toNumber(raw.fat_g ?? raw.fat)),
  };
};

const readDay = (raw: unknown, index: number): PlanDay | null => {
  if (!isObject(raw)) return null;
  const day = Math.floor(toNumber(raw.day, index + 1));
  if (day < 1 || day > 7) return null;
  const meals = (Array.isArray(raw.meals) ? raw.meals : [])
    .map(readMeal)
    .filter((m): m is PlanMeal => m !== null);
  return {
    day,
    dayName: toText(raw.dayName, 20) || DAY_NAMES[day - 1],
    meals,
    notes: toText(raw.notes, 300),
  };
};

const readWeek = (raw: unknown, index: number): PlanWeek | null => {
  if (!isObject(raw)) return null;
  const week = Math.floor(toNumber(raw.week, index + 1));
  if (week < 1 || week > MAX_PLAN_WEEKS * 4) return null;

  const byDay = new Map<number, PlanDay>();
  (Array.isArray(raw.days) ? raw.days : []).forEach((d, i) => {
    const parsed = readDay(d, i);
    // A day the model sent twice must not double-count in the totals.
    if (parsed && !byDay.has(parsed.day)) byDay.set(parsed.day, parsed);
  });
  const days = [...byDay.values()].sort((a, b) => a.day - b.day);

  return {
    week,
    focus: toText(raw.focus, 40) || "Plan",
    calories: Math.round(toNumber(raw.calories)),
    protein_g: Math.round(toNumber(raw.protein_g ?? raw.protein)),
    carbs_g: Math.round(toNumber(raw.carbs_g ?? raw.carbs)),
    fat_g: Math.round(toNumber(raw.fat_g ?? raw.fat)),
    days,
  };
};

export type ParseResult = {
  plan: GeneratedPlan | null;
  /** Weeks the response claimed but that could not be read. */
  droppedWeeks: number;
  /** Present when `plan` is null — what to tell the athlete. */
  error?: string;
};

/**
 * Turn whatever the function returned into something renderable.
 *
 * `plan_data` in the database is the `weeks` array alone, while a fresh
 * response is `{ summary, weeks }`, so both shapes are accepted here — that is
 * what lets a stored plan and a just-generated one share one renderer.
 */
export function parseGeneratedPlan(raw: unknown): ParseResult {
  const container = isObject(raw) && "plan" in raw ? raw.plan : raw;
  const weeksSource = Array.isArray(container)
    ? container
    : isObject(container) && Array.isArray(container.weeks)
      ? container.weeks
      : null;

  const summary = isObject(container) ? toText(container.summary, 500) : "";

  if (!weeksSource || weeksSource.length === 0) {
    return { plan: null, droppedWeeks: 0, error: "The plan came back empty." };
  }

  const byWeek = new Map<number, PlanWeek>();
  let droppedWeeks = 0;
  weeksSource.forEach((w, i) => {
    const parsed = readWeek(w, i);
    if (!parsed) {
      droppedWeeks += 1;
      return;
    }
    if (!byWeek.has(parsed.week)) byWeek.set(parsed.week, parsed);
    else droppedWeeks += 1;
  });

  const weeks = [...byWeek.values()].sort((a, b) => a.week - b.week);
  if (weeks.length === 0) {
    return {
      plan: null,
      droppedWeeks,
      error: "The plan came back in a shape we could not read. Your credits were refunded automatically.",
    };
  }

  return { plan: { summary, weeks }, droppedWeeks };
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export type MacroTotals = { calories: number; protein_g: number; carbs_g: number; fat_g: number };

const EMPTY_TOTALS: MacroTotals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

/** What one day's meals add up to. */
export function dayTotals(day: PlanDay | undefined | null): MacroTotals {
  if (!day) return { ...EMPTY_TOTALS };
  return day.meals.reduce<MacroTotals>(
    (acc, meal) => ({
      calories: acc.calories + meal.calories,
      protein_g: acc.protein_g + meal.protein_g,
      carbs_g: acc.carbs_g + meal.carbs_g,
      fat_g: acc.fat_g + meal.fat_g,
    }),
    { ...EMPTY_TOTALS },
  );
}

/**
 * The DAILY average a week's meals actually provide — a check on the week's
 * stated targets, which is why it is computed from the meals rather than read
 * from `week.calories`.
 */
export function planTotals(week: Pick<PlanWeek, "days">): MacroTotals {
  const days = week.days ?? [];
  if (days.length === 0) return { ...EMPTY_TOTALS };
  const sum = days.reduce<MacroTotals>(
    (acc, day) => {
      const t = dayTotals(day);
      return {
        calories: acc.calories + t.calories,
        protein_g: acc.protein_g + t.protein_g,
        carbs_g: acc.carbs_g + t.carbs_g,
        fat_g: acc.fat_g + t.fat_g,
      };
    },
    { ...EMPTY_TOTALS },
  );
  return {
    calories: Math.round(sum.calories / days.length),
    protein_g: Math.round(sum.protein_g / days.length),
    carbs_g: Math.round(sum.carbs_g / days.length),
    fat_g: Math.round(sum.fat_g / days.length),
  };
}

/** Somewhere to start a summary line: the first week that states targets. */
export function planHeader(plan: GeneratedPlan): { weeks: number; targets: MacroTotals } {
  const first = plan.weeks.find((w) => w.calories > 0) ?? plan.weeks[0];
  return {
    weeks: plan.weeks.length,
    targets: first
      ? { calories: first.calories, protein_g: first.protein_g, carbs_g: first.carbs_g, fat_g: first.fat_g }
      : { ...EMPTY_TOTALS },
  };
}
