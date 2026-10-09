import { describe, expect, it } from "vitest";

import {
  MIN_EXPECTED_SECONDS,
  expectedPlanSeconds,
  planChunkCount,
  planChunkWeeks,
} from "./planGeneration";
import {
  ONE_WEEK_CHUNK_MAX_WEEKS,
  PLAN_CHUNK_WEEKS,
  planChunkWeeks as serverChunkWeeks,
} from "../../supabase/functions/_shared/planPeriodisation";

describe("the plan-generation estimate", () => {
  it("grows with the plan, but far slower than the weeks do", () => {
    const four = expectedPlanSeconds(4);
    const twelve = expectedPlanSeconds(12);

    // 3× the weeks must be clearly less than 3× the wait: twelve calls run at
    // the same time as each other, so only the merge and the payload grow.
    expect(twelve).toBeGreaterThan(four);
    expect(twelve / four).toBeLessThan(2.5);
  });

  it("does not let the wait grow with the NUMBER of calls", () => {
    // The server writes one week per call, twelve calls in flight. A plan with
    // four times the calls is not four times the wait — the estimate has to
    // track the slowest call, which is the same size in both cases.
    const six = expectedPlanSeconds(6);
    const twentyFour = expectedPlanSeconds(24);

    expect(twentyFour).toBeGreaterThan(six);
    // Quadruple the calls, nowhere near quadruple the wait — the bar must not
    // count calls as if they were queued.
    expect(twentyFour / six).toBeLessThan(2);
  });

  it("never claims a plan is instant", () => {
    expect(expectedPlanSeconds(1)).toBeGreaterThanOrEqual(MIN_EXPECTED_SECONDS);
    expect(expectedPlanSeconds(0)).toBeGreaterThanOrEqual(MIN_EXPECTED_SECONDS);
  });

  it("stops growing before it would promise an unrealistic wait", () => {
    // 52 weeks is the server's own maximum; the screen must not show a
    // multi-minute countdown it cannot honour.
    expect(expectedPlanSeconds(52)).toBeLessThanOrEqual(90);
  });

  it("survives junk input from a half-filled wizard", () => {
    for (const bad of [NaN, -5, 1e9, Infinity]) {
      const value = expectedPlanSeconds(bad as number);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(90);
    }
  });

  it("survives junk in the chunk size, which is an argument too", () => {
    // `Math.max(1, Math.floor(NaN))` is NaN, and one NaN turned the whole
    // estimate — and the block count — into NaN: a bar rendering "NaN%" beside
    // "~NaNs left". The chunk size falls back to the server's own rule instead.
    for (const bad of [NaN, -1, 0, Infinity, -Infinity]) {
      const estimate = expectedPlanSeconds(8, bad as number);
      expect(Number.isFinite(estimate), `estimate for chunkWeeks=${bad}`).toBe(true);
      expect(estimate).toBeGreaterThanOrEqual(MIN_EXPECTED_SECONDS);
      expect(estimate).toBeLessThanOrEqual(90);
      expect(planChunkCount(8, bad as number)).toBeGreaterThan(0);
    }

    // A junk chunk size is the same as no chunk size: the server's rule wins.
    expect(expectedPlanSeconds(8, NaN)).toBe(expectedPlanSeconds(8));
    expect(planChunkCount(24, NaN)).toBe(planChunkCount(24));
  });

  it("counts the work in the same pieces the server asks for", () => {
    // A week per call up to the server's call ceiling, two weeks beyond it.
    expect(planChunkCount(1)).toBe(1);
    expect(planChunkCount(2)).toBe(2);
    expect(planChunkCount(3)).toBe(3);
    expect(planChunkCount(8)).toBe(8);
    expect(planChunkCount(12)).toBe(12);
    expect(planChunkCount(24)).toBe(12);
    expect(planChunkCount(52)).toBe(26);
  });

  it("uses exactly the chunk size the server uses", () => {
    // The one drift this file can suffer: the client predicting a different
    // shape from the one `generate-plan` runs, which makes the bar a lie. The
    // server's own constants are imported here rather than restated.
    for (let weeks = 1; weeks <= 52; weeks++) {
      const expected = weeks <= ONE_WEEK_CHUNK_MAX_WEEKS ? 1 : PLAN_CHUNK_WEEKS;
      expect(planChunkWeeks(weeks), `${weeks} weeks`).toBe(expected);
      expect(planChunkWeeks(weeks), `${weeks} weeks (server)`).toBe(serverChunkWeeks(weeks));
    }
  });
});
