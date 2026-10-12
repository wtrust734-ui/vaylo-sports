import { describe, expect, it } from "vitest";

import { buildWorkoutReviewDigest } from "./workoutReview";

describe("buildWorkoutReviewDigest", () => {
  it("puts actual workouts beside the current plan week and asks for the comparison", () => {
    const { digest, workoutCount } = buildWorkoutReviewDigest({
      workouts: [
        {
          title: "Run session",
          sport: "run",
          duration_minutes: 42,
          distance_km: 8.5,
          completed_at: "2026-10-09T07:00:00.000Z",
          notes: "Felt strong through 6km, faded on the last hill.",
        },
      ],
      planWeek: {
        week: 3,
        sessions: [{ day: 2, title: "Tempo run", type: "tempo", duration_minutes: 45 }],
      },
      weekCurrent: 3,
      durationWeeks: 8,
    });

    expect(workoutCount).toBe(1);
    expect(digest).toContain("2026-10-09: Run session");
    expect(digest).toContain("Current training plan: week 3 of 8");
    expect(digest).toContain("Day 2: Tempo run");
    expect(digest).toContain("Compare the logged workouts with the current plan week");
  });

  it("reports missing data instead of inventing it and stays within the prompt cap", () => {
    const { digest, workoutCount } = buildWorkoutReviewDigest({
      workouts: Array.from({ length: 30 }, (_, index) => ({
        title: `Session ${index + 1}`,
        completed_at: "2026-10-09T07:00:00.000Z",
        notes: "x".repeat(500),
      })),
      planWeek: null,
      weekCurrent: null,
    });

    // Only the 20 newest are kept, long notes are capped per line, and the
    // comparison ask survives truncation because it is reserved first.
    expect(workoutCount).toBe(20);
    expect(digest).not.toContain("Session 21");
    expect(digest.length).toBeLessThanOrEqual(3400);
    expect(digest).toContain("… (log truncated)");
    expect(digest).toContain("Compare the logged workouts with the current plan week");
  });
});
