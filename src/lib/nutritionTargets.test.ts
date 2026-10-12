// ============================================================================
// THE RECOMMENDED AMOUNTS — the arithmetic an athlete is asked to eat to
// ----------------------------------------------------------------------------
// The point of this module is that an athlete who has never counted a macro
// gets a number they can start from, and gets to see why. So the tests below
// are not "it returns an object": they are the properties the number has to
// have to be trustworthy — it must move with training load, follow the goal
// they picked, scale with body size, and never leave the bounds regardless of
// what was typed into the form.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  ASSUMED_HEIGHT_CM,
  ASSUMED_WEIGHT_KG,
  NUTRITION_INTAKE_DEFAULTS,
  RECOMMENDATION_BOUNDS,
  goalFromProfile,
  normalizeIntake,
  prefillIntake,
  recommendTargets,
  type NutritionIntake,
} from "./nutritionTargets";

const intake = (over: Partial<NutritionIntake> = {}): NutritionIntake => ({
  ...NUTRITION_INTAKE_DEFAULTS,
  weightKg: 80,
  heightCm: 180,
  sex: "male",
  ...over,
});

describe("the recommendation follows the inputs it claims to follow", () => {
  it("rises with the amount of training", () => {
    const light = recommendTargets(intake({ trainingDaysPerWeek: 2, sessionMinutes: 45 }), 25);
    const heavy = recommendTargets(intake({ trainingDaysPerWeek: 6, sessionMinutes: 90 }), 25);

    expect(heavy.maintenance).toBeGreaterThan(light.maintenance);
    expect(heavy.calories).toBeGreaterThan(light.calories);
    // ...and says so, so the athlete can see which input moved it.
    expect(heavy.basis.join(" ")).toMatch(/6 sessions of 90 min/);
    expect(light.basis.join(" ")).toMatch(/2 sessions of 45 min/);
  });

  it("follows the goal they picked, in the right direction", () => {
    const cut = recommendTargets(intake({ goal: "Cut" }), 25);
    const maintain = recommendTargets(intake({ goal: "Maintain" }), 25);
    const bulk = recommendTargets(intake({ goal: "Bulk" }), 25);

    expect(cut.calories).toBeLessThan(maintain.calories);
    expect(bulk.calories).toBeGreaterThan(maintain.calories);
    // Maintaining is their maintenance — the untransformed number.
    expect(maintain.calories).toBe(maintain.maintenance);
  });

  it("scales protein and fat with body weight", () => {
    const lighter = recommendTargets(intake({ weightKg: 60 }), 25);
    const heavier = recommendTargets(intake({ weightKg: 95 }), 25);

    expect(heavier.protein_g).toBeGreaterThan(lighter.protein_g);
    expect(heavier.fat_g).toBeGreaterThan(lighter.fat_g);

    // And lands inside the evidence-based band rather than at a made-up number.
    for (const [result, weight] of [[lighter, 60], [heavier, 95]] as const) {
      expect(result.protein_g / weight).toBeGreaterThanOrEqual(1.6);
      expect(result.protein_g / weight).toBeLessThanOrEqual(2.3);
    }
  });

  it("says plainly when weight and height had to be assumed", () => {
    const guessed = recommendTargets(intake({ weightKg: null, heightCm: null }), 25);
    const told = recommendTargets(intake(), 25);

    expect(guessed.basis.join(" ")).toMatch(new RegExp(`${ASSUMED_WEIGHT_KG} kg`));
    expect(guessed.basis.join(" ")).toMatch(new RegExp(`${ASSUMED_HEIGHT_CM} cm`));
    expect(guessed.basis.join(" ")).toMatch(/not on your profile/i);
    expect(told.basis.join(" ")).not.toMatch(/not on your profile/i);
  });

  it("leaves carbohydrate in the day rather than filling it with protein and fat", () => {
    // The hard case: a light athlete on a cut, where protein at 2 g/kg plus fat
    // could otherwise consume the entire target.
    const small = recommendTargets(intake({ weightKg: 52, heightCm: 160, sex: "female", goal: "Cut", trainingDaysPerWeek: 2 }), 45);

    expect(small.carbs_g).toBeGreaterThanOrEqual(20);
    expect(small.protein_g * 4 + small.fat_g * 9).toBeLessThan(small.calories);
  });

  it("uses the dietary pattern for the meals, not for the arithmetic", () => {
    const omnivore = recommendTargets(intake({ dietaryPattern: "omnivore" }), 25);
    const vegan = recommendTargets(intake({ dietaryPattern: "vegan" }), 25);

    expect(vegan.calories).toBe(omnivore.calories);
    expect(vegan.protein_g).toBe(omnivore.protein_g);
    // ...but it is not silently dropped either: the athlete is told where it went.
    expect(vegan.basis.join(" ")).toMatch(/vegan/);
    expect(omnivore.basis.join(" ")).not.toMatch(/preference does not change/);
  });
});

describe("no input can produce a target worth eating to", () => {
  const hosts = [
    intake({ weightKg: 900, heightCm: 999, trainingDaysPerWeek: 99, sessionMinutes: 9999, mealsPerDay: 40 }),
    intake({ weightKg: 1, heightCm: 10, trainingDaysPerWeek: -4, sessionMinutes: 0, mealsPerDay: 0 }),
    intake({ weightKg: Number.NaN, heightCm: Number.NaN, trainingDaysPerWeek: Number.NaN, sessionMinutes: Number.NaN }),
  ];

  it("clamps every number into the documented bounds, integers only", () => {
    // Named explicitly rather than zipped from RECOMMENDATION_BOUNDS: the bound
    // table describes what goes IN as well as what comes out, and a silent
    // `key in result` skip is how an output field stops being checked.
    const outputs: [keyof typeof RECOMMENDATION_BOUNDS, keyof ReturnType<typeof recommendTargets>][] = [
      ["calories", "calories"],
      ["protein", "protein_g"],
      ["carbs", "carbs_g"],
      ["fat", "fat_g"],
    ];

    for (const age of [4, 18, 25, 60, 200, Number.NaN]) {
      for (const host of hosts) {
        const result = recommendTargets(host, age);

        for (const [boundKey, field] of outputs) {
          const bounds = RECOMMENDATION_BOUNDS[boundKey];
          const value = result[field] as number;
          expect(Number.isFinite(value), `${field} for age ${age}`).toBe(true);
          expect(Number.isInteger(value), `${field} must be a whole number`).toBe(true);
          expect(value, `${field} below its floor`).toBeGreaterThanOrEqual(bounds.min);
          expect(value, `${field} above its ceiling`).toBeLessThanOrEqual(bounds.max);
        }

        // The two derived figures are bounds-checked too; they are the ones a
        // typo in a weight field would have inflated most.
        expect(result.bmr).toBeGreaterThan(0);
        expect(result.maintenance).toBeGreaterThanOrEqual(result.bmr);
      }
    }
  });

  it("treats an impossible body size as 'not given' rather than using it", () => {
    const absurd = recommendTargets(intake({ weightKg: 900, heightCm: 999 }), 25);
    const assumed = recommendTargets(intake({ weightKg: null, heightCm: null }), 25);

    expect(absurd.calories).toBe(assumed.calories);
    expect(absurd.basis.join(" ")).toMatch(/not on your profile/i);
  });

  it("treats an age outside the adult range as the nearest adult age", () => {
    // The screen refuses under-18s before this runs; if it is ever called with a
    // child's age anyway it must not produce a child's calorie target.
    expect(recommendTargets(intake(), 4).bmr).toBe(recommendTargets(intake(), 18).bmr);
    expect(recommendTargets(intake(), 200).bmr).toBe(recommendTargets(intake(), 90).bmr);
  });
});

describe("what the questionnaire opens with", () => {
  it("reads a goal out of the profile's own wording", () => {
    expect(goalFromProfile("Lose weight, run a 5k")).toBe("Cut");
    expect(goalFromProfile("Build muscle")).toBe("Bulk");
    expect(goalFromProfile("Stay fit, get faster")).toBe("Maintain");
    expect(goalFromProfile(null)).toBe("Maintain");
  });

  it("prefills weight, height and goal from the profile, and lets a saved answer win", () => {
    const first = prefillIntake({ weightKg: 82, heightCm: 184, goals: "Bulk" });
    expect(first.weightKg).toBe(82);
    expect(first.heightCm).toBe(184);
    expect(first.goal).toBe("Bulk");

    const returning = prefillIntake({
      weightKg: 82,
      heightCm: 184,
      goals: "Bulk",
      saved: { goal: "Cut", weightKg: 79, mealsPerDay: 5 },
    });
    expect(returning.goal).toBe("Cut");
    expect(returning.weightKg).toBe(79);
    expect(returning.mealsPerDay).toBe(5);
  });

  it("ignores a profile value that is not a plausible measurement", () => {
    const odd = prefillIntake({ weightKg: 0, heightCm: 12, goals: null });
    expect(odd.weightKg).toBeNull();
    expect(odd.heightCm).toBeNull();
  });

  it("turns a stored settings row back into an intake without trusting it", () => {
    const saved = normalizeIntake({
      training_days_per_week: "5",
      typical_session_minutes: 75,
      activity_level: "manual",
      dietary_pattern: "vegan",
      food_dislikes: "peanuts",
      meals_per_day: 3,
      sex: "female",
      goal: "Bulk",
      weeks: 6,
      something_else: true,
    });

    expect(saved).toEqual({
      ...NUTRITION_INTAKE_DEFAULTS,
      goal: "Bulk",
      weeks: 6,
      trainingDaysPerWeek: 5,
      sessionMinutes: 75,
      activityLevel: "manual",
      dietaryPattern: "vegan",
      foodDislikes: "peanuts",
      mealsPerDay: 3,
      sex: "female",
      weightKg: null,
      heightCm: null,
      notes: "",
    });
  });

  it("falls back field by field when the row is junk or missing", () => {
    expect(normalizeIntake(null)).toEqual(NUTRITION_INTAKE_DEFAULTS);

    const junk = normalizeIntake({
      goal: "Recomp",
      weeks: "many",
      training_days_per_week: 99,
      typical_session_minutes: -5,
      activity_level: "swimming",
      dietary_pattern: "carnivore",
      meals_per_day: 0,
      sex: "yes",
    });

    expect(junk.goal).toBe(NUTRITION_INTAKE_DEFAULTS.goal);
    expect(junk.weeks).toBe(NUTRITION_INTAKE_DEFAULTS.weeks);
    expect(junk.trainingDaysPerWeek).toBeLessThanOrEqual(RECOMMENDATION_BOUNDS.days.max);
    expect(junk.sessionMinutes).toBeGreaterThanOrEqual(RECOMMENDATION_BOUNDS.minutes.min);
    expect(junk.activityLevel).toBe(NUTRITION_INTAKE_DEFAULTS.activityLevel);
    expect(junk.dietaryPattern).toBe(NUTRITION_INTAKE_DEFAULTS.dietaryPattern);
    expect(junk.mealsPerDay).toBeGreaterThanOrEqual(RECOMMENDATION_BOUNDS.mealsPerDay.min);
    expect(junk.sex).toBe(NUTRITION_INTAKE_DEFAULTS.sex);
  });
});
