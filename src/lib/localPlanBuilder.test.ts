import { describe, expect, it } from "vitest";
import { generatePlanData, planConstraints, type PlanQuiz } from "./localPlanBuilder";

const quiz = (overrides: Partial<PlanQuiz> = {}): PlanQuiz => ({
  daysPerWeek: 4,
  hoursPerWeek: 4,
  sessionLengthPref: "standard",
  equipment: ["full_gym"],
  environment: "gym",
  intensityPref: "balanced",
  focusAreas: [],
  timeOfDay: "evening",
  targetEvent: "",
  recoveryDays: 2,
  ...overrides,
});

describe("the week the athlete asked for", () => {
  const weekOne = (overrides: Partial<PlanQuiz> = {}, sport = "Football") =>
    generatePlanData(sport, "Get faster", "intermediate", 1, 25, quiz(overrides))[0]!;

  it.each([2, 3, 4, 5, 6])("writes exactly %i training days", (days) => {
    // Before this, every sport but Running/Gym used a fixed six-session
    // template, so a three-day answer produced a five- or six-session week.
    const week = weekOne({ daysPerWeek: days, recoveryDays: 1 });
    const training = week.sessions.filter((s) => !s.isRest && !s.isRecovery);
    expect(training).toHaveLength(days);
    expect(week.sessions).toHaveLength(7);
  });

  it("keeps the full rest days the athlete chose, and fills the rest as active recovery", () => {
    const week = weekOne({ daysPerWeek: 4, recoveryDays: 2 });
    expect(week.sessions.filter((s) => s.isRest)).toHaveLength(2);
    expect(week.sessions.filter((s) => s.isRecovery)).toHaveLength(1);
    expect(week.sessions.filter((s) => !s.isRest && !s.isRecovery)).toHaveLength(4);
  });

  it("puts the sessions the athlete said they wanted in the week", () => {
    const speedWeek = weekOne({ daysPerWeek: 3, focusAreas: ["Speed"] });
    const titles = speedWeek.sessions
      .filter((s) => !s.isRest && !s.isRecovery)
      .map((s) => s.title);
    expect(titles).toContain("Speed & Agility");
    // The other sport sessions are not dropped — they move behind the focus.
    expect(titles.length).toBe(3);
  });

  it("spreads the training days instead of bunching them at the start", () => {
    const week = weekOne({ daysPerWeek: 3, recoveryDays: 1 }, "Running");
    const trainingDays = week.sessions
      .filter((s) => !s.isRest && !s.isRecovery)
      .map((s) => s.day);
    expect(trainingDays).toEqual([1, 3, 5]);
  });
});

describe("planConstraints", () => {
  it("adds nothing when the athlete left no note and needs no access support", () => {
    const constraints = planConstraints(quiz());
    expect(constraints.cues).toEqual([]);
    expect(constraints.lowImpact).toBe(false);
    expect(constraints.sessionCapMinutes).toBeNull();
  });

  it("turns a knee note into a low-impact cue that reaches every session", () => {
    const answers = quiz({ notes: "My left knee gets sore when I run. I also have a bad shoulder." });
    const constraints = planConstraints(answers);
    expect(constraints.lowImpact).toBe(true);
    expect(constraints.overheadFree).toBe(true);
    expect(constraints.cues.join(" ")).toContain("Low-impact first");
    expect(constraints.cues.join(" ")).toContain("No loaded overhead pressing");

    const plan = generatePlanData("Running", "Get faster", "intermediate", 2, 25, answers);
    const training = plan[0]!.sessions.filter((s) => !s.isRest);
    expect(training.length).toBeGreaterThan(0);
    for (const session of training) {
      expect(session.adaptations).toEqual(expect.arrayContaining(constraints.cues));
    }
    // The high-impact movements are actually replaced, not just annotated.
    const exerciseNames = training.flatMap((s) =>
      ((s.exercises as { name: string }[] | undefined) ?? []).map((e) => e.name.toLowerCase()),
    );
    expect(exerciseNames.some((n) => /\b(sprint|run|jog|jump|hop|clean)\b/.test(n))).toBe(false);

    // The athlete's own words are kept verbatim in the plain-language cue when
    // they do not match a known constraint.
    const plain = planConstraints(quiz({ notes: "I play in a band on Thursdays." }));
    expect(plain.cues[0]).toContain("I play in a band on Thursdays.");
  });

  it("does not narrow the plan when a body part is the goal, not a complaint", () => {
    const constraints = planConstraints(quiz({ notes: "I want to build my back and shoulders." }));
    expect(constraints.lowImpact).toBe(false);
    expect(constraints.overheadFree).toBe(false);
    expect(constraints.cues).toHaveLength(1);
    expect(constraints.cues[0]).toContain("build my back and shoulders");
  });

  it("honours a stated time cap so no session overshoots it", () => {
    const answers = quiz({ notes: "I only have 30 minutes on training days." });
    const constraints = planConstraints(answers);
    expect(constraints.sessionCapMinutes).toBe(30);

    const plan = generatePlanData("Gym/Weightlifting", "Build muscle", "advanced", 4, 30, answers);
    for (const week of plan) {
      for (const session of week.sessions) {
        expect(session.duration_minutes).toBeLessThanOrEqual(30);
      }
    }
  });

  it("does not ask the athlete to self-diagnose, but adapts a declared chronic condition", () => {
    const answers = quiz({ disability: "chronic_pain_fatigue" });
    const constraints = planConstraints(answers);
    expect(constraints.lowEnergy).toBe(true);
    expect(constraints.lowImpact).toBe(true);
    expect(constraints.cues.join(" ")).toContain("Energy is the limiter");
  });

  it("keeps the plan standard for a support need that needs no change (prefer not to say)", () => {
    const constraints = planConstraints(quiz({ disability: "prefer_not_to_say" }));
    expect(constraints.lowImpact).toBe(false);
    expect(constraints.lowEnergy).toBe(false);
    expect(constraints.cues).toEqual([]);
  });
});
