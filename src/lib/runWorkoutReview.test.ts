import { beforeEach, describe, expect, it, vi } from "vitest";

// The Supabase client is mocked through a mutable holder so each test can set
// the workout log it will read and the edge-function answers it will receive.
// `invokeResults` is a queue: the top-up retry path calls the edge function
// again, and the queue is how the second answer is staged.
const mock = vi.hoisted(() => ({
  workouts: [] as Array<Record<string, unknown>>,
  invokeResults: [] as Array<{ data: unknown; error: unknown }>,
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
        invoke: () => Promise.resolve(mock.invokeResults.shift() ?? { data: null, error: null }),
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
