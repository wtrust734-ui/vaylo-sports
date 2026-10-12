// ============================================================================
// ATHLETE MEMORY — the shape of "everything the AI knows about you"
// ----------------------------------------------------------------------------
// Two things are being protected here.
//
// 1. The builders are correct: a week of logged food becomes per-day totals
//    (not one number, not twenty meals of prose), the cap on every list is
//    applied, an empty account produces empty sections rather than invented
//    ones, and nothing renders the strings "undefined" or "null" into a prompt.
//
// 2. The TWO PATHS AGREE. The client builds the dossier in
//    src/lib/athleteDossier.ts and the edge functions build it in
//    supabase/functions/_shared/athleteDossier.ts. A feature served by one and
//    a feature served by the other must describe the same athlete, so this test
//    reads the server file off disk and asserts its section markers appear in
//    exactly the order DOSSIER_SECTION_ORDER declares, and that its caps match
//    DOSSIER_LIMITS. Add a section in one place only and this fails.
// ============================================================================

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DOSSIER_EXCLUSIONS,
  DOSSIER_LIMITS,
  DOSSIER_SECTION_MARKERS,
  DOSSIER_SECTION_ORDER,
  activePlanSummary,
  buildAgeLabel,
  dossierSections,
  hasSectionContent,
  mealDayTotals,
  nonEmptySections,
  nutritionSummary,
  sectionCounts,
} from "@/lib/athleteMemory";

describe("mealDayTotals — a week of food as days, capped", () => {
  const rows = [
    { log_date: "2026-10-01", calories: 500, protein_g: 30, carbs_g: 60, fat_g: 15, meal_type: "breakfast" },
    { log_date: "2026-10-01", calories: 700, protein_g: 45, carbs_g: 80, fat_g: 20, meal_type: "dinner" },
    { log_date: "2026-10-03", calories: 400, protein_g: 25, carbs_g: 40, fat_g: 12, meal_type: "snack" },
  ];

  it("totals each day's meals into one row", () => {
    const days = mealDayTotals(rows);
    expect(days).toHaveLength(2);
    const first = days.find((d) => d.date === "2026-10-01")!;
    expect(first.kcal).toBe(1200);
    expect(first.protein_g).toBe(75);
    expect(first.carbs_g).toBe(140);
    expect(first.fat_g).toBe(35);
    expect(first.meals).toBe(2);
  });

  it("returns the newest day first", () => {
    expect(mealDayTotals(rows).map((d) => d.date)).toEqual(["2026-10-03", "2026-10-01"]);
  });

  it("drops a row with no date rather than bucketing it under an empty key", () => {
    const days = mealDayTotals([...rows, { calories: 900 }]);
    expect(days.every((d) => d.date.length === 10)).toBe(true);
    expect(days).toHaveLength(2);
  });

  it("applies the cap, keeping the most recent days", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      log_date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      calories: 100,
    }));
    const days = mealDayTotals(many);
    expect(days).toHaveLength(DOSSIER_LIMITS.mealDays);
    expect(days[0].date).toBe("2026-10-12");
  });

  it("survives junk: strings, negatives and missing macros become numbers, not NaN", () => {
    const days = mealDayTotals([{ log_date: "2026-10-02", calories: "250" as unknown as number, protein_g: null }]);
    expect(days[0].kcal).toBe(250);
    expect(days[0].protein_g).toBe(0);
    expect(Number.isFinite(days[0].fat_g)).toBe(true);
  });

  it("returns nothing for nothing", () => {
    expect(mealDayTotals([])).toEqual([]);
  });
});

describe("activePlanSummary — the week the athlete is actually in", () => {
  const plan = {
    title: "Autumn Base",
    sport: "Running",
    week_current: 3,
    duration_weeks: 8,
    plan_data: [
      { week: 1, focus: "Intro", sessions: [{ day: 1, title: "Easy", type: "run", duration_min: 40 }] },
      {
        week: 3,
        focus: "Build",
        sessions: [
          { day: 1, title: "Intervals", type: "run", duration_min: 50 },
          { day: 2, title: "Rest", type: "rest", isRest: true },
          { day: 3, title: "Long run", type: "run", duration_min: 90 },
        ],
      },
    ],
  };

  it("picks the current week, not the first one", () => {
    const summary = activePlanSummary(plan)!;
    expect(summary.week).toBe(3);
    expect(summary.focus).toBe("Build");
    expect(summary.thisWeek.map((s) => s.title)).toEqual(["Intervals", "Rest", "Long run"]);
  });

  it("counts sessions without counting rest days", () => {
    expect(activePlanSummary(plan)!.sessionsThisWeek).toBe(2);
  });

  it("falls back to the first week when week_current is out of range", () => {
    const summary = activePlanSummary({ ...plan, week_current: 99 })!;
    expect(summary.thisWeek[0].title).toBe("Easy");
  });

  it("caps the sessions printed", () => {
    const many = { ...plan, plan_data: [{ week: 3, sessions: Array.from({ length: 40 }, (_, i) => ({ day: i % 7, title: `S${i}`, type: "run" })) }] };
    expect(activePlanSummary(many)!.thisWeek.length).toBeLessThanOrEqual(10);
  });

  it("returns null rather than a nameless plan", () => {
    expect(activePlanSummary(null)).toBeNull();
    expect(activePlanSummary({ title: "   " })).toBeNull();
    expect(activePlanSummary({} as never)).toBeNull();
  });
});

describe("nutritionSummary — a saved plan plus what was logged", () => {
  it("reads the saved plan's targets and whether meals were written", () => {
    const summary = nutritionSummary({
      plan: {
        title: "Maintain, 4 weeks",
        goal: "Maintain",
        weeks: 4,
        calories_target: 2400,
        protein_target: 160,
        carbs_target: 280,
        fat_target: 75,
        plan_data: [{ week: 1 }],
      },
    });
    expect(summary.plan).toMatchObject({ title: "Maintain, 4 weeks", calories: 2400, protein_g: 160, hasMeals: true });
  });

  it("reports no plan when there is no title, rather than an empty one", () => {
    expect(nutritionSummary({ plan: { goal: "Cut" } }).plan).toBeNull();
    expect(nutritionSummary({}).plan).toBeNull();
  });

  it("carries the questionnaire answers through", () => {
    const summary = nutritionSummary({
      dietaryPattern: "vegetarian",
      foodDislikes: "peanuts",
      mealsPerDay: "4",
      mealRows: [{ log_date: "2026-10-01", calories: 800 }],
    });
    expect(summary.dietaryPattern).toBe("vegetarian");
    expect(summary.foodDislikes).toBe("peanuts");
    expect(summary.mealsPerDay).toBe(4);
    expect(summary.loggedDays).toBe(1);
  });
});

describe("the panel's rows are derived from the dossier the AI receives", () => {
  const full = {
    profile: { sport: "Running", experience_level: "Intermediate", age: 27, ageCaps: { maxSessionsPerWeek: 6, maxRPE: 9 } },
    pbs: [{ metric: "5k", value: 1180, unit: "s" }],
    vpr: { overall_vpr: 71 },
    recentMetrics: [{ metric_type: "heart_rate", value: 52 }],
    injuries: [{ body_part: "Knee", severity: 3, status: "active" }],
    recovery: { logs: [{ log_date: "2026-10-10", readiness_score: 62 }] },
    outcomeGoals: [{ title: "Sub-40 10k" }],
    load: { dailyLoads: [{ log_date: "2026-10-10" }], sessionLoads: [] },
    activePlan: { title: "Autumn Base", week: 3, weeks: 8, sessionsThisWeek: 4 },
    recentWorkouts: [{ date: "2026-10-10", sport: "Running" }],
    nutrition: { plan: { title: "Maintain" }, days: [{ date: "2026-10-10" }], dietaryPattern: "omnivore" },
    lifeEvents: [{ type: "holiday", from: "2026-09-01", to: "2026-09-07" }],
    mentalCheckins: [{ date: "2026-10-10", readiness_score: 70 }],
    coachMemories: [{ category: "preference", key: "session time", value: "mornings" }],
  };

  it("returns every section, in the declared order", () => {
    const sections = dossierSections(full);
    expect(sections.map((s) => s.key)).toEqual([...DOSSIER_SECTION_ORDER]);
    for (const section of sections) expect(section.label.trim().length).toBeGreaterThan(0);
  });

  it("summarises what is there, with real numbers", () => {
    const byKey = Object.fromEntries(dossierSections(full).map((s) => [s.key, s.summary]));
    expect(byKey.profile).toContain("Running");
    expect(byKey.injuries).toContain("Knee");
    expect(byKey.plan).toContain("week 3 of 8");
    expect(byKey.nutrition).toContain("Maintain");
  });

  it("says a section is empty instead of inventing one", () => {
    const byKey = Object.fromEntries(dossierSections({}).map((s) => [s.key, s.summary]));
    for (const summary of Object.values(byKey)) {
      expect(summary).not.toMatch(/undefined|null|NaN/);
      expect(summary.length).toBeGreaterThan(0);
    }
    expect(sectionCounts({})).toEqual({ filled: 0, total: DOSSIER_SECTION_ORDER.length });
    expect(nonEmptySections({})).toEqual([]);
  });

  it("counts only the sections that hold something", () => {
    const counts = sectionCounts(full);
    expect(counts.total).toBe(DOSSIER_SECTION_ORDER.length);
    expect(counts.filled).toBe(DOSSIER_SECTION_ORDER.length);
    expect(nonEmptySections(full)).toHaveLength(DOSSIER_SECTION_ORDER.length);
    expect(hasSectionContent(full, "pbs")).toBe(true);
    expect(hasSectionContent({}, "pbs")).toBe(false);
  });
});

describe("buildAgeLabel — a stale memory must not read as current", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");

  it("labels seconds, minutes, hours and days", () => {
    expect(buildAgeLabel("2026-10-11T11:59:40.000Z", now)).toBe("just now");
    expect(buildAgeLabel("2026-10-11T11:48:00.000Z", now)).toBe("12 minutes ago");
    expect(buildAgeLabel("2026-10-11T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(buildAgeLabel("2026-10-08T12:00:00.000Z", now)).toBe("3 days ago");
  });

  it("says unknown rather than guessing", () => {
    expect(buildAgeLabel(null, now)).toBe("unknown");
    expect(buildAgeLabel("not a date", now)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// The two paths must agree — asserted against the server file on disk
// ---------------------------------------------------------------------------

describe("client and server build one athlete", () => {
  const serverFile = resolve(__dirname, "../../supabase/functions/_shared/athleteDossier.ts");
  const source = existsSync(serverFile) ? readFileSync(serverFile, "utf8") : "";

  it("exists where both the client and the edge functions expect it", () => {
    expect(existsSync(serverFile), `missing ${serverFile}`).toBe(true);
  });

  it("writes its prompt sections in exactly the declared order", () => {
    // Every `lines.push("# SECTION")` in the server formatter, in file order.
    const markers: string[] = [];
    const markerRe = /lines\.push\("# ([^"]+)"\)/g;
    let match: RegExpExecArray | null;
    while ((match = markerRe.exec(source)) !== null) markers.push(match[1]);
    const expected = DOSSIER_SECTION_ORDER.map((key) => DOSSIER_SECTION_MARKERS[key].replace("# ", ""));
    expect(markers).toEqual(expected);
  });

  it("cap every list the same way the client does", () => {
    for (const [key, value] of Object.entries(DOSSIER_LIMITS)) {
      expect(source, `server DOSSIER_LIMITS is missing ${key}: ${value}`).toContain(`${key}: ${value}`);
    }
  });

  it("reads the sections that make it a whole athlete, not just a training log", () => {
    for (const table of [
      '"profiles"',
      '"injury_logs"',
      '"recovery_logs"',
      '"training_plans"',
      '"workouts"',
      '"meal_logs"',
      '"nutrition_plans"',
      '"life_events"',
      '"mental_checkins"',
      '"coach_memories"',
    ]) {
      expect(source, `server dossier does not read ${table}`).toContain(`from(${table})`);
    }
  });

  it("states what the memory does NOT hold, so the panel cannot overclaim", () => {
    // The exclusions live client-side (the panel prints them). They must be
    // concrete statements about this app, not a reassuring slogan, or the
    // honest-limits half of "the AI knows everything about you" is missing.
    expect(DOSSIER_EXCLUSIONS.length).toBeGreaterThanOrEqual(3);
    for (const item of DOSSIER_EXCLUSIONS) {
      expect(typeof item).toBe("string");
      expect(item.trim().length).toBeGreaterThan(8);
    }
    expect(DOSSIER_EXCLUSIONS.join(" ")).toMatch(/payment|card/);
  });
});
