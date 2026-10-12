// ============================================================================
// INJURY PLAN — parser, briefing and stored-text tests
// ----------------------------------------------------------------------------
// The important claims here are the ones a paid path depends on:
//
//   1. a model answer that is not the shape we asked for produces an ERROR and
//      no plan, never an empty plan the athlete paid for,
//   2. a slightly wrong answer (string numbers, camelCase, markdown fences,
//      one unreadable week) still produces a plan the screen can read,
//   3. the stored protocol always carries the disclaimer and the red flags, so
//      an AI-written rehabilitation scaffold is never shown bare.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  buildInjuryBriefing,
  MAX_PLAN_WEEKS,
  parseInjuryPlan,
  PERSONALISED_PLAN_MARKER,
  planHeadline,
  renderInjuryProtocol,
  splitStoredProtocol,
  type InjuryPlan,
} from "./injuryPlan";

const validPlan = {
  summary: "Reported left knee pain after sprinting. This scaffold builds back tolerance.",
  weeks: [
    {
      week: 1,
      focus: "Calm it down",
      items: [
        { label: "Days 1–3", work: "Isometric quad holds, 5 × 30s", pain_rule: "pain ≤ 2/10" },
        { label: "Day 4", work: "Stationary bike, 15 min, no resistance" },
      ],
      progress_when: "Walking and stairs pain-free for two days",
      stop_if: "Swelling increases after any session",
    },
    {
      week: 2,
      focus: "Build tolerance",
      items: [{ label: "Days 1, 3, 5", work: "Step-ups 3 × 8 each leg" }],
      progress_when: "No pain on step-ups",
      stop_if: "Pain above 3/10",
    },
  ],
  red_flags: ["Locking or giving way", "Swelling that does not settle"],
  see_a_professional: "See a physiotherapist before progressing past week 2.",
  disclaimer: "General scaffold, not medical advice — have a physiotherapist supervise it.",
};

const planOf = (raw: unknown): InjuryPlan => {
  const { plan, error } = parseInjuryPlan(raw);
  expect(error, `expected a plan, got: ${error}`).toBeUndefined();
  expect(plan).toBeTruthy();
  return plan!;
};

describe("parseInjuryPlan — a usable answer", () => {
  it("reads the JSON string the edge function returns", () => {
    const plan = planOf(JSON.stringify(validPlan));
    expect(plan.weeks).toHaveLength(2);
    expect(plan.weeks[0].week).toBe(1);
    expect(plan.weeks[0].items[0].work).toContain("Isometric");
    expect(plan.weeks[0].items[0].painRule).toBe("pain ≤ 2/10");
    expect(plan.redFlags).toHaveLength(2);
    expect(plan.disclaimer).toContain("not medical advice");
  });

  it("unwraps a fenced code block", () => {
    const plan = planOf("```json\n" + JSON.stringify(validPlan) + "\n```");
    expect(plan.weeks).toHaveLength(2);
  });

  it("accepts camelCase and the alias field names a model drifts into", () => {
    const plan = planOf({
      summary: "s",
      weeks: [
        {
          focus: "Week one",
          sessions: [{ label: "Days 1-3", detail: "Bridges 3 × 10" }],
          progressWhen: "No pain",
          stopIf: "Pain rises",
        },
      ],
    });
    // A week with no number is still week 1, not dropped.
    expect(plan.weeks[0].week).toBe(1);
    expect(plan.weeks[0].items[0].work).toBe("Bridges 3 × 10");
    expect(plan.weeks[0].progressWhen).toBe("No pain");
  });

  it("reads a double-encoded answer", () => {
    const plan = planOf(JSON.stringify(JSON.stringify(validPlan)));
    expect(plan.weeks).toHaveLength(2);
  });

  it("keeps the readable weeks when one comes back unusable", () => {
    const plan = planOf({
      weeks: [{ week: 1, focus: "", items: [] }, validPlan.weeks[0]],
    });
    expect(plan.weeks).toHaveLength(1);
    expect(plan.weeks[0].focus).toBe("Calm it down");
  });

  it("sorts weeks and drops a duplicate rather than rendering it twice", () => {
    const plan = planOf({
      weeks: [validPlan.weeks[1], validPlan.weeks[1], validPlan.weeks[0]],
    });
    expect(plan.weeks.map((w) => w.week)).toEqual([1, 2]);
  });

  it("drops a week numbered past the cap instead of trusting it", () => {
    const plan = planOf({
      weeks: [{ week: MAX_PLAN_WEEKS + 5, focus: "Nonsense", items: [{ work: "x" }] }, validPlan.weeks[0]],
    });
    expect(plan.weeks.map((w) => w.week)).toEqual([1]);
  });
});

describe("parseInjuryPlan — an answer we cannot use", () => {
  it("fails on prose instead of JSON", () => {
    const { plan, error } = parseInjuryPlan("I'm sorry, I can't help with that.");
    expect(plan).toBeNull();
    expect(error).toBeTruthy();
  });

  it("fails on an answer with no weeks rather than returning an empty plan", () => {
    for (const raw of ["", "{}", JSON.stringify({ weeks: [] }), JSON.stringify({ weeks: "soon" })]) {
      const { plan, error } = parseInjuryPlan(raw);
      expect(plan, `expected no plan for ${JSON.stringify(raw)}`).toBeNull();
      expect(error).toBeTruthy();
    }
  });

  it("fails when every week is unreadable", () => {
    const { plan, error } = parseInjuryPlan({
      weeks: [{ week: 1, focus: "", items: [] }, { week: 2, focus: "", sessions: [] }],
    });
    expect(plan).toBeNull();
    expect(error).toContain("no readable weeks");
  });

  it("fails on null and on a non-object", () => {
    expect(parseInjuryPlan(null).plan).toBeNull();
    expect(parseInjuryPlan(42).plan).toBeNull();
  });
});

describe("renderInjuryProtocol — what is stored on the injury row", () => {
  it("writes the weeks, the work and the pain rules in order", () => {
    const text = renderInjuryProtocol(planOf(validPlan));
    // The stored form says what it is BEFORE the plan, so the record itself
    // answers "was this the paid one?" without a second column.
    expect(text.startsWith(PERSONALISED_PLAN_MARKER)).toBe(true);
    const { personalised, lines } = splitStoredProtocol(text);
    expect(personalised).toBe(true);
    expect(lines[0]).toContain("Reported left knee pain");
    expect(lines).toContain("Week 1: Calm it down");
    expect(lines.some((l) => l.startsWith("Days 1–3 — Isometric quad holds") && l.includes("pain ≤ 2/10"))).toBe(true);
    expect(lines).toContain("Progress when: Walking and stairs pain-free for two days");
    expect(lines).toContain("Stop this week if: Swelling increases after any session");
  });

  it("always carries the red flags and a disclaimer", () => {
    const text = renderInjuryProtocol(planOf(validPlan));
    expect(text).toContain("Stop and see a clinician now if:");
    expect(text).toContain("• Locking or giving way");
    expect(text).toContain("not medical advice");
  });

  it("substitutes a disclaimer when the model omitted one", () => {
    const plan = planOf({ weeks: [{ week: 1, focus: "Go", items: [{ work: "x" }] }] });
    expect(renderInjuryProtocol(plan)).toContain("not medical advice");
  });

  it("reads a stored generic scaffold back as generic, not as a paid plan", () => {
    const generic = "Days 1–3: Rest, ice.\nWeek 2: Wall sits 3×30s.";
    const { personalised, lines } = splitStoredProtocol(generic);
    expect(personalised).toBe(false);
    expect(lines).toHaveLength(2);
  });
});

describe("buildInjuryBriefing", () => {
  it("carries the site, the severity and the athlete's own words", () => {
    const briefing = buildInjuryBriefing({
      bodyPart: "Knee",
      severity: 6,
      notes: "hurt it sprinting",
      hurts: "bending",
      stillDoing: "walking",
      daysSince: 3,
      sport: "Football",
    });
    expect(briefing).toContain("Knee");
    expect(briefing).toContain("6/10");
    expect(briefing).toContain("3 days ago");
    expect(briefing).toContain("bending");
    expect(briefing).toContain("walking");
    expect(briefing).toContain("hurt it sprinting");
    expect(briefing).toContain("Football");
    // The model is told what it is looking at, and that it is not a diagnosis.
    expect(briefing).toContain("not been examined");
  });

  it("clamps severity and strips control characters", () => {
    const briefing = buildInjuryBriefing({
      bodyPart: "Knee\u0007",
      severity: 99,
      notes: "a\u0000b",
    });
    expect(briefing).toContain("10/10");
    expect(briefing).not.toContain("\u0007");
    expect(briefing).not.toContain("\u0000");
    expect(briefing).not.toContain("Started about");
  });

  it("does not invent a site the athlete did not give", () => {
    const briefing = buildInjuryBriefing({ bodyPart: "", severity: 0 });
    expect(briefing).toContain("unspecified");
    expect(briefing).toContain("1/10");
  });
});

describe("planHeadline", () => {
  it("prefers the summary and falls back to the first week", () => {
    expect(planHeadline(planOf(validPlan))).toContain("Reported left knee");
    expect(planHeadline(planOf({ weeks: [{ week: 1, focus: "Go", items: [{ work: "x" }] }] }))).toContain("Go");
  });
});
