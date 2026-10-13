// ============================================================================
// THE GOAL QUIZ'S RULES
// ----------------------------------------------------------------------------
// Three things about this quiz can break silently, and each is pinned below:
//
//   * the steps. Asking a target's worth of questions of somebody who said
//     "I only want a habit" is the wall this quiz exists to remove, and a
//     wrong step list still renders — it just renders the wrong form.
//
//   * the rules. An inverted target renders as a negative progress bar, and a
//     weekly target of 0 divides the week's percentage by zero. Both are
//     refused here rather than at the database.
//
//   * the rows. A habit-only goal must write `outcome_goal_id: null` — that
//     column being nullable is the whole reason a habit can now stand alone —
//     and a "both" goal must hang its habits off the target it just created.
//     Getting this backwards would silently detach the daily checklist from
//     the target it is meant to close the gap on.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  DEFAULT_CATEGORY,
  GOAL_CATEGORIES,
  HABIT_TEMPLATES,
  MAX_DAILY_ACTIONS,
  clampWeeklyTarget,
  dailyActionRows,
  emptyDraft,
  emptyHabitDraft,
  isKnownCategory,
  planWrites,
  processGoalRow,
  reviewDraft,
  stepsFor,
  suggestDailyActions,
  type GoalDraft,
} from "./goalSetup";

const draftWith = (over: Partial<GoalDraft> = {}): GoalDraft => ({
  ...emptyDraft("both"),
  ...over,
});

const completeTarget = {
  title: "Sub-18 5K",
  category: "performance",
  currentValue: "19.5",
  targetValue: "18",
  unit: "minutes",
  deadline: "2027-04-01",
};

describe("the quiz's shape follows the intent", () => {
  it("asks nothing about a target when only a habit was chosen", () => {
    // This is the door that did not exist: a weekly habit with no target above
    // it. Asking for a target's worth of answers is what made it unreachable.
    const steps = stepsFor("habit");
    expect(steps).not.toContain("target");
    expect(steps).not.toContain("progress");
    expect(steps).toEqual(["intent", "habit", "daily", "review"]);
  });

  it("asks nothing about the daily work when only a target was chosen", () => {
    const steps = stepsFor("target");
    expect(steps).toEqual(["intent", "target", "progress", "review"]);
    expect(steps).not.toContain("habit");
    expect(steps).not.toContain("daily");
  });

  it("asks both when both were chosen, and always ends on the review", () => {
    expect(stepsFor("both")).toEqual(["intent", "target", "progress", "habit", "daily", "review"]);
    for (const intent of ["target", "habit", "both"] as const) {
      expect(stepsFor(intent).at(-1)).toBe("review");
      expect(stepsFor(intent)[0]).toBe("intent");
    }
  });
});

describe("what the quiz checks before it saves anything", () => {
  it("accepts a complete target and a named habit", () => {
    const review = reviewDraft(
      draftWith({
        target: completeTarget,
        habits: [{ title: "Run 4 times a week", weeklyTarget: 4, dailyActions: ["Easy run"] }],
      }),
    );
    expect(review.ok).toBe(true);
    expect(review.problems).toEqual([]);
    expect(review.summary).toContain("Sub-18 5K");
    expect(review.summary).toContain("1 weekly habit");
  });

  it("refuses a target with no name", () => {
    const review = reviewDraft(draftWith({ target: { ...completeTarget, title: "  " } }));
    expect(review.ok).toBe(false);
    expect(review.problems.map((p) => p.field)).toContain("title");
  });

  it("accepts a target BELOW where the athlete is — a faster time is the common case", () => {
    // Sub-18 with a current 19.5 (minutes), which is the goal most athletes in
    // this app set. The manual dialog refuses target < current, so this quiz
    // would have inherited a rule that blocks a running time goal outright.
    const review = reviewDraft(draftWith({ intent: "target", target: completeTarget }));
    expect(review.ok).toBe(true);
    expect(review.problems).toEqual([]);
  });

  it("refuses a target that is already where the athlete is", () => {
    const review = reviewDraft(
      draftWith({ target: { ...completeTarget, currentValue: "18", targetValue: "18" } }),
    );
    expect(review.ok).toBe(false);
    expect(review.problems.map((p) => p.field)).toContain("targetValue");
  });

  it("accepts a target with no number and no deadline — they are optional", () => {
    const review = reviewDraft(
      draftWith({
        intent: "target",
        target: { ...completeTarget, targetValue: "", unit: "", deadline: "" },
      }),
    );
    expect(review.ok).toBe(true);
  });

  it("refuses a deadline that is not a date, and a unit that is a paragraph", () => {
    const bad = reviewDraft(
      draftWith({ target: { ...completeTarget, deadline: "sometime next spring" } }),
    );
    expect(bad.ok).toBe(false);
    expect(bad.problems.map((p) => p.field)).toContain("deadline");

    const longUnit = reviewDraft(
      draftWith({ target: { ...completeTarget, unit: "x".repeat(40) } }),
    );
    expect(longUnit.ok).toBe(false);
  });

  it("refuses a habit-only goal with no habit, but not a target-only goal with none", () => {
    expect(reviewDraft(draftWith({ intent: "habit", target: completeTarget, habits: [emptyHabitDraft()] })).ok)
      .toBe(false);
    // The target is complete; the empty habit it still carries is ignored
    // because this goal is not about a habit.
    expect(reviewDraft(draftWith({ intent: "target", target: completeTarget })).ok).toBe(true);
  });

  it("keeps the daily checklist to something a person can do daily", () => {
    const habits = [
      {
        title: "Run",
        weeklyTarget: 4,
        dailyActions: Array.from({ length: MAX_DAILY_ACTIONS + 1 }, (_, i) => `Action ${i}`),
      },
    ];
    const review = reviewDraft(draftWith({ target: completeTarget, habits }));
    expect(review.ok).toBe(false);
    expect(review.problems.map((p) => p.field)).toContain("daily");
  });

  it("only ever accepts a category the screen can badge", () => {
    expect(isKnownCategory(DEFAULT_CATEGORY)).toBe(true);
    expect(isKnownCategory("vibes")).toBe(false);
    expect(GOAL_CATEGORIES.length).toBeGreaterThanOrEqual(5);
    expect(reviewDraft(draftWith({ target: { ...completeTarget, category: "vibes" } })).ok).toBe(false);
  });

  it("costs nothing: goals are not a metered feature", () => {
    // The paid AI review is a separate button on the screen. If a goal of any
    // kind ever started costing credits, the athlete would find out here first.
    expect(reviewDraft(draftWith({ target: completeTarget })).cost).toBe(0);
  });
});

describe("the weekly target the progress maths divides by", () => {
  it("never returns zero, and never a week longer than a week", () => {
    for (const input of [0, -3, 0.4, 15, 100, Number.NaN]) {
      const target = clampWeeklyTarget(input);
      expect(target).toBeGreaterThanOrEqual(1);
      expect(target).toBeLessThanOrEqual(14);
    }
  });

  it("keeps a sane number exactly as asked", () => {
    for (const input of [1, 3, 4, 7, 14]) expect(clampWeeklyTarget(input)).toBe(input);
  });
});

describe("suggesting the daily work from the athlete's own words", () => {
  it("reads the habit out of a sentence", () => {
    expect(suggestDailyActions("I want to run 4 times a week")).toContain("Easy run");
    expect(suggestDailyActions("get to the gym more")).toContain("Strength session");
    expect(suggestDailyActions("be asleep by 22:30")).toContain("Lights out by 22:30");
  });

  it("still gives the checklist one row when it recognises nothing", () => {
    // An empty checklist under a named habit is a dead end: the athlete cannot
    // tick anything today. The habit itself is the fallback action.
    expect(suggestDailyActions("get better")).toEqual(["get better"]);
  });

  it("never returns more than four, however many keywords match", () => {
    const many = suggestDailyActions("run, cycle, swim, gym, mobility, sleep, water, eat, skill, physio");
    expect(many.length).toBeLessThanOrEqual(4);
    expect(new Set(many).size).toBe(many.length);
  });

  it("ships templates that are complete enough to save on their own", () => {
    for (const template of HABIT_TEMPLATES) {
      expect(template.title.trim()).not.toBe("");
      expect(template.weeklyTarget).toBe(clampWeeklyTarget(template.weeklyTarget));
      expect(template.dailyActions.length).toBeGreaterThan(0);
      expect(template.dailyActions.length).toBeLessThanOrEqual(MAX_DAILY_ACTIONS);
    }
  });
});

describe("the rows the answers become", () => {
  it("writes a standalone habit with no goal above it", () => {
    // outcome_goal_id is nullable and that is the entire point: the habit is
    // the goal. (The UI could not do this before — habits only existed inside a
    // target's card.)
    const plan = planWrites("user-1", draftWith({
      intent: "habit",
      habits: [{ title: "Run 4 times a week", weeklyTarget: 4, dailyActions: ["Easy run", "Intervals"] }],
    }));

    expect(plan.goal).toBeNull();
    expect(plan.habits).toHaveLength(1);

    const row = processGoalRow("user-1", plan.habits[0].habit, null);
    expect(row).toEqual({
      user_id: "user-1",
      outcome_goal_id: null,
      title: "Run 4 times a week",
      weekly_target: 4,
    });
    expect(dailyActionRows("user-1", plan.habits[0].actions)).toEqual([
      { user_id: "user-1", title: "Easy run" },
      { user_id: "user-1", title: "Intervals" },
    ]);
  });

  it("hangs the habit off the target on a both goal", () => {
    const plan = planWrites("user-1", draftWith({
      intent: "both",
      target: completeTarget,
      habits: [{ title: "Run 4 times a week", weeklyTarget: 4, dailyActions: ["Easy run"] }],
    }));

    expect(plan.goal).not.toBeNull();
    const row = processGoalRow("user-1", plan.habits[0].habit, "goal-9");
    expect(row.outcome_goal_id).toBe("goal-9");
  });

  it("carries the target's numbers, and blanks that mean 'not stated'", () => {
    const plan = planWrites("user-1", draftWith({ intent: "target", target: completeTarget }));
    expect(plan.goal).toEqual({
      user_id: "user-1",
      title: "Sub-18 5K",
      category: "performance",
      metric_unit: "minutes",
      start_value: 19.5,
      current_value: 19.5,
      target_value: 18,
      deadline: "2027-04-01",
    });

    const bare = planWrites("user-1", draftWith({
      intent: "target",
      target: { ...completeTarget, targetValue: "", unit: "", deadline: "", currentValue: "" },
    }));
    expect(bare.goal).toMatchObject({
      metric_unit: null,
      target_value: null,
      deadline: null,
      current_value: 0,
      start_value: 0,
    });
  });

  it("drops a habit with no name rather than writing an empty one", () => {
    const plan = planWrites("user-1", draftWith({
      intent: "both",
      target: completeTarget,
      habits: [emptyHabitDraft(), { title: "Mobility every day", weeklyTarget: 7, dailyActions: [] }],
    }));
    expect(plan.habits).toHaveLength(1);
    expect(plan.habits[0].habit.title).toBe("Mobility every day");
  });

  it("trims the answers, and the weekly target is clamped on the way out", () => {
    const plan = planWrites("user-1", draftWith({
      intent: "both",
      target: { ...completeTarget, title: "  Sub-18 5K  " },
      habits: [{ title: "  Run  ", weeklyTarget: 99, dailyActions: ["  Easy run  ", "   "] }],
    }));
    expect(plan.goal?.title).toBe("Sub-18 5K");
    expect(processGoalRow("user-1", plan.habits[0].habit, null).title).toBe("Run");
    expect(processGoalRow("user-1", plan.habits[0].habit, null).weekly_target).toBe(14);
    expect(plan.habits[0].actions).toEqual(["Easy run"]);
  });
});
