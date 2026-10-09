// ============================================================================
// PLAN SETUP ADVICE — the numbers the wizard recommends, and the caps on them
// ----------------------------------------------------------------------------
// What can silently go wrong here is not a wrong sentence, it is advice that
// outruns a safety cap: a recommendation of five training days for an athlete
// whose age caps allow three, or "hard" for a 14-year-old. Those are the cases
// the tests below pin, next to the ordinary level progression.
// ============================================================================

import { describe, expect, it } from "vitest";

import { matchesAdvice, normaliseLevel, recommendSetup } from "./planSetupAdvice";

const YOUTH_CAPS = { maxSessionsPerWeek: 3, minRestDays: 2, maxMinutesPerSession: 45 };

describe("the level baselines", () => {
  it("gives a beginner three days and two full rest days", () => {
    const advice = recommendSetup({ level: "beginner" });

    expect(advice.daysPerWeek).toBe(3);
    expect(advice.restDays).toBe(2);
    expect(advice.sessionLengthPref).toBe("short");
    expect(advice.intensityPref).toBe("balanced");
    expect(advice.hoursPerWeek).toBe(2.5); // 3 × 45 min
    expect(advice.athleteKnowsBest).toBe(false);
  });

  it("steps the intermediate athlete up to four days and one rest day", () => {
    const advice = recommendSetup({ level: "intermediate" });

    expect(advice.daysPerWeek).toBe(4);
    expect(advice.restDays).toBe(1);
    expect(advice.hoursPerWeek).toBe(4); // 4 × 60 min
  });

  it("lets an advanced athlete run five days and hard intensity", () => {
    const advice = recommendSetup({ level: "advanced" });

    expect(advice.daysPerWeek).toBe(5);
    expect(advice.intensityPref).toBe("hard");
    // The wizard stops sounding like it knows better than they do.
    expect(advice.athleteKnowsBest).toBe(true);
  });

  it("treats an unknown or missing level as a beginner rather than throwing", () => {
    // The wizard's level is a free string from local state.
    expect(normaliseLevel(undefined)).toBe("beginner");
    expect(normaliseLevel("Advanced")).toBe("advanced");
    expect(normaliseLevel("elite")).toBe("beginner");
    expect(recommendSetup({ level: "elite" }).daysPerWeek).toBe(3);
  });
});

describe("the age caps win", () => {
  it("clamps the days to the cap instead of recommending past it", () => {
    const advice = recommendSetup({ level: "advanced", caps: YOUTH_CAPS });

    expect(advice.daysPerWeek).toBe(3);
    expect(advice.restDays).toBe(2);
    // 3 × 45 min, not the 90-minute long session the level alone would pick.
    expect(advice.hoursPerWeek).toBe(2.5);
  });

  it("keeps the shortest session length when the cap is too tight even for that", () => {
    // A 30-minute cap cannot be met by any preference; the recommendation must
    // still be the smallest one rather than a 60-minute "standard".
    const advice = recommendSetup({ level: "intermediate", caps: { ...YOUTH_CAPS, maxMinutesPerSession: 30 } });
    expect(advice.sessionLengthPref).toBe("short");
  });

  it("never recommends training plus rest days that add up past the week", () => {
    // A cap of 6 sessions with 3 mandatory rest days would be 9 days; the
    // wizard would then submit a week the generator has to fix.
    const advice = recommendSetup({ level: "advanced", caps: { maxSessionsPerWeek: 6, minRestDays: 3, maxMinutesPerSession: 90 } });

    expect(advice.daysPerWeek + advice.restDays).toBeLessThanOrEqual(7);
    expect(advice.restDays).toBeGreaterThanOrEqual(3);
  });

  it("does not argue for a number a cap has already taken away", () => {
    // The beginner reason used to hardcode "three full-body sessions" while
    // interpolating the number in front of it, so a one-session cap produced
    // "1 training days: three full-body sessions …". A sentence that contradicts
    // its own first word is how the panel stops being believed.
    const advice = recommendSetup({
      level: "beginner",
      caps: { maxSessionsPerWeek: 1, minRestDays: 0, maxMinutesPerSession: 30 },
    });

    expect(advice.daysPerWeek).toBe(1);
    expect(advice.reasons.daysPerWeek).toContain("1 training day:");
    expect(advice.reasons.daysPerWeek).not.toMatch(/three full-body/i);
    // The uncapped answer keeps the plain sentence, so the common case is not
    // saddled with a caveat that does not apply to it.
    expect(recommendSetup({ level: "beginner" }).reasons.daysPerWeek).toMatch(/three full-body/i);
  });

  it("downgrades intensity for a developing athlete, even an advanced one", () => {
    const advice = recommendSetup({ level: "advanced", age: 14 });
    expect(advice.intensityPref).toBe("easy");
  });

  it("downgrades hard to balanced for a masters athlete", () => {
    const advice = recommendSetup({ level: "advanced", age: 52 });
    expect(advice.intensityPref).toBe("balanced");
  });

  it("leaves an adult advanced athlete on hard", () => {
    expect(recommendSetup({ level: "advanced", age: 26 }).intensityPref).toBe("hard");
  });
});

describe("the environment and focus follow the athlete's own answers", () => {
  it("reads the environment from the sport", () => {
    expect(recommendSetup({ level: "beginner", sport: "Swimming" }).environment).toBe("Indoor");
    expect(recommendSetup({ level: "beginner", sport: "Running" }).environment).toBe("Outdoor");
    expect(recommendSetup({ level: "beginner", sport: "Tennis" }).environment).toBe("Mixed");
    // A sport the map has never heard of gets the neutral answer, not a guess.
    expect(recommendSetup({ level: "beginner", sport: "Kabaddi" }).environment).toBe("Mixed");
  });

  it("blends the goals into the level's focus areas, without duplicates", () => {
    const advice = recommendSetup({ level: "beginner", goals: ["Fat Loss", "Strength", "Fat Loss"] });

    expect(advice.focusAreas).toContain("Fat Loss");
    expect(advice.focusAreas).toContain("Strength");
    expect(new Set(advice.focusAreas).size).toBe(advice.focusAreas.length);
    expect(advice.focusAreas.length).toBeLessThanOrEqual(4);
  });

  it("recommends a duration the wizard can actually select", () => {
    // The wizard's own options are 4/6/8/12. A recommendation outside that list
    // is a suggestion nobody can tap.
    const { durationWeeks } = recommendSetup({ level: "intermediate" });
    expect([4, 6, 8, 12]).toContain(durationWeeks);
  });
});

describe("what it refuses to recommend", () => {
  it("offers no recommendation for equipment or training time", () => {
    const advice = recommendSetup({ level: "beginner" });

    // Not "has an empty value" — the fields do not exist, so no future edit can
    // quietly start badging a recommendation for either.
    expect(advice).not.toHaveProperty("equipment");
    expect(advice).not.toHaveProperty("timeOfDay");
    // Both are still explained in the wizard, in the honest direction.
    expect(advice.reasons.equipment).toMatch(/only you can give/i);
    expect(advice.reasons.timeOfDay).toMatch(/slot you can keep/i);
  });

  it("explains every recommendation it does make", () => {
    const advice = recommendSetup({ level: "beginner", goals: ["Endurance"], sport: "Running" });

    for (const [field, reason] of Object.entries(advice.reasons)) {
      expect(reason, `${field} has no reasoning`).toBeTruthy();
      expect(reason.length, `${field}'s reasoning is too thin to help`).toBeGreaterThan(40);
    }
  });
});

describe("comparing an answer to the advice", () => {
  it("matches scalars exactly and arrays as sets", () => {
    const advice = recommendSetup({ level: "intermediate" });

    expect(matchesAdvice(advice, "daysPerWeek", 4)).toBe(true);
    expect(matchesAdvice(advice, "daysPerWeek", 5)).toBe(false);
    // Order must not matter: the athlete taps chips in whatever order they like.
    expect(matchesAdvice(advice, "focusAreas", [...advice.focusAreas].reverse())).toBe(true);
    expect(matchesAdvice(advice, "focusAreas", advice.focusAreas.slice(1))).toBe(false);
  });
});
