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
  freeInjuryProtocol,
  MEDICAL_REFERRAL_MARKER,
  MAX_PLAN_WEEKS,
  MAX_SITE_LENGTH,
  parseInjuryPlan,
  PERSONALISED_PLAN_MARKER,
  planHeadline,
  readStoredTrainingAdvice,
  renderInjuryProtocol,
  resolveInjurySite,
  splitStoredProtocol,
  SERIOUS_SEVERITY,
  type InjuryPlan,
} from "./injuryPlan";

// ─── Any injury, not just the ones on the list ───

const KNOWN = ["Knee", "Hamstring", "Achilles", "Lower Back", "Other"];

describe("the injury site that gets logged", () => {
  it("keeps the athlete's own words instead of collapsing them to 'Other'", () => {
    // This is what "create a plan for any injury" means in the data: the briefing
    // the plan is written from carries the athlete's site, not a placeholder.
    expect(resolveInjurySite({ listed: "Other", typed: "groin", known: KNOWN })).toBe("groin");
    expect(resolveInjurySite({ listed: "Other", typed: "  rotator   cuff  ", known: KNOWN })).toBe("rotator cuff");
  });

  it("falls back to 'Other' only when there is genuinely nothing to name", () => {
    expect(resolveInjurySite({ listed: "Other", typed: "   ", known: KNOWN })).toBe("Other");
    expect(resolveInjurySite({ listed: "Other", typed: null, known: KNOWN })).toBe("Other");
    expect(resolveInjurySite({ listed: "Something odd", typed: null, known: KNOWN })).toBe("Other");
  });

  it("keeps a listed site as it is", () => {
    expect(resolveInjurySite({ listed: "Knee", typed: "ignored", known: KNOWN })).toBe("Knee");
  });

  it("bounds and cleans what it stores", () => {
    const long = "x".repeat(200);
    expect(resolveInjurySite({ listed: "Other", typed: long, known: KNOWN })).toHaveLength(MAX_SITE_LENGTH);
    // Control characters cannot ride into the prompt or the column.
    expect(resolveInjurySite({ listed: "Other", typed: "shi\u0000n\n\u0007", known: KNOWN })).toBe("shi n");
  });
});

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

// ─── The safety floor: serious symptoms get a referral, not a plan ───

describe("the serious-symptom gate", () => {
  it("refers on the report's own serious signals, without needing a diagnosis", () => {
    // Each of these is a keyword that genuinely warrants clinical assessment
    // regardless of everything else in the report; the app's job is to notice
    // them, not to name the injury.
    for (const reported of [
      "heard a pop at the moment of landing and can't bear weight",
      "leg numbness spreading down, pins and needles",
      "bladder changes since it happened",
      "obvious deformity, think it is a fracture",
      "night pain that wakes me",
      "hot and swollen with a fever",
      "head injury during the match, knocked out",
    ]) {
      expect(freeInjuryProtocol({ bodyPart: "Knee", severity: 3, reported }).referral, reported).toBe(true);
    }
  });

  it("does not refer on ordinary badness: a sore knee still gets the free scaffold", () => {
    const normal = freeInjuryProtocol({ bodyPart: "Knee", severity: 4, reported: "Twisted it at 6-a-side, hurts when I run downhill" });
    expect(normal.referral).toBe(false);
    expect(normal.lines.join("\n")).toContain("General scaffold");
  });

  it("refers on a severity at the top of the scale even with a silent note", () => {
    expect(freeInjuryProtocol({ bodyPart: "Knee", severity: SERIOUS_SEVERITY, reported: null }).referral).toBe(true);
    // One below the threshold stays scaffold territory.
    expect(freeInjuryProtocol({ bodyPart: "Knee", severity: SERIOUS_SEVERITY - 1, reported: null }).referral).toBe(false);
  });

  it("the referral text is stored and rendered as its own thing, never as a plan", () => {
    const lines = freeInjuryProtocol({ bodyPart: "Lower Back", severity: 9, reported: "" }).lines;
    const stored = lines.join("\n");
    expect(stored.startsWith(MEDICAL_REFERRAL_MARKER)).toBe(true);
    // Both of the labels the screen can print would mislead here; the referral
    // is neither the paid plan nor the free scaffold.
    expect(splitStoredProtocol(stored).personalised).toBe(false);
    expect(stored).toMatch(/physiotherapist or doctor/);
    expect(stored).toMatch(/does not diagnose or treat/i);
  });
});

// ─── The free scaffold is conservative by construction ───

describe("the free generic scaffold", () => {
  it("exists for every listed body area, with red flags and a pain rule", () => {
    for (const bodyPart of ["Knee", "Hamstring", "Calf", "Achilles", "Foot/Ankle", "Hip", "Lower Back", "Shoulder", "Elbow", "Wrist", "Other"]) {
      const result = freeInjuryProtocol({ bodyPart, severity: 3, reported: "" });
      expect(result.referral, bodyPart).toBe(false);
      const text = result.lines.join("\n");
      expect(text).toContain("not medical advice");
      expect(text).toContain("Progress when");
      expect(text).toContain("clinician");
    }
  });

  it("prescribes NO recovery timeline and NO return-to-sport progression", () => {
    // What the old in-page scaffolds wrote: fixed week-by-week programmes
    // ("Week 3+: build to sprints — add 10% per session") identical for every
    // severity. The app has no basis for a timeline, so the text may not
    // contain one.
    for (const bodyPart of ["Knee", "Hamstring", "Calf", "Achilles", "Foot/Ankle", "Hip", "Lower Back", "Shoulder", "Elbow", "Wrist", "Other"]) {
      const text = freeInjuryProtocol({ bodyPart, severity: 3, reported: "" }).lines.join("\n");
      expect(text, bodyPart).not.toMatch(/^\s*Weeks?\s*\d/m);
      expect(text, bodyPart).not.toMatch(/\d+\s*%/);
      expect(text, bodyPart).not.toMatch(/return to sport/i);
    }
  });

  it("warns at least one honest thing about progression: next-day pain, not the session", () => {
    const text = freeInjuryProtocol({ bodyPart: "Knee", severity: 3, reported: "" }).lines.join("\n");
    expect(text).toMatch(/pain-free|comfortable/i);
  });
});

// ─── Training advice: the plan says what happens to their normal week ───

describe("training guidance on a personalised plan", () => {
  const withTraining = {
    ...validPlan,
    training: {
      status: "stop",
      stop_for: "10-14 days",
      during: "Upper-body gym work and easy walking, as long as it stays pain-free.",
      build_back: [
        "Easy walking, 15 minutes, pain-free the next morning before adding more.",
        "Straight-line jogging at conversational pace, every other day.",
        "One full training session once two jogging days have been pain-free.",
      ],
    },
  };

  it("reads the status, the stop period, what is still allowed and the build-back steps", () => {
    const plan = planOf(JSON.stringify(withTraining));
    expect(plan.training).toEqual({
      status: "stop",
      stopFor: "10-14 days",
      during: "Upper-body gym work and easy walking, as long as it stays pain-free.",
      buildBack: [
        "Easy walking, 15 minutes, pain-free the next morning before adding more.",
        "Straight-line jogging at conversational pace, every other day.",
        "One full training session once two jogging days have been pain-free.",
      ],
    });
  });

  it("accepts the same facts at the top level when the model does not nest them", () => {
    const plan = planOf({
      ...validPlan,
      training_status: "modified",
      during: "No sprinting or cutting; straight-line work is fine.",
      build_back: ["Straight-line running at 70%.", "Add one change of direction per session."],
    });
    expect(plan.training?.status).toBe("modified");
    expect(plan.training?.during).toContain("No sprinting");
    expect(plan.training?.buildBack).toHaveLength(2);
  });

  it("does not guess 'continue' from an unreadable status", () => {
    // A broken status field is the one place a default could hurt: telling an
    // injured athlete to train as planned is the unsafe reading.
    const plan = planOf({ ...validPlan, training: { status: "???", during: "x" } });
    expect(plan.training?.status).toBe("modified");
  });

  it("is null for plans written before the field existed", () => {
    expect(planOf(JSON.stringify(validPlan)).training).toBeNull();
  });

  it("is stored before the weeks, and reads back for the card", () => {
    const text = renderInjuryProtocol(planOf(JSON.stringify(withTraining)));
    const { lines } = splitStoredProtocol(text);
    expect(lines[0]).toContain("Reported left knee pain");

    const trainingIndex = lines.findIndex((line) => line.startsWith("Training:"));
    const weekIndex = lines.findIndex((line) => line.startsWith("Week 1:"));
    expect(trainingIndex).toBeGreaterThan(0);
    expect(trainingIndex).toBeLessThan(weekIndex);
    expect(lines[trainingIndex]).toContain("stop for 10-14 days");
    expect(lines).toContain("Build back into training:");

    const advice = readStoredTrainingAdvice(lines);
    expect(advice?.status).toBe("stop");
    expect(advice?.headline).toContain("stop for 10-14 days");
    expect(advice?.during).toContain("Upper-body gym work");
    expect(advice?.buildBack).toHaveLength(3);
  });

  it("says 'until the checkpoints' when the model gave no duration", () => {
    const plan = planOf({
      ...validPlan,
      training: { status: "stop", during: "Nothing loaded.", build_back: ["Walk pain-free."] },
    });
    const text = renderInjuryProtocol(plan);
    expect(text).toContain("Training: stop — build back only through the steps below.");
    expect(text).not.toMatch(/stop for\s+—/);
  });
});

describe("the briefing for the plan", () => {
  it("carries every intake answer, not just the site and severity", () => {
    const briefing = buildInjuryBriefing({
      bodyPart: "Knee",
      severity: 4,
      mechanism: "Landed awkwardly at training",
      hurts: "Cutting and downhill running",
      stillDoing: "Cycling and upper-body work",
      swelling: "some",
      daysSince: 3,
      trainingDays: 4,
      sport: "Football",
      notes: "Physio booked for Friday",
    });
    expect(briefing).toContain("How it happened: Landed awkwardly at training");
    expect(briefing).toContain("What hurts / makes it worse: Cutting and downhill running");
    expect(briefing).toContain("Still able to do pain-free: Cycling and upper-body work");
    expect(briefing).toContain("Swelling or bruising: some swelling or bruising");
    expect(briefing).toContain("Started about 3 days ago");
    expect(briefing).toContain("Training days in their current plan: 4 a week");
    expect(briefing).toContain("Sport: Football");
    expect(briefing).toContain("Athlete's own note: Physio booked for Friday");
  });

  it("drops an unrecognised swelling value instead of putting it in the prompt", () => {
    const briefing = buildInjuryBriefing({ bodyPart: "Knee", severity: 3, swelling: "gigantic" });
    expect(briefing).not.toContain("gigantic");
  });
});

describe("equipment in the briefing", () => {
  it("tells the plan what the athlete can actually train with", () => {
    const briefing = buildInjuryBriefing({
      bodyPart: "Knee",
      severity: 4,
      equipment: ["resistance_bands", "mats_floor_space"],
    });
    expect(briefing).toContain("Equipment available: Resistance bands, Mat / floor space");
  });

  it("says bodyweight only rather than leaving the model to guess", () => {
    const briefing = buildInjuryBriefing({ bodyPart: "Knee", severity: 4, equipment: ["none"] });
    expect(briefing).toContain("Equipment available: bodyweight only, no equipment");
  });
});

describe("a paid answer wrapped in prose", () => {
  it("still produces the plan instead of charging for an unreadable reply", () => {
    const wrapped = `Here is the plan you asked for:\n${JSON.stringify(validPlan)}\nTake it to a physiotherapist.`;
    const plan = planOf(wrapped);
    expect(plan.weeks).toHaveLength(2);
  });
});
