import { beforeEach, describe, expect, it, vi } from "vitest";

// The Supabase client is mocked through a mutable holder so each test can set
// the workout log it will read and the edge-function answers it will receive.
// `invokeResults` is a queue: the top-up retry path calls the edge function
// again, and the queue is how the second answer is staged.
const mock = vi.hoisted(() => ({
  workouts: [] as Array<Record<string, unknown>>,
  invokeResults: [] as Array<{ data: unknown; error: unknown }>,
  // What the last call actually sent. The digest is the prompt, so this is how
  // a test asks "which week did it compare against?" rather than trusting the
  // argument name.
  lastBody: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/topUpStore", () => ({
  requestCreditTopUp: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => Promise.resolve({ data: mock.workouts, error: null }),
  };
  return {
    supabase: {
      from: () => query,
      functions: {
        invoke: (_fn: string, opts?: { body?: Record<string, unknown> }) => {
          mock.lastBody = opts?.body ?? null;
          return Promise.resolve(mock.invokeResults.shift() ?? { data: null, error: null });
        },
      },
    },
  };
});

import { requestCreditTopUp } from "@/lib/topUpStore";

import { runWorkoutReview } from "./runWorkoutReview";

const loggedWorkout = {
  id: "w1",
  title: "Tempo run",
  completed_at: "2026-10-09T07:00:00.000Z",
  duration_minutes: 45,
};

const creditError = {
  data: null,
  error: {
    context: {
      status: 402,
      json: async () => ({ error: "Not enough credits.", shortfall: 10, cost: 8, balance: 0 }),
    },
  },
};

beforeEach(() => {
  mock.workouts = [];
  mock.invokeResults = [];
  mock.lastBody = null;
  vi.mocked(requestCreditTopUp).mockReset();
});

describe("runWorkoutReview", () => {
  it("refuses to analyse — and never charges — before a workout has been logged", async () => {
    const onCharge = vi.fn();

    const result = await runWorkoutReview({
      user: { id: "u1" },
      profile: { sport: "run" },
      planWeek: [{ week: 1, sessions: [] }],
      weekCurrent: 1,
      durationWeeks: 4,
      onCharge,
    });

    expect(result).toEqual({
      kind: "empty",
      reason: "Log a few finished sessions first — analysing nothing would be invented.",
    });
    expect(onCharge).not.toHaveBeenCalled();
  });

  it("reads the log even with no active plan, instead of refusing outright", async () => {
    // The button used to answer "No active plan yet — generate one first" and
    // spend nothing, which is a dead end for the athlete whose log is the only
    // thing they have. The digest builder already knows how to say a plan was
    // not supplied, so the review runs and says that.
    mock.workouts = [loggedWorkout];
    mock.invokeResults = [{ data: { result: JSON.stringify({ summary: "Steady week." }), cost: 8 }, error: null }];

    const result = await runWorkoutReview({
      user: { id: "u1" },
      profile: { sport: "run" },
      planWeek: null,
      weekCurrent: null,
      durationWeeks: null,
    });

    expect(result.kind).toBe("ready");
    expect(String(mock.lastBody?.summary)).toContain("no active plan was supplied");
  });

  it("compares against the week the athlete is in, not the first week of the plan", async () => {
    mock.workouts = [loggedWorkout];
    mock.invokeResults = [{ data: { result: JSON.stringify({ summary: "Steady week." }), cost: 8 }, error: null }];

    await runWorkoutReview({
      user: { id: "u1" },
      profile: { sport: "run" },
      planWeek: [
        { week: 1, sessions: [{ day: 1, title: "Easy shakeout", duration_minutes: 30 }] },
        { week: 3, sessions: [{ day: 2, title: "Threshold blocks", duration_minutes: 60 }] },
      ],
      weekCurrent: 3,
      durationWeeks: 4,
    });

    const summary = String(mock.lastBody?.summary);
    expect(summary).toContain("week 3 of 4");
    expect(summary).toContain("Threshold blocks");
    expect(summary).not.toContain("Easy shakeout");
  });

  it("reads the weeks out of a plan stored as { weeks: [...] }", async () => {
    mock.workouts = [loggedWorkout];
    mock.invokeResults = [{ data: { result: JSON.stringify({ summary: "Steady week." }), cost: 8 }, error: null }];

    await runWorkoutReview({
      user: { id: "u1" },
      profile: { sport: "run" },
      planWeek: { weeks: [{ week: 2, sessions: [{ day: 1, title: "Hill reps", duration_minutes: 50 }] }] },
      weekCurrent: 2,
      durationWeeks: 4,
    });

    expect(String(mock.lastBody?.summary)).toContain("Hill reps");
  });

  it("charges the stats-insight price and returns the parsed answer", async () => {
    mock.workouts = [loggedWorkout];
    mock.invokeResults = [
      { data: { result: JSON.stringify({ summary: "Steady week." }), cost: 8 }, error: null },
    ];
    const onCharge = vi.fn();

    const result = await runWorkoutReview({
      user: { id: "u1" },
      profile: { sport: "run" },
      planWeek: [
        { week: 1, sessions: [{ day: 1, title: "Tempo run", duration_minutes: 45 }] },
      ],
      weekCurrent: 1,
      durationWeeks: 4,
      onCharge,
    });

    expect(onCharge).toHaveBeenCalledWith(8);
    expect(result).toEqual({
      kind: "ready",
      data: { summary: "Steady week." },
      charged: 8,
    });
  });

  it("opens the top-up sheet for the exact shortfall after a 402", async () => {
    mock.workouts = [loggedWorkout];
    mock.invokeResults = [creditError];
    vi.mocked(requestCreditTopUp).mockResolvedValue({ purchased: false, dismissed: true, plan: null });

    const result = await runWorkoutReview({
      user: { id: "u1" },
      profile: { sport: "run" },
      planWeek: [{ week: 1, sessions: [] }],
      weekCurrent: 1,
      durationWeeks: 4,
    });

    expect(requestCreditTopUp).toHaveBeenCalledWith({
      shortfall: 10,
      reasonLabel: "Analyse my workouts",
    });
    expect(result).toEqual({
      kind: "error",
      message: "Cancelled — add credits to analyse your workouts.",
    });
  });

  it("re-runs the review after the athlete tops up, without a second tap", async () => {
    mock.workouts = [loggedWorkout];
    mock.invokeResults = [
      creditError,
      { data: { result: JSON.stringify({ summary: "Now it worked." }), cost: 8 }, error: null },
    ];
    vi.mocked(requestCreditTopUp).mockResolvedValue({ purchased: true, dismissed: false, plan: null });

    const result = await runWorkoutReview({
      user: { id: "u1" },
      profile: { sport: "run" },
      planWeek: [{ week: 1, sessions: [] }],
      weekCurrent: 1,
      durationWeeks: 4,
    });

    expect(requestCreditTopUp).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      kind: "ready",
      data: { summary: "Now it worked." },
      charged: 8,
    });
  });
});
