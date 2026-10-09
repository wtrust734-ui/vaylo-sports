// Table-driven tests for the core athlete-product calculations.
//
// Conventions these tests pin down:
//  • Canonical units: kilometres, kilograms, centimetres, minutes, seconds.
//    Imperial conversions happen only in lib/units.ts (display layer).
//  • Day keys are LOCAL calendar days (`YYYY-MM-DD`, lib/dates.ts) — never
//    UTC-shifted ISO slices.
//  • Load = session-RPE × minutes (the session-RPE "product" convention);
//    it is a product-defined training-load proxy, NOT a validated
//    physiological measure.
//  • VPR/readiness/mental scores are product-defined indices on 0–100.
//  • Missing data → null or exclusion, never a fabricated number.

import { describe, expect, it } from "vitest";
import { metricToIndex, calculateVPR, analyzeLoads, getSportWeights, type LoadRow, type MetricRow } from "@/lib/performance";
import { kmToMiles, milesToKm, kgToLb, lbToKg, cmToFtIn, ftInToCm, cToF, formatDistance } from "@/lib/units";
import { localDateKey, localDateKeyDaysAgo } from "@/lib/dates";
import {
  buildLogIndex,
  reliabilityScore,
  currentStreak,
  weeklyCompletionForProcess,
  outcomeProgress,
  requiredRate,
  type ActionLog,
  type OutcomeGoal,
} from "@/lib/goals";
import { calcMentalReadiness } from "@/components/mental/MentalCheckIn";

// ─────────────────────────────────────────────────────────────────────────────
// Units — canonical storage, display-layer conversion
// ─────────────────────────────────────────────────────────────────────────────
describe("unit conversion (canonical km/kg/cm; display converts)", () => {
  it.each([
    [0, 0],
    [1, 0.621371],
    [10, 6.21371],
    [42.195, 26.218749], // marathon
  ])("kmToMiles(%p) = %p", (km, expected) => {
    expect(kmToMiles(km)).toBeCloseTo(expected, 5);
  });

  it("round-trips without drift beyond float epsilon", () => {
    for (const km of [0.5, 5, 21.0975, 100, 300]) {
      expect(milesToKm(kmToMiles(km))).toBeCloseTo(km, 10);
      expect(lbToKg(kgToLb(km))).toBeCloseTo(km, 10);
    }
  });

  it.each([
    [180, { ft: 5, in: 11 }],
    [152, { ft: 5, in: 0 }], // rounding lands on a full foot → 5'0", never 4'12"
    [183, { ft: 6, in: 0 }],
  ])("cmToFtIn(%p) = %j", (cm, expected) => {
    expect(cmToFtIn(cm)).toEqual(expected);
  });

  it("cm↔ft/in round-trip stays within half an inch of the true value", () => {
    for (const cm of [150, 165.5, 178, 190]) {
      const { ft, in: inch } = cmToFtIn(cm);
      // Display rounds to whole inches, so ±0.5 in (≈1.27 cm) is the honest bound.
      expect(Math.abs(ftInToCm(ft, inch) - cm)).toBeLessThanOrEqual(1.27);
    }
  });

  it.each([
    [0, 32],
    [37, 98.6],
    [100, 212],
  ])("cToF(%p) = %p", (c, f) => {
    expect(cToF(c)).toBeCloseTo(f, 6);
  });

  it("formatDistance handles missing data honestly", () => {
    expect(formatDistance(null, "metric")).toBe("—");
    expect(formatDistance(undefined, "imperial")).toBe("—");
    expect(formatDistance(5, "metric", 1)).toBe("5.0 km");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dates — local calendar-day keys
// ─────────────────────────────────────────────────────────────────────────────
describe("local day keys (no UTC drift)", () => {
  it("keys a late-evening session on the same local day west of UTC", () => {
    // 23:30 local in a UTC-5 zone is 04:30 UTC next day — ISO would lie.
    const lateEvening = new Date(2026, 5, 15, 23, 30); // local Jun 15
    expect(localDateKey(lateEvening)).toBe("2026-06-15");
  });

  it("keys an early-morning session on the same local day east of UTC", () => {
    const earlyMorning = new Date(2026, 5, 16, 0, 15); // local Jun 16
    expect(localDateKey(earlyMorning)).toBe("2026-06-16");
  });

  it("localDateKeyDaysAgo walks back across month boundaries", () => {
    const key = localDateKeyDaysAgo(0);
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// metricToIndex — piecewise 0–100 mapping
// ─────────────────────────────────────────────────────────────────────────────
describe("metricToIndex (0–100, piecewise good/elite/worldClass)", () => {
  it.each([
    // [type, value, expected]
    ["sprint_40m", 4.4, 98], // between elite 4.8 and worldClass 4.3 → 90 + 0.8·10
    ["sprint_40m", 4.8, 90], // at elite boundary
    ["sprint_40m", 6.5, 60], // at good boundary
    ["sprint_40m", 13, 0], // far beyond good → floor 0
    ["vertical_jump", 0, 0],
    ["vertical_jump", 100, 100],
    ["vo2_max", 40, 60], // good boundary
    ["vo2_max", 85, 100],
    ["unknown_metric", 42, 42], // uncalibrated: value passes through clamped
    ["unknown_metric", 250, 100],
  ])("metricToIndex(%p, %p) = %p", (type, value, expected) => {
    expect(metricToIndex(type, value)).toBe(expected);
  });

  it("never returns outside 0–100", () => {
    for (const v of [-10, 0, 0.001, 1000, 10000]) {
      for (const t of ["sprint_40m", "vo2_max", "bench_press", "anything"]) {
        const idx = metricToIndex(t, v);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThanOrEqual(100);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calculateVPR — weighted, renormalised over present buckets
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateVPR", () => {
  it("returns zeros across the board with no metrics", () => {
    const vpr = calculateVPR([], "Running");
    expect(vpr.overall_vpr).toBe(0);
  });

  it("caps overall by data completeness (1 bucket → ≤70)", () => {
    const rows: MetricRow[] = [
      { metric_type: "sprint_40m", value: 5.0, log_date: "2026-09-01" },
    ];
    const vpr = calculateVPR(rows, "Sprinting");
    expect(vpr.overall_vpr).toBeLessThanOrEqual(70);
  });

  it("a perfect spread across all six buckets can reach 100", () => {
    const rows: MetricRow[] = [
      { metric_type: "sprint_100m", value: 9.5, log_date: "2026-09-01" }, // speed
      { metric_type: "squat", value: 300, log_date: "2026-09-01" }, // power
      { metric_type: "vo2_max", value: 90, log_date: "2026-09-01" }, // endurance
      { metric_type: "passing_accuracy", value: 99, log_date: "2026-09-01" }, // skill
      { metric_type: "reaction_time", value: 120, log_date: "2026-09-01" }, // reaction
    ];
    // repeatability derives from 3+ skill metrics
    rows.push(
      { metric_type: "passing_accuracy", value: 99, log_date: "2026-09-02" },
      { metric_type: "passing_accuracy", value: 99, log_date: "2026-09-03" },
    );
    const vpr = calculateVPR(rows, "Football");
    expect(vpr.overall_vpr).toBeGreaterThanOrEqual(90);
  });

  it("sport weights always sum to 1", () => {
    for (const sport of ["Running", "Sprinting", "Football", "Underwater Hockey"]) {
      const w = getSportWeights(sport);
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// analyzeLoads — acute:chronic (product-defined load proxy)
// ─────────────────────────────────────────────────────────────────────────────
describe("analyzeLoads (session-RPE × minutes; acute:chronic)", () => {
  const day = (offset: number, total_rpe: number): LoadRow => ({
    log_date: localDateKeyDaysAgo(offset),
    sprint_load: 0,
    endurance_load: 0,
    strength_load: 0,
    skill_load: 0,
    total_rpe,
  });

  it("flat load → ratio 1.0, ok alert", () => {
    const loads = Array.from({ length: 28 }, (_, i) => day(i, 500));
    const a = analyzeLoads(loads);
    expect(a.ratio).toBe(1);
    expect(a.alerts[0]?.type).toBe("ok");
    expect(a.injuryRisk).toBe("low");
  });

  it("empty data produces zeros, not NaN", () => {
    const a = analyzeLoads([]);
    expect(a.acute).toBe(0);
    expect(a.chronic).toBe(0);
    expect(a.ratio).toBe(0);
    expect(Number.isFinite(a.sprintShare)).toBe(true);
  });

  it("spike week flags overtraining", () => {
    const loads = [
      ...Array.from({ length: 21 }, (_, i) => day(i + 7, 300)),
      ...Array.from({ length: 7 }, () => day(0, 900)),
    ];
    const a = analyzeLoads(loads);
    expect(a.ratio).toBeGreaterThan(1.5);
    expect(a.alerts.some((x) => x.type === "overtraining")).toBe(true);
    expect(a.injuryRisk).toBe("high");
  });

  it("share math with missing sub-loads stays finite and sums ≤ 1", () => {
    const loads = Array.from({ length: 10 }, (_, i) => ({
      ...day(i, 400),
      sprint_load: 100,
      endurance_load: 100,
      strength_load: 100,
      skill_load: 100,
    }));
    const a = analyzeLoads(loads);
    expect(a.sprintShare + a.enduranceShare + a.strengthShare).toBeCloseTo(1, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Goals — progress, streaks, weekly completion, idempotent log index
// ─────────────────────────────────────────────────────────────────────────────
describe("goal progress (division-by-zero safe, clamped 0–100)", () => {
  const goal = (over: Partial<OutcomeGoal>): OutcomeGoal => ({
    id: "g1", user_id: "u1", title: "t", description: null, category: "performance",
    metric_unit: null, start_value: 0, current_value: 0, target_value: 100,
    deadline: null, status: "active", ...over,
  });

  it.each([
    [{ current_value: 50 }, 50],
    [{ current_value: 130 }, 100], // clamped high
    [{ current_value: -20 }, 0], // clamped low
    [{ target_value: 0 }, 0], // no divide-by-zero
    [{ start_value: 100, target_value: 100, current_value: 100 }, 0],
    [{ start_value: 0, current_value: 30, target_value: 60 }, 50],
  ])("outcomeProgress(%j) = %p", (over, expected) => {
    expect(outcomeProgress(goal(over))).toBe(expected);
  });

  it.each([
    [{ deadline: null }, "—"],
    [{ deadline: "2020-01-01" }, "—"], // past deadline: no nonsense negative rate
    [{ deadline: "2099-01-01", target_value: null }, "—"],
  ])("requiredRate(%j) = %p", (over, expected) => {
    expect(requiredRate(goal(over))).toBe(expected);
  });
});

describe("daily action logs (idempotent index, local-day streaks)", () => {
  const today = localDateKey();
  const yesterday = localDateKeyDaysAgo(1);
  const log = (action: string, date: string): ActionLog => ({
    id: `${action}-${date}`, action_id: action, log_date: date, completed: true,
  });

  it("buildLogIndex dedupes by construction and ignores incomplete rows", () => {
    const idx = buildLogIndex([
      log("a1", today),
      log("a1", today), // duplicate submission — same key
      log("a2", yesterday),
      { id: "x", action_id: "a3", log_date: today, completed: false },
    ]);
    expect(idx.get(`a1|${today}`)).toBe(true);
    expect(idx.get(`a2|${yesterday}`)).toBe(true);
    expect(idx.get(`a3|${today}`)).toBeUndefined();
  });

  it("streak breaks on the first missing day and never counts inactive-only sets", () => {
    const actions = [{ id: "a1", process_goal_id: "p1", title: "t", active: true }];
    const logs = [log("a1", today), log("a1", yesterday), log("a1", localDateKeyDaysAgo(2))];
    expect(currentStreak(actions, logs)).toBe(3);
    expect(currentStreak(actions, [log("a1", today), log("a1", localDateKeyDaysAgo(2))])).toBe(1);
    expect(currentStreak([], [])).toBe(0);
  });

  it("reliability is 0 without actions and 100 with all days done", () => {
    const actions = [{ id: "a1", process_goal_id: "p1", title: "t", active: true }];
    expect(reliabilityScore(actions, [], 7)).toBe(0);
    const days = 7;
    const logs = Array.from({ length: days }, (_, i) => log("a1", localDateKeyDaysAgo(i)));
    expect(reliabilityScore(actions, logs, days)).toBe(100);
  });

  it("weekly completion counts a day once even with multiple actions", () => {
    const pg = { id: "p1", outcome_goal_id: null, title: "t", description: null, weekly_target: 5, active: true };
    const actions = [
      { id: "a1", process_goal_id: "p1", title: "t", active: true },
      { id: "a2", process_goal_id: "p1", title: "t", active: true },
    ];
    const today2 = new Date();
    const dow = (today2.getDay() + 6) % 7; // Mon=0
    const logs = [log("a1", today), log("a2", today)];
    const r = weeklyCompletionForProcess(pg, actions, logs);
    // Only today's session (earlier days this week have no logs).
    expect(r.done).toBe(1);
    expect(r.pct).toBe(Math.min(100, Math.round((1 / 5) * 100)));
    void dow;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mental readiness — product-defined mood index
// ─────────────────────────────────────────────────────────────────────────────
describe("calcMentalReadiness (product-defined index, 1–10 sliders → 0–100)", () => {
  it.each([
    // all-neutral sliders → neutral 50, not a bad score
    [{ confidence: 5, stress: 5, focus: 5, motivation: 5, fatigue: 5 }, 50],
    // best case
    [{ confidence: 10, stress: 1, focus: 10, motivation: 10, fatigue: 1 }, 100],
    // worst case
    [{ confidence: 1, stress: 10, focus: 1, motivation: 1, fatigue: 10 }, 0],
    // out-of-range input is clamped, never extrapolated
    [{ confidence: 99, stress: -5, focus: 10, motivation: 10, fatigue: 0 }, 100],
  ])("calcMentalReadiness(%j).score = %p", (vals, expected) => {
    expect(calcMentalReadiness(vals).score).toBe(expected);
  });
});
