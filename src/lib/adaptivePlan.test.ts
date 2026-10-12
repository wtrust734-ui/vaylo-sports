// Tests for the adaptive rebuild: what happens to a plan when the athlete has
// been away.
//
// The properties asserted here are the ones that would fail quietly and hurt
// someone:
//
//   • Nothing is moved. A dropped session becomes a rest day *in place* and
//     never reappears in a later week, so every session's day number is
//     identical before and after a rebuild and no week gains a session.
//   • History is not rewritten. Weeks that have already finished, days of the
//     return week that are already behind the athlete, and any session the
//     adaptive record says they completed are left exactly as they were.
//   • The rebuild is reversible, exactly. Undo restores from the record's own
//     snapshots rather than re-deriving what the plan "must have" said, so it
//     still works after the athlete has edited the rebuilt plan.
//   • It is conservative, and never more aggressive than the band allows — the
//     percentages come from the specification and are asserted rather than
//     described.
//
// The thirteen cases the Phase 2 specification asks for are covered and named
// in the descriptions, but they are asserted through the normal API rather than
// special-cased: every one of them is the same function with different facts.

import { describe, expect, it } from "vitest";

import {
  activeAdjustments,
  adjustmentForWeek,
  chooseKeptSessions,
  classifyBreak,
  creditedDays,
  planRebuild,
  rebuildRefusalNote,
  rebuildWeek,
  returnProgression,
  undoAdjustment,
  weekDayKey,
  weekNote,
  type AdjustmentStep,
  type BreakFacts,
  type PlanAdjustmentRecord,
  type RebuildInput,
  type RebuildOutcome,
  type ReturnContext,
} from "./adaptivePlan";
import { flattenPlan, type PlanSessionLike, type PlanWeekLike, type TrainingPlanLike } from "./planSchedule";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Monday 5 October 2026. Every date below is derived from it, so the file has
 *  one place to change if the fixture ever needs to move. */
const ANCHOR = "2026-10-05";
const TODAY = "2026-10-05";

const addDays = (key: string, days: number): string => {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const weekStart = (week: number): string => addDays(ANCHOR, (week - 1) * 7);

/** The same anchor as a plan row, so `flattenPlan` can date the fixture too. */
const planRow = (plan_data: unknown): TrainingPlanLike => ({
  id: "p1",
  created_at: new Date(2026, 9, 5).toISOString(),
  plan_data,
});

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const session = (
  day: number,
  title: string,
  type: string,
  duration = 60,
  extra: Record<string, unknown> = {},
): PlanSessionLike => ({
  day,
  dayName: DAY_NAMES[day - 1],
  title,
  type,
  duration_minutes: duration,
  description: `${title} as the generator wrote it.`,
  warmup: ["Row 3 min"],
  exercises: [{ name: "Squat", sets: "4x6" }],
  cooldown: ["Stretch 5 min"],
  skipped: false,
  ...extra,
});

const restDay = (day: number): PlanSessionLike => ({
  day,
  dayName: DAY_NAMES[day - 1],
  title: "Rest Day",
  type: "rest",
  duration_minutes: 0,
  description: "Full rest.",
  exercises: [],
  isRest: true,
});

/**
 * A week in the shape the generator actually produces: four sessions, three
 * rest days, and two of the four are key work (speed and intervals, by the
 * `deriveImportance` heuristic that Phase 1 already uses).
 */
const standardWeek = (week: number): PlanWeekLike => ({
  week,
  isDeload: false,
  isHoliday: false,
  sessions: [
    session(1, "Speed Work", "speed"),
    restDay(2),
    session(3, "Interval Training", "intervals"),
    restDay(4),
    session(5, "Strength Training", "strength"),
    restDay(6),
    session(7, "Long Run", "endurance"),
  ],
});

const plan = (weeks = 6): PlanWeekLike[] => Array.from({ length: weeks }, (_, i) => standardWeek(i + 1));

const facts = (overrides: Partial<BreakFacts> = {}): BreakFacts => ({
  eventId: "ev-1",
  eventType: "holiday",
  startDate: "2026-10-12", // Monday of week 2
  endDate: "2026-10-18", // Sunday of week 2
  days: 7,
  activityLevel: "none",
  allowTraining: "no",
  ...overrides,
});

const run = (overrides: Partial<RebuildInput> = {}): RebuildOutcome =>
  planRebuild({ weeks: plan(), weekStart, facts: facts(), id: "adj-1", today: TODAY, ...overrides });

/** Sessions that are not rest days, by day number. */
const playableDays = (week: PlanWeekLike): number[] =>
  week.sessions.filter((s) => !s.isRest && s.type !== "rest" && !s.isRecovery).map((s) => s.day);

const byDay = (week: PlanWeekLike, day: number): PlanSessionLike =>
  week.sessions.find((s) => s.day === day)!;

// ---------------------------------------------------------------------------
// Break classification
// ---------------------------------------------------------------------------

describe("classifyBreak", () => {
  it("treats up to three days as no interruption at all", () => {
    for (const days of [0, -5, 1, 2, 3]) expect(classifyBreak(days)).toBe("none");
  });

  it("does not explode on nonsense input", () => {
    // A value that is not a real number of days cannot be allowed to trigger a
    // rebuild, so it falls on the "no interruption" side of every check.
    expect(classifyBreak(Number.NaN)).toBe("none");
    expect(classifyBreak(Number.POSITIVE_INFINITY)).toBe("none");
  });

  it("uses the specification's bands, erring conservative where they overlap", () => {
    expect(classifyBreak(4)).toBe("week");
    expect(classifyBreak(7)).toBe("week");
    expect(classifyBreak(8)).toBe("fortnight");
    expect(classifyBreak(14)).toBe("fortnight");
    expect(classifyBreak(15)).toBe("extended");
    // The spec calls 28 days both the end of "15–28" and the start of "28+".
    expect(classifyBreak(27)).toBe("extended");
    expect(classifyBreak(28)).toBe("reset");
    expect(classifyBreak(120)).toBe("reset");
  });
});

// ---------------------------------------------------------------------------
// Progression bands
// ---------------------------------------------------------------------------

describe("returnProgression", () => {
  it("returns nothing for a break that needs no rebuild", () => {
    expect(returnProgression("none")).toEqual([]);
  });

  it("programs a 4–7 day break as a two-week climb rather than one week and straight back in", () => {
    expect(returnProgression("week", {})).toEqual([
      { back: 1, volumePct: 70, intensityPct: 80, focus: "rebuild" },
      { back: 2, volumePct: 85, intensityPct: 90, focus: "resume" },
    ]);
    // The last week back is deliberately not 100%: it is where the athlete is
    // most likely to sprint for the level they left on.
    for (const step of returnProgression("week", {})) expect(step.volumePct).toBeLessThan(100);
  });

  it("programs 8–14 days over two weeks, starting under 60%", () => {
    const steps = returnProgression("fortnight", {});
    expect(steps.map((s) => [s.volumePct, s.intensityPct])).toEqual([
      [55, 65],
      [75, 80],
    ]);
    // "Avoid immediate high-intensity blocks" — the first week back is capped.
    expect(steps[0].intensityPct).toBeLessThan(70);
  });

  it("treats 15–27 days as a three-week mini-base rebuild", () => {
    expect(returnProgression("extended", {}).map((s) => [s.volumePct, s.intensityPct])).toEqual([
      [45, 55],
      [65, 75],
      [85, 88],
    ]);
  });

  it("treats 28+ days as a four-week reset that never reaches the old peak", () => {
    const steps = returnProgression("reset", {});
    expect(steps.map((s) => [s.volumePct, s.intensityPct])).toEqual([
      [40, 50],
      [55, 65],
      [70, 80],
      [85, 90],
    ]);
    // The last week is deliberately not 100% — the sprint back to old numbers
    // is the week that undoes the whole return.
    expect(steps[steps.length - 1].volumePct).toBeLessThan(95);
  });

  it("is consistently gentler for a youth athlete, and longer after a reset", () => {
    const adult = returnProgression("reset", {});
    const youth = returnProgression("reset", { age: 15 });
    expect(youth).toHaveLength(adult.length + 1);
    for (let i = 0; i < adult.length; i++) {
      expect(youth[i].volumePct).toBe(adult[i].volumePct - 5);
      expect(youth[i].intensityPct).toBe(adult[i].intensityPct - 5);
    }
    // The step the adult does not get, so a young athlete is not asked to be
    // back at full training after a month off in the same four weeks.
    expect(youth[4]).toMatchObject({ back: 5, volumePct: 90, intensityPct: 95 });
  });

  it("does not treat an unknown or adult age as youth", () => {
    expect(returnProgression("week", { age: 18 })[0].volumePct).toBe(70);
    expect(returnProgression("week", { age: null })[0].volumePct).toBe(70);
    expect(returnProgression("week", {})[0].volumePct).toBe(70);
  });

  it("caps the first week back hard after illness or injury", () => {
    const [first, second] = returnProgression("extended", { medical: true });
    expect(first.intensityPct).toBeLessThanOrEqual(60);
    expect(first.volumePct).toBe(40); // 45 − 5
    expect(second.intensityPct).toBeLessThanOrEqual(70);
  });

  it("takes a further notch off the first week when the athlete's own recovery logging is poor", () => {
    const [plain] = returnProgression("week", {});
    const [poor] = returnProgression("week", { recoveryPoor: true });
    expect(poor.volumePct).toBe(plain.volumePct - 10);
    expect(poor.intensityPct).toBe(plain.intensityPct - 10);
  });

  it("never programs below a third of normal volume, however many modifiers stack", () => {
    const [first] = returnProgression("reset", { age: 14, medical: true, recoveryPoor: true });
    expect(first.volumePct).toBe(33);
    expect(first.intensityPct).toBeGreaterThanOrEqual(40);
  });

  it("does not cut to 40% an athlete who had almost no training to lose", () => {
    const [first] = returnProgression("reset", { consistentWeeksBefore: 0 });
    expect(first.volumePct).toBe(60);
    expect(first.intensityPct).toBeGreaterThanOrEqual(65);
  });

  it("leaves a consistent athlete on the band the break earned", () => {
    const [first] = returnProgression("reset", { consistentWeeksBefore: 6 });
    expect(first.volumePct).toBe(40);
  });

  it("never lets the no-history floor lift a week that illness or injury capped", () => {
    // Both rules can apply to the same athlete, and they point in opposite
    // directions. The medical one is the stronger reason, so it wins.
    const [first] = returnProgression("reset", { medical: true, consistentWeeksBefore: 0 });
    expect(first.volumePct).toBe(35);
    expect(first.intensityPct).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Credit for what the athlete kept doing
// ---------------------------------------------------------------------------

describe("creditedDays", () => {
  it("credits nothing when the athlete was fully away", () => {
    expect(creditedDays(facts(), {})).toBe(0);
  });

  it("reads a declared activity level as a share of the days", () => {
    expect(creditedDays(facts({ activityLevel: "normal" }), {})).toBeCloseTo(2.45, 5);
    expect(creditedDays(facts({ activityLevel: "light" }), {})).toBeCloseTo(1.05, 5);
    expect(creditedDays(facts({ activityLevel: "unknown" }), {})).toBe(0);
  });

  it("counts days trained in this sport in full and days in another at half", () => {
    // The specification's warning: activity in one sport does not maintain
    // another, so a week of swimming cannot cancel a running rebuild.
    expect(creditedDays(facts(), { activeDaysSameSport: 2 })).toBe(2);
    expect(creditedDays(facts(), { activeDaysOtherSport: 2 })).toBe(1);
  });

  it("never credits more than half the break, however much was logged", () => {
    // Somebody who trained every day of a three-week break was not away for
    // three weeks — but they were also not following the plan.
    expect(creditedDays(facts({ days: 21, activityLevel: "normal" }), { activeDaysSameSport: 21 })).toBe(10.5);
  });

  it("cannot be pushed negative by nonsense counts", () => {
    expect(creditedDays(facts(), { activeDaysSameSport: -4, activeDaysOtherSport: -4 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Which sessions survive a reduced week
// ---------------------------------------------------------------------------

describe("chooseKeptSessions", () => {
  const five = [
    session(1, "Mon", "endurance"),
    session(2, "Tue", "endurance"),
    session(3, "Wed", "endurance"),
    session(4, "Thu", "endurance"),
    session(5, "Fri", "endurance"),
  ];

  it("keeps every key session even when the budget is smaller than the key count", () => {
    const week = [session(1, "Speed", "speed"), session(3, "Intervals", "intervals"), session(5, "Run", "endurance")];
    expect(chooseKeptSessions(week, 1).map((s) => s.title)).toEqual(["Speed", "Intervals"]);
  });

  it("spaces a seven-day week around the key sessions", () => {
    // After a break the thing that has gone is the ability to absorb load, and
    // three sessions on consecutive days is how a rebuild week becomes an
    // injury. Given a choice, the survivor furthest from everything already
    // kept wins.
    expect(chooseKeptSessions(standardWeek(1).sessions, 3).map((s) => s.day)).toEqual([1, 3, 5]);
    expect(chooseKeptSessions(standardWeek(1).sessions, 2).map((s) => s.day)).toEqual([1, 3]);
  });

  it("does not keep three days in a row when a spread is available", () => {
    const kept = chooseKeptSessions(five, 3).map((s) => s.day);
    let longest = 1;
    let run = 1;
    for (let i = 1; i < kept.length; i++) {
      run = kept[i] === kept[i - 1] + 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    expect(kept).toHaveLength(3);
    expect(longest).toBeLessThanOrEqual(2);
  });

  it("never keeps a rest day, even when the budget exceeds the sessions", () => {
    const week = [restDay(1), session(3, "Run", "endurance"), restDay(5)];
    expect(chooseKeptSessions(week, 9).map((s) => s.day)).toEqual([3]);
  });

  it("is stable: the same input gives the same choice", () => {
    expect(chooseKeptSessions(five, 2).map((s) => s.day)).toEqual(chooseKeptSessions(five, 2).map((s) => s.day));
  });

  it("prefers the longer session when the spacing is equal", () => {
    const week = [session(4, "Short", "endurance", 30), session(5, "Long", "endurance", 90)];
    expect(chooseKeptSessions(week, 1)[0].title).toBe("Long");
  });
});

// ---------------------------------------------------------------------------
// One week
// ---------------------------------------------------------------------------

describe("rebuildWeek", () => {
  const step = { back: 1, volumePct: 70, intensityPct: 80, focus: "rebuild" as const, weekNumber: 3 };

  it("scales durations to the band, rounded to a five-minute boundary", () => {
    const { week } = rebuildWeek(standardWeek(3), step, "ev-1");
    expect(byDay(week, 1).duration_minutes).toBe(40); // 60 × 70% = 42 → 40
    expect(byDay(week, 1).returnFromBreak).toMatchObject({
      lifeEventId: "ev-1",
      weekBack: 1,
      volumePct: 70,
      intensityPct: 80,
      originalDuration: 60,
    });
  });

  it("drops a session in place rather than moving it", () => {
    const { week, droppedTitles } = rebuildWeek(standardWeek(3), step, "ev-1");
    expect(droppedTitles).toEqual(["Long Run"]);

    const sunday = byDay(week, 7);
    expect(sunday.day).toBe(7);
    expect(sunday.isRest).toBe(true);
    expect(sunday.duration_minutes).toBe(0);
    expect(sunday.title).toBe("Rest");
    expect(sunday.returnFromBreak).toMatchObject({ dropped: true, originalTitle: "Long Run" });
    // The athlete is told, in the session, that nothing was displaced.
    expect(String(sunday.description)).toContain("nothing has been moved into next week");
  });

  it("keeps the point of the week and writes the key flag onto it", () => {
    const { week } = rebuildWeek(standardWeek(3), step, "ev-1");
    expect(byDay(week, 1).key).toBe(true);
    expect(byDay(week, 3).key).toBe(true);
    expect(byDay(week, 5).key).toBe(false);
  });

  it("downgrades high-intensity work when the ceiling is below 85%, and leaves it alone above", () => {
    const { week } = rebuildWeek(standardWeek(3), { ...step, intensityPct: 80 }, "ev-1");
    expect(byDay(week, 1).type).toBe("endurance");
    expect(byDay(week, 3).type).toBe("endurance");

    const { week: sharp } = rebuildWeek(standardWeek(3), { ...step, intensityPct: 88 }, "ev-1");
    expect(byDay(sharp, 1).type).toBe("speed");
    expect(byDay(sharp, 3).type).toBe("intervals");
  });

  it("writes the ceiling into the session without claiming it is a recovery day", () => {
    const { week } = rebuildWeek(standardWeek(3), { ...step, intensityPct: 55, volumePct: 45 }, "ev-1");
    expect(String(byDay(week, 1).description)).toContain("hold this to about 55%");
    // `isRecovery` means "this is an active recovery day" everywhere else in
    // the app, and anything that asks whether a day is playable treats it as a
    // rest day. A rebuilt session must not be hidden from the next rebuild.
    expect(byDay(week, 1).isRecovery).toBeFalsy();
    expect(byDay(week, 1).isRest).toBeFalsy();
    // A session that was dropped, by contrast, really is a rest day.
    expect(byDay(week, 7).isRest).toBe(true);
    expect(byDay(week, 7).isRecovery).toBe(false);
  });

  it("records exactly the sessions it changed, for undo", () => {
    const { snapshot } = rebuildWeek(standardWeek(3), step, "ev-1");
    expect(snapshot.map((s) => s.session.day)).toEqual([1, 3, 5, 7]);
    expect(snapshot.map((s) => s.week)).toEqual([3, 3, 3, 3]);
    expect(snapshot[0].session.duration_minutes).toBe(60);
  });

  it("leaves rest days, locked sessions and the earlier days of a mid-week return untouched", () => {
    const { week, snapshot, droppedTitles } = rebuildWeek(
      standardWeek(3),
      { ...step, fromDay: 6 },
      "ev-1",
      [weekDayKey(3, 7)],
    );

    // Days 1 and 3 are before the athlete came back; day 7 is locked because
    // they already did it. Nothing changed in any of them, so nothing about
    // them goes into the reversal record either.
    expect(byDay(week, 1).duration_minutes).toBe(60);
    expect(byDay(week, 3).duration_minutes).toBe(60);
    expect(byDay(week, 7).duration_minutes).toBe(60);
    expect(byDay(week, 7).returnFromBreak).toBeUndefined();
    expect(snapshot).toEqual([]);
    expect(droppedTitles).toEqual([]);
    expect(byDay(week, 2).isRest).toBe(true);
  });

  it("never shrinks a session below ten minutes", () => {
    const tiny: PlanWeekLike = { week: 3, sessions: [session(1, "Mobility", "endurance", 15)] };
    const { week } = rebuildWeek(tiny, { ...step, volumePct: 40, intensityPct: 95 }, "ev-1");
    expect(byDay(week, 1).duration_minutes).toBe(10);
  });

  it("summarises the week for the screen without the athlete having to read the sessions", () => {
    const { week } = rebuildWeek(standardWeek(3), step, "ev-1");
    expect(week.returnFromBreak).toMatchObject({ weekBack: 1, sessions: 3, dropped: 1 });
    expect(week.returnFromBreak!.droppedTitles).toEqual(["Long Run"]);
    expect(week.extraNote).toBe(weekNote(step));
  });

  it("leaves a week of nothing but rest alone", () => {
    const empty: PlanWeekLike = { week: 3, sessions: [restDay(1), restDay(2), restDay(3)] };
    const { week, droppedTitles } = rebuildWeek(empty, step, "ev-1");
    expect(droppedTitles).toEqual([]);
    expect(week.returnFromBreak).toMatchObject({ sessions: 0, dropped: 0 });
  });
});

// ---------------------------------------------------------------------------
// The whole plan
// ---------------------------------------------------------------------------

describe("planRebuild", () => {
  it("case 1 — a one-day break changes nothing at all", () => {
    const outcome = run({
      facts: facts({ startDate: "2026-10-12", endDate: "2026-10-12", days: 1 }),
    });
    expect(outcome.reason).toBe("break-too-short");
    expect(outcome.adjustment).toBeNull();
    expect(outcome.weeks).toEqual(plan());
  });

  it("case 1 (cont.) — a three-day break is still not an interruption", () => {
    expect(run({ facts: facts({ endDate: "2026-10-14", days: 3 }) }).reason).toBe("break-too-short");
  });

  it("case 2 — a seven-day holiday rebuilds the first week back at 70/80 and keeps the point of the week", () => {
    const outcome = run();
    expect(outcome.reason).toBe("applied");

    const week3 = outcome.weeks[2];
    expect(week3.returnFromBreak).toMatchObject({
      lifeEventId: "ev-1",
      weekBack: 1,
      volumePct: 70,
      intensityPct: 80,
      focus: "rebuild",
      sessions: 3,
      dropped: 1,
    });
    // The key sessions survived. The accessory long run did not.
    expect(byDay(week3, 1).title).toBe("Speed Work");
    expect(byDay(week3, 3).title).toBe("Interval Training");
    expect(byDay(week3, 7).isRest).toBe(true);

    // Week 1 is the loading week before the holiday: every session is still
    // there, just ~10% longer (60 min -> 65, rounded to five minutes).
    const original = plan();
    expect(outcome.weeks[0]).not.toBe(original[0]);
    for (const day of [1, 3, 5, 7]) expect(byDay(outcome.weeks[0], day).duration_minutes).toBe(65);
    expect(outcome.weeks[0].extraNote).toContain("Loading week");
    // The holiday week itself (no training allowed) is the very same object:
    // there is no path by which it was touched.
    expect(outcome.weeks[1]).toEqual(original[1]);
    // Week 4 is the second week back, climbing to 85% rather than landing at
    // full volume, and week 5 onwards is untouched.
    expect(outcome.weeks[3].returnFromBreak).toMatchObject({ weekBack: 2, volumePct: 85, focus: "resume" });
    expect(outcome.weeks[4]).toEqual(original[4]);
  });

  it("case 2 (cont.) — the explanation names the break, the window and the choice", () => {
    const { adjustment } = run();
    expect(adjustment!.explanation).toContain("Your plan has been rebuilt because of a holiday from 12 Oct to 18 Oct.");
    expect(adjustment!.explanation).toContain("rather than trying to make up everything you missed");
    expect(adjustment!.headline).toBe("Rebuilt for a holiday");
    expect(adjustment!.steps.map((s) => [s.week, s.focus, s.volumePct, s.intensityPct])).toEqual([
      [1, "preload", 110, 100],
      [3, "rebuild", 70, 80],
      [4, "resume", 85, 90],
    ]);
    // Every step records what stood in the week before it, so undo is exact —
    // and none of these weeks had a note to replace.
    for (const step of adjustment!.steps) expect(step.previousNote).toBeUndefined();
  });

  it("case 3 — a four-week break is a reset rebuilt over four progressively fuller weeks", () => {
    const outcome = run({
      weeks: plan(10),
      facts: facts({ eventType: "exams", startDate: "2026-10-12", endDate: "2026-11-08", days: 28 }),
    });
    expect(outcome.reason).toBe("applied");
    // The four-week break ends on Sunday 8 November, so the athlete returns on
    // Monday 9 November, which is the first day of week 6.
    expect(outcome.adjustment!.steps.map((s) => [s.week, s.volumePct, s.intensityPct])).toEqual([
      [6, 40, 50],
      [7, 55, 65],
      [8, 70, 80],
      [9, 85, 90],
    ]);
    // Never the previous peak, in any of the four weeks.
    for (const step of outcome.adjustment!.steps) expect(step.volumePct).toBeLessThan(95);
  });

  it("case 3 (cont.) — a break with no weeks left behind it says so instead of doing nothing quietly", () => {
    const outcome = run({
      weeks: plan(2),
      facts: facts({ startDate: "2026-10-12", endDate: "2026-11-08", days: 28 }),
    });
    expect(outcome.reason).toBe("no-remaining-weeks");
    expect(outcome.adjustment).toBeNull();
  });

  it("case 2 (cont.) — the loading week is banked from mid-week, not only on its Monday", () => {
    // The regression: the loading week used to require the whole week to be
    // unstarted (`startKey >= today`), which only ever held when the break was
    // added on the Monday a week out. A holiday entered on Thursday got the
    // eased week, the return ramp — and no loading week at all, which is the
    // "before it, you should probably get some hard work" half of the plan
    // silently never happening.
    const outcome = run({
      today: "2026-10-08", // the Thursday of week 1; the break starts the following Monday
    });
    expect(outcome.reason).toBe("applied");
    const loading = outcome.adjustment!.steps.find((s) => s.focus === "preload");
    expect(loading).toMatchObject({ week: 1, volumePct: 110 });
    // The days still ahead are banked; the days already behind the athlete are
    // left exactly as they were.
    expect(byDay(outcome.weeks[0], 5).duration_minutes).toBe(65);
    expect(byDay(outcome.weeks[0], 7).duration_minutes).toBe(65);
    expect(byDay(outcome.weeks[0], 1).duration_minutes).toBe(60);
    expect(byDay(outcome.weeks[0], 3).duration_minutes).toBe(60);
  });

  it("case 2 (cont.) — nothing is loaded once the day before the break is behind the athlete", () => {
    // The break starts on Monday 12 October and today is that Monday: the week
    // that would be loaded has finished, so nothing is loaded — and, crucially,
    // the loading step does not reach into the break's own week to load days
    // the athlete has just said they are away for.
    const outcome = run({ today: "2026-10-12" });
    expect(outcome.adjustment!.steps.map((s) => s.focus)).toEqual(["rebuild", "resume"]);
    expect(outcome.weeks[0]).toEqual(plan()[0]);
  });

  it("case 2 (cont.) — a break starting mid-week loads only the days before it", () => {
    // A holiday from Wednesday 14 October. Week 2 is both the loading week and
    // the break's own week, so Monday and Tuesday bank a little extra and
    // Wednesday onwards — the days the athlete is away — are left alone.
    const outcome = run({
      facts: facts({ startDate: "2026-10-14", endDate: "2026-10-17", days: 4 }),
      today: "2026-10-12",
    });
    const loading = outcome.adjustment!.steps.find((s) => s.focus === "preload");
    expect(loading).toMatchObject({ week: 2 });
    // Monday and Tuesday bank the extra 10%; the days the athlete is away are
    // not loaded, and the ramp after the return still happens in this same week
    // (Sunday), composed on top of the loading rather than replacing it.
    expect(byDay(outcome.weeks[1], 1).duration_minutes).toBe(65);
    expect(byDay(outcome.weeks[1], 3).duration_minutes).toBe(60);
    expect(byDay(outcome.weeks[1], 3).returnFromBreak).toBeUndefined();
    expect(byDay(outcome.weeks[1], 7).returnFromBreak).toBeDefined();
  });

  it("case 7 — a 4-day break ending on a Saturday still ramps on the athlete's next real week", () => {
    // Wednesday to Saturday away, so they are back on the Sunday of week 2 —
    // the last day of that plan week, which in this fixture is a rest day. The
    // step the return week cannot take moves to week 3 rather than vanishing
    // with it; the old code dropped it and left the athlete going straight back
    // in at full volume.
    const weeks = plan(6).map((w) =>
      w.week === 2 ? { ...w, sessions: w.sessions.map((s) => (s.day === 7 ? restDay(7) : s)) } : w,
    );
    const outcome = run({
      weeks,
      facts: facts({ startDate: "2026-10-14", endDate: "2026-10-17", days: 4 }),
      today: "2026-10-14",
    });
    expect(outcome.reason).toBe("applied");
    expect(outcome.adjustment!.steps[0]).toMatchObject({ week: 3, focus: "rebuild", volumePct: 70, intensityPct: 80 });
    // The return week itself is untouched: there was nothing of it left.
    expect(outcome.weeks[1]).toEqual(weeks[1]);
    expect(byDay(outcome.weeks[2], 3).duration_minutes).toBe(40);
    // And the week after climbs rather than landing back at full volume.
    expect(outcome.adjustment!.steps[1]).toMatchObject({ week: 4, focus: "resume", volumePct: 85 });
  });

  it("case 7 (cont.) — a 4–7 day break climbs back over two weeks instead of landing", () => {
    const outcome = run();
    const returns = outcome.adjustment!.steps.filter((s) => s.focus !== "preload");
    expect(returns.map((s) => [s.week, s.focus, s.volumePct, s.intensityPct])).toEqual([
      [3, "rebuild", 70, 80],
      [4, "resume", 85, 90],
    ]);
    // Never straight back to the volume they left on.
    for (const step of returns) expect(step.volumePct).toBeLessThan(100);
  });

  it("case 4 — a holiday with exercise counts the days kept, and can shorten the rebuild band", () => {
    // Eight days away is normally a fortnight band. Four of those days were
    // actually trained in this sport, so the athlete was effectively away for
    // four days and the rebuild is the four-day one.
    const outcome = run({
      facts: facts({ startDate: "2026-10-12", endDate: "2026-10-19", days: 8, activityLevel: "normal" }),
      context: { activeDaysSameSport: 4 },
    });
    expect(outcome.reason).toBe("applied");
    expect(outcome.adjustment!.creditedDays).toBe(4);
    // The loading week plus the two-week climb back.
    expect(outcome.adjustment!.steps).toHaveLength(3);
    expect(outcome.adjustment!.steps[0]).toMatchObject({ week: 1, focus: "preload", volumePct: 110 });
    expect(outcome.adjustment!.steps[1].volumePct).toBe(70);
    expect(outcome.adjustment!.steps[2]).toMatchObject({ focus: "resume", volumePct: 85 });
    expect(outcome.adjustment!.explanation).toContain("You kept training during some of it");
  });

  it("case 3 (cont.) — a break with nothing left inside it says so, rather than claiming a change", () => {
    // The athlete takes the last week of their plan off. Every week of the plan
    // is inside the break, so there is no week left to rebuild — the honest
    // answer, and one the athlete is now told, rather than the old generic
    // "Nothing needed changing on your plan."
    const outcome = run({
      weeks: plan(3),
      facts: facts({ startDate: "2026-10-19", endDate: "2026-10-25", days: 7 }),
      today: "2026-10-19",
    });
    expect(outcome.reason).not.toBe("applied");
    expect(outcome.adjustment).toBeNull();
    expect(rebuildRefusalNote(outcome.reason)).not.toBe("Nothing needed changing on your plan.");
  });

  it("case 4 (cont.) — a declared activity level is credited in the record", () => {
    const outcome = run({ facts: facts({ activityLevel: "normal" }) });
    // 0.35 of a day for each of seven days is 2.45, stored to one decimal as
    // 2.4. It rounds down rather than up, which is the conservative direction:
    // less credit means a fuller rebuild.
    expect(outcome.adjustment!.creditedDays).toBe(2.4);
    expect(outcome.adjustment!.explanation).toContain("2 of those days are already accounted for");
  });

  it("case 5 — a football match inside the rebuild window turns that week into a taper, not a rebuild", () => {
    // Fourteen days away returns the athlete into week 4, and the match falls
    // on the Saturday of that first week back.
    const outcome = run({
      weeks: plan(8),
      facts: facts({ startDate: "2026-10-12", endDate: "2026-10-25", days: 14 }),
      competitions: [{ title: "Sunday League", date: "2026-10-31" }],
    });
    const steps = outcome.adjustment!.steps;
    // A loading week is banked before the break; the return starts after it.
    expect(steps[0]).toMatchObject({ week: 1, focus: "preload", volumePct: 110 });
    const [first, second] = steps.slice(1);
    expect(first.week).toBe(4);
    // Volume cut to at most half, intensity kept — arriving fresh is the only
    // thing left to optimise in the week of a match.
    expect(first).toMatchObject({ focus: "compete", volumePct: 50, intensityPct: 90 });
    // The rebuild resumes its normal curve the week after.
    expect(second).toMatchObject({ week: 5, focus: "restore", volumePct: 75, intensityPct: 80 });
    expect(outcome.adjustment!.competingSoon).toBe(true);
    expect(outcome.adjustment!.explanation).toContain("competition in that window");

    const competitionWeek = outcome.weeks.find((w) => w.week === 4)!;
    expect(competitionWeek.returnFromBreak!.focus).toBe("compete");
    // Nothing was moved to make room for it, and the match itself was not
    // scaled away by the rebuild.
    expect(competitionWeek.sessions.map((s) => s.day)).toEqual(standardWeek(4).sessions.map((s) => s.day));
  });

  it("case 6 — a session completed just before the break is left exactly as it was", () => {
    const original = plan();
    // A hard session completed on the Monday before the break, recorded the way
    // the adaptive record records it: week 1, day 1, and therefore locked.
    const outcome = run({ weeks: original, locked: [weekDayKey(1, 1)] });
    // The loading week still banks fitness around the completed session, but
    // the session itself is left exactly as it was.
    expect(outcome.weeks[0]).not.toBe(original[0]);
    expect(outcome.weeks[0].sessions[0].duration_minutes).toBe(60);
    expect(outcome.weeks[0].sessions[0].type).toBe("speed");
    expect(outcome.weeks[0].sessions[0].returnFromBreak).toBeUndefined();
    // The other days of the loading week still bank their extra 10%.
    expect(byDay(outcome.weeks[0], 3).duration_minutes).toBe(65);
    // The holiday week is the very same object: no path rewrote it.
    expect(outcome.weeks[1]).toBe(original[1]);
  });

  it("case 6 (cont.) — a hard session completed on the way back is locked out of the rebuild", () => {
    const outcome = run({ locked: [weekDayKey(3, 1)] });
    const week3 = outcome.weeks[2];
    // They did it, so the plan does not get to pretend it was 40 minutes.
    expect(byDay(week3, 1).duration_minutes).toBe(60);
    expect(byDay(week3, 1).type).toBe("speed");
    expect(byDay(week3, 1).returnFromBreak).toBeUndefined();
    // The rest of the week was still rebuilt around it.
    expect(byDay(week3, 3).duration_minutes).toBe(40);
    expect(outcome.adjustment!.before.some((s) => s.session.day === 1 && s.week === 3)).toBe(false);
  });

  it("case 6 (cont.) — a session the athlete marked skipped is also left alone", () => {
    const weeks = plan();
    weeks[2].sessions[4].skipped = true;
    const outcome = run({ weeks });
    expect(byDay(outcome.weeks[2], 5).duration_minutes).toBe(60);
    expect(byDay(outcome.weeks[2], 5).returnFromBreak).toBeUndefined();
  });

  it("case 7 — a key session lost to the break is the one that is kept", () => {
    // The life event cancelled the interval session (the plan_events record),
    // and the rebuild still keeps it: the point of the week is what survives.
    const outcome = run({
      locked: [],
    });
    const week3 = outcome.weeks[2];
    expect(byDay(week3, 3).title).toBe("Interval Training");
    expect(byDay(week3, 3).returnFromBreak).toBeDefined();
    expect(byDay(week3, 3).key).toBe(true);
    // What was sacrificed is the accessory session, not the key work.
    expect(byDay(week3, 7).isRest).toBe(true);
  });

  it("case 8 — poor recovery logging takes another notch off the first week back", () => {
    const outcome = run({ context: { recoveryPoor: true } });
    const firstBack = outcome.adjustment!.steps.find((s) => s.focus === "rebuild")!;
    expect(firstBack.volumePct).toBe(60);
    expect(firstBack.intensityPct).toBe(70);
  });

  it("case 9 — an illness or injury break is capped harder and says it is not medical advice", () => {
    const outcome = run({
      weeks: plan(10),
      facts: facts({ eventType: "injury", startDate: "2026-10-12", endDate: "2026-11-08", days: 28 }),
      context: { medical: true },
    });
    const first = outcome.adjustment!.steps[0];
    expect(first.intensityPct).toBeLessThanOrEqual(60);
    expect(first.volumePct).toBe(35);
    expect(outcome.adjustment!.medicalNote).toContain("not a treatment plan");
    expect(outcome.adjustment!.explanation).toContain("Follow your doctor's or physiotherapist's guidance");
    // Never a diagnosis, in any of the copy.
    expect(outcome.adjustment!.explanation.toLowerCase()).not.toContain("diagnos");
    expect(outcome.adjustment!.headline).toBe("Rebuilt for an injury");
  });

  it("case 10 — a second break during a rebuild rebuilds on top of it, and both are undoable in reverse", () => {
    const original = plan();
    // A fortnight away returns the athlete into weeks 4 and 5.
    const first = run({
      weeks: original,
      id: "adj-1",
      facts: facts({ startDate: "2026-10-12", endDate: "2026-10-25", days: 14 }),
    });
    // The loading week comes first, then the two-week return progression.
    expect(first.adjustment!.steps.map((s) => s.week)).toEqual([1, 4, 5]);
    expect(byDay(first.weeks[4], 3).duration_minutes).toBe(45); // 60 × 75%

    // Their availability changes again the moment they are back: another week
    // off, which lands on week 5 of the plan — a week the first rebuild has
    // already scaled.
    const second = run({
      weeks: first.weeks,
      id: "adj-2",
      existing: [first.adjustment!],
      facts: facts({ eventId: "ev-2", startDate: "2026-10-26", endDate: "2026-11-01", days: 7 }),
    });
    expect(second.reason).toBe("applied");
    // The second break banks its own loading week (week 3, on top of the
    // first rebuild's values) and returns into week 5.
    expect(second.adjustment!.steps.map((s) => s.week)).toEqual([3, 5, 6]);
    expect(second.adjustment!.steps[1].week).toBe(5);
    // Scaled off what was already there: 60 → 45 → 30. Nothing is resurrected
    // and nothing is stacked.
    expect(byDay(second.weeks[4], 3).duration_minutes).toBe(30);
    // And the second break is not allowed to re-apply the first one: its steps
    // are its own loading week and its own return, nothing from ev-1.
    expect(second.adjustment!.steps).toHaveLength(3);

    // Undoing in reverse order walks the plan back to where it started.
    const undoneSecond = undoAdjustment(second.weeks, second.adjustment!);
    expect(undoneSecond.removed).toBe(true);
    expect(undoneSecond.weeks[4]).toEqual(first.weeks[4]);
    const undoneFirst = undoAdjustment(undoneSecond.weeks, first.adjustment!);
    expect(undoneFirst.weeks).toEqual(original);
    expect(JSON.stringify(undoneFirst.weeks)).toBe(JSON.stringify(original));
  });

  it("case 10 (cont.) — the same break is never applied twice", () => {
    const applied = run();
    const again = run({ weeks: applied.weeks, existing: [applied.adjustment!] });
    expect(again.reason).toBe("already-applied");
    expect(again.adjustment).toBeNull();
    expect(again.weeks).toEqual(applied.weeks);
  });

  it("case 11 — a competition right after a long break is tapered into, from week one", () => {
    const outcome = run({
      weeks: plan(10),
      facts: facts({ eventType: "illness", startDate: "2026-10-12", endDate: "2026-11-08", days: 28 }),
      context: { medical: true },
      // The championships fall on the Saturday of the first week back.
      competitions: [{ title: "County Championships", date: "2026-11-14" }],
    });
    const weeks = outcome.adjustment!.steps.map((s) => [s.week, s.focus, s.volumePct, s.intensityPct]);
    // The competition falls in the very first week back, which the progression
    // would otherwise have kept at 35% volume. The window starts at week 6
    // because the break ends on Sunday 8 November.
    expect(weeks).toEqual([
      [6, "compete", 35, 60],
      [7, "rebuild", 55, 65],
      [8, "restore", 70, 80],
      [9, "resume", 85, 90],
    ]);
    // A taper does not outweigh a medical cap: the athlete recovering from the
    // break that put them here is not told to sharpen at 90% intensity.
    expect(outcome.adjustment!.steps[0].intensityPct).toBeLessThan(90);
    // The rebuild resumes normally after the event rather than the whole
    // progression collapsing into it.
    expect(outcome.adjustment!.steps[2].intensityPct).toBe(80);
  });

  it("case 12 — two sessions on one day share one fate, never half a day", () => {
    // A football match added on the same day as a planned session.
    const week = standardWeek(3);
    week.sessions = [...week.sessions, session(7, "Football Match", "cross_training", 90)];
    const step = { back: 1, focus: "rebuild" as const, weekNumber: 3 };

    // At 45% the Sunday is not affordable, and both of its sessions go.
    const light = rebuildWeek(week, { ...step, volumePct: 45, intensityPct: 55 }, "ev-1");
    const sunday = light.week.sessions.filter((s) => s.day === 7);
    expect(sunday).toHaveLength(2);
    for (const s of sunday) {
      expect(s.isRest).toBe(true);
      expect(s.returnFromBreak!.dropped).toBe(true);
    }
    // Three go at 45%: the accessory strength day, and both Sunday sessions.
    expect(light.droppedTitles).toEqual(["Strength Training", "Long Run", "Football Match"]);

    // At 70% the Sunday is affordable, and both of its sessions stay at the
    // same multiplier — the day is programmed or it is not.
    const fuller = rebuildWeek(week, { ...step, volumePct: 70, intensityPct: 80 }, "ev-1");
    for (const s of fuller.week.sessions.filter((x) => x.day === 7)) {
      expect(s.isRest).toBeFalsy();
      expect(s.returnFromBreak!.volumePct).toBe(70);
    }
  });

  it("case 12 (cont.) — an added unplanned session is simply part of the week the rebuild sees", () => {
    const weeks = plan();
    weeks[2].sessions.push(session(6, "Football Match", "sport_specific", 90));
    const outcome = run({ weeks });
    const saturday = outcome.weeks[2].sessions.filter((s) => s.day === 6);
    // The match is key work by the same rule the rest of the app uses, so it is
    // protected and scaled rather than dropped, and the rest day it landed on
    // is left as a rest day.
    expect(saturday.map((s) => s.title)).toEqual(["Rest Day", "Football Match"]);
    expect(saturday[1].duration_minutes).toBe(65); // 90 × 70% = 63 → 65
    const rebuilt = outcome.adjustment!.steps.find((s) => s.focus === "rebuild")!;
    expect(rebuilt.volumePct).toBe(70);
    expect(rebuilt.sessions).toBeGreaterThanOrEqual(4);
  });

  it("case 13 — a youth athlete gets a gentler, longer rebuild and development copy", () => {
    const outcome = run({
      weeks: plan(10),
      facts: facts({ eventType: "exams", startDate: "2026-10-12", endDate: "2026-11-08", days: 28 }),
      context: { age: 15 },
    });
    expect(outcome.adjustment!.steps.map((s) => s.volumePct)).toEqual([35, 50, 65, 80, 90]);
    expect(outcome.adjustment!.explanation).toContain("still developing");
    expect(outcome.adjustment!.explanation).toContain("deliberately gentle");
    // Development-oriented, never pressure-oriented.
    expect(outcome.adjustment!.explanation.toLowerCase()).not.toContain("must");
    expect(outcome.adjustment!.explanation.toLowerCase()).not.toContain("faster");
  });

  it("case 13 (cont.) — poor recovery and youth stack conservatively but keep a floor", () => {
    const outcome = run({
      weeks: plan(10),
      facts: facts({ startDate: "2026-10-12", endDate: "2026-11-08", days: 28 }),
      context: { age: 14, recoveryPoor: true, medical: true },
    });
    const first = outcome.adjustment!.steps[0];
    expect(first.volumePct).toBe(33);
    expect(first.intensityPct).toBe(40);
  });

  it("starts the return at the first week back rather than the week after it", () => {
    // A break that ends mid-week returns the athlete into that same week; the
    // days from the return onwards are rebuilt and the days before are not.
    const outcome = run({ facts: facts({ startDate: "2026-10-12", endDate: "2026-10-16", days: 5 }) });
    // The loading week (week 1) is recorded first; the return still starts in
    // the week the athlete comes back, not the week after it.
    expect(outcome.adjustment!.steps[0]).toMatchObject({ week: 1, focus: "preload" });
    expect(outcome.adjustment!.steps[1].week).toBe(2);
    const week2 = outcome.weeks[1];
    // Monday is before the return, so it is untouched despite the rebuild.
    expect(byDay(week2, 1).duration_minutes).toBe(60);
    expect(byDay(week2, 1).returnFromBreak).toBeUndefined();
    // Saturday is after it, and is rebuilt.
    expect(byDay(week2, 7).returnFromBreak).toBeDefined();
  });

  it("treats a plan that starts after the break as a return from that break", () => {
    const outcome = run({
      weeks: [standardWeek(1), standardWeek(2)],
      facts: facts({ startDate: "2026-09-21", endDate: "2026-09-30", days: 10 }),
    });
    expect(outcome.reason).toBe("applied");
    expect(outcome.adjustment!.steps[0].week).toBe(1);
    expect(byDay(outcome.weeks[0], 1).duration_minutes).toBe(35);
  });

  it("refuses to rewrite a week that has already finished", () => {
    // The break ended three weeks ago, but today is the first day of the plan.
    const outcome = run({
      weeks: plan(6),
      today: "2026-10-26", // Monday of week 4
      facts: facts({ startDate: "2026-09-28", endDate: "2026-10-04", days: 7 }),
    });
    expect(outcome.reason).toBe("applied");
    expect(outcome.adjustment!.steps[0].week).toBe(4);
    // Weeks 1–3 are untouched, which is the whole point.
    expect(outcome.weeks.slice(0, 3)).toEqual(plan().slice(0, 3));
  });

  it("shapes the weeks around a mid-plan holiday: load before, ease during, ramp after", () => {
    // The exact shape asked for: a 10-week plan, holiday in week 5, training
    // allowed while away. Week 4 banks ~10% more, week 5 drops to easy
    // movement, week 6 climbs back at the normal return rate.
    const outcome = run({
      weeks: plan(10),
      facts: facts({
        startDate: "2026-11-02", // Monday of week 5
        endDate: "2026-11-08", // Sunday of week 5
        days: 7,
        allowTraining: "optional",
      }),
    });
    expect(outcome.reason).toBe("applied");
    expect(outcome.adjustment!.steps.map((s) => [s.week, s.focus, s.volumePct, s.intensityPct])).toEqual([
      [4, "preload", 110, 100],
      [5, "holiday", 50, 60],
      [6, "rebuild", 70, 80],
      [7, "resume", 85, 90],
    ]);

    // Week 4: everything still there, ~10% longer.
    for (const day of [1, 3, 5, 7]) expect(byDay(outcome.weeks[3], day).duration_minutes).toBe(65);
    expect(outcome.weeks[3].extraNote).toContain("Loading week");

    // Week 5: the key work survives at half volume with the intensity capped,
    // the rest becomes rest days in place.
    expect(byDay(outcome.weeks[4], 1).duration_minutes).toBe(30);
    expect(byDay(outcome.weeks[4], 1).type).toBe("endurance"); // speed, downgraded
    expect(byDay(outcome.weeks[4], 1).returnFromBreak).toBeDefined();
    expect(byDay(outcome.weeks[4], 7).isRest).toBe(true);
    expect(outcome.weeks[4].extraNote).toContain("Holiday week");

    // Week 6: the normal return, untouched by the shaping around it.
    expect(byDay(outcome.weeks[5], 3).duration_minutes).toBe(40);

    // The explanation says all three parts in plain language.
    expect(outcome.adjustment!.explanation).toContain("loaded a little higher");
    expect(outcome.adjustment!.explanation).toContain("eased right back to easy movement");

    // And the whole thing still undoes byte for byte.
    const undone = undoAdjustment(outcome.weeks, outcome.adjustment!);
    expect(undone.weeks).toEqual(plan(10));
  });

  it("leaves the holiday week stored as planned when no training is allowed", () => {
    // "No training" weeks are cancelled by the availability layer at read
    // time; the rebuild must not rewrite them as well.
    const before = plan(10);
    const outcome = run({
      weeks: before,
      facts: facts({
        startDate: "2026-11-02",
        endDate: "2026-11-08",
        days: 7,
        allowTraining: "no",
      }),
    });
    expect(outcome.weeks[4]).toEqual(before[4]);
    expect(outcome.adjustment!.steps.map((s) => [s.week, s.focus])).toEqual([
      [4, "preload"],
      [6, "rebuild"],
      [7, "resume"],
    ]);
  });

  it("never preloads a medical break or a week that is already behind the athlete", () => {
    const medical = run({ context: { medical: true } });
    expect(medical.adjustment!.steps.some((s) => s.focus === "preload")).toBe(false);

    // Marked mid-holiday: week 4 has already finished, so there is nothing to
    // bank — but the rest of the holiday week is still eased from today.
    const late = run({
      today: "2026-11-03", // Tuesday of the holiday week
      facts: facts({
        startDate: "2026-11-02",
        endDate: "2026-11-08",
        days: 7,
        allowTraining: "optional",
      }),
    });
    expect(late.adjustment!.steps.some((s) => s.focus === "preload")).toBe(false);
    // Monday is behind them: untouched. Wednesday onwards is eased.
    expect(byDay(late.weeks[4], 1).duration_minutes).toBe(60);
    expect(byDay(late.weeks[4], 1).returnFromBreak).toBeUndefined();
    expect(byDay(late.weeks[4], 3).returnFromBreak).toBeDefined();
  });

  it("reports nothing-planned rather than inventing a week when all that is left is rest", () => {
    const restful: PlanWeekLike[] = [
      { week: 1, sessions: [restDay(1), restDay(2)] },
      { week: 2, sessions: [restDay(1)] },
    ];
    // The break ends on Sunday 11 October, so the athlete returns into week 2 —
    // which holds nothing but rest, and nothing to rebuild.
    const outcome = run({
      weeks: restful,
      facts: facts({ startDate: "2026-10-05", endDate: "2026-10-11", days: 7 }),
    });
    expect(outcome.reason).toBe("nothing-planned");
    expect(outcome.weeks).toEqual(restful);
  });

  it("handles an empty plan without throwing", () => {
    expect(run({ weeks: [] }).reason).toBe("no-remaining-weeks");
  });
});

// ---------------------------------------------------------------------------
// The absolutes
// ---------------------------------------------------------------------------

describe("absolutes", () => {
  const breaks: Array<[string, Partial<BreakFacts>, Partial<ReturnContext>]> = [
    ["a week", {}, {}],
    ["a fortnight", { startDate: "2026-10-12", endDate: "2026-10-25", days: 14 }, {}],
    ["a month", { startDate: "2026-10-12", endDate: "2026-11-08", days: 28 }, {}],
    ["a month, youth, ill", { startDate: "2026-10-12", endDate: "2026-11-08", days: 28 }, { age: 14, medical: true, recoveryPoor: true }],
  ];

  it("never changes a day number, and never adds a session", () => {
    for (const [, factPatch, context] of breaks) {
      const before = plan(10);
      const outcome = run({ weeks: before, facts: facts(factPatch), context });

      for (const week of outcome.weeks) {
        const original = before.find((w) => w.week === week.week)!;
        expect(week.sessions.map((s) => s.day)).toEqual(original.sessions.map((s) => s.day));
        expect(week.sessions.length).toBe(original.sessions.length);
      }
      // And the whole plan never grows: nothing was moved into a later week.
      const count = (ws: PlanWeekLike[]) => ws.reduce((n, w) => n + w.sessions.filter((s) => !s.isRest).length, 0);
      expect(count(outcome.weeks)).toBeLessThanOrEqual(count(before));
    }
  });

  it("never changes the calendar date of a session that remains", () => {
    const before = plan(10);
    const outcome = run({
      weeks: before,
      facts: facts({ startDate: "2026-10-12", endDate: "2026-11-08", days: 28 }),
    });
    const dates = (data: unknown) =>
      flattenPlan(planRow(data)).map((s) => `${s.week}:${s.day}:${s.scheduled_date}`);
    expect(dates(outcome.weeks)).toEqual(dates(before));
  });

  it("never reduces a week to nothing: every rebuilt week keeps at least one session", () => {
    for (const [, factPatch, context] of breaks) {
      const outcome = run({
        weeks: plan(10),
        facts: facts(factPatch),
        context,
      });
      for (const step of outcome.adjustment!.steps) {
        expect(step.sessions).toBeGreaterThan(0);
      }
    }
  });

  it("restores the plan byte for byte, including the sessions it never touched", () => {
    const before = plan(10);
    const outcome = run({ weeks: before, facts: facts({ startDate: "2026-10-12", endDate: "2026-11-08", days: 28 }) });
    const undone = undoAdjustment(outcome.weeks, outcome.adjustment!);
    expect(undone.removed).toBe(true);
    expect(undone.weeks).toEqual(before);
    expect(JSON.stringify(undone.weeks)).toBe(JSON.stringify(before));
  });

  it("restores the week's own note as well as its sessions", () => {
    const before = plan();
    before[2].extraNote = "Deload because of the school trip.";
    const outcome = run({ weeks: before });
    expect(outcome.weeks[2].extraNote).not.toBe("Deload because of the school trip.");
    const undone = undoAdjustment(outcome.weeks, outcome.adjustment!);
    expect(undone.weeks[2].extraNote).toBe("Deload because of the school trip.");
  });

  it("reports an undo that found nothing to undo rather than claiming success", () => {
    const outcome = run();
    const foreign: PlanWeekLike[] = [{ week: 99, sessions: [restDay(1)] }];
    expect(undoAdjustment(foreign, outcome.adjustment!).removed).toBe(false);
  });

  it("keeps everything the specification requires out of the athlete's medical life", () => {
    const outcome = run({ facts: facts({ eventType: "illness", days: 21, endDate: "2026-11-01" }), context: { medical: true } });
    const copy = `${outcome.adjustment!.explanation} ${outcome.adjustment!.medicalNote}`.toLowerCase();
    for (const word of ["diagnos", "you have", "syndrome", "cure", "prescrib", "medicine"]) {
      expect(copy).not.toContain(word);
    }
  });
});

// ---------------------------------------------------------------------------
// Reading the record back
// ---------------------------------------------------------------------------

describe("adjustmentForWeek", () => {
  it("finds the step that covers a week", () => {
    const outcome = run({
      weeks: plan(8),
      facts: facts({ startDate: "2026-10-12", endDate: "2026-10-25", days: 14 }),
    });
    const found = adjustmentForWeek([outcome.adjustment!], outcome.adjustment!.steps[1].week);
    expect(found!.step.week).toBe(outcome.adjustment!.steps[1].week);
    expect(adjustmentForWeek([outcome.adjustment!], 99)).toBeNull();
  });
});

describe("activeAdjustments", () => {
  const valid: PlanAdjustmentRecord = {
    id: "a1",
    kind: "return_from_break",
    lifeEventId: "ev-1",
    createdAt: TODAY,
    break: { startDate: "2026-10-12", endDate: "2026-10-18", days: 7, eventType: "holiday", activityLevel: "none" },
    creditedDays: 0,
    steps: [],
    headline: "Rebuilt for a holiday",
    explanation: "…",
    medicalNote: null,
    competingSoon: false,
    before: [],
  };

  it("returns an empty list for anything that is not an array", () => {
    for (const value of [null, undefined, {}, "[]", 7]) expect(activeAdjustments(value)).toEqual([]);
  });

  it("keeps well-formed records and drops junk", () => {
    const value = [valid, null, "nope", {}, { kind: "something_else" }, { ...valid, before: null }, { ...valid, id: "a2" }];
    expect(activeAdjustments(value).map((a) => a.id)).toEqual(["a1", "a2"]);
  });
});

describe("weekNote", () => {
  it("says what the week is for and that nothing was moved", () => {
    const note = weekNote({ back: 1, volumePct: 55, intensityPct: 65, focus: "rebuild" });
    expect(note).toContain("55%");
    expect(note).toContain("65%");
    expect(note).toContain("Nothing was moved from your break into this week");
  });

  it("has something different to say about a competition week", () => {
    expect(weekNote({ back: 2, volumePct: 50, intensityPct: 90, focus: "compete" })).toContain("Competition week");
  });
});

// ---------------------------------------------------------------------------
// Copy that the tests above do not reach
// ---------------------------------------------------------------------------

describe("explanation copy", () => {
  it("names a single-day break in the singular", () => {
    const outcome = run({ facts: facts({ startDate: "2026-10-12", endDate: "2026-10-12", days: 1, eventType: "competition" }) });
    // A single day is below the rebuild threshold, so this only checks the
    // shared formatter through a break that does rebuild.
    const long = run({
      facts: facts({ startDate: "2026-10-12", endDate: "2026-10-19", days: 8, eventType: "travel" }),
    });
    expect(long.adjustment!.explanation).toContain("because of travel from 12 Oct to 19 Oct");
    expect(outcome.reason).toBe("break-too-short");
  });

  it("says a break is a break when the type is one it does not name", () => {
    const outcome = run({ facts: facts({ eventType: "other", days: 9, endDate: "2026-10-20" }) });
    expect(outcome.adjustment!.explanation).toContain("because of a break from");
    expect(outcome.adjustment!.headline).toBe("Rebuilt for a break");
  });
});

// A compile-time assertion that the exported record shape is the one the rest
// of the app will store: if a field is ever added to `AdjustmentStep` without
// being written by `planRebuild`, this stops type-checking.
const _stepShape: (step: AdjustmentStep) => number = (step) => step.week;
