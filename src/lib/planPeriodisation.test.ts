// ============================================================================
// The periodisation the plan generator computes itself. These are not cosmetic
// assertions: the skeleton is what the model is told to hit, and what the
// server stamps onto the plan afterwards, so a wrong week here is a wrong week
// in an athlete's training — a deload that never arrives, or a plan that drops
// volume half way through and never builds it back.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  ONE_WEEK_CHUNK_MAX_WEEKS,
  buildWeekSkeleton,
  chunkSkeleton,
  planChunkWeeks,
  skeletonContinuityNote,
  skeletonTargetLines,
} from "../../supabase/functions/_shared/planPeriodisation";

describe("the week skeleton", () => {
  it("deloads on the caps cycle and nowhere else", () => {
    const weeks = buildWeekSkeleton({ duration: 8, deloadEvery: 4, level: "intermediate", sessionsPerWeek: 4 });

    expect(weeks.filter((w) => w.isDeload).map((w) => w.week)).toEqual([4, 8]);
    expect(weeks.every((w) => w.isDeload === (w.week % 4 === 0))).toBe(true);
  });

  it("honours a tighter deload cycle for an athlete the caps place on one", () => {
    // Under-18 and masters athletes get deloadEvery: 3 from getAgeCaps.
    const weeks = buildWeekSkeleton({ duration: 6, deloadEvery: 3, level: "beginner", sessionsPerWeek: 3 });
    expect(weeks.filter((w) => w.isDeload).map((w) => w.week)).toEqual([3, 6]);
  });

  it("never lets volume fall except on a deload", () => {
    const weeks = buildWeekSkeleton({ duration: 12, deloadEvery: 4, level: "advanced", sessionsPerWeek: 5 });

    let previous = 0;
    for (const week of weeks) {
      if (!week.isDeload) {
        expect(week.volumePct, `week ${week.week} is below the week before it`).toBeGreaterThanOrEqual(previous);
        previous = week.volumePct;
      } else {
        expect(week.volumePct).toBeLessThan(previous);
        expect(week.intensityPct).toBeLessThan(100);
      }
    }
  });

  it("gives a deload fewer sessions than a normal week", () => {
    const weeks = buildWeekSkeleton({ duration: 8, deloadEvery: 4, level: "intermediate", sessionsPerWeek: 3 });
    const deload = weeks.find((w) => w.isDeload)!;

    expect(deload.sessions).toBe(2);
    // ...and never fewer than one, whatever the athlete's week looks like.
    const single = buildWeekSkeleton({ duration: 4, deloadEvery: 4, sessionsPerWeek: 1 });
    expect(single.find((w) => w.isDeload)!.sessions).toBe(1);
  });

  it("spends a beginner's first block on technique and gives an advanced week a peak", () => {
    const beginner = buildWeekSkeleton({ duration: 4, level: "beginner", sessionsPerWeek: 3 });
    const advanced = buildWeekSkeleton({ duration: 4, level: "advanced", sessionsPerWeek: 5 });

    expect(beginner[0].focus).toBe("Technique");
    expect(advanced.map((w) => w.focus)).toContain("Peak");
  });

  it("is monotonic to exactly the plan length, for any length the API accepts", () => {
    for (const duration of [1, 2, 3, 7, 12, 52]) {
      const weeks = buildWeekSkeleton({ duration, deloadEvery: 4, level: "intermediate", sessionsPerWeek: 4 });
      expect(weeks).toHaveLength(duration);
      expect(weeks.map((w) => w.week)).toEqual(Array.from({ length: duration }, (_, i) => i + 1));
    }
  });

  it("treats a nonsensical plan as the shortest sane one instead of crashing", () => {
    // The duration arrives from a request body, so it is attacker-controlled.
    const weeks = buildWeekSkeleton({ duration: Number.NaN, level: "nonsense", sessionsPerWeek: 99 });
    expect(weeks.length).toBeGreaterThanOrEqual(1);
    expect(weeks.every((w) => w.sessions <= 7)).toBe(true);
    expect(buildWeekSkeleton({ duration: -4 }).length).toBeGreaterThanOrEqual(1);
    expect(buildWeekSkeleton({ duration: 9999 }).length).toBeLessThanOrEqual(52);
  });
});

describe("splitting the skeleton for parallel writing", () => {
  it("cuts the plan into two-week pieces", () => {
    const weeks = buildWeekSkeleton({ duration: 6 });
    const chunks = chunkSkeleton(weeks);

    expect(chunks.map((c) => c.map((w) => w.week))).toEqual([[1, 2], [3, 4], [5, 6]]);
    // Every week appears exactly once: a lost week is a plan the athlete paid
    // for and did not get.
    expect(chunks.flat()).toHaveLength(weeks.length);
  });

  it("keeps an odd final chunk rather than dropping it", () => {
    const chunks = chunkSkeleton(buildWeekSkeleton({ duration: 5 }));
    expect(chunks.map((c) => c.length)).toEqual([2, 2, 1]);
  });

  it("handles a single-week plan without producing an empty chunk", () => {
    expect(chunkSkeleton(buildWeekSkeleton({ duration: 1 }))).toHaveLength(1);
  });
});

describe("how long a plan is split into calls", () => {
  it("writes a week per call for every plan length an athlete picks", () => {
    for (const weeks of [1, 4, 8, 12]) {
      expect(planChunkWeeks(weeks), `${weeks} weeks`).toBe(1);
    }
  });

  it("falls back to two weeks per call only beyond the ceiling", () => {
    for (const weeks of [13, 24, 52]) {
      expect(planChunkWeeks(weeks), `${weeks} weeks`).toBe(2);
    }
  });

  it("hands out the chunk size it claims, for every accepted length", () => {
    // The chunk size and the split have to agree: a rule that returns 1 while
    // the splitter still uses 2 would quietly undo the whole change.
    for (const weeks of [1, 2, 12, 13, 52]) {
      const skeleton = buildWeekSkeleton({ duration: weeks });
      const chunks = chunkSkeleton(skeleton, planChunkWeeks(weeks));

      expect(chunks.flat()).toHaveLength(weeks);
      expect(Math.max(...chunks.map((c) => c.length))).toBe(planChunkWeeks(weeks));
    }
  });

  it("treats a nonsensical length as a short plan, not as an unbounded one", () => {
    for (const bad of [Number.NaN, -3, 0, 1e9]) {
      expect([1, 2]).toContain(planChunkWeeks(bad as number));
    }
    expect(ONE_WEEK_CHUNK_MAX_WEEKS).toBeLessThanOrEqual(13);
  });
});

describe("what a chunk is told", () => {
  const all = buildWeekSkeleton({ duration: 6, deloadEvery: 4, level: "intermediate", sessionsPerWeek: 4 });
  const own = chunkSkeleton(all)[1]; // weeks 3-4

  it("lists every week, and marks the caller's own", () => {
    const lines = skeletonTargetLines(all, own);

    expect(lines).toContain("Week 1");
    expect(lines).toContain("Week 6");
    expect(lines.match(/THIS REQUEST/g)).toHaveLength(2);
    expect(lines).toContain("Week 3  <-- THIS REQUEST");
    // The deload is visible in its own line, because that is the week the model
    // most needs to write differently.
    expect(lines).toContain("Week 4  <-- THIS REQUEST (Deload, deload)");
  });

  it("says out loud that the neighbouring weeks belong to other calls", () => {
    const note = skeletonContinuityNote(own, all);

    expect(note).toMatch(/at the same time/i);
    expect(note).toMatch(/do not write them/i);
    // It names where this slice sits, at both ends.
    expect(note).toContain("week 2");
    expect(note).toContain("week 5");
  });

  it("does not claim continuity that does not exist at the edges", () => {
    // The first chunk has no week before it, so it may only look forward...
    const first = skeletonContinuityNote(chunkSkeleton(all)[0], all);
    expect(first).toContain("starts from");
    expect(first).not.toContain("ends at");

    // ...and the last chunk only backwards. Naming a week that does not exist
    // would tell the model to continue from a number nobody is writing.
    const last = skeletonContinuityNote(chunkSkeleton(all)[2], all);
    expect(last).toContain("week 4 (Deload, deload) ends at");
    expect(last).not.toContain("starts from");
  });
});
