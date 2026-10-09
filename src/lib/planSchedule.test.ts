// Tests for the plan → real-dates projection.
//
// This projection is what makes a life event able to name the sessions it
// affects, so the properties that matter are the ones that would silently
// mis-date a whole week: the week anchor must be stable across views (it is
// derived from `created_at`, never from the `week_current` cursor), day numbers
// are clamped so malformed stored JSON cannot place a session in a neighbouring
// week, and a plan whose `plan_data` cannot be read returns no schedule rather
// than an invented one.

import { describe, expect, it } from "vitest";

import {
  asPlanWeeks,
  currentWeekOf,
  deriveImportance,
  flattenPlan,
  mondayOf,
  sessionDate,
  sessionsInPeriod,
  weekOneMonday,
  type TrainingPlanLike,
} from "./planSchedule";

/** Local date, so assertions never depend on the machine's timezone. */
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const plan = (overrides: Partial<TrainingPlanLike> = {}): TrainingPlanLike => ({
  id: "p1",
  // Wednesday 7 October 2026. The anchor must be the Monday of that week.
  created_at: local(2026, 10, 7).toISOString(),
  week_current: 1,
  duration_weeks: 6,
  plan_data: [],
  ...overrides,
});

const week = (weekNumber: number, sessions: unknown[]) => ({ week: weekNumber, sessions });
const session = (day: number, title: string, extra: Record<string, unknown> = {}) => ({
  day,
  title,
  type: "session",
  ...extra,
});

describe("mondayOf", () => {
  it("returns the Monday of the week containing the date", () => {
    // Monday itself, and every day through to Sunday, map back to 5 October.
    for (const day of [5, 6, 7, 8, 9, 10, 11]) {
      expect(mondayOf(local(2026, 10, day)).getDate()).toBe(5);
    }
  });

  it("crosses a month boundary backwards without drifting", () => {
    // Thursday 1 October 2026 → Monday 28 September 2026.
    const monday = mondayOf(local(2026, 10, 1));
    expect(monday.getMonth()).toBe(8);
    expect(monday.getDate()).toBe(28);
  });
});

describe("weekOneMonday", () => {
  it("anchors on the Monday of the week the plan was created", () => {
    expect(weekOneMonday(plan()).getDay()).toBe(1); // 1 = Monday
    expect(weekOneMonday(plan()).getDate()).toBe(5);
  });

  it("ignores week_current, which is the regression that would move history", () => {
    // The cursor advances as the athlete progresses. If the anchor followed it,
    // every already-dated session would shift the next time the plan was opened.
    const started = weekOneMonday(plan({ week_current: 1 }));
    const advanced = weekOneMonday(plan({ week_current: 4 }));
    expect(advanced.getTime()).toBe(started.getTime());
  });

  it("falls back to today rather than throwing on a plan with no usable created_at", () => {
    const fallback = local(2026, 3, 12); // a Thursday
    expect(weekOneMonday(plan({ created_at: null }), fallback).getDate()).toBe(9);
    expect(weekOneMonday(plan({ created_at: "not a date" }), fallback).getDate()).toBe(9);
  });
});

describe("sessionDate", () => {
  const anchor = mondayOf(local(2026, 10, 7)); // Monday 5 October 2026

  it("maps day 1 of week 1 to the anchor Monday", () => {
    expect(sessionDate(anchor, 1, 1)).toBe("2026-10-05");
  });

  it("maps the last day of the week to Sunday", () => {
    expect(sessionDate(anchor, 1, 7)).toBe("2026-10-11");
  });

  it("counts whole weeks, not calendar rows", () => {
    expect(sessionDate(anchor, 2, 1)).toBe("2026-10-12");
    expect(sessionDate(anchor, 3, 7)).toBe("2026-10-25");
  });

  it("clamps a malformed day instead of placing a session in another week", () => {
    // `day: 0` or `day: 12` can only come from hand-edited or legacy JSON, and
    // placing those in the neighbouring week is worse than clamping them.
    expect(sessionDate(anchor, 1, 0)).toBe("2026-10-05");
    expect(sessionDate(anchor, 1, 12)).toBe("2026-10-11");
    expect(sessionDate(anchor, 0, 1)).toBe("2026-10-05");
  });
});

describe("deriveImportance", () => {
  it("counts the sessions that carry the point of the week", () => {
    for (const type of ["speed", "intervals", "power", "sport_specific"]) {
      expect(deriveImportance({ day: 1, title: "x", type })).toBe(true);
    }
  });

  it("never calls a rest or recovery day important", () => {
    expect(deriveImportance({ day: 1, title: "Rest", type: "rest", isRest: true })).toBe(false);
    expect(deriveImportance({ day: 1, title: "Recovery", type: "recovery", isRecovery: true })).toBe(false);
    // Even if it were mislabelled with a key type: a rest day is not a loss.
    expect(deriveImportance({ day: 1, title: "Rest", type: "intervals", isRest: true })).toBe(false);
  });

  it("does not invent importance for an ordinary session", () => {
    expect(deriveImportance({ day: 1, title: "Easy run", type: "endurance" })).toBe(false);
    expect(deriveImportance({ day: 1, title: "Untyped" })).toBe(false);
  });
});

describe("asPlanWeeks", () => {
  it("returns nothing for data it cannot read rather than guessing", () => {
    expect(asPlanWeeks(null)).toEqual([]);
    expect(asPlanWeeks(undefined)).toEqual([]);
    expect(asPlanWeeks("weeks")).toEqual([]);
    expect(asPlanWeeks({ week: 1 })).toEqual([]);
    // Weeks without a `sessions` array are dropped, not treated as empty weeks.
    expect(asPlanWeeks([{ week: 1 }, null, "x", week(2, [])]).map((w) => w.week)).toEqual([2]);
  });
});

describe("flattenPlan", () => {
  const data = [
    week(1, [session(3, "Intervals", { type: "intervals" }), session(1, "Easy", { isRest: false })]),
    week(2, [session(1, "Rest", { isRest: true })]),
  ];

  it("gives every session a real date, oldest first", () => {
    const dated = flattenPlan(plan({ plan_data: data }));
    expect(dated.map((s) => s.scheduled_date)).toEqual(["2026-10-05", "2026-10-07", "2026-10-12"]);
  });

  it("builds a stable id from the plan, week and day", () => {
    const dated = flattenPlan(plan({ plan_data: data }));
    expect(dated.map((s) => s.id)).toEqual(["p1:1:1", "p1:1:3", "p1:2:1"]);
  });

  it("carries the rest flag from either place the plan expresses it", () => {
    const dated = flattenPlan(
      plan({ plan_data: [week(1, [session(1, "Rest", { isRest: true }), session(2, "Rest via type", { type: "rest" })])] }),
    );
    expect(dated.map((s) => s.isRest)).toEqual([true, true]);
  });

  it("marks key sessions and leaves the rest alone", () => {
    const dated = flattenPlan(
      plan({ plan_data: [week(1, [session(1, "Intervals", { type: "intervals" }), session(2, "Accessory")])] }),
    );
    expect(dated.map((s) => s.important)).toEqual([true, false]);
  });

  it("returns no schedule for a plan whose data cannot be read", () => {
    expect(flattenPlan(plan({ plan_data: null }))).toEqual([]);
    expect(flattenPlan(plan({ plan_data: { weeks: 6 } }))).toEqual([]);
  });

  it("skips a session with no usable day number instead of dating it", () => {
    const dated = flattenPlan(plan({ plan_data: [week(1, [{ title: "No day" }, session(2, "Fine")])] }));
    expect(dated.map((s) => s.title)).toEqual(["Fine"]);
  });
});

describe("sessionsInPeriod", () => {
  const dated = flattenPlan(
    plan({ plan_data: [week(1, [session(1, "A"), session(7, "B")]), week(2, [session(1, "C")])] }),
  );

  it("includes both ends of the period", () => {
    expect(sessionsInPeriod(dated, "2026-10-05", "2026-10-11").map((s) => s.title)).toEqual(["A", "B"]);
    expect(sessionsInPeriod(dated, "2026-10-11", "2026-10-12").map((s) => s.title)).toEqual(["B", "C"]);
  });

  it("returns nothing for a period that misses the plan entirely", () => {
    expect(sessionsInPeriod(dated, "2027-01-01", "2027-01-31")).toEqual([]);
  });

  it("covers exactly the sessions a two-week holiday spans, and no more", () => {
    // The spec's case 3 from the other side: a 4-week plan with one session a
    // week, and a 14-day break. The break must cover two sessions — not the
    // whole plan, which is what an off-by-one range would produce.
    const long = flattenPlan(
      plan({
        duration_weeks: 4,
        plan_data: [1, 2, 3, 4].map((w) => week(w, [session(1, `W${w}`)])),
      }),
    );
    expect(sessionsInPeriod(long, "2026-10-05", "2026-10-18").map((s) => s.title)).toEqual(["W1", "W2"]);
  });
});

describe("currentWeekOf", () => {
  const fourWeeks = plan({
    duration_weeks: 4,
    plan_data: [1, 2, 3, 4].map((w) => week(w, [session(1, `W${w}`)])),
  });

  it("reports the week the athlete is in", () => {
    expect(currentWeekOf(fourWeeks, local(2026, 10, 7))).toBe(1);
    expect(currentWeekOf(fourWeeks, local(2026, 10, 14))).toBe(2);
    expect(currentWeekOf(fourWeeks, local(2026, 10, 25))).toBe(3); // the Sunday of week 3
  });

  it("returns null before the plan starts and after it ends", () => {
    expect(currentWeekOf(fourWeeks, local(2026, 9, 30))).toBeNull();
    expect(currentWeekOf(fourWeeks, local(2026, 12, 1))).toBeNull();
  });

  it("returns null for a plan with no weeks", () => {
    expect(currentWeekOf(plan(), local(2026, 10, 7))).toBeNull();
  });
});
