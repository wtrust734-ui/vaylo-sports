// ============================================================================
// PLAN TIMING, TESTED
// ----------------------------------------------------------------------------
// The estimate calibrates from recorded generation durations. What the tests
// have to prove: refusals never teach the estimate a lie (a fast 402 is not
// a generation time), the median of real successful runs IS used when there
// is enough of it, the screen's source label says which it is quoting, junk
// storage and junk inputs cannot poison the number, and the shape-matching
// (one-week chunks vs two-week chunks) is the unit of comparison.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MIN_SAMPLES_FOR_CALIBRATION,
  clearPlanGenerationHistory,
  estimatePlanSeconds,
  planGenerationHistory,
  recordPlanGenerationMs,
} from "./planTiming";
import { expectedNutritionSeconds, expectedPlanSeconds } from "./planGeneration";

const SEM = 1000;

const seedRuns = (kind: "training" | "nutrition", weeks: number, msRuns: number[]) => {
  msRuns.forEach((ms, i) => {
    recordPlanGenerationMs({ kind, weeks, ms, outcome: "ok", at: Date.now() + i });
  });
};

beforeEach(() => {
  clearPlanGenerationHistory();
});

afterEach(() => {
  clearPlanGenerationHistory();
});

describe("plan timing history", () => {
  it("records a real generation and can read it back", () => {
    recordPlanGenerationMs({ kind: "training", weeks: 4, ms: 30 * SEM, outcome: "ok" });
    const history = planGenerationHistory("training");
    expect(history).toHaveLength(1);
    expect(history[0].weeks).toBe(4);
    expect(history[0].ms).toBe(30 * SEM);
    expect(history[0].outcome).toBe("ok");
  });

  it("drops garbage: impossible durations, impossible weeks, junk outcomes", () => {
    // A generation under the floor is a refusal, not work; over the ceiling is
    // a hung or sleep-killed round trip. Neither says anything about waits.
    recordPlanGenerationMs({ kind: "training", weeks: 4, ms: 500, outcome: "ok" });
    recordPlanGenerationMs({ kind: "training", weeks: 4, ms: 20 * 60 * SEM, outcome: "ok" });
    recordPlanGenerationMs({ kind: "training", weeks: 400, ms: 30 * SEM, outcome: "ok" });
    recordPlanGenerationMs({ kind: "training", weeks: 4, ms: 0, outcome: "ok" });
    expect(planGenerationHistory("training")).toHaveLength(0);
  });

  it("keeps a bounded window, newest-wins, sorted oldest first", () => {
    for (let i = 0; i < 20; i++) {
      recordPlanGenerationMs({ kind: "training", weeks: 4, ms: (20 + i) * SEM, outcome: "ok" });
    }
    const history = planGenerationHistory("training");
    expect(history.length).toBeLessThanOrEqual(14);
    for (let i = 1; i < history.length; i++) {
      expect(history[i].at).toBeGreaterThanOrEqual(history[i - 1].at);
    }
    // Newest samples survive the cap — the estimate reflects recent provider
    // behaviour, not the app's first week ever.
    expect(history[history.length - 1].ms).toBe((20 + 19) * SEM);
  });
});

describe("the calibrated estimate", () => {
  it("is the model constant when there is no history", () => {
    const estimate = estimatePlanSeconds("training", 4);
    expect(estimate.source).toBe("model");
    expect(estimate.seconds).toBe(expectedPlanSeconds(4));
  });

  it("quotes the nutrition model, not the training one, for meal plans", () => {
    // The kind is part of the prior: a week of meals is less work than a week
    // of training, and quoting the training constant made the wait screen
    // promise nearly double the time the plan takes.
    const estimate = estimatePlanSeconds("nutrition", 4);
    expect(estimate.source).toBe("model");
    expect(estimate.seconds).toBe(expectedNutritionSeconds(4));
    expect(estimate.seconds).toBeLessThan(expectedPlanSeconds(4));
  });

  it("requires a believable number of samples before it substitutes its judgement", () => {
    for (let i = 1; i < MIN_SAMPLES_FOR_CALIBRATION; i++) {
      clearPlanGenerationHistory();
      seedRuns("training", 4, Array(i).fill(60 * SEM));
      expect(estimatePlanSeconds("training", 4).source).toBe("model");
    }
    clearPlanGenerationHistory();
    seedRuns("training", 4, [60 * SEM, 60 * SEM, 60 * SEM]);
    expect(estimatePlanSeconds("training", 4).source).toBe("history");
  });

  it("calibrates to the median of successful runs and labels it 'history'", () => {
    // Three runs: the median of 28/30/90 is 30 — a slow outlier must not pull
    // the whole estimate behind it.
    seedRuns("training", 4, [28 * SEM, 30 * SEM, 90 * SEM]);
    const estimate = estimatePlanSeconds("training", 4);
    expect(estimate.source).toBe("history");
    expect(estimate.seconds).toBe(30);
    expect(estimate.samples).toBe(3);
  });

  it("never lets refusals teach a lie: failed fast round trips are not generation time", () => {
    // Suppose the provider is having a slow day (60s a plan) and the athlete
    // triggers three throttle refusals in between (2s each). The recorded
    // history is five round trips; the estimate must still read 60.
    for (const ms of [2 * SEM, 2 * SEM, 60 * SEM, 2 * SEM, 60 * SEM, 58 * SEM]) {
      recordPlanGenerationMs({ kind: "training", weeks: 4, ms, outcome: ms < 10 * SEM ? "failed" : "ok" });
    }
    const estimate = estimatePlanSeconds("training", 4);
    expect(estimate.source).toBe("history");
    expect(estimate.seconds).toBe(60);
  });

  it("compares like for like: chunk shape, not total length", () => {
    // The server's wall clock tracks the slowest CALL. A one-week-chunk plan
    // (≤12 wks) and another (also ≤12) are the same shape; a 24-week plan
    // arrived at differently (2-week chunks) must not calibrate the 4-week
    // estimate.
    seedRuns("training", 24, [120 * SEM, 118 * SEM, 122 * SEM]); // 2-week chunks
    const estimate = estimatePlanSeconds("training", 4); // 1-week chunks
    expect(estimate.source).toBe("model");
    // …while a same-shape history does calibrate.
    seedRuns("training", 6, [40 * SEM, 40 * SEM, 40 * SEM]);
    expect(estimatePlanSeconds("training", 4).source).toBe("history");
  });

  it("scales the per-week merge term only upward from the recorded length", () => {
    // Median recorded run was 4 weeks at 30s. A 12-week request has a slightly
    // larger merge/payload bill, so a nudge upward is right — but a 2-week
    // request does not claim to be FASTER than anything measured: the floor
    // of the recorded reality is the fallback.
    seedRuns("training", 4, [30 * SEM, 30 * SEM, 30 * SEM]);
    expect(estimatePlanSeconds("training", 12).seconds).toBeGreaterThan(30);
    expect(estimatePlanSeconds("training", 2).seconds).toBe(30);
  });

  it("is bounded by the same caps as the model, whatever the history says", () => {
    seedRuns("training", 52, [55 * SEM, 56 * SEM, 54 * SEM]);
    const estimate = estimatePlanSeconds("training", 52);
    expect(estimate.seconds).toBeLessThanOrEqual(90);
    expect(estimate.seconds).toBeGreaterThanOrEqual(12);
  });

  it("survives junk inputs and cannot be poisoned", () => {
    seedRuns("training", 4, [30 * SEM, 30 * SEM, 30 * SEM]);
    for (const bad of [NaN, 0, -4, Infinity]) {
      const estimate = estimatePlanSeconds("training", bad as number);
      expect(Number.isFinite(estimate.seconds)).toBe(true);
      expect(estimate.seconds).toBeGreaterThan(0);
    }
  });

  it("nutrition history does not calibrate training, and the storage is shared", () => {
    seedRuns("nutrition", 4, [50 * SEM, 50 * SEM, 50 * SEM]);
    expect(estimatePlanSeconds("training", 4).source).toBe("model");
    expect(estimatePlanSeconds("nutrition", 4).source).toBe("history");
  });
});
