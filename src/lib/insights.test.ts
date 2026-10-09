// ============================================================================
// INSIGHTS — actionable, honest and bounded
// ----------------------------------------------------------------------------
// The specification for this phase is as specific about what analytics must NOT
// do as about what they must: no overwhelming charts, no metric the athlete
// cannot influence, and above all no medical-sounding risk score. Those are
// testable properties, so they are tested: the honesty of a missing number, the
// exclusion of an excused session, the ceiling on the trend, and a blanket scan
// for medical certainty across everything the module can emit.
//
// `today` is an argument everywhere, so every window here is deterministic and
// no test depends on the day it runs.
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  GOAL_WINDOW_DAYS,
  INSIGHT_WINDOW_DAYS,
  LOAD_TREND_MAX_WEEKS,
  LOAD_TREND_MIN_WEEKS,
  buildTrainingInsights,
  nextActionFrom,
  type InsightFacts,
  type InsightMetricId,
  type InsightSession,
} from "./insights";
import { findMedicalCertainty } from "./explanations";
import { YOUTH_ANALYSIS_NOTE } from "./health/startingAnalysis";

const TODAY = "2026-10-06";

/**
 * `days` before `from` (TODAY by default), as a `YYYY-MM-DD` key.
 *
 * The `from` argument matters: most of these windows are calendar weeks, and
 * TODAY is a Tuesday, so a test that needs three sessions inside one week has
 * to pick a day of the week that has three days behind it. `TODAY` is
 * deliberately fixed rather than read from the clock, so the suite cannot pass
 * or fail depending on the day it runs.
 */
const ago = (days: number, from: string = TODAY): string => {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/** A Sunday, so the week containing it has three days behind it. */
const SUNDAY = "2026-10-11";

const session = (over: Partial<InsightSession> = {}): InsightSession => ({
  date: ago(1),
  sport: "Running",
  durationMinutes: 45,
  distanceKm: 8,
  load: 45,
  source: "manual",
  ...over,
});

/** A record that supports all seven metrics. */
const fullFacts = (over: Partial<InsightFacts> = {}): InsightFacts => ({
  today: TODAY,
  age: 34,
  sessions: [
    session({ date: ago(1), load: 45 }),
    session({ date: ago(3), load: 60, source: "strava" }),
    session({ date: ago(5), load: 30 }),
    session({ date: ago(8), load: 50 }),
    session({ date: ago(10), load: 40, source: "strava" }),
    session({ date: ago(12), load: 25 }),
  ],
  planned: [
    { date: ago(1), title: "Easy run", status: "completed", countsTowardCompletion: true },
    { date: ago(3), title: "Intervals", status: "completed", countsTowardCompletion: true },
    { date: ago(5), title: "Easy run", status: "completed", countsTowardCompletion: true },
    { date: ago(8), title: "Long run", status: "completed", countsTowardCompletion: true },
    { date: ago(10), title: "Easy run", status: "skipped", countsTowardCompletion: true },
    { date: ago(12), title: "Tempo", status: "completed", countsTowardCompletion: true },
  ],
  recovery: [
    { date: ago(1), fatigue: 4, sleepQuality: 7, readinessScore: 72 },
    { date: ago(2), fatigue: 5, sleepQuality: 7, readinessScore: 70 },
    { date: ago(3), fatigue: 6, sleepQuality: 6, readinessScore: 66 },
  ],
  goals: [
    {
      title: "Run a sub-40 10K",
      percent: 62,
      status: "on_track",
      daysRemaining: 21,
      achievedMilestones: 3,
      totalMilestones: 5,
      nextMilestone: { title: "5K time trial under 20:30", targetDate: ago(-14) },
    },
  ],
  adjustments: [{ date: ago(9), title: "Long run", eventType: "holiday", volumePct: null }],
  returnFromBreak: null,
  competition: null,
  primarySport: "Running",
  ...over,
});

/** At least LOAD_TREND_MIN_WEEKS weeks of history, so the trend is available. */
const weeksOfSessions = (weeks: number, perWeek = 2, from: string = TODAY): InsightSession[] => {
  const out: InsightSession[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < perWeek; i++) out.push(session({ date: ago(w * 7 + i + 1, from), load: 40 }));
  }
  return out;
};

const metric = (facts: InsightFacts, id: InsightMetricId) => {
  const found = buildTrainingInsights(facts).metrics.find((m) => m.id === id);
  expect(found, `${id} missing`).toBeDefined();
  return found!;
};

describe("buildTrainingInsights — the shape", () => {
  it("lists the specification's areas, with the rebuild first when one is running", () => {
    const insights = buildTrainingInsights(
      fullFacts({
        returnFromBreak: { weekBack: 2, totalWeeks: 3, volumePct: 65, focus: "restore" },
      }),
    );
    expect(insights.metrics.map((m) => m.id)).toEqual([
      "return_progression",
      "recovery_trend",
      "workload",
      "consistency",
      "goal_progress",
      "plan_adjustments",
      "load_trend",
    ]);
  });

  it("is empty, and says why, when there is nothing at all to read", () => {
    const insights = buildTrainingInsights({ today: TODAY, sessions: [], planned: [], recovery: [], goals: [], adjustments: [] });
    expect(insights.empty).toBe(true);
    expect(insights.metrics).toEqual([]);
    expect(insights.top).toBeNull();
    expect(insights.reason).toMatch(/nothing to read yet/i);
  });

  it("leads with the most actionable reading, and gives a next action", () => {
    const insights = buildTrainingInsights(
      fullFacts({
        // Two bad check-in signals make recovery the thing to act on.
        recovery: [
          { date: ago(1), fatigue: 9, sleepQuality: 3, readinessScore: 40 },
          { date: ago(2), fatigue: 9, sleepQuality: 3, readinessScore: 41 },
          { date: ago(3), fatigue: 8, sleepQuality: 4, readinessScore: 44 },
        ],
      }),
    );
    expect(insights.top?.tone).toBe("watch");
    expect(insights.top?.id).toBe("recovery_trend");
    expect(nextActionFrom(insights)).toMatch(/easier|move it a day/i);
  });

  it("reports the imported and manual split rather than blending them silently", () => {
    const insights = buildTrainingInsights(fullFacts());
    expect(insights.importedCount).toBe(2);
    expect(insights.manualCount).toBe(4);
    expect(insights.caveats.join(" ")).toMatch(/2 of 6 sessions in this window were imported/);
  });

  it("says when the whole window is imported, because an import is a floor not a measurement", () => {
    const insights = buildTrainingInsights(
      fullFacts({ sessions: [session({ source: "strava" }), session({ date: ago(2), source: "strava" })] }),
    );
    expect(insights.importedCount).toBe(2);
    expect(insights.manualCount).toBe(0);
    expect(insights.caveats.join(" ")).toMatch(/came from your connected app/i);
  });

  it("counts a session it could not price in consistency but not in load, and says so", () => {
    const insights = buildTrainingInsights(fullFacts({ sessions: [session({ load: null })] }));
    expect(insights.caveats.join(" ")).toMatch(/without an effort rating/);
  });

  it("is deterministic: the same facts produce the same reading", () => {
    const a = buildTrainingInsights(fullFacts());
    const b = buildTrainingInsights(fullFacts());
    expect(a).toEqual(b);
  });
});

describe("consistency", () => {
  it("uses the plan's own denominator and excludes what a break removed", () => {
    const withBreak = buildTrainingInsights(
      fullFacts({
        planned: [
          { date: ago(1), title: "Easy run", status: "completed", countsTowardCompletion: true },
          { date: ago(3), title: "Intervals", status: "completed", countsTowardCompletion: true },
          { date: ago(5), title: "Holiday session", status: "cancelled_due_to_availability", countsTowardCompletion: false },
          { date: ago(6), title: "Holiday session", status: "cancelled_due_to_availability", countsTowardCompletion: false },
        ],
      }),
    );
    const consistency = withBreak.metrics.find((m) => m.id === "consistency")!;
    expect(consistency.value).toBe("100%");
    expect(consistency.why.map((w) => w.text).join(" ")).toMatch(/2 sessions were removed by a break/);
    expect(consistency.nextStep).toBeNull();
  });

  it("is not measurable without a plan, and says what would fix that", () => {
    const facts = fullFacts({ planned: [] });
    const consistency = metric(facts, "consistency");
    expect(consistency.available).toBe(false);
    expect(consistency.value).toBe("—");
    expect(consistency.nextStep).toMatch(/plan/i);
  });

  it("excludes a week with nothing scheduled from the weeks considered", () => {
    // Three sessions inside a single plan week, with the three weeks before it
    // empty of anything scheduled: the empty weeks must not read as failures.
    const facts = fullFacts({
      today: SUNDAY,
      planned: [
        { date: ago(1, SUNDAY), title: "Easy run", status: "completed", countsTowardCompletion: true },
        { date: ago(2, SUNDAY), title: "Intervals", status: "completed", countsTowardCompletion: true },
        { date: ago(3, SUNDAY), title: "Easy run", status: "completed", countsTowardCompletion: true },
      ],
    });
    const consistency = metric(facts, "consistency");
    expect(consistency.why.map((w) => w.text).join(" ")).toMatch(/in 1 of those 1 weeks/);
  });

  it("counts the week's sessions against the target rather than the month's total", () => {
    // Three sessions spread one-per-week misses the three-a-week rhythm, and the
    // number has to say so even though the monthly total looks identical.
    const facts = fullFacts({
      planned: [
        { date: ago(0), title: "Easy run", status: "completed", countsTowardCompletion: true },
        { date: ago(7), title: "Intervals", status: "completed", countsTowardCompletion: true },
        { date: ago(14), title: "Tempo", status: "completed", countsTowardCompletion: true },
      ],
    });
    expect(metric(facts, "consistency").value).toBe("100%");
    expect(metric(facts, "consistency").why.map((w) => w.text).join(" ")).toMatch(
      /in 0 of those 3 weeks/,
    );
  });
});

describe("recent workload", () => {
  it("compares the last 28 days with the 28 before them", () => {
    const facts = fullFacts({
      sessions: [
        ...weeksOfSessions(4, 3).map((s) => ({ ...s, load: 60 })),
        ...weeksOfSessions(8, 1)
          .filter((s) => s.date < ago(INSIGHT_WINDOW_DAYS))
          .map((s) => ({ ...s, load: 20 })),
      ],
    });
    const workload = metric(facts, "workload");
    expect(workload.available).toBe(true);
    expect(workload.value.startsWith("+")).toBe(true);
    expect(workload.tone).toBe("watch");
    expect(workload.nextStep).toMatch(/easier week/i);
  });

  it("refuses to judge without an earlier window to compare against", () => {
    const facts = fullFacts({ sessions: [session({ date: ago(1) }), session({ date: ago(4) })] });
    const workload = metric(facts, "workload");
    expect(workload.available).toBe(false);
    expect(workload.confidence).toBe("none");
    expect(workload.headline).toMatch(/Not enough history/);
  });

  it("does not read a logging gap as a change in training", () => {
    // Sessions in the recent window with no priceable load contribute a date
    // but no load, so there is nothing to compare.
    const facts = fullFacts({
      sessions: [
        session({ date: ago(1), load: null }),
        session({ date: ago(2), load: null }),
        session({ date: ago(30), load: 60 }),
      ],
    });
    expect(metric(facts, "workload").available).toBe(false);
  });

  it("frames a drop during a rebuild as the plan working", () => {
    const facts = fullFacts({
      returnFromBreak: { weekBack: 1, totalWeeks: 3, volumePct: 45, focus: "rebuild" },
      sessions: [
        session({ date: ago(1), load: 10 }),
        session({ date: ago(40), load: 90 }),
        session({ date: ago(45), load: 90 }),
      ],
    });
    const workload = metric(facts, "workload");
    expect(workload.why.map((w) => w.text).join(" ")).toMatch(/plan working|rebuilding/i);
  });
});

describe("recovery trend", () => {
  it("is not measurable with no check-ins, and asks for one rather than showing a zero", () => {
    const recovery = metric(fullFacts({ recovery: [] }), "recovery_trend");
    expect(recovery.available).toBe(false);
    expect(recovery.value).toBe("—");
    expect(recovery.nextStep).toMatch(/check-in/i);
  });

  it("averages the athlete's own ratings and reads the direction from the halves", () => {
    const facts = fullFacts({
      recovery: [
        { date: ago(1), fatigue: 3, sleepQuality: 8 },
        { date: ago(2), fatigue: 3, sleepQuality: 8 },
        { date: ago(3), fatigue: 8, sleepQuality: 5 },
        { date: ago(4), fatigue: 8, sleepQuality: 5 },
      ],
    });
    const recovery = metric(facts, "recovery_trend");
    expect(recovery.value).toMatch(/fatigue 5\.5\/10/);
    expect(recovery.why.map((w) => w.text).join(" ")).toMatch(/coming down/);
    expect(recovery.tone).toBe("positive");
  });

  it("treats several poor signals together as the week to keep easy", () => {
    const facts = fullFacts({
      recovery: [
        { date: ago(1), fatigue: 8, sleepQuality: 3, soreness: 8 },
        { date: ago(2), fatigue: 9, sleepQuality: 3, soreness: 8 },
        { date: ago(3), fatigue: 8, sleepQuality: 4, soreness: 7 },
      ],
    });
    const recovery = metric(facts, "recovery_trend");
    expect(recovery.tone).toBe("watch");
    expect(recovery.headline).toMatch(/keep the easy sessions easy/);
    expect(recovery.nextStep).toMatch(/easier|move it/i);
    // The action and the honesty about what these numbers are, in one rationale.
    expect(recovery.rationale).toMatch(/pattern worth acting on early/);
    expect(recovery.rationale).toMatch(/your own ratings, not a measurement/);
  });

  it("says readiness is absent rather than defaulting it", () => {
    const facts = fullFacts({ recovery: [{ date: ago(1), fatigue: 5, readinessScore: null }] });
    expect(metric(facts, "recovery_trend").why.map((w) => w.text).join(" ")).toMatch(
      /not used the readiness score/,
    );
  });
});

describe("goal progress", () => {
  it("reports milestones reached and the next one", () => {
    const goal = metric(fullFacts(), "goal_progress");
    expect(goal.value).toBe("3/5");
    expect(goal.nextStep).toMatch(/5K time trial under 20:30/);
    expect(goal.why.map((w) => w.text).join(" ")).toMatch(/3 of 5 milestones/);
  });

  it("makes the competition inside the window the reason", () => {
    const facts = fullFacts({ competition: { title: "County 10K", days: 3 } });
    const goal = metric(facts, "goal_progress");
    expect(goal.headline).toMatch(/key session/i);
    expect(goal.why.map((w) => w.text).join(" ")).toMatch(/County 10K is in 3 days/);
    expect(GOAL_WINDOW_DAYS).toBeGreaterThan(3);
  });

  it("is not measurable without a goal, and says what to do about it", () => {
    const goal = metric(fullFacts({ goals: [] }), "goal_progress");
    expect(goal.available).toBe(false);
    expect(goal.nextStep).toMatch(/goal/i);
  });

  it("flags a behind-schedule goal without moralising", () => {
    const facts = fullFacts({
      goals: [{ title: "Run a sub-40 10K", percent: 20, status: "behind", daysRemaining: 10, achievedMilestones: 0, totalMilestones: 4, nextMilestone: null }],
    });
    const goal = metric(facts, "goal_progress");
    expect(goal.tone).toBe("watch");
    expect(goal.headline).not.toMatch(/fail|should have|behind schedule/i);
  });
});

describe("plan adjustments", () => {
  it("counts what life changed, and breaks it down by reason", () => {
    const facts = fullFacts({
      adjustments: [
        { date: ago(9), title: "Long run", eventType: "holiday", volumePct: null },
        { date: ago(9), title: "Easy run", eventType: "holiday", volumePct: null },
        { date: ago(20), title: "Intervals", eventType: "illness", volumePct: null },
      ],
    });
    const adjustments = metric(facts, "plan_adjustments");
    expect(adjustments.value).toBe("3");
    const joined = adjustments.why.map((w) => w.text).join(" ");
    expect(joined).toMatch(/2 sessions adjusted because of holiday/);
    expect(joined).toMatch(/1 session adjusted because of illness/);
    // The two never collapse into one another: the breakdown is the point.
    expect(adjustments.why.length).toBeGreaterThanOrEqual(2);
  });

  it("reports a rebuilt week as written into the plan rather than as a gap", () => {
    const facts = fullFacts({
      adjustments: [{ date: ago(4), title: "Rebuild week 1", eventType: "holiday", volumePct: 55 }],
    });
    const joined = metric(facts, "plan_adjustments").why.map((w) => w.text).join(" ");
    expect(joined).toMatch(/part of a rebuild/);
  });

  it("reads an untouched month as a good month", () => {
    const adjustments = metric(fullFacts({ adjustments: [] }), "plan_adjustments");
    expect(adjustments.value).toBe("0");
    expect(adjustments.tone).toBe("positive");
    expect(adjustments.headline).toMatch(/Nothing has adjusted your plan/);
  });

  it("is not measurable without a plan to adjust", () => {
    const adjustments = metric(fullFacts({ adjustments: [], planned: [] }), "plan_adjustments");
    expect(adjustments.available).toBe(false);
  });
});

describe("load trend", () => {
  it("refuses a trend from fewer than four weeks", () => {
    // Two weeks of sessions land inside three calendar weeks — still short of a
    // trend, and the screen has to say so rather than draw three bars.
    const facts = fullFacts({ sessions: weeksOfSessions(LOAD_TREND_MIN_WEEKS - 2, 2) });
    const trend = metric(facts, "load_trend");
    expect(trend.available).toBe(false);
    expect(trend.value).toBe("—");
    expect(trend.headline).toMatch(/at least 4 weeks/i);
  });

  it("caps the strip at eight weeks, however long the record is", () => {
    const facts = fullFacts({ sessions: weeksOfSessions(20, 2) });
    const trend = metric(facts, "load_trend");
    expect(trend.available).toBe(true);
    expect(trend.series?.length).toBe(LOAD_TREND_MAX_WEEKS);
    expect(trend.series!.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("names the biggest week with its actual date", () => {
    const facts = fullFacts({
      sessions: [
        ...weeksOfSessions(4, 1).filter((s) => s.date < ago(7)).map((s) => ({ ...s, load: 30 })),
        // A heavy final week, which must be the peak.
        session({ date: ago(1), load: 200 }),
      ],
    });
    const trend = metric(facts, "load_trend");
    expect(trend.why.map((w) => w.text).join(" ")).toMatch(/biggest week was 200 load/);
    expect(trend.nextStep).toMatch(/lighter/i);
    // TODAY is a Tuesday, so this week is two days old. A heavy START is worth
    // naming — it is already the heaviest — but it must not be judged as though
    // the week were over, which is the mistake this assertion pins.
    expect(trend.headline).toMatch(/already the heaviest/i);
    expect(trend.why.map((w) => w.text).join(" ")).toMatch(/still in progress/);
  });

  it("does not call a week in progress light, because it has barely started", () => {
    // The live regression: on a Tuesday, two days of training read as "well
    // below your recent average" — telling an athlete their week had collapsed.
    const facts = fullFacts({
      sessions: [...weeksOfSessions(8, 2), session({ date: ago(2), load: 5 })],
    });
    const trend = metric(facts, "load_trend");
    expect(trend.headline).not.toMatch(/below your recent average/i);
    expect(trend.headline).toMatch(/steady pattern/i);
    expect(trend.why.map((w) => w.text).join(" ")).toMatch(/not yet comparable/);
  });

  it("calls a finished week light when it really was", () => {
    // The same record read on a Sunday, with a light week that is now over.
    const facts = fullFacts({
      today: SUNDAY,
      sessions: [
        ...weeksOfSessions(8, 2, SUNDAY).filter((s) => s.date < "2026-10-05"),
        session({ date: "2026-10-10", load: 3 }),
      ],
    });
    const trend = metric(facts, "load_trend");
    expect(trend.headline).toMatch(/well below your recent average/i);
    expect(trend.why.map((w) => w.text).join(" ")).not.toMatch(/still in progress/);
  });
});

describe("return from break", () => {
  it("is absent from the screen unless a rebuild is actually running", () => {
    expect(buildTrainingInsights(fullFacts()).metrics.some((m) => m.id === "return_progression")).toBe(false);
  });

  it("reports which week of how many, and what this week is for", () => {
    const insights = buildTrainingInsights(
      fullFacts({ returnFromBreak: { weekBack: 2, totalWeeks: 3, volumePct: 65, focus: "restore" } }),
    );
    const back = insights.metrics.find((m) => m.id === "return_progression")!;
    expect(back.value).toBe("Week 2 of 3");
    expect(back.headline).toBe("You are in Week 2 of 3 in your return-from-break progression.");
    expect(back.why.map((w) => w.text).join(" ")).toMatch(/65% of your usual volume/);
    expect(back.why.map((w) => w.text).join(" ")).toMatch(/restoring your usual load/);
    expect(back.nextStep).toMatch(/programmed volume/);
  });

  it("says the rebuild ends after the last week", () => {
    const insights = buildTrainingInsights(
      fullFacts({ returnFromBreak: { weekBack: 3, totalWeeks: 3, volumePct: 85, focus: "resume" } }),
    );
    expect(insights.metrics.find((m) => m.id === "return_progression")!.nextStep).toMatch(
      /last week of the rebuild/i,
    );
  });
});

describe("safety and youth", () => {
  it("never claims medical certainty anywhere in the reading", () => {
    const facts = [
      fullFacts(),
      fullFacts({ recovery: [] }),
      fullFacts({ goals: [] }),
      fullFacts({ planned: [] }),
      fullFacts({ sessions: [] }),
      fullFacts({ returnFromBreak: { weekBack: 1, totalWeeks: 4, volumePct: 40, focus: "rebuild" } }),
      fullFacts({ age: 15 }),
    ];
    for (const input of facts) {
      const insights = buildTrainingInsights(input);
      const text = JSON.stringify(insights);
      expect(findMedicalCertainty(text), `medical certainty in: ${text.slice(0, 400)}`).toEqual([]);
      // No risk percentage anywhere, in any phrasing.
      expect(text).not.toMatch(/\d+\s*%\s*(chance|risk|likely)/i);
    }
  });

  it("for a developing athlete, drops the comparative framing and adds the development note", () => {
    const insights = buildTrainingInsights(
      fullFacts({
        age: 15,
        planned: [
          { date: ago(1), title: "Easy run", status: "completed", countsTowardCompletion: true },
          { date: ago(3), title: "Intervals", status: "skipped", countsTowardCompletion: true },
        ],
      }),
    );
    expect(insights.youth).toBe(true);
    expect(insights.caveats).toContain(YOUTH_ANALYSIS_NOTE);
    const consistency = insights.metrics.find((m) => m.id === "consistency")!;
    expect(consistency.rationale).toMatch(/at your age/i);
    // The week-level adjustment copy is gentler for a youth athlete too.
    expect(consistency.headline).not.toMatch(/only|just \d/i);
  });

  it("shows no comparison against other athletes, in any metric", () => {
    // "You vs elite profiles" is a different screen. Nothing here ranks the
    // athlete against anyone, which is the pressure the specification rules out.
    const text = JSON.stringify(buildTrainingInsights(fullFacts()));
    expect(text).not.toMatch(/percentile|elite|rank|better than \d/i);
  });

  it("keeps every metric explainable, with a why or an honest reason for its absence", () => {
    const bar = buildTrainingInsights(fullFacts({ recovery: [], goals: [], planned: [] }));
    for (const m of bar.metrics) {
      expect(m.rationale.trim().length, `${m.id} has no rationale`).toBeGreaterThan(0);
      if (!m.available) {
        expect(m.headline.trim().length, `${m.id} is unavailable with no reason`).toBeGreaterThan(0);
      }
    }
  });
});
