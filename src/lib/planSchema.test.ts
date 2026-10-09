// ============================================================================
// THE PAID-PLAN VALIDATOR
// ----------------------------------------------------------------------------
// `generate-plan` and `edit-plan` both put model output in front of an athlete
// who has already been charged, so `cleanPlanWeeks` is the function that decides
// whether that output is accepted or refunded. It is also the function with a
// documented incident behind it: an earlier check treated each week as a bare
// array of days, dropped every week of a correctly-shaped answer, and refunded
// the plan as "malformed".
//
// None of this had a test. The sibling shared module (planPeriodisation) is
// covered from src/lib, so the asymmetry was an accident, not a decision.
// ============================================================================

import { describe, expect, it } from "vitest";

import { cleanPlanWeeks, isSafePlanString } from "../../supabase/functions/_shared/planSchema";

const day = (over: Record<string, unknown> = {}) => ({
  day: 1,
  dayName: "Monday",
  title: "Easy run",
  type: "endurance",
  duration_minutes: 45,
  isRest: false,
  ...over,
});

const sevenDays = () => Array.from({ length: 7 }, (_, i) => day({ day: i + 1, dayName: "Day" }));

const weekObject = (over: Record<string, unknown> = {}) => ({ week: 1, sessions: sevenDays(), ...over });

describe("what counts as a week", () => {
  it("keeps a week that is an object carrying seven valid sessions", () => {
    const clean = cleanPlanWeeks([weekObject()]);

    expect(clean).toHaveLength(1);
    expect((clean[0].sessions as unknown[]).length).toBe(7);
    // `week` itself is preserved — the client splices by week number.
    expect(clean[0].week).toBe(1);
  });

  it("drops a bare array of days, because a week is the object that carries them", () => {
    // The documented incident ran the other way: the check looked for a bare
    // array, the model answered with `{ week, sessions:[…] }` as documented, and
    // every week was dropped and refunded as malformed. So a week is an OBJECT
    // with a `sessions` array — and a bare array, having no sessions, is not a
    // week. This test pins the shape from both sides.
    expect(cleanPlanWeeks([sevenDays()])).toHaveLength(0);
    expect(cleanPlanWeeks([{ sessions: sevenDays() }])).toHaveLength(1);
  });

  it("drops a week that is missing a day, and one that has eight", () => {
    expect(cleanPlanWeeks([weekObject({ sessions: sevenDays().slice(0, 6) })])).toHaveLength(0);
    expect(cleanPlanWeeks([weekObject({ sessions: [...sevenDays(), day()] })])).toHaveLength(0);
  });

  it("drops a week whose session object is malformed", () => {
    const missingTitle = sevenDays();
    missingTitle[3] = day({ title: undefined });

    const nonString = sevenDays();
    nonString[2] = day({ dayName: 3 });

    // A control character in a field the UI renders is the case the rule exists
    // for: it would break the row it is drawn in.
    const controlChar = sevenDays();
    controlChar[5] = day({ title: "Run\nfast" });

    expect(cleanPlanWeeks([weekObject({ sessions: missingTitle })])).toHaveLength(0);
    expect(cleanPlanWeeks([weekObject({ sessions: nonString })])).toHaveLength(0);
    expect(cleanPlanWeeks([weekObject({ sessions: controlChar })])).toHaveLength(0);
  });

  it("drops anything that is not a week object at all", () => {
    expect(cleanPlanWeeks([null, undefined, "week 1", 7, [], { week: 1 }])).toHaveLength(0);
  });

  it("keeps the weeks in the order they were sent", () => {
    const clean = cleanPlanWeeks([weekObject({ week: 3 }), weekObject({ week: 1 }), weekObject({ week: 2 })]);
    expect(clean.map((w) => w.week)).toEqual([3, 1, 2]);
  });
});

describe("what is clamped rather than trusted", () => {
  it("clamps a session length the model got wrong", () => {
    const cases: [unknown, number][] = [
      [9999, 600],
      [-45, 0],
      ["45", 45],
      ["about an hour", 0],
      [null, 0],
      [undefined, 0],
      [NaN, 0],
    ];

    for (const [raw, expected] of cases) {
      const clean = cleanPlanWeeks([weekObject({ sessions: sevenDays().map((d, i) => (i === 0 ? { ...d, duration_minutes: raw } : d)) })]);
      expect(clean, `duration ${String(raw)}`).toHaveLength(1);
      const first = (clean[0].sessions as Record<string, unknown>[])[0];
      expect(first.duration_minutes, `duration ${String(raw)}`).toBe(expected);
    }
  });

  it("keeps the fields it does not police", () => {
    // isRest/isRecovery/skipped are read by the plan renderer; dropping them
    // here would turn a rest day into a training day.
    const clean = cleanPlanWeeks([weekObject({ sessions: sevenDays().map((d, i) => (i === 0 ? { ...d, isRest: true, skipped: false } : d)) })]);

    const first = (clean[0].sessions as Record<string, unknown>[])[0];
    expect(first.isRest).toBe(true);
    expect(first.skipped).toBe(false);
  });
});

describe("isSafePlanString", () => {
  it("accepts bounded plain text and refuses everything else", () => {
    expect(isSafePlanString("Easy run", 120)).toBe(true);
    expect(isSafePlanString("", 120)).toBe(true);

    expect(isSafePlanString("Run\nfast", 120)).toBe(false); // control character
    expect(isSafePlanString("x".repeat(121), 120)).toBe(false); // over the field's bound
    expect(isSafePlanString(42, 120)).toBe(false);
    expect(isSafePlanString(null, 120)).toBe(false);
    expect(isSafePlanString(undefined, 120)).toBe(false);
    expect(isSafePlanString({ title: "Easy run" }, 120)).toBe(false);
  });
});
