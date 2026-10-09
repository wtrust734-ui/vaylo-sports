// ============================================================================
// THE NUTRITION PLAN'S CLIENT HALF — what must be true around the charge
// ----------------------------------------------------------------------------
// This module is the only thing standing between a paid model response and the
// screen: it decides whether a request is worth sending (so an unanswerable one
// never becomes a charge) and whether what came back can be rendered at all.
// Until now it had no test of its own while every sibling (planEdit,
// planPeriodisation, planSetupAdvice, offerVisibility) had one — which is how a
// plan an athlete paid 15 credits a week for could render as an empty screen
// without the suite noticing.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  MAX_PLAN_WEEKS,
  dayTotals,
  newNutritionPlanRequestId,
  parseGeneratedPlan,
  planHeader,
  planTotals,
  validatePlanRequest,
  type PlanWeek,
} from "./nutritionPlan";

/** A week the way the function's own validator emits one: 7 days, real meals. */
const week = (over: Partial<PlanWeek> = {}): PlanWeek => ({
  week: 1,
  focus: "Base",
  calories: 2400,
  protein_g: 180,
  carbs_g: 250,
  fat_g: 70,
  days: [
    {
      day: 1,
      dayName: "Monday",
      notes: "",
      meals: [
        { slot: "Breakfast", name: "Oats and whey", description: "", calories: 600, protein_g: 40, carbs_g: 80, fat_g: 12 },
        { slot: "Lunch", name: "Chicken rice bowl", description: "", calories: 800, protein_g: 60, carbs_g: 90, fat_g: 18 },
      ],
    },
  ],
  ...over,
});

describe("the request is checked before it can cost anything", () => {
  it("accepts a goal the server recognises and a length inside its range", () => {
    expect(validatePlanRequest({ goal: "Cut", weeks: 4 })).toEqual({ ok: true, goal: "Cut", weeks: 4 });
    // A number input hands back a string; it is still a length.
    expect(validatePlanRequest({ goal: "Bulk", weeks: "6" }).weeks).toBe(6);
  });

  it("refuses a goal it cannot send, rather than defaulting in silence", () => {
    const check = validatePlanRequest({ goal: "Recomp", weeks: 4 });
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/goal/i);
  });

  it("refuses a length outside the server's bounds", () => {
    for (const weeks of [0, -3, MAX_PLAN_WEEKS + 1, NaN, "soon", null]) {
      const check = validatePlanRequest({ goal: "Maintain", weeks: weeks as number });
      expect(check.ok, `weeks=${String(weeks)}`).toBe(false);
      expect(check.error).toMatch(/between 1 and 12/i);
    }
  });

  it("never asks for a plan when the screen has no answer at all", () => {
    expect(validatePlanRequest({}).ok).toBe(false);
    expect(validatePlanRequest({ goal: null, weeks: null }).ok).toBe(false);
  });
});

describe("a request id is fresh per attempt", () => {
  it("is a non-empty string, and not the same one twice", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newNutritionPlanRequestId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(typeof id).toBe("string");
  });
});

describe("reading the model's answer", () => {
  it("accepts both shapes the plan is stored in", () => {
    // A fresh response is { summary, weeks }; `nutrition_plans.plan_data` is the
    // bare weeks array. One renderer has to read both, or a stored plan stops
    // rendering the day the feature ships.
    const fresh = parseGeneratedPlan({ plan: { summary: "Two weeks of building", weeks: [week()] } });
    const stored = parseGeneratedPlan([week()]);

    expect(fresh.plan?.summary).toBe("Two weeks of building");
    expect(stored.plan?.weeks).toHaveLength(1);
    expect(stored.plan?.weeks[0].days[0].meals).toHaveLength(2);
    expect(fresh.droppedWeeks).toBe(0);
  });

  it("keeps the weeks it can read and reports the ones it cannot", () => {
    // A model that returns rubbish beside real weeks must render the real ones
    // and say how many were lost — not fail wholesale, and not claim them.
    const result = parseGeneratedPlan({
      weeks: [week({ week: 1 }), "not a week", 42, null, { week: 1 }],
    });

    expect(result.plan?.weeks.map((w) => w.week)).toEqual([1]);
    expect(result.plan?.weeks[0].days[0].meals).toHaveLength(2);
    expect(result.droppedWeeks).toBe(4);
  });

  it("keeps a week whose days are missing rather than nulling the whole plan", () => {
    // A week with no readable days is KEPT, empty, and only non-weeks are
    // counted as dropped. That is the right way round here: the function's own
    // validator guarantees seven days per week (see _shared/planSchema.ts), so
    // a dayless week can only come from stored or legacy data, and refusing the
    // plan outright would hide the weeks beside it that are fine.
    const result = parseGeneratedPlan({ weeks: [week({ week: 1 }), { week: 2 }] });

    expect(result.plan?.weeks.map((w) => w.week)).toEqual([1, 2]);
    expect(result.plan?.weeks[1].days).toEqual([]);
    expect(result.droppedWeeks).toBe(0);
  });

  it("counts a repeated week once instead of double-charging the totals", () => {
    const result = parseGeneratedPlan({ weeks: [week({ week: 1 }), week({ week: 1, calories: 9999 })] });

    expect(result.plan?.weeks).toHaveLength(1);
    expect(result.plan?.weeks[0].calories).toBe(2400); // the first answer wins
    expect(result.droppedWeeks).toBe(1);
  });

  it("counts a repeated day once, so a duplicated day cannot inflate the week", () => {
    const monday = week().days[0];
    const result = parseGeneratedPlan({
      weeks: [week({ days: [monday, { ...monday, meals: monday.meals.map((m) => ({ ...m, calories: m.calories })) }] })],
    });

    const days = result.plan?.weeks[0].days ?? [];
    expect(days).toHaveLength(1);
    // The daily average is computed from the MEALS, so a doubled Monday would
    // have doubled the headline number the athlete reads.
    expect(planTotals(result.plan!.weeks[0]).calories).toBe(1400);
  });

  it("coerces the numbers a model writes as prose", () => {
    // Deliberately untyped: this is the input side, which is untrusted model
    // JSON, and half the point of the parser is what it does with a number
    // written as a sentence. Typing the fixture would assert a shape nobody
    // promised.
    const proseWeek: Record<string, unknown> = {
      week: 1,
      focus: "Base",
      calories: "about 2,400 kcal",
      protein_g: "~180g",
      carbs_g: -50,
      fat_g: "n/a",
      days: [{
        day: 1, dayName: "Monday", notes: "",
        meals: [{ slot: "Lunch", name: "Bowl", description: "", calories: "800", protein_g: "60g", carbs_g: "90", fat_g: "18" }],
      }],
    };

    const result = parseGeneratedPlan({ weeks: [proseWeek] });

    const parsed = result.plan!.weeks[0];
    expect(parsed.calories).toBe(2400); // commas removed, not truncated to 2
    expect(parsed.protein_g).toBe(180);
    expect(parsed.carbs_g).toBe(0); // a negative target is a zero, never a negative
    expect(parsed.fat_g).toBe(0);
    expect(parsed.days[0].meals[0].calories).toBe(800);
  });

  it("drops a day the model sent without a number, rather than inventing day 0", () => {
    const result = parseGeneratedPlan({
      weeks: [week({ days: [{ day: 99, dayName: "Monday", notes: "", meals: [] }] })],
    });

    expect(result.plan?.weeks[0].days).toHaveLength(0);
  });

  it("keeps a meal that has only a description, and drops one with neither", () => {
    // Also untyped, and also the input side: the macros are absent here on
    // purpose, which is the shape a thin model answer really arrives in.
    const thinWeek: Record<string, unknown> = {
      week: 1,
      days: [{
        day: 1, dayName: "Monday", notes: "",
        meals: [
          { slot: "Lunch", description: "Whatever the canteen has", calories: 500 },
          { slot: "Snack", name: "", description: "", calories: 100 },
        ],
      }],
    };

    const result = parseGeneratedPlan({ weeks: [thinWeek] });

    const meals = result.plan!.weeks[0].days[0].meals;
    expect(meals).toHaveLength(1);
    expect(meals[0].name).toBe("Whatever the canteen has");
  });

  it("says the credits were refunded when nothing at all could be read", () => {
    for (const junk of [null, undefined, {}, [], "…", { weeks: [] }, { weeks: [null, 5, "week"] }]) {
      const result = parseGeneratedPlan(junk);
      expect(result.plan, `plan for ${JSON.stringify(junk)}`).toBeNull();
      expect(result.error).toBeTruthy();
    }

    // The one that reaches an athlete who has been charged has to carry the
    // promise the function actually keeps — refund on every failure path.
    const unreadable = parseGeneratedPlan({ weeks: [null, "week"] });
    expect(unreadable.plan).toBeNull();
    expect(unreadable.error).toMatch(/refunded/i);
  });
});

describe("the totals are a check on the targets, not a copy of them", () => {
  it("averages the week's meals over the days it has", () => {
    const two = week({
      days: [
        { day: 1, dayName: "Monday", notes: "", meals: [{ slot: "Lunch", name: "A", description: "", calories: 600, protein_g: 40, carbs_g: 60, fat_g: 10 }] },
        { day: 2, dayName: "Tuesday", notes: "", meals: [{ slot: "Lunch", name: "B", description: "", calories: 800, protein_g: 60, carbs_g: 80, fat_g: 20 }] },
      ],
    });

    // 1400 over two days, not 1400 as a day.
    expect(planTotals(two)).toEqual({ calories: 700, protein_g: 50, carbs_g: 70, fat_g: 15 });
  });

  it("returns zeros rather than NaN for an empty day or week", () => {
    expect(dayTotals(null)).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
    expect(dayTotals({ day: 1, dayName: "Monday", meals: [], notes: "" })).toEqual({
      calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
    });
    // The week path divides by the day count: no days must not mean NaN.
    expect(planTotals({ days: [] })).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });

  it("sums a day from its meals, ignoring the day's own numbers", () => {
    const day = week().days[0];
    expect(dayTotals(day)).toEqual({ calories: 1400, protein_g: 100, carbs_g: 170, fat_g: 30 });
  });
});

describe("the header line", () => {
  it("counts the weeks returned and reads the first week that states targets", () => {
    const header = planHeader({
      summary: "",
      weeks: [week({ week: 1, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }), week({ week: 2, calories: 2600, protein_g: 200, carbs_g: 260, fat_g: 80 })],
    });

    expect(header.weeks).toBe(2);
    expect(header.targets.calories).toBe(2600);
  });

  it("returns zeros rather than throwing when the plan is empty", () => {
    expect(planHeader({ summary: "", weeks: [] })).toEqual({
      weeks: 0,
      targets: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
    });
  });
});
