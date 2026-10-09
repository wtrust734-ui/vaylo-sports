// ============================================================================
// EXPLANATIONS — the contract every recommendation has to keep
// ----------------------------------------------------------------------------
// Phase 6's rule is that an important recommendation explains why, using the
// athlete's own data, in 2–5 bullets, without inventing anything and without
// medical certainty. Those are properties of the copy, so they are tested as
// properties of the copy: this file feeds every adapter a matrix of inputs and
// asserts the shape, the provenance, the honesty and the wording.
//
// The cases the specification names are here as named tests, because the point
// of the module is those exact situations: a reduced session, a holiday, a
// return-from-break week, a competition three days out, and the one where the
// app has to say it does not know.
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  INSUFFICIENT_SENTENCE,
  MAX_WHY,
  buildExplanation,
  confidenceLabel,
  explainAvailability,
  explainConsistency,
  explainDecision,
  explainGoalProximity,
  explainRebuild,
  explainWeek,
  explainWorkload,
  findMedicalCertainty,
  hasAnythingToSay,
  reasonSourceLabel,
  sortExplanations,
  type RecommendationExplanation,
} from "./explanations";
import type { AdjustmentDecision, Evidence, WeekDecision } from "./recoveryAdjust";
import type { AvailabilityAssessment, LifeEvent } from "./lifeEvents";
import type { BreakFacts, ProgressionStep } from "./adaptivePlan";

// ---------------------------------------------------------------------------
// Fixtures — built from the real shapes, not from mocks
// ---------------------------------------------------------------------------

const evidence = (text: string, source: Evidence["source"] = "recovery"): Evidence => ({ text, source });

const decision = (over: Partial<AdjustmentDecision> = {}): AdjustmentDecision => ({
  action: "reduce",
  date: "2026-10-06",
  title: "Threshold intervals",
  volumePct: 70,
  intensityPct: 80,
  evidence: [
    evidence("Your readiness was 44/100 this morning.", "recovery"),
    evidence("You logged 8 hours of sleep — below your usual.", "recovery"),
    evidence("Your load over the last 7 days is 24% above the 28 days before it.", "load"),
    evidence("You have a competition on 9 Oct, three days away.", "calendar"),
  ],
  headline: "Keep today easy so you can perform on Thursday.",
  uncertainty: null,
  blockedBy: null,
  ...over,
});

const weekDecision = (over: Partial<WeekDecision> = {}): WeekDecision => ({
  decisions: [decision()],
  volumeReductionPct: 30,
  explanation: "Consider reducing this week's volume by about 30%.",
  uncertainty: null,
  ...over,
});

const lifeEvent = (over: Partial<LifeEvent> = {}): LifeEvent => ({
  id: "evt-1",
  user_id: "user-1",
  start_date: "2026-09-14",
  end_date: "2026-09-20",
  event_type: "holiday",
  activity_level: "none",
  allow_training: "no",
  note: null,
  ...over,
});

const assessment = (over: Partial<AvailabilityAssessment> = {}): AvailabilityAssessment => ({
  adjustments: [],
  cancelled: [],
  lostKeySessions: [],
  explanation: null,
  ...over,
});

const breakFacts = (over: Partial<BreakFacts> = {}): BreakFacts => ({
  eventId: "evt-1",
  eventType: "holiday",
  startDate: "2026-09-14",
  endDate: "2026-09-20",
  days: 7,
  activityLevel: "none",
  allowTraining: "no",
  ...over,
});

const steps: ProgressionStep[] = [
  { back: 1, volumePct: 55, intensityPct: 65, focus: "rebuild" },
  { back: 2, volumePct: 75, intensityPct: 80, focus: "restore" },
];

/** Every explanation this file can produce, for the blanket scans below. */
const allExplanations = (): RecommendationExplanation[] => [
  explainDecision(decision()),
  explainDecision(decision({ action: "proceed", evidence: [] })),
  explainDecision(decision({ action: "blocked", blockedBy: "A medical note on your calendar", evidence: [evidence("You marked 6 Oct as no training.", "calendar")] })),
  explainDecision(decision({ action: "insufficient", evidence: [], uncertainty: INSUFFICIENT_SENTENCE })),
  explainWeek(weekDecision())!,
  explainAvailability(
    lifeEvent(),
    assessment({ cancelled: [{ sessionId: "s1", scheduled_date: "2026-09-15", title: "Long run", status: "cancelled_due_to_availability", lifeEventId: "evt-1", reason: "unavailable", important: true }] }),
  )!,
  explainRebuild({ facts: breakFacts(), steps, weekBack: 2, creditedDays: 3, youth: false, medical: false, competingSoon: false }),
  explainRebuild({ facts: breakFacts({ eventType: "injury" }), steps, weekBack: 1, creditedDays: 0, youth: true, medical: true, competingSoon: true }),
  explainGoalProximity({ goalTitle: "Run a sub-40 10K", daysRemaining: 21, percent: 62, status: "on_track", achievedMilestones: 3, totalMilestones: 5, nextMilestone: { title: "5K time trial under 20:30", targetDate: "2026-10-20" }, competition: { title: "County 10K", days: 3 } })!,
  explainWorkload({ recentDays: 28, recentLoad: 735, recentSessions: 14, priorLoad: 500, ratio: 1.47, band: "high" }),
  explainWorkload({ recentDays: 28, recentLoad: 120, recentSessions: 3, priorLoad: null, ratio: null, band: "unknown" }),
  explainConsistency({ completed: 10, planned: 12, percent: 83, targetPerWeek: 3, weeksConsidered: 4, weeksMeetingTarget: 3, excusedByBreak: 2 }),
  explainConsistency({ completed: 0, planned: 0, percent: 0, targetPerWeek: 3, weeksConsidered: 4, weeksMeetingTarget: 0 }),
];

// ---------------------------------------------------------------------------

describe("explainDecision — a session recommendation", () => {
  it("answers the specification's example with the numbers behind it", () => {
    // "Easy session recommended today" with reasons about recent intensity,
    // workload and how the athlete reported feeling.
    const explanation = explainDecision(decision());
    expect(explanation.headline).toBe("Keep today easy so you can perform on Thursday.");
    expect(explanation.why.length).toBeGreaterThanOrEqual(2);
    expect(explanation.why.length).toBeLessThanOrEqual(MAX_WHY);
    // Every bullet is a fact from the record, and says where it came from.
    expect(explanation.why.map((w) => w.text)).toContain("Your readiness was 44/100 this morning.");
    expect(explanation.why.map((w) => w.source)).toContain("recovery");
    expect(explanation.why.map((w) => w.source)).toContain("load");
    expect(explanation.tone).toBe("watch");
    expect(explanation.insufficient).toBe(false);
  });

  it("reports the athlete's own reasons verbatim rather than paraphrasing them", () => {
    // The screen must not be able to explain a decision differently from how
    // the rules made it, so the strings pass through untouched.
    const d = decision();
    const explanation = explainDecision(d);
    for (const item of d.evidence.slice(0, MAX_WHY)) {
      expect(explanation.why.map((w) => w.text)).toContain(item.text);
    }
  });

  it("says it does not know, in the specification's words, when the rules held back", () => {
    const explanation = explainDecision(
      decision({ action: "insufficient", evidence: [], headline: "Today's read", uncertainty: INSUFFICIENT_SENTENCE }),
    );
    expect(explanation.insufficient).toBe(true);
    expect(explanation.confidence).toBe("none");
    expect(explanation.rationale).toBe(INSUFFICIENT_SENTENCE);
    // Nothing invented to fill the space: no bullets claiming anything.
    expect(explanation.why).toEqual([]);
    expect(confidenceLabel(explanation.confidence)).toBe("Not enough information");
  });

  it("treats a hard constraint as a safety matter, not a judgement", () => {
    const explanation = explainDecision(
      decision({ action: "blocked", blockedBy: "A medical note on your calendar", volumePct: null }),
    );
    expect(explanation.tone).toBe("safety");
    expect(explanation.rationale).toContain("medical note");
    // A constraint is a fact about the athlete's life and needs no support.
    expect(explanation.confidence).toBe("high");
  });

  it("labels a change resting on one fact as thin evidence rather than dressing it up", () => {
    const explanation = explainDecision(decision({ evidence: [evidence("Your readiness was 44/100.")] }));
    expect(explanation.confidence).toBe("low");
    expect(confidenceLabel(explanation.confidence)).toBe("Thin evidence");
  });

  it("is honest, not empty, when a session is left alone with nothing logged against it", () => {
    const explanation = explainDecision(decision({ action: "proceed", evidence: [] }));
    expect(explanation.tone).toBe("positive");
    expect(explanation.why.length).toBe(1);
    expect(explanation.why[0].text).toMatch(/nothing you have logged/i);
    expect(explanation.why[0].source).toBe("history");
  });
});

describe("explainWeek — the week-level recommendation", () => {
  it("uses the number the rules averaged and the reasons they used", () => {
    const explanation = explainWeek(weekDecision())!;
    expect(explanation.headline).toBe("Consider reducing this week's volume by about 30%.");
    expect(explanation.why.some((w) => /readiness was 44/i.test(w.text))).toBe(true);
    expect(explanation.why.some((w) => w.source === "plan")).toBe(true);
    expect(explanation.tone).toBe("watch");
  });

  it("returns nothing to say when the week is left alone and the rules were sure", () => {
    expect(explainWeek(weekDecision({ volumeReductionPct: null, explanation: null }))).toBeNull();
  });

  it("reports uncertainty at week level when that is all there is", () => {
    const explanation = explainWeek(
      weekDecision({ volumeReductionPct: null, explanation: null, uncertainty: "Not enough logged sessions this week to judge." })!,
    )!;
    expect(explanation.insufficient).toBe(true);
    expect(explanation.headline).toMatch(/left exactly as planned/i);
    expect(explanation.rationale).toContain("Not enough logged sessions");
  });
});

describe("explainAvailability — the plan changed because of life (Phase 1)", () => {
  it("explains a holiday with its dates and what it cost", () => {
    const explanation = explainAvailability(
      lifeEvent(),
      assessment({
        cancelled: [
          { sessionId: "s1", scheduled_date: "2026-09-15", title: "Long run", status: "cancelled_due_to_availability", lifeEventId: "evt-1", reason: "unavailable", important: false },
          { sessionId: "s2", scheduled_date: "2026-09-17", title: "Intervals", status: "cancelled_due_to_availability", lifeEventId: "evt-1", reason: "unavailable", important: true },
        ],
        lostKeySessions: [
          { sessionId: "s2", scheduled_date: "2026-09-17", title: "Intervals", status: "cancelled_due_to_availability", lifeEventId: "evt-1", reason: "unavailable", important: true },
        ],
        adjustments: [
          { sessionId: "s1", scheduled_date: "2026-09-15", title: "Long run", status: "cancelled_due_to_availability", lifeEventId: "evt-1", reason: "unavailable", important: false },
          { sessionId: "s2", scheduled_date: "2026-09-17", title: "Intervals", status: "cancelled_due_to_availability", lifeEventId: "evt-1", reason: "unavailable", important: true },
        ],
      }),
    )!;
    expect(explanation.kind).toBe("plan_change");
    expect(explanation.why.map((w) => w.text).join(" ")).toMatch(/14 Sep/);
    expect(explanation.why.map((w) => w.text).join(" ")).toMatch(/2 sessions/);
    // The key session is named, because losing it is the thing that changes the week.
    expect(explanation.why.map((w) => w.text).join(" ")).toMatch(/Intervals/);
    expect(explanation.rationale).toMatch(/rebuilt around the sessions that matter/i);
  });

  it("says nothing when an event changed nothing", () => {
    expect(explainAvailability(lifeEvent({ allow_training: "yes" }), assessment())).toBeNull();
  });

  it("explains an optional window without implying a loss", () => {
    const explanation = explainAvailability(
      lifeEvent({ allow_training: "optional" }),
      assessment({
        adjustments: [
          { sessionId: "s1", scheduled_date: "2026-09-15", title: "Easy run", status: "planned", lifeEventId: null, reason: "optional_window", important: false },
        ],
      }),
    )!;
    expect(explanation.why.map((w) => w.text).join(" ")).toMatch(/optional/);
    expect(explanation.why.map((w) => w.text).join(" ")).toMatch(/counts against you/);
    expect(explanation.tone).toBe("info");
  });
});

describe("explainRebuild — return from break (Phase 2)", () => {
  it("leads with the specification's sentence: which week of how many, and what it is for", () => {
    const first = explainRebuild({ facts: breakFacts(), steps, weekBack: 1, creditedDays: 0, youth: false, medical: false, competingSoon: false });
    expect(first.headline).toBe("Return-from-break progression: Week 1 of 2 — rebuilding your base.");
    const second = explainRebuild({ facts: breakFacts(), steps, weekBack: 2, creditedDays: 0, youth: false, medical: false, competingSoon: false });
    expect(second.headline).toMatch(/Week 2 of 2 — restoring your usual load/);
  });

  it("credits the days the athlete kept training, and the break's own length", () => {
    const explanation = explainRebuild({ facts: breakFacts(), steps, weekBack: 1, creditedDays: 3.4, youth: false, medical: false, competingSoon: false });
    const joined = explanation.why.map((w) => w.text).join(" ");
    expect(joined).toMatch(/7 days/);
    expect(joined).toMatch(/kept training during 3 of those days/);
    expect(joined).toMatch(/55% of your usual volume/);
    expect(explanation.why.map((w) => w.source)).toContain("break");
  });

  it("carries the medical and youth notes as rationale and a safety tone", () => {
    const explanation = explainRebuild({ facts: breakFacts({ eventType: "injury" }), steps, weekBack: 1, creditedDays: 0, youth: true, medical: true, competingSoon: false });
    expect(explanation.tone).toBe("safety");
    expect(explanation.rationale).toMatch(/not a treatment plan/i);
    expect(explanation.rationale).toMatch(/Follow your doctor's/);
    expect(explanation.why.map((w) => w.text).join(" ")).toMatch(/still developing/);
  });

  it("clamps a week number the plan cannot support rather than inventing a week", () => {
    const explanation = explainRebuild({ facts: breakFacts(), steps, weekBack: 9, creditedDays: 0, youth: false, medical: false, competingSoon: false });
    expect(explanation.headline).toMatch(/Week 2 of 2/);
  });
});

describe("explainGoalProximity — what the athlete is training for (Phase 4)", () => {
  it("names the competition three days out, which is the specification's key-session case", () => {
    const explanation = explainGoalProximity({
      goalTitle: "Run a sub-40 10K",
      daysRemaining: 21,
      percent: 62,
      status: "on_track",
      achievedMilestones: 3,
      totalMilestones: 5,
      nextMilestone: { title: "5K time trial under 20:30", targetDate: "2026-10-20" },
      competition: { title: "County 10K", days: 3 },
    })!;
    expect(explanation.headline).toMatch(/key session/i);
    const joined = explanation.why.map((w) => w.text).join(" ");
    expect(joined).toMatch(/County 10K is in 3 days/);
    expect(joined).toMatch(/3 of 5 milestones reached/);
    expect(joined).toMatch(/21 days away/);
    expect(explanation.why.map((w) => w.source)).toContain("goal");
  });

  it("says nothing when there is no date, no milestone and no competition", () => {
    expect(
      explainGoalProximity({ goalTitle: "Get fitter", daysRemaining: null, percent: 0, status: "unknown", nextMilestone: null }),
    ).toBeNull();
  });

  it("does not claim a target is close when the date is months away", () => {
    const explanation = explainGoalProximity({
      goalTitle: "Run a sub-40 10K",
      daysRemaining: 140,
      percent: 12,
      status: "behind",
      // A milestone far out is what makes this worth saying at all: without one,
      // and with the date months away, there is nothing to tell the athlete.
      nextMilestone: { title: "5K under 21:00", targetDate: "2027-01-01" },
    })!;
    expect(explanation.headline).not.toMatch(/close/i);
    const joined = explanation.why.map((w) => w.text).join(" ");
    expect(joined).toMatch(/140 days away/);
    expect(joined).toMatch(/behind/);
    // Nothing was said about a competition, because there is not one.
    expect(joined).not.toMatch(/competition|is today/);
  });

  it("says nothing about a far-off goal with no milestone either", () => {
    expect(
      explainGoalProximity({ goalTitle: "Get fitter", daysRemaining: 140, percent: 12, status: "unknown", nextMilestone: null }),
    ).toBeNull();
  });
});

describe("explainWorkload — is the load appropriate", () => {
  it("explains a rise with both windows, so the comparison is checkable", () => {
    const explanation = explainWorkload({ recentDays: 28, recentLoad: 735, recentSessions: 14, priorLoad: 500, ratio: 1.47, band: "high" });
    const joined = explanation.why.map((w) => w.text).join(" ");
    expect(explanation.headline).toMatch(/47% higher/);
    expect(joined).toMatch(/735 load across 14 sessions/);
    expect(joined).toMatch(/before that carried 500/);
    expect(explanation.tone).toBe("watch");
  });

  it("refuses to judge a workload with nothing to compare it against", () => {
    const explanation = explainWorkload({ recentDays: 28, recentLoad: 120, recentSessions: 3, priorLoad: null, ratio: null, band: "unknown" });
    expect(explanation.insufficient).toBe(true);
    expect(explanation.confidence).toBe("none");
    expect(explanation.headline).toMatch(/Not enough history/);
  });

  it("frames a drop during a rebuild as the plan working, not as a problem", () => {
    const explanation = explainWorkload({ recentDays: 28, recentLoad: 200, recentSessions: 6, priorLoad: 500, ratio: 0.4, band: "low", inReturnProgression: true });
    expect(explanation.why.map((w) => w.text).join(" ")).toMatch(/plan working/i);
  });
});

describe("explainConsistency — the number the athlete controls", () => {
  it("uses the plan's own denominator and counts a break as excused", () => {
    const explanation = explainConsistency({ completed: 10, planned: 12, percent: 83, targetPerWeek: 3, weeksConsidered: 4, weeksMeetingTarget: 3, excusedByBreak: 2 });
    const joined = explanation.why.map((w) => w.text).join(" ");
    expect(joined).toMatch(/10 of 12 planned sessions/);
    expect(joined).toMatch(/3 of those 4 weeks/);
    expect(joined).toMatch(/2 sessions were removed by a break/);
    // A week with a break in it is not reported as a shortfall.
    expect(explanation.rationale).toMatch(/input you control/i);
  });

  it("says there is nothing to measure when nothing was planned", () => {
    const explanation = explainConsistency({ completed: 0, planned: 0, percent: 0, targetPerWeek: 3, weeksConsidered: 4, weeksMeetingTarget: 0 });
    expect(explanation.insufficient).toBe(true);
    expect(explanation.headline).toMatch(/No planned sessions/);
  });

  it("drops comparative framing for a developing athlete", () => {
    const youth = explainConsistency({ completed: 5, planned: 12, percent: 42, targetPerWeek: 3, weeksConsidered: 4, weeksMeetingTarget: 1, youth: true });
    expect(youth.rationale).toMatch(/at your age/i);
    expect(youth.rationale).not.toMatch(/performance/i);
  });
});

describe("the guarantees every explanation keeps", () => {
  it("inside the bullet budget, with the remainder reported rather than lost", () => {
    const many = buildExplanation({
      id: "x",
      kind: "session",
      headline: "Test",
      why: Array.from({ length: 9 }, (_, i) => ({ text: `Fact ${i}`, source: "load" as const })),
      rationale: "r",
      tone: "info",
    });
    expect(many.why.length).toBe(MAX_WHY);
    expect(many.omitted).toBe(4);
  });

  it("never repeats a reason, because two engines reaching one conclusion reads as a glitch", () => {
    const dup = buildExplanation({
      id: "x",
      kind: "session",
      headline: "Test",
      why: [
        { text: "You added a holiday from 14 Sep to 20 Sep.", source: "calendar" },
        { text: "you added a HOLIDAY from 14 sep to 20 sep.", source: "calendar" },
      ],
      rationale: "r",
      tone: "info",
    });
    expect(dup.why.length).toBe(1);
    expect(dup.omitted).toBe(0);
  });

  it("never claims medical certainty, anywhere, for any input", () => {
    // The blanket scan. If a future adapter starts emitting a risk score or a
    // diagnosis, this fails on the sentence rather than in a review.
    for (const explanation of allExplanations()) {
      const text = [
        explanation.headline,
        explanation.rationale,
        ...explanation.why.map((w) => w.text),
        reasonSourceLabel("recovery"),
      ].join(" ");
      expect(findMedicalCertainty(text), `medical certainty in: ${text}`).toEqual([]);
    }
  });

  it("has a headline, a rationale and a summary for every one of them", () => {
    const all = allExplanations();
    expect(all.length).toBeGreaterThanOrEqual(12);
    for (const explanation of all) {
      expect(explanation.headline.trim().length).toBeGreaterThan(0);
      expect(explanation.rationale.trim().length).toBeGreaterThan(0);
      expect(explanation.summary.startsWith(explanation.headline)).toBe(true);
      // The summary is a fallback for a collapsed row, so it must say something
      // beyond the headline when there is a reason to give.
      if (explanation.why.length > 0 && !explanation.insufficient) {
        expect(explanation.summary.length).toBeGreaterThan(explanation.headline.length);
      }
    }
  });

  it("has something to show the athlete for every one of them", () => {
    expect(hasAnythingToSay(allExplanations())).toBe(true);
    expect(hasAnythingToSay([])).toBe(false);
  });

  it("orders the most actionable first, stably", () => {
    const sorted = sortExplanations(allExplanations());
    const weights = sorted.map((e) => e.tone);
    const rank = { safety: 0, watch: 1, info: 2, positive: 3 } as const;
    const ranks = weights.map((t) => rank[t]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("names where each reason came from, in words", () => {
    expect(reasonSourceLabel("recovery")).toBe("your recovery check-ins");
    expect(reasonSourceLabel("load")).toBe("your logged sessions");
    expect(reasonSourceLabel("goal")).toBe("your goal");
    expect(reasonSourceLabel("import")).toBe("your imported training");
  });
});
