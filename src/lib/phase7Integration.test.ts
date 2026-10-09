// ===========================================================================
// PHASE 7 — six phases, one system.
// ----------------------------------------------------------------------------
// Phases 1–6 each shipped with their own unit tests, and each one passes. What
// none of them covered was the seams: the holiday Phase 1 records that Phase 2
// rebuilds around, that Phase 6 explains, that Phase 4 excuses from the
// consistency denominator, while Phase 5 keeps it readable offline. Those seams
// are where the features stop feeling like one product.
//
// Each describe below is one of the specification's ten messy real-world
// scenarios, run by composing the REAL modules rather than by re-testing them.
// A scenario that can only pass by two modules disagreeing is the failure this
// file exists to catch.
//
// Deliberately NOT covered here: single-module guarantees already pinned in
// lifeEvents.test, adaptivePlan.test, recoveryAdjust.test, roadmap.test,
// insights.test, explanations.test, offlineQueueConflict.test and
// guardianAccess.test. Duplicating those would add runtime, not confidence.
// ===========================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { analyzeLoads, type LoadRow } from "./performance";

// supabase is mocked at the module boundary for Scenario 5 only: the offline
// queue is exercised for real against a network that can be turned off. The
// factory closes over its collaborators and never touches them at definition
// time, so the hoisting vi.mock performs cannot reach a temporal dead zone.
const serverInserts: Record<string, unknown>[] = [];
const network = { offline: false };
const insert = async (values: Record<string, unknown>) => {
  if (network.offline) {
    return { error: Object.assign(new TypeError("Failed to fetch"), { name: "TypeError" }), data: null };
  }
  serverInserts.push(values);
  return { error: null, data: values };
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (values: Record<string, unknown>) => insert(values),
      update: () => ({ eq: async () => ({ error: null, data: null }) }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));

import {
  activeAdjustments,
  classifyBreak,
  planRebuild,
  returnProgression,
  type BreakFacts,
} from "./adaptivePlan";
import { guardianSanitizePermissions } from "./guardianAccess";
import {
  explainDecision,
  explainGoalProximity,
  explainRebuild,
  explainWeek,
  findMedicalCertainty,
  MAX_WHY,
} from "./explanations";
import { isLikelyManualDuplicate, type ExistingWorkout, type StagedActivity } from "./health/importHistory";
import { buildTrainingInsights, GOAL_WINDOW_DAYS, type InsightFacts, type InsightGoal, type InsightSession } from "./insights";
import {
  assessAvailability,
  countsTowardCompletion,
  isFailure,
  lifeEventType,
  type LifeEvent,
  type PlannedSession,
} from "./lifeEvents";
import { clearQueue, flushQueue, insertOrQueue, pendingWrites } from "./offlineQueue";
import { decideForSession, decideForWeek, loadTrend, type AdjustableSession, type LoadEntry, type RecoveryEntry, type RecoveryFacts } from "./recoveryAdjust";
import { buildGoalRoadmap, deriveDevelopmentAreas, goalProgress, type RoadmapContext, type RoadmapGoalRow } from "./roadmap";
import { loadTotals, sessionLoad } from "./sessionLoad";
import type { PlanSessionLike, PlanWeekLike } from "./planSchedule";

// ---------------------------------------------------------------------------
// Dates. Every module here takes its day as an injected `YYYY-MM-DD`, so the
// clock is fixed once and nothing in the suite can drift with the machine.
// ---------------------------------------------------------------------------

const TODAY = "2026-10-06";

const isoOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const parse = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

const addDays = (key: string, n: number): string => {
  const d = parse(key);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};

const daysAgo = (n: number): string => addDays(TODAY, -n);
const daysAhead = (n: number): string => addDays(TODAY, n);

// ---------------------------------------------------------------------------
// Fixtures, in the shapes each module actually accepts.
// ---------------------------------------------------------------------------

function lifeEvent(over: Partial<LifeEvent> = {}): LifeEvent {
  return {
    id: "ev-1",
    user_id: "athlete-1",
    start_date: "2026-09-21",
    end_date: "2026-09-30",
    event_type: "holiday",
    activity_level: "light",
    allow_training: "no",
    note: null,
    ...over,
  };
}

function planned(over: Partial<PlannedSession> = {}): PlannedSession {
  return {
    id: "pe-1",
    scheduled_date: "2026-09-23",
    title: "Intervals",
    status: "planned",
    important: true,
    ...over,
  };
}

function adjustable(over: Partial<AdjustableSession> = {}): AdjustableSession {
  return {
    week: 1,
    day: 1,
    date: daysAhead(1),
    title: "Intervals",
    type: "run",
    durationMinutes: 50,
    ...over,
  };
}

/** Eight plan weeks starting Monday 14 Sep 2026, five sessions each. */
function planWeeks(count = 8): PlanWeekLike[] {
  return Array.from({ length: count }, (_, i) => ({
    week: i + 1,
    sessions: [
      { day: 1, title: "Easy run", type: "easy", duration_minutes: 40 },
      { day: 2, title: "Rest", type: "rest", isRest: true },
      { day: 3, title: "Intervals", type: "key", duration_minutes: 50 },
      { day: 4, title: "Easy run", type: "easy", duration_minutes: 35 },
      { day: 5, title: "Long run", type: "long", duration_minutes: 75 },
    ] as PlanSessionLike[],
  }));
}

/** A plan week anchored so week 1 begins Monday 14 Sep 2026. */
const weekStart = (week: number): string => addDays("2026-09-14", (week - 1) * 7);

/**
 * A load history with a genuinely elevated acute:chronic ratio: seven flat
 * weeks behind, then a hard few days in front — including a football match,
 * so the multi-sport path is exercised rather than assumed.
 */
function elevatedLoads(): LoadEntry[] {
  const chronic = [7, 11, 15, 19, 23, 27, 31].map((n) => ({
    date: daysAgo(n),
    sport: "Running",
    title: "Easy run",
    load: 55,
    source: "workout" as const,
  }));
  const match = sessionLoad({ sport: "Football", durationMinutes: 90, kind: "match" });
  return [
    { date: daysAgo(0), sport: "Football", title: "Sunday league match", load: match.load, source: "workout" },
    { date: daysAgo(2), sport: "Running", title: "Threshold run", load: 70, source: "workout" },
    ...chronic,
  ];
}

const runDownRecovery = (): RecoveryEntry[] => [
  { log_date: TODAY, fatigue: 9, sleep_quality: 3, soreness: 8, readiness_score: 41 },
];

function factsFor(over: Partial<RecoveryFacts> = {}): RecoveryFacts {
  return {
    today: TODAY,
    recovery: runDownRecovery(),
    loads: elevatedLoads(),
    sessions: [adjustable()],
    ...over,
  };
}

function insightSessions(): InsightSession[] {
  return elevatedLoads()
    .filter((l) => l.load !== null)
    .map((l) => ({
      date: l.date,
      sport: l.sport ?? "Running",
      durationMinutes: 50,
      distanceKm: null,
      load: l.load,
      source: l.sport === "Football" ? "strava" : "manual",
      title: l.title ?? null,
    }));
}

const roadmapContext = (over: Partial<RoadmapContext> = {}): RoadmapContext => ({
  today: TODAY,
  sports: ["Running"],
  lifeEvents: [],
  weeks: [],
  adjustments: [],
  competitions: [],
  ...over,
});

function goalRow(over: Partial<RoadmapGoalRow> = {}): RoadmapGoalRow {
  return {
    id: "goal-1",
    user_id: "athlete-1",
    title: "Run 5K in 20:00",
    description: null,
    category: "performance",
    metric_unit: "sec",
    start_value: 1300,
    current_value: 1200,
    target_value: 1200,
    deadline: "2026-11-28",
    status: "active",
    created_at: "2026-09-01",
    ...over,
  } as RoadmapGoalRow;
}

/** Every athlete-facing string in one object, for the safety assertions. */
const prose = (...parts: (string | null | undefined)[]): string => parts.filter(Boolean).join(" ");

// ===========================================================================
describe("Scenario 1 — break → return → competition", () => {
  const facts: BreakFacts = {
    eventId: "ev-1",
    eventType: "holiday",
    startDate: "2026-09-21",
    endDate: "2026-09-30",
    days: 10,
    activityLevel: "light",
    allowTraining: "no",
  };

  it("a 10-day break rebuilds the plan instead of leaving a hole", () => {
    const outcome = planRebuild({
      weeks: planWeeks(),
      weekStart,
      facts,
      competitions: [{ title: "County 10K", date: "2026-10-08" }],
      id: "adj-1",
      today: "2026-09-30",
    });

    expect(outcome.reason).toBe("applied");
    expect(outcome.adjustment).not.toBeNull();
    expect(outcome.adjustment!.steps.length).toBeGreaterThan(0);
    // The break is remembered as a record, not recomputed later: the record is
    // what survives `plan_data` being edited.
    expect(outcome.adjustment!.break.days).toBe(10);
    expect(outcome.adjustment!.headline).toBeTruthy();
    expect(outcome.adjustment!.explanation).toBeTruthy();
  });

  it("sees the competition that lands in return week 2", () => {
    const outcome = planRebuild({
      weeks: planWeeks(),
      weekStart,
      facts,
      competitions: [{ title: "County 10K", date: "2026-10-08" }],
      id: "adj-1",
      today: "2026-09-30",
    });
    expect(outcome.adjustment!.competingSoon).toBe(true);
  });

  it("adjusts the progression around the competition rather than abandoning it", () => {
    const alone = planRebuild({ weeks: planWeeks(), weekStart, facts, id: "adj-a", today: "2026-09-30" });
    const raced = planRebuild({
      weeks: planWeeks(),
      weekStart,
      facts,
      competitions: [{ title: "County 10K", date: "2026-10-08" }],
      id: "adj-b",
      today: "2026-09-30",
    });

    const before = alone.adjustment!.steps;
    const after = raced.adjustment!.steps;

    // The progression survives intact — same number of weeks, same focus on
    // every week except the one the race falls in. That is the specification's
    // "not abandoned but adjusted around the competition".
    expect(after).toHaveLength(before.length);
    expect(after.map((s) => s.focus)).toEqual(before.map((s) => s.focus).map((f, i) => (i === 1 ? "compete" : f)));

    const competing = after.filter((s) => s.focus === "compete");
    expect(competing).toHaveLength(1);
    expect(competing[0].week).toBe(4); // 14 Sep anchor → the race on 8 Oct.
    expect(raced.adjustment!.competingSoon).toBe(true);
  });

  it("round-trips through the JSON column the plan actually stores", () => {
    const outcome = planRebuild({ weeks: planWeeks(), weekStart, facts, id: "adj-1", today: "2026-09-30" });
    const stored = JSON.parse(JSON.stringify([outcome.adjustment])) as unknown;
    expect(activeAdjustments(stored)).toHaveLength(1);
  });

  it("explains the return from both the break and the competition, and claims nothing medical", () => {
    const steps = returnProgression(classifyBreak(facts.days), {});
    expect(steps.length).toBeGreaterThan(1);

    const explained = explainRebuild({
      facts,
      steps,
      weekBack: 2,
      creditedDays: 0,
      youth: false,
      medical: false,
      competingSoon: true,
    });

    expect(explained.headline).toMatch(/week 2 of/i);
    expect(explained.why.length).toBeGreaterThanOrEqual(2);
    expect(explained.why.length).toBeLessThanOrEqual(MAX_WHY);
    // A holiday is not an injury, and the copy must not start behaving like one.
    expect(findMedicalCertainty(prose(explained.headline, explained.rationale, ...explained.why.map((w) => w.text)))).toEqual([]);
  });

  it("the analytics lead with the return, and the competition rides on the goal", () => {
    const facts: InsightFacts = {
      today: TODAY,
      sessions: insightSessions(),
      planned: [
        { date: daysAgo(1), title: "Easy run", status: "completed", countsTowardCompletion: true },
        { date: TODAY, title: "Intervals", status: "planned", countsTowardCompletion: true },
      ],
      recovery: [],
      goals: [
        {
          title: "Run 5K in 20:00",
          percent: 60,
          status: "on_track",
          daysRemaining: 53,
          achievedMilestones: 2,
          totalMilestones: 5,
          nextMilestone: { title: "Sub 21:00", targetDate: daysAhead(30) },
        },
      ],
      adjustments: [{ date: daysAgo(10), title: "Easy run", eventType: "holiday" }],
      returnFromBreak: { weekBack: 2, totalWeeks: 3, volumePct: 75, focus: "rebuild" },
      competition: { title: "County 10K", days: 11 },
    };

    const insights = buildTrainingInsights(facts);
    const back = insights.metrics.find((m) => m.id === "return_progression");

    expect(back).toBeDefined();
    expect(back!.available).toBe(true);
    expect(back!.value).toBe("Week 2 of 3");

    const goal = insights.metrics.find((m) => m.id === "goal_progress")!;
    const goalCopy = prose(goal.headline, goal.rationale, ...goal.why.map((w) => w.text));
    // The countdown, the goal and the next milestone are one sentence for the
    // athlete, even though they come from the calendar and the roadmap.
    expect(goalCopy).toContain("County 10K");
    expect(goalCopy).toContain("Run 5K in 20:00");
    expect(goalCopy).toContain("milestones reached");

    const changes = insights.metrics.find((m) => m.id === "plan_adjustments")!;
    const changesCopy = prose(changes.headline, changes.rationale, ...changes.why.map((w) => w.text));
    expect(changesCopy).toContain("1 session adjusted because of holiday");
    // Phase 1's break is not a debt the athlete is being made to repay.
    expect(changesCopy).toMatch(/count as missed sessions|not paying them back/i);
  });
});

// ===========================================================================
describe("Scenario 2 — unplanned match, then a run-down check-in", () => {
  it("prices the football match on the same scale as the running", () => {
    const match = sessionLoad({ sport: "Football", durationMinutes: 90, kind: "match" });
    const run = sessionLoad({ sport: "Running", durationMinutes: 60, rpe: 6 });
    expect(match.load).not.toBeNull();
    expect(run.load).not.toBeNull();
    // Multi-sport load is comparable, not on a separate scale — otherwise the
    // ratio below would be comparing two currencies.
    expect(match.load! / run.load!).toBeGreaterThan(0.8);
    expect(match.load! / run.load!).toBeLessThan(3.5);
  });

  it("the load trend knows the match happened and that the week is elevated", () => {
    const trend = loadTrend(elevatedLoads(), TODAY);
    expect(trend.known).toBe(true);
    expect(trend.elevated).toBe(true);
    expect(trend.acuteSports).toContain("Football");
    expect(trend.hardSessions).toBeGreaterThanOrEqual(1);
  });

  it("reduces Monday and cites the match and the check-in", () => {
    const decision = decideForSession(adjustable(), factsFor());

    expect(decision.action).toBe("reduce");
    expect(decision.evidence.length).toBeGreaterThanOrEqual(2);

    const sources = new Set(decision.evidence.map((e) => e.source));
    expect(sources.has("recovery")).toBe(true);
    expect(sources.has("load")).toBe(true);

    const explained = explainDecision(decision);
    expect(explained.why.length).toBeGreaterThanOrEqual(2);
    expect(explained.why.length).toBeLessThanOrEqual(MAX_WHY);
    expect(explained.rationale).toBeTruthy();
    expect(
      findMedicalCertainty(prose(explained.headline, explained.rationale, ...explained.why.map((w) => w.text))),
    ).toEqual([]);
  });

  it("shows both an elevated workload and a recovery reading in analytics", () => {
    const insights = buildTrainingInsights({
      today: TODAY,
      sessions: insightSessions(),
      planned: [{ date: TODAY, title: "Intervals", status: "planned", countsTowardCompletion: true }],
      recovery: [
        { date: TODAY, sleepQuality: 3, fatigue: 9, soreness: 8, stress: 7, readinessScore: 41 },
        { date: daysAgo(3), sleepQuality: 6, fatigue: 5 },
      ],
      goals: [],
      adjustments: [],
    });

    const workload = insights.metrics.find((m) => m.id === "workload")!;
    const recovery = insights.metrics.find((m) => m.id === "recovery_trend")!;
    expect(workload.available).toBe(true);
    expect(recovery.available).toBe(true);
    // The run-down check-in outranks the month-long percentage: it is the one
    // that changes what the athlete does today.
    expect(insights.top?.id).toBe("recovery_trend");
  });
});

// ===========================================================================
describe("Scenario 3 — goal change mid-plan", () => {
  it("replaces the target, the milestones and the percentage together", () => {
    const before = buildGoalRoadmap(
      goalRow({ title: "Run 5K in 20:00", target_value: 1200, deadline: "2026-11-28" }),
      roadmapContext(),
    );
    const after = buildGoalRoadmap(
      goalRow({ title: "Run 5K in 19:00", target_value: 1140, deadline: "2026-12-02" }),
      roadmapContext(),
    );

    expect(after.target).not.toBe(before.target);
    expect(after.progress.daysRemaining).toBeGreaterThan(before.progress.daysRemaining!);
    // A harder target against the same start is a different amount of progress,
    // and saying so is the whole point of the roadmap.
    expect(after.progress.percent).not.toBe(before.progress.percent);
    expect(after.milestones.length).toBeGreaterThan(0);
  });

  it("feeds the new percentage straight into the analytics screen", () => {
    const goal = goalRow({ target_value: 1140, deadline: "2026-12-02" });
    const progress = goalProgress(goal, roadmapContext());

    const insightGoal: InsightGoal = {
      title: goal.title,
      percent: progress.percent,
      status: progress.status,
      daysRemaining: progress.daysRemaining,
      achievedMilestones: 0,
      totalMilestones: 5,
      nextMilestone: null,
    };

    const insights = buildTrainingInsights({
      today: TODAY,
      sessions: insightSessions(),
      planned: [],
      recovery: [],
      goals: [insightGoal],
      adjustments: [],
    });

    const metric = insights.metrics.find((m) => m.id === "goal_progress")!;
    expect(metric.available).toBe(true);
    // The number on /insights is the roadmap's number, not a second opinion.
    expect(prose(metric.headline, metric.rationale, ...metric.why.map((w) => w.text))).toContain(
      `${progress.percent}%`,
    );
  });

  it("keeps a goal three weeks out inside the key-session window", () => {
    const explained = explainGoalProximity({
      goalTitle: "Run 5K in 19:00",
      daysRemaining: 21,
      percent: 40,
      status: "on_track",
      nextMilestone: null,
      achievedMilestones: 0,
      totalMilestones: 0,
      competition: null,
      keyWindowDays: GOAL_WINDOW_DAYS,
    });
    expect(explained).not.toBeNull();
    expect(
      findMedicalCertainty(prose(explained!.headline, explained!.rationale, ...explained!.why.map((w) => w.text))),
    ).toEqual([]);
  });
});

// ===========================================================================
describe("Scenario 4 — parent and athlete see different, consistent pictures", () => {
  it("a cancelled session is never a failure, so reduced load is not a verdict", () => {
    const event = lifeEvent({ event_type: "private", allow_training: "no" });
    const session = planned({ scheduled_date: "2026-09-23", important: true });
    const assessment = assessAvailability([session], event);

    const changed = assessment.adjustments[0]!;
    expect(changed.status).toBe("cancelled_due_to_availability");
    // The parent's dashboard reads the same statuses. If this were a failure,
    // a youth taking a personal break would show up as a missed session.
    expect(isFailure(changed.status)).toBe(false);
    expect(countsTowardCompletion(session, [event])).toBe(false);
    expect(assessment.explanation).toBeTruthy();
  });

  it("still counts the sessions the athlete did during the window", () => {
    const event = lifeEvent({ event_type: "private", allow_training: "no" });
    const done = planned({ status: "completed", important: true });
    expect(countsTowardCompletion(done, [event])).toBe(true);
  });

  it("cannot be talked out of the floors a younger guardian is entitled to", () => {
    const everythingOff = Object.fromEntries(
      ["goals", "roadmap", "consistency", "upcoming", "completed", "recovery", "workload", "competitions", "alerts", "coach"].map(
        (k) => [k, false],
      ),
    );

    const under13 = guardianSanitizePermissions(everythingOff, "under_13");
    expect(under13.consistency).toBe(true);
    expect(under13.upcoming).toBe(true);
    expect(under13.completed).toBe(true);
    expect(under13.alerts).toBe(true);

    const fourteen = guardianSanitizePermissions(everythingOff, "age_13_15");
    expect(fourteen.alerts).toBe(true);
    expect(fourteen.goals).toBe(false);
  });
});

// ===========================================================================
describe("Scenario 5 — offline logging on two devices", () => {
  beforeEach(() => {
    clearQueue();
    network.offline = false;
    serverInserts.length = 0;
  });

  it("holds the workout while offline, then lands it without losing the other device's row", async () => {
    // The other device logged a session while this one was dead.
    serverInserts.push({ id: "from-other-device", title: "Lunchtime run", session_load: 70 });

    network.offline = true;
    const queued = await insertOrQueue("workouts", {
      id: "offline-monday",
      title: "Morning run",
      session_load: 60,
    });

    expect(queued.ok).toBe(true);
    expect(queued.queued).toBe(true);
    expect(pendingWrites()).toHaveLength(1);
    // Nothing reached the database while the network was down — no half write.
    expect(serverInserts).toHaveLength(1);

    // Tuesday: the connection is back.
    network.offline = false;
    const sent = await flushQueue();

    expect(sent).toBe(1);
    expect(pendingWrites()).toHaveLength(0);
    expect(serverInserts.map((r) => r.id).sort()).toEqual(["from-other-device", "offline-monday"]);
  });

  it("counts both workouts once, in load and in the analytics", async () => {
    serverInserts.push({ id: "from-other-device", session_load: 70 });

    network.offline = true;
    await insertOrQueue("workouts", { id: "offline-monday", session_load: 60 });
    network.offline = false;
    await flushQueue();

    // Two distinct sessions on one day are two sessions — the queue's job is to
    // deliver each exactly once, not to reconcile them into one.
    const totals = loadTotals(
      serverInserts.map((r) => ({ date: TODAY, load: r.session_load as number })),
    );
    expect(totals.sessions).toBe(2);
    expect(totals.total).toBe(130);

    const insights = buildTrainingInsights({
      today: TODAY,
      sessions: [
        { date: TODAY, sport: "Running", durationMinutes: 45, distanceKm: null, load: 60, source: "manual" },
        { date: TODAY, sport: "Running", durationMinutes: 45, distanceKm: null, load: 70, source: "manual" },
      ],
      planned: [],
      recovery: [],
      goals: [],
      adjustments: [],
    });
    expect(insights.sessionCount).toBe(2);
    expect(insights.empty).toBe(false);
  });
});

// ===========================================================================
describe("Scenario 6 — three months of Strava history next to two weeks of manual logs", () => {
  const manualRun: ExistingWorkout = {
    id: "manual-1",
    started_at: "2026-10-05T12:10:00Z",
    completed_at: "2026-10-05T13:00:00Z",
    duration_minutes: 45,
    sport: "Running",
    type: "run",
    source: null,
  };

  const staged = (over: Partial<StagedActivity> = {}): StagedActivity => ({
    source: "strava",
    source_record_id: "abc123",
    title: "Morning Run",
    activity_type: "Run",
    start_time: "2026-10-05T12:00:00Z",
    end_time: "2026-10-05T12:50:00Z",
    duration_seconds: 3000,
    distance_meters: 8000,
    active_calories: 520,
    heart_rate_avg: 152,
    ...over,
  });

  it("spots the run the athlete already typed, and keeps the manual row", () => {
    const hit = isLikelyManualDuplicate(staged(), [manualRun]);
    expect(hit?.id).toBe("manual-1");
  });

  it("leaves a genuinely different session alone rather than dropping it", () => {
    const differentSport = isLikelyManualDuplicate(
      staged({ activity_type: "Ride", title: "Morning Ride", source_record_id: "ride-1" }),
      [manualRun],
    );
    expect(differentSport).toBeNull();

    const differentDay = isLikelyManualDuplicate(
      staged({ start_time: "2026-10-04T12:00:00Z", end_time: "2026-10-04T12:50:00Z", source_record_id: "run-2" }),
      [manualRun],
    );
    expect(differentDay).toBeNull();

    const differentLength = isLikelyManualDuplicate(
      staged({ start_time: "2026-10-05T12:00:00Z", end_time: "2026-10-05T13:40:00Z", duration_seconds: 6000, source_record_id: "run-3" }),
      [manualRun],
    );
    expect(differentLength).toBeNull();
  });

  it("never dedupes against a row the import itself wrote", () => {
    const alreadyImported: ExistingWorkout = { ...manualRun, id: "imported-1", source: "strava" };
    expect(isLikelyManualDuplicate(staged(), [alreadyImported])).toBeNull();
  });

  it("an imported session moves the plan the same way a manual one does", () => {
    // The import writes to `workouts`, so a watch-recorded session arrives as a
    // `workout` row like any other. Provenance is metadata for the athlete, not
    // a filter on the advice: history from Strava has to be able to change
    // this week's recommendation, or importing it would be pointless.
    const imported = elevatedLoads().map((l) => ({ ...l, source: "workout" as const }));
    const manual = elevatedLoads().map((l) => ({ ...l, source: "performance_log" as const }));

    const fromImport = loadTrend(imported, TODAY);
    const fromHand = loadTrend(manual, TODAY);
    expect(fromImport.elevated).toBe(true);
    expect(fromImport.elevated).toBe(fromHand.elevated);
    expect(fromImport.ratio).toBe(fromHand.ratio);
    expect(fromImport.acuteSports).toEqual(fromHand.acuteSports);

    const decision = decideForSession(adjustable(), factsFor({ loads: imported }));
    expect(decision.action).toBe("reduce");
    expect(decision.evidence.some((e) => e.source === "load")).toBe(true);
  });

  it("says out loud that the window mixes imported and manual sessions", () => {
    const insights = buildTrainingInsights({
      today: TODAY,
      sessions: [
        { date: daysAgo(1), sport: "Running", durationMinutes: 50, distanceKm: 8, load: 65, source: "strava" },
        { date: daysAgo(2), sport: "Running", durationMinutes: 40, distanceKm: 6, load: 50, source: "manual" },
      ],
      planned: [],
      recovery: [],
      goals: [],
      adjustments: [],
    });

    expect(insights.importedCount).toBe(1);
    expect(insights.manualCount).toBe(1);
    expect(insights.caveats.some((c) => /imported/i.test(c))).toBe(true);
    expect(insights.caveats.some((c) => /Nothing is estimated about your body/i.test(c))).toBe(true);
  });
});

// ===========================================================================
describe("Scenario 7 — youth athlete, exams, then the competition", () => {
  it("takes two weeks of exams out of the plan without calling it a missed fortnight", () => {
    const exams = lifeEvent({
      event_type: "exams",
      start_date: "2026-10-06",
      end_date: "2026-10-19",
      allow_training: "no",
      activity_level: "light",
    });
    const sessions = [
      planned({ id: "a", scheduled_date: "2026-10-07", title: "Intervals", important: true }),
      planned({ id: "b", scheduled_date: "2026-10-14", title: "Long run", important: false }),
      planned({ id: "c", scheduled_date: "2026-10-25", title: "Long run", important: true }),
    ];

    const assessment = assessAvailability(sessions, exams);

    expect(assessment.cancelled).toHaveLength(2);
    expect(assessment.lostKeySessions).toHaveLength(1);
    // The session after the window is untouched — exams do not ripple forward.
    expect(assessment.adjustments.find((a) => a.sessionId === "c")?.status).toBe("planned");
    expect(assessment.explanation).toBeTruthy();

    // Excused, not failed: this is the denominator the parent sees too.
    expect(sessions.map((s) => countsTowardCompletion({ ...s, status: "cancelled_due_to_availability" }, [exams]))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("keeps the analytics development-oriented for a 15-year-old", () => {
    const insights = buildTrainingInsights({
      today: TODAY,
      age: 15,
      sessions: insightSessions(),
      planned: [
        { date: daysAgo(1), title: "Intervals", status: "cancelled_due_to_availability", countsTowardCompletion: false, lifeEventId: "ev-1" },
        { date: TODAY, title: "Easy run", status: "completed", countsTowardCompletion: true },
      ],
      recovery: [{ date: TODAY, sleepQuality: 7, fatigue: 3, readinessScore: 80 }],
      goals: [],
      adjustments: [{ date: daysAgo(1), title: "Intervals", eventType: "exams" }],
    });

    expect(insights.youth).toBe(true);

    const changes = insights.metrics.find((m) => m.id === "plan_adjustments")!;
    const copy = prose(changes.headline, changes.rationale, ...changes.why.map((w) => w.text));
    expect(copy.toLowerCase()).toContain("exams");
    expect(copy).toMatch(/part of a season, not a failure/i);

    // Nothing anywhere in the youth-facing output reads as pressure or medicine.
    const everything = prose(
      ...insights.metrics.map((m) => prose(m.headline, m.rationale, m.nextStep ?? "", ...m.why.map((w) => w.text))),
      ...insights.caveats,
    );
    expect(findMedicalCertainty(everything)).toEqual([]);
    expect(everything).not.toMatch(/you (failed|let yourself down)|must win|prove it/i);
  });

  it("labels an exam period in the athlete's own words, not a clinical one", () => {
    expect(lifeEventType("exams").label.toLowerCase()).toContain("exam");
  });
});

// ===========================================================================
describe("Scenario 8 — injury, return, setback", () => {
  const injuryBreak: BreakFacts = {
    eventId: "ev-injury",
    eventType: "injury",
    startDate: "2026-09-14",
    endDate: "2026-10-04",
    days: 21,
    activityLevel: "none",
    allowTraining: "no",
  };

  it("a three-week injury is classified as a real break and rebuilt", () => {
    expect(classifyBreak(injuryBreak.days)).toBe("extended");

    const outcome = planRebuild({
      weeks: planWeeks(),
      weekStart,
      facts: injuryBreak,
      context: { medical: true, age: 17 },
      id: "adj-injury",
      today: "2026-10-04",
    });

    expect(outcome.reason).toBe("applied");
    expect(outcome.adjustment!.medicalNote).toBeTruthy();
  });

  it("caps the first week back harder than a holiday would", () => {
    const medical = returnProgression("extended", { medical: true, age: 17 });
    const holiday = returnProgression("extended", { age: 17 });
    expect(medical[0].volumePct).toBeLessThan(holiday[0].volumePct);
    expect(medical[0].intensityPct).toBeLessThanOrEqual(60);
  });

  it("explains the injury without diagnosing, and says so plainly", () => {
    const steps = returnProgression("extended", { medical: true, age: 17 });
    const explained = explainRebuild({
      facts: injuryBreak,
      steps,
      weekBack: 1,
      creditedDays: 0,
      youth: true,
      medical: true,
      competingSoon: false,
    });

    const copy = prose(explained.headline, explained.rationale, ...explained.why.map((w) => w.text));
    expect(findMedicalCertainty(copy)).toEqual([]);
    // The safety tone and the "not a treatment plan" line are what make this
    // safe to show a 17-year-old who has just been told to rest.
    expect(explained.tone).toBe("safety");
    expect(copy.toLowerCase()).toMatch(/not a (treatment|medical) plan|follow (the |your )?(clinician|physio|doctor)/);
  });

  it("a hard constraint outranks recovery data, and blocks rather than negotiates", () => {
    const blocked = decideForSession(
      adjustable({ date: "2026-10-04" }),
      factsFor({
        events: [lifeEvent({ event_type: "injury", start_date: "2026-09-14", end_date: "2026-10-04", allow_training: "no" })],
      }),
    );
    expect(blocked.action).toBe("blocked");
    expect(blocked.blockedBy).toBeTruthy();
    expect(findMedicalCertainty(prose(blocked.headline, ...blocked.evidence.map((e) => e.text)))).toEqual([]);
  });
});

// ===========================================================================
describe("Scenario 9 — running PB becomes a football squad", () => {
  it("re-derives the development areas when the sport behind the goal changes", () => {
    const runner = deriveDevelopmentAreas(goalRow({ title: "Run a running PB" }), roadmapContext({ sports: ["Running"] }));
    const footballer = deriveDevelopmentAreas(goalRow({ title: "Make first-team football squad" }), roadmapContext({ sports: ["Football"] }));

    expect(runner.length).toBeGreaterThan(0);
    expect(footballer.length).toBeGreaterThan(0);
    expect(runner).not.toEqual(footballer);
  });

  it("keeps the roadmap honest about what is stored rather than derived", () => {
    const stored = buildGoalRoadmap(
      goalRow({ development_areas: JSON.stringify(["speed and agility", "tactical understanding"]) }),
      roadmapContext({ sports: ["Football"] }),
    );
    expect(stored.areasSource).toBe("stored");
    expect(stored.developmentAreas).toEqual(["speed and agility", "tactical understanding"]);

    const derived = buildGoalRoadmap(goalRow(), roadmapContext({ sports: ["Running"] }));
    expect(derived.areasSource).toBe("derived");
  });
});

// ===========================================================================
describe("Scenario 10 — poor recovery, the athlete overrides, then feels worse", () => {
  const monday = TODAY;
  const tuesday = daysAhead(1);

  const worseRecovery = (): RecoveryEntry[] => [
    { log_date: tuesday, fatigue: 10, sleep_quality: 2, soreness: 9, readiness_score: 33 },
    { log_date: monday, fatigue: 9, sleep_quality: 3, readiness_score: 41 },
  ];

  it("recommends less on Monday and again, just as firmly, on Tuesday", () => {
    const mondayDecision = decideForSession(
      adjustable({ date: monday }),
      factsFor({ today: monday, recovery: [{ log_date: monday, fatigue: 9, sleep_quality: 3, readiness_score: 41 }] }),
    );
    const tuesdayDecision = decideForSession(
      adjustable({ date: tuesday, title: "Tempo run" }),
      factsFor({ today: tuesday, recovery: worseRecovery() }),
    );

    expect(mondayDecision.action).toBe("reduce");
    // Worse numbers must not produce a softer recommendation, and must not
    // produce "you already trained hard yesterday, so rest".
    expect(tuesdayDecision.action).toBe("reduce");
    expect(tuesdayDecision.evidence.length).toBeGreaterThanOrEqual(mondayDecision.evidence.length);
  });

  it("rolls the week up without inventing a number bigger than the sessions it proposes", () => {
    const week = decideForWeek(
      [
        adjustable({ date: monday, week: 1, day: 1 }),
        adjustable({ date: tuesday, week: 1, day: 2, title: "Tempo run" }),
      ],
      factsFor({ today: tuesday, recovery: worseRecovery() }),
    );

    expect(week.decisions).toHaveLength(2);
    expect(week.volumeReductionPct).not.toBeNull();
    expect(week.volumeReductionPct!).toBeGreaterThanOrEqual(10);
    expect(week.volumeReductionPct!).toBeLessThanOrEqual(40);
    expect(week.explanation).toBeTruthy();

    const explained = explainWeek(week);
    expect(explained).not.toBeNull();
    expect(explained!.why.length).toBeLessThanOrEqual(MAX_WHY);
  });

  it("never shames the athlete and never dresses itself up as medicine", () => {
    const decisions = [
      decideForSession(adjustable({ date: monday }), factsFor({ today: monday, recovery: [{ log_date: monday, fatigue: 9, sleep_quality: 3 }] })),
      decideForSession(adjustable({ date: tuesday, title: "Tempo run" }), factsFor({ today: tuesday, recovery: worseRecovery() })),
    ];

    const copy = decisions
      .map((d) => {
        const e = explainDecision(d);
        return prose(d.headline, d.uncertainty, e.headline, e.rationale, ...e.why.map((w) => w.text), ...d.evidence.map((x) => x.text));
      })
      .join(" ");

    expect(copy).not.toMatch(/you (failed|should have|ignored)|your fault|lazy|slacking|let yourself down/i);
    expect(findMedicalCertainty(copy)).toEqual([]);
  });

  it("admits when the record is too thin instead of guessing", () => {
    const thin = decideForSession(adjustable(), {
      today: TODAY,
      recovery: [],
      loads: [],
      sessions: [adjustable()],
    });

    expect(thin.action).toBe("insufficient");
    const explained = explainDecision(thin);
    expect(explained.insufficient).toBe(true);
    expect(explained.rationale.toLowerCase()).toContain("enough information");
    expect(explained.why).toHaveLength(0);
  });
});

// ===========================================================================
// The rule Phases 6–7 established applies to the whole product, not only to
// the screens Phase 6 happened to touch. `analyzeLoads` predates Phases 1–6
// and its athlete-facing sentences are rendered verbatim as the Workload
// advice on /metrics, so it is held to the same standard here.
// ===========================================================================
describe("cross-cutting — no screen claims a medical finding", () => {
  const source = (p: string): string =>
    readFileSync(resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

  /**
   * The file with whole-line comments removed.
   *
   * Both screens carry comments that name the claim they used to make — that is
   * how the history survives a refactor — and a scan for the phrase would find
   * the explanation rather than the copy. Only lines that *begin* a comment are
   * dropped, so a URL inside a string literal is left where it is.
   */
  const shippedCopy = (p: string): string =>
    source(p)
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*|\*\/)/.test(line))
      .join("\n");

  const day = (offset: number, total_rpe: number): LoadRow => ({
    log_date: daysAgo(offset),
    sprint_load: 0,
    endurance_load: 0,
    strength_load: 0,
    skill_load: 0,
    total_rpe,
  });

  const cases: { label: string; loads: LoadRow[]; age?: number }[] = [
    {
      label: "a spike",
      loads: [
        ...Array.from({ length: 21 }, (_, i) => day(i + 7, 300)),
        ...Array.from({ length: 7 }, (_, i) => day(i, 900)),
      ],
      age: 15,
    },
    {
      label: "a drop",
      loads: Array.from({ length: 28 }, (_, i) => day(i, i < 7 ? 100 : 500)),
      age: 15,
    },
    {
      label: "a sprint-heavy week",
      loads: Array.from({ length: 28 }, (_, i) => ({
        ...day(i, 500),
        sprint_load: 400,
        endurance_load: 60,
        strength_load: 40,
      })),
      age: 15,
    },
    {
      label: "a young athlete's heavy week",
      loads: Array.from({ length: 28 }, (_, i) => day(i, i < 7 ? 950 : 500)),
      age: 15,
    },
  ];

  it("every workload alert is a training statement, whatever the shape of the data", () => {
    for (const { label, loads, age } of cases) {
      const messages = analyzeLoads(loads, age).alerts.map((a) => a.message);
      expect(messages.length, `${label} produced no alert at all`).toBeGreaterThan(0);
      for (const message of messages) {
        expect(findMedicalCertainty(message), `${label}: ${message}`).toEqual([]);
        // The specific claims that used to be rendered here.
        expect(message, `${label}: ${message}`).not.toMatch(/tendon stress|safe zone|safe threshold|detraining risk/i);
      }
    }
  });

  it("the injury screen sells a strain reading, not a risk forecast", () => {
    const page = shippedCopy("/src/pages/Injury.tsx");
    expect(page).not.toContain("HIGH RISK");
    expect(page).not.toContain("Current Risk");
    expect(page).not.toContain("Predictive Injury Engine");
    expect(page).not.toContain("Real-time risk");
    // The screen keeps every feature it had: it is the claim that changed.
    expect(page).toContain("Current strain");
    expect(page).toContain("not a medical assessment");
    expect(page).toContain("creditCost(\"injury_management_unlock\")");
  });

  it("the metrics dashboard still does not print an injury-risk tile", () => {
    const page = shippedCopy("/src/pages/MetricsHub.tsx");
    expect(page).not.toContain("Injury risk:");
    expect(page).toContain("not a medical assessment");
  });
});
