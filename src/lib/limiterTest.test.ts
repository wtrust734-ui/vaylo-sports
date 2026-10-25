import { describe, expect, it } from "vitest";
import { LIMITER_QUESTIONS, analyzeLimiterTest, recoveryDayOptions, type LimiterAnswer } from "./limiterTest";
import type { MetricRow } from "./performance";

const allAnswers = (ratings: Record<string, number>): LimiterAnswer => {
  const out: LimiterAnswer = {};
  for (const q of LIMITER_QUESTIONS) if (ratings[q.id] != null) out[q.id] = ratings[q.id];
  return out;
};

const metric = (metric_type: string, value: number): MetricRow => ({
  metric_type,
  value,
  log_date: "2026-09-28",
});

describe("recoveryDayOptions", () => {
  it("offers exactly one full rest day when six training days are chosen", () => {
    // Reported: choosing 6 free days then left "None / 1 / 2 / 3 full rest" to
    // answer, which can total nine days in a seven-day week.
    expect(recoveryDayOptions(6)).toEqual([1]);
  });

  it("never offers more rest days than the week has left", () => {
    for (let trainingDays = 0; trainingDays <= 7; trainingDays += 1) {
      const options = recoveryDayOptions(trainingDays);
      for (const rest of options) {
        expect(rest, `${trainingDays} training + ${rest} rest`).toBeLessThanOrEqual(7 - trainingDays);
        expect(trainingDays + rest, `${trainingDays} + ${rest}`).toBeLessThanOrEqual(7);
      }
    }
  });

  it("keeps the usual answers when the week has room", () => {
    expect(recoveryDayOptions(5)).toEqual([0, 1, 2]);
    expect(recoveryDayOptions(2)).toEqual([0, 1, 2, 3]);
    expect(recoveryDayOptions(7)).toEqual([0]);
  });
});

describe("analyzeLimiterTest", () => {
  it("ranks only answered categories and never invents a mid-point default", () => {
    // Answer just two questions.
    const answers = allAnswers({ sprint_ability: 3, strength: 9 });
    const result = analyzeLimiterTest(answers, [], "Football");
    const names = result.limiters.map((l) => l.name);
    expect(names).toContain("speed");
    expect(names).toContain("strength");
    expect(result.answered).toBe(2);
    // A category with no answer must not appear anywhere in the ranking.
    expect(names).not.toContain("endurance");
    expect(names).not.toContain("mobility");
    // Self-rating 3/10 → 30/100.
    const speed = result.limiters.find((l) => l.name === "speed");
    expect(speed?.score).toBe(3);
    expect(speed?.evidence).toBe("self-rating only");
  });

  it("blends logged metrics over self-ratings and labels the evidence", () => {
    // Self-rate speed as weak (2), but log an elite 40m sprint (4.5s → index ~96).
    const answers = allAnswers({ sprint_ability: 2, long_effort: 5 });
    const result = analyzeLimiterTest(
      answers,
      [metric("sprint_40m", 4.5)],
      "Sprinting",
    );
    const speed = result.limiters.find((l) => l.name === "speed");
    expect(speed).toBeDefined();
    expect(speed?.evidence).toBe("logged metric + self-rating");
    // 0.7 objective + 0.3 self → far above the raw self-rating of 2.
    expect(speed!.score).toBeGreaterThan(4);
    expect(result.objectiveCategories).toBe(1);
    expect(result.confidence).toContain("logged performance data");
  });

  it("uses recovery logs as objective evidence for the recovery category", () => {
    const answers = allAnswers({ recovery: 4, strength: 8 });
    const result = analyzeLimiterTest(
      answers,
      [],
      "Running",
      [{ readiness_score: 85 }, { readiness_score: 90 }],
    );
    const recovery = result.limiters.find((l) => l.name === "recovery");
    expect(recovery?.evidence).toBe("logged metric + self-rating");
    // (0.7×87.5 + 0.3×40) / 10 ≈ 7.3 — not ranked first despite the low rating.
    expect(recovery!.score).toBeGreaterThan(5);
  });

  it("ignores invalid ratings instead of coercing them", () => {
    const answers: LimiterAnswer = { sprint_ability: 11, strength: 0, long_effort: 5 };
    const result = analyzeLimiterTest(answers, [], "Running");
    expect(result.answered).toBe(1);
    expect(result.limiters.map((l) => l.name)).toEqual(["endurance"]);
  });

  it("weights limiter priority by sport profile", () => {
    // Same weak self-rating (3/10) for speed: a sprinter's priority must far
    // exceed a marathon-style endurance profile's priority for that category.
    const answers = allAnswers({ sprint_ability: 3, long_effort: 3 });
    const sprinter = analyzeLimiterTest(answers, [], "Sprinting");
    const runner = analyzeLimiterTest(answers, [], "Running");
    const sp = sprinter.limiters.find((l) => l.name === "speed")!.priority;
    const rp = runner.limiters.find((l) => l.name === "speed")!.priority;
    expect(sp).toBeGreaterThan(rp);
  });

  it("returns a self-ratings-only confidence string when no metrics exist", () => {
    const result = analyzeLimiterTest(allAnswers({ sprint_ability: 5 }), [], "Tennis");
    expect(result.confidence).toContain("self-ratings only");
    expect(result.objectiveCategories).toBe(0);
  });
});
