import { describe, expect, it } from "vitest";

import {
  decideForSession,
  decideForWeek,
  decisionText,
  daysBetween,
  hardConstraintFor,
  latestRecovery,
  loadTrend,
  NOT_ENOUGH_INFORMATION,
  type AdjustableSession,
  type LoadEntry,
  type RecoveryEntry,
  type RecoveryFacts,
} from "./recoveryAdjust";

const TODAY = "2026-10-05";

const session = (over: Partial<AdjustableSession> = {}): AdjustableSession => ({
  week: 1,
  day: 1,
  date: TODAY,
  title: "Tempo Run",
  type: "tempo",
  durationMinutes: 45,
  ...over,
});

const recovery = (over: Partial<RecoveryEntry> = {}): RecoveryEntry => ({
  log_date: TODAY,
  sleep_quality: 7,
  fatigue: 5,
  soreness: 4,
  mood: 7,
  stress: 3,
  energy: 7,
  readiness_score: 75,
  ...over,
});

/** A steady four weeks of training, so `loadTrend` has a chronic baseline. */
const chronic: LoadEntry[] = [
  { date: "2026-09-10", sport: "Running", load: 50, source: "performance_log" },
  { date: "2026-09-12", sport: "Running", load: 55, source: "performance_log" },
  { date: "2026-09-14", sport: "Running", load: 45, source: "performance_log" },
  { date: "2026-09-16", sport: "Running", load: 60, source: "performance_log" },
  { date: "2026-09-18", sport: "Running", load: 50, source: "performance_log" },
  { date: "2026-09-20", sport: "Running", load: 55, source: "performance_log" },
  { date: "2026-09-22", sport: "Running", load: 45, source: "performance_log" },
  { date: "2026-09-24", sport: "Running", load: 60, source: "performance_log" },
  { date: "2026-09-26", sport: "Running", load: 50, source: "performance_log" },
  { date: "2026-09-28", sport: "Running", load: 55, source: "performance_log" },
];

const facts = (over: Partial<RecoveryFacts> = {}): RecoveryFacts => ({
  today: TODAY,
  recovery: [recovery()],
  loads: chronic,
  sessions: [session()],
  ...over,
});

const event = (over: Partial<RecoveryFacts["events"] extends (infer T)[] | undefined ? T : never> = {}) =>
  ({
    id: "ev-1",
    user_id: "u1",
    start_date: "2026-10-01",
    end_date: "2026-10-08",
    event_type: "holiday",
    activity_level: "light",
    allow_training: "no",
    note: null,
    created_at: "2026-09-30T00:00:00Z",
    updated_at: "2026-09-30T00:00:00Z",
    ...over,
  }) as NonNullable<RecoveryFacts["events"]>[number];

// ---------------------------------------------------------------------------
// Hard constraints — these may never be negotiated with recovery data.
// ---------------------------------------------------------------------------

describe("recoveryAdjust — hard constraints", () => {
  it("blocks a session on a competition day", () => {
    const decision = decideForSession(
      session({ date: "2026-10-07" }),
      facts({ competitions: [{ title: "City Half", date: "2026-10-07" }] }),
    );
    expect(decision.action).toBe("blocked");
    expect(decision.blockedBy).toBe("competition");
    expect(decision.volumePct).toBeNull();
  });

  it("blocks a session inside a paused break, however good the recovery data is", () => {
    const decision = decideForSession(
      session({ date: "2026-10-03" }),
      facts({ events: [event()], recovery: [recovery({ readiness_score: 95, sleep_quality: 9, fatigue: 1 })] }),
    );
    expect(decision.action).toBe("blocked");
    expect(decision.blockedBy).toBe("unavailable");
  });

  it("never offers a session during a recorded illness, even one notch worse", () => {
    const decision = decideForSession(
      session({ date: "2026-10-03" }),
      facts({ events: [event({ event_type: "illness", activity_level: "none" })] }),
    );
    expect(decision.action).toBe("blocked");
    expect(decision.blockedBy).toBe("medical");
    expect(decisionText(decision)).toMatch(/doctor|physiotherapist/i);
  });

  it("treats the day after a competition as required rest", () => {
    const decision = decideForSession(
      session({ date: "2026-10-08" }),
      facts({ competitions: [{ title: "City Half", date: "2026-10-07" }] }),
    );
    expect(decision.action).toBe("blocked");
    expect(decision.blockedBy).toBe("post-competition");
  });

  it("reports the most fundamental constraint first when several apply", () => {
    const decision = decideForSession(
      session({ date: "2026-10-07" }),
      facts({
        competitions: [{ title: "City Half", date: "2026-10-07" }],
        events: [event()],
      }),
    );
    expect(decision.blockedBy).toBe("competition");
  });

  it("exposes the constraint check on its own, for callers that need it", () => {
    expect(hardConstraintFor(session({ date: "2026-10-07" }), facts())).toBeNull();
    expect(hardConstraintFor(session({ date: "2026-10-07" }), facts({ competitions: [{ title: "X", date: "2026-10-07" }] }))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

describe("recoveryAdjust — §3 heuristics", () => {
  it("case 3: high fatigue AND poor sleep AND elevated load cuts about 30%", () => {
    const decision = decideForSession(
      session(),
      facts({
        recovery: [recovery({ fatigue: 9, sleep_quality: 3, readiness_score: 40 })],
        loads: [
          ...chronic,
          { date: "2026-10-03", sport: "Running", load: 90, source: "performance_log" },
          { date: "2026-10-04", sport: "Running", load: 95, source: "performance_log" },
          { date: "2026-10-05", sport: "Running", load: 90, source: "performance_log" },
        ],
      }),
    );
    expect(decision.action).toBe("reduce");
    expect(decision.volumePct).toBe(70);
    expect(decision.intensityPct).toBe(70);
  });

  it("does not cut on one bad signal alone", () => {
    // Poor sleep, but load is normal and fatigue is fine. A bad night is not a
    // bad week, and an app that reacts to one night trains its athletes to stop
    // trusting it.
    const decision = decideForSession(
      session(),
      facts({ recovery: [recovery({ sleep_quality: 2, fatigue: 4, readiness_score: 72 })] }),
    );
    expect(decision.action).not.toBe("reduce");
  });

  it("half-cuts when fatigue and sleep are poor but there is no load history", () => {
    const decision = decideForSession(
      session(),
      facts({ recovery: [recovery({ fatigue: 9, sleep_quality: 2 })], loads: [] }),
    );
    expect(decision.action).toBe("reduce");
    expect(decision.volumePct).toBe(85);
    expect(decision.uncertainty).toContain(NOT_ENOUGH_INFORMATION);
  });

  it("case 2: an unplanned football match pushes load up even when nothing was planned", () => {
    const trend = loadTrend(
      [
        ...chronic,
        { date: "2026-10-03", sport: "football", title: "Saturday match", load: 126, source: "workout" },
      ],
      TODAY,
    );
    expect(trend.elevated).toBe(true);
    expect(trend.hardSessions).toBeGreaterThanOrEqual(1);
    expect(trend.acuteSports).toContain("football");
  });

  it("case 3b: swaps a hard session for an easy one when load is high and recovery is poor", () => {
    const decision = decideForSession(
      session({ type: "intervals" }),
      facts({
        recovery: [recovery({ fatigue: 8, readiness_score: 45 })],
        loads: [
          ...chronic,
          { date: "2026-10-02", sport: "Running", load: 120, source: "performance_log" },
          { date: "2026-10-04", sport: "Running", load: 130, source: "performance_log" },
        ],
      }),
    );
    expect(decision.action).toBe("swap");
    expect(decision.intensityPct).toBeLessThanOrEqual(60);
  });

  it("does not swap an easy session on the strength of one poor night", () => {
    const decision = decideForSession(
      session({ type: "endurance" }),
      facts({ recovery: [recovery({ fatigue: 8, readiness_score: 45 })] }),
    );
    expect(decision.action).not.toBe("swap");
  });

  it("case 3c: low readiness with a key session tomorrow makes today easy", () => {
    const decision = decideForSession(
      session({ day: 1, date: "2026-10-05" }),
      facts({
        recovery: [recovery({ readiness_score: 45 })],
        sessions: [
          session({ day: 1, date: "2026-10-05" }),
          session({ day: 2, date: "2026-10-06", title: "Intervals", type: "intervals", key: true }),
        ],
      }),
    );
    expect(decision.action).toBe("reduce");
    expect(decisionText(decision)).toMatch(/tomorrow/i);
  });

  it("does not reduce the key session itself in order to protect tomorrow", () => {
    const decision = decideForSession(
      session({ date: "2026-10-06", type: "intervals", key: true }),
      facts({
        recovery: [recovery({ readiness_score: 45 })],
        sessions: [
          session({ date: "2026-10-05" }),
          session({ date: "2026-10-06", type: "intervals", key: true }),
        ],
      }),
    );
    expect(decision.action).not.toBe("reduce");
  });

  it("case 4: high readiness, moderate load and no imminent competition lets the plan stand", () => {
    const decision = decideForSession(
      session({ type: "intervals" }),
      facts({ recovery: [recovery({ readiness_score: 88, sleep_quality: 9, fatigue: 2 })] }),
    );
    expect(decision.action).toBe("proceed");
    expect(decision.evidence.some((e) => /nothing is competing/i.test(e.text))).toBe(true);
  });

  it("withholds 'go ahead' when a competition is within three days", () => {
    const decision = decideForSession(
      session(),
      facts({
        recovery: [recovery({ readiness_score: 88 })],
        competitions: [{ title: "City Half", date: "2026-10-07" }],
      }),
    );
    expect(decision.action).not.toBe("proceed");
  });

  it("case 5: week 1 of a return rebuild with poor recovery takes a further 15% off", () => {
    const decision = decideForSession(
      session(),
      facts({
        inReturnProgression: true,
        returnWeekBack: 1,
        recovery: [recovery({ readiness_score: 42, fatigue: 8 })],
      }),
    );
    expect(decision.action).toBe("reduce");
    expect(decision.volumePct).toBe(85);
  });

  it("case 6: week 1 of a return rebuild with good recovery does NOT accelerate", () => {
    const decision = decideForSession(
      session(),
      facts({
        inReturnProgression: true,
        returnWeekBack: 1,
        recovery: [recovery({ readiness_score: 85, sleep_quality: 9, fatigue: 2 })],
      }),
    );
    expect(decision.action).toBe("proceed");
    // The specification's point is that a good day is not permission to push.
    expect(decision.volumePct).toBeNull();
    expect(decision.evidence.some((e) => e.source === "break")).toBe(true);
  });

  it("never proposes an increase, in any branch", () => {
    const scenarios: RecoveryFacts[] = [
      facts({ recovery: [recovery({ readiness_score: 100, sleep_quality: 10, fatigue: 1 })] }),
      facts({ inReturnProgression: true, returnWeekBack: 2, recovery: [recovery({ readiness_score: 95 })] }),
      facts({ recovery: [recovery({ readiness_score: 100 })], competitions: [{ title: "X", date: "2026-10-08" }] }),
    ];
    for (const f of scenarios) {
      const decision = decideForSession(session({ type: "intervals" }), f);
      if (decision.volumePct !== null) expect(decision.volumePct).toBeLessThanOrEqual(100);
      if (decision.intensityPct !== null) expect(decision.intensityPct).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// Uncertainty
// ---------------------------------------------------------------------------

describe("recoveryAdjust — saying 'I don't know'", () => {
  it("says the specification's sentence when there is neither recovery nor load", () => {
    const decision = decideForSession(session(), facts({ recovery: [], loads: [] }));
    expect(decision.action).toBe("insufficient");
    expect(decision.uncertainty).toContain(NOT_ENOUGH_INFORMATION);
    expect(decisionText(decision)).toContain(NOT_ENOUGH_INFORMATION);
  });

  it("does not treat a missing readiness score as a score of zero", () => {
    // The Phase 2 bug: `Number(null) === 0` read a null as the worst possible
    // recovery. A null must be unknown, and unknown must not cut a session.
    const decision = decideForSession(
      session(),
      facts({ recovery: [recovery({ readiness_score: null, fatigue: 4, sleep_quality: 8 })], loads: chronic }),
    );
    expect(decision.action).toBe("proceed");
  });

  it("ignores a recovery log that is too old to act on", () => {
    const decision = decideForSession(
      session(),
      facts({
        recovery: [recovery({ log_date: "2026-08-01", fatigue: 10, sleep_quality: 1, readiness_score: 20 })],
        loads: chronic,
      }),
    );
    expect(decision.action).not.toBe("reduce");
  });

  it("still finds an explanation when a rest day is in the way of an adjustment", () => {
    const decision = decideForSession(
      session({ isRest: true, type: "rest", durationMinutes: 0 }),
      facts({ recovery: [recovery({ fatigue: 10, sleep_quality: 1, readiness_score: 10 })] }),
    );
    expect(decision.action).toBe("preserve");
  });
});

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

describe("recoveryAdjust — the week", () => {
  it("leaves a good week alone and says nothing", () => {
    const week = decideForWeek(
      [session({ day: 1, date: "2026-10-05" }), session({ day: 3, date: "2026-10-07", type: "endurance" })],
      facts({ recovery: [recovery({ readiness_score: 85 })] }),
    );
    expect(week.volumeReductionPct).toBeNull();
    expect(week.explanation).toBeNull();
  });

  it("averages the reduction rather than quoting the largest single cut", () => {
    const week = decideForWeek(
      [
        session({ day: 1, date: "2026-10-05" }),
        session({ day: 2, date: "2026-10-06", type: "endurance" }),
        session({ day: 3, date: "2026-10-07", type: "endurance" }),
      ],
      facts({
        recovery: [recovery({ fatigue: 9, sleep_quality: 2, readiness_score: 35 })],
        loads: [
          ...chronic,
          { date: "2026-10-03", sport: "Running", load: 120, source: "performance_log" },
          { date: "2026-10-04", sport: "Running", load: 130, source: "performance_log" },
        ],
      }),
    );
    expect(week.volumeReductionPct).not.toBeNull();
    expect(week.volumeReductionPct!).toBeGreaterThanOrEqual(10);
    expect(week.volumeReductionPct!).toBeLessThanOrEqual(40);
    expect(week.explanation).toMatch(/consider reducing this week's volume/i);
  });

  it("adds the development note for a youth athlete and never asks them to prove anything", () => {
    const week = decideForWeek(
      [session({ date: "2026-10-05" })],
      facts({
        age: 15,
        recovery: [recovery({ fatigue: 9, sleep_quality: 2, readiness_score: 35 })],
        loads: [...chronic, { date: "2026-10-04", sport: "Running", load: 130, source: "performance_log" }],
      }),
    );
    expect(week.explanation).toMatch(/still developing/i);
    expect(week.explanation).toMatch(/rest is part of getting stronger/i);
  });

  it("says the week could not be assessed when nothing could be", () => {
    const week = decideForWeek([session()], facts({ recovery: [], loads: [] }));
    expect(week.uncertainty).toContain(NOT_ENOUGH_INFORMATION);
  });

  it("decides each session by its own date, not by array order", () => {
    const week = decideForWeek(
      [session({ day: 3, date: "2026-10-07" }), session({ day: 1, date: "2026-10-05" })],
      facts({ competitions: [{ title: "City Half", date: "2026-10-07" }] }),
    );
    expect(week.decisions.map((d) => d.date)).toEqual(["2026-10-05", "2026-10-07"]);
    expect(week.decisions[1].action).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// The evidence itself
// ---------------------------------------------------------------------------

describe("recoveryAdjust — evidence and copy", () => {
  it("cites the athlete's own numbers and never invents a probability", () => {
    const decision = decideForSession(
      session(),
      facts({
        recovery: [recovery({ fatigue: 9, sleep_quality: 2, readiness_score: 35 })],
        loads: [...chronic, { date: "2026-10-04", sport: "Running", load: 130, source: "performance_log" }],
      }),
    );
    const text = decisionText(decision);
    expect(text).toMatch(/9\/10/);
    expect(text).toMatch(/2\/10/);
    expect(text).toMatch(/35\/100/);
    // No risk percentages anywhere — that is the whole point of §2 and §7.
    expect(text).not.toMatch(/\d+%\s+chance/i);
    expect(text).not.toMatch(/risk of (injury|illness)/i);
  });

  it("describes the athlete's inputs in plain language, not as jargon", () => {
    const decision = decideForSession(
      session(),
      facts({
        recovery: [recovery({ fatigue: 9, sleep_quality: 2, readiness_score: 35 })],
        loads: [...chronic, { date: "2026-10-04", sport: "Running", load: 130, source: "performance_log" }],
      }),
    );
    expect(decisionText(decision)).toMatch(/you reported your fatigue/i);
    expect(decisionText(decision)).not.toMatch(/ACWR|TRIMP|monotony/i);
  });

  it("reads a rest day as recovery, not as a session to scale", () => {
    const decision = decideForSession(
      session({ type: "rest", durationMinutes: 0, isRest: true }),
      facts(),
    );
    expect(decision.action).toBe("preserve");
    expect(decision.volumePct).toBeNull();
  });
});

describe("recoveryAdjust — reading the data", () => {
  it("counts whole days between dates in both directions", () => {
    expect(daysBetween("2026-10-01", "2026-10-05")).toBe(4);
    expect(daysBetween("2026-10-05", "2026-10-01")).toBe(-4);
    expect(daysBetween("2026-10-05", "2026-10-05")).toBe(0);
  });

  it("picks the most recent recovery log inside the window", () => {
    const picked = latestRecovery(
      [
        recovery({ log_date: "2026-10-01", readiness_score: 10 }),
        recovery({ log_date: "2026-10-05", readiness_score: 90 }),
        recovery({ log_date: "2026-09-01", readiness_score: 20 }),
      ],
      TODAY,
    );
    expect(picked?.readiness_score).toBe(90);
  });

  it("does not claim a load trend from a single logged session", () => {
    const trend = loadTrend([{ date: TODAY, sport: "Running", load: 400, source: "performance_log" }], TODAY);
    expect(trend.known).toBe(false);
    expect(trend.elevated).toBe(false);
    expect(trend.ratio).toBeNull();
  });

  it("ignores unpriceable sessions when measuring load", () => {
    const trend = loadTrend(
      [...chronic, { date: TODAY, sport: "Quidditch", load: null, source: "workout" }],
      TODAY,
    );
    expect(trend.acute).toBe(0);
  });
});