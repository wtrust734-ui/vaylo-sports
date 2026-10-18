// ============================================================================
// The campaign layer.
//
// Two things here are load-bearing. First, the unit economics: a concept carries
// a cost estimate and paid generation is refused over the configured limit, so
// getting the arithmetic wrong spends real money. Second, the fabrication rules:
// a model asked for "a hook and a benefit" will invent statistics and app
// screens, and these checks are what stop that reaching an advert.
// ============================================================================

import { describe, expect, it } from "vitest";

import { ELEVENLABS_MODELS } from "./elevenlabs";
import { GEMINI_MODELS } from "./aiModels";
import { estimateVeoCostUsd } from "./veo";
import {
  AD_CONCEPT_SCHEMA,
  AD_PLATFORMS,
  CAMPAIGN_OBJECTIVES,
  CONCEPT_COUNT,
  CONCEPT_SYSTEM_PROMPT,
  FABRICATION_PATTERNS,
  MAX_ON_SCREEN_TEXT,
  STAGE_DIRECTION_PATTERNS,
  checkBudget,
  estimateConceptCost,
  normaliseConcept,
  parseConceptPayload,
  spokenScript,
  validateBrief,
  validateConcept,
  type AdConcept,
  type CampaignBrief,
} from "./campaign";

const brief = (over: Partial<CampaignBrief> = {}): CampaignBrief => ({
  name: "Spring Training Push",
  objective: "app_installs",
  audience: "Club runners aged 18-30 training five times a week",
  platform: "reels",
  budgetUsd: 25,
  message: "Track every session and watch the trend line move",
  callToAction: "Join the waitlist",
  ...over,
});

const concept = (over: Partial<AdConcept> = {}): AdConcept => ({
  title: "Every session counts",
  hook: "You are training hard. Is it working?",
  coreMessage: "Vaylo keeps your training in one place so progress is visible.",
  script: "Every session, every rep. Vaylo Sports keeps your training in one place.",
  rationale: "Leads with the question every athlete already asks.",
  callToAction: "Join the waitlist",
  onScreenText: ["TRAIN WITH INTENT", "Join the waitlist"],
  storyboard: [
    { shot: 1, description: "Athlete sprinting under floodlights", veoPrompt: "athlete sprinting, floodlit track, night", seconds: 8, useAppFootage: false },
    { shot: 2, description: "Real app screen showing the trend line", veoPrompt: "", seconds: 4, useAppFootage: true },
  ],
  ...over,
});

describe("the brief must be complete before anything is generated", () => {
  it("accepts a complete, on-brand brief", () => {
    expect(validateBrief(brief())).toEqual({ ok: true, problems: [] });
  });

  it("reports EVERY problem at once rather than one at a time", () => {
    const result = validateBrief({ name: "x" });
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThanOrEqual(5);
  });

  it("refuses an objective or platform outside the supported set", () => {
    expect(validateBrief(brief({ objective: "vibes" as never })).problems.join(" ")).toMatch(/Objective must be one of/);
    expect(validateBrief(brief({ platform: "billboard" as never })).problems.join(" ")).toMatch(/Platform must be one of/);
  });

  it("refuses a nonsensical budget", () => {
    expect(validateBrief(brief({ budgetUsd: -5 })).problems.join(" ")).toMatch(/0 or more/);
    expect(validateBrief(brief({ budgetUsd: Number.NaN })).problems.join(" ")).toMatch(/must be a number/);
    expect(validateBrief(brief({ budgetUsd: 50_000 })).problems.join(" ")).toMatch(/refused/);
  });

  it("applies the brand rules to the message and the call to action", () => {
    const result = validateBrief(brief({ message: "Guaranteed to make you 30% faster" }));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/Campaign message/);
  });

  it("does not throw on a missing brief", () => {
    expect(() => validateBrief(null)).not.toThrow();
    expect(validateBrief(undefined).ok).toBe(false);
  });
});

describe("the concept contract", () => {
  it("accepts a well-formed concept", () => {
    expect(validateConcept(concept())).toEqual({ ok: true, problems: [] });
  });

  it("requires the fields the pipeline actually consumes", () => {
    for (const field of ["title", "hook", "coreMessage", "script", "callToAction", "rationale"] as const) {
      const result = validateConcept(concept({ [field]: "" } as Partial<AdConcept>));
      expect(result.ok, `${field} should be required`).toBe(false);
    }
  });

  it("requires a storyboard", () => {
    expect(validateConcept(concept({ storyboard: [] })).problems).toContain("a storyboard with at least one shot is required");
  });

  it("refuses a shot length Veo does not accept, before it is billed", () => {
    const bad = concept({
      storyboard: [{ shot: 1, description: "x", veoPrompt: "y", seconds: 5, useAppFootage: false }],
    });
    expect(validateConcept(bad).problems.join(" ")).toMatch(/must be 4, 6 or 8 seconds \(got 5\)/);
  });

  it("does NOT demand a Veo prompt for a shot that uses real app footage", () => {
    const result = validateConcept(
      concept({ storyboard: [{ shot: 1, description: "trend line screen", veoPrompt: "", seconds: 4, useAppFootage: true }] }),
    );
    expect(result.ok).toBe(true);
  });

  it("does demand a Veo prompt for a generated shot", () => {
    const result = validateConcept(
      concept({ storyboard: [{ shot: 1, description: "x", veoPrompt: "  ", seconds: 4, useAppFootage: false }] }),
    );
    expect(result.problems.join(" ")).toMatch(/needs a Veo prompt/);
  });

  it("caps the storyboard", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ shot: i + 1, description: "x", veoPrompt: "y", seconds: 4, useAppFootage: false }));
    expect(validateConcept(concept({ storyboard: many })).problems.join(" ")).toMatch(/at most 8 shots/);
  });

  it("caps on-screen text at the lines the render layout can actually place", () => {
    expect(MAX_ON_SCREEN_TEXT).toBe(2);
    expect(validateConcept(concept({ onScreenText: ["a", "b"] })).ok).toBe(true);
    expect(validateConcept(concept({ onScreenText: ["a", "b", "c"] })).problems.join(" ")).toMatch(/at most 2 on-screen text lines/);
    expect(validateConcept(concept({ onScreenText: [] })).problems.join(" ")).toMatch(/at least one on-screen/);
  });

  it("does not count a repeat of the call to action as an extra line", () => {
    // Models add the CTA to on-screen text routinely; the layout draws it from
    // its own field, so the repeat is not a second caption.
    const result = validateConcept(concept({ onScreenText: ["First", "Second", "JOIN THE WAITLIST"] }));
    expect(result.ok).toBe(true);
    expect(validateConcept(concept({ onScreenText: ["First", "Second", "Third"] })).ok).toBe(false);
  });

  it("carries the shared brand rules onto the narration", () => {
    expect(validateConcept(concept({ script: "Only $9 per month" })).problems.join(" ")).toMatch(/no checkout/);
  });

  it("does not throw on a partial concept", () => {
    expect(() => validateConcept({})).not.toThrow();
    expect(validateConcept(null).ok).toBe(false);
  });
});

describe("fabrication is refused, not just discouraged", () => {
  it("catches each invented thing the brief forbids", () => {
    const bad: Array<[string, string]> = [
      ["app screen", "Show the dashboard screen with your weekly volume."],
      ["award", "An award-winning training experience."],
      ["endorsement", "As seen on national television."],
      ["reviews", "Our users say it changed their season."],
      ["rating", "Rated 5 by athletes everywhere."],
      ["user count", "Join 250,000 athletes already training."],
      ["promise", "Guaranteed to improve your race times."],
    ];
    for (const [label, text] of bad) {
      const result = validateConcept(concept({ hook: text }));
      expect(result.ok, `expected refusal for ${label}`).toBe(false);
      expect(result.problems.join(" "), label).toMatch(/fabrication|narration/);
    }
  });

  it("does not trip on honest, specific copy", () => {
    expect(
      validateConcept(
        concept({
          hook: "You are training hard. Is it working?",
          coreMessage: "Vaylo records every session so the trend line is visible.",
          onScreenText: ["TRAIN WITH INTENT"],
        }),
      ).ok,
    ).toBe(true);
  });

  it("has a reason for every pattern, so the refusal can be explained", () => {
    for (const { reason } of FABRICATION_PATTERNS) expect(reason.length).toBeGreaterThan(10);
  });
});

describe("the cost estimate drives the approval gate", () => {
  it("counts only the shots that are actually generated", () => {
    const cost = estimateConceptCost(concept());
    expect(cost.veoShots).toBe(1); // the second shot uses real app footage and is free
    expect(cost.veoSeconds).toBe(8);
  });

  it("prices the generated seconds at the veo LITE rate", () => {
    const cost = estimateConceptCost(concept());
    expect(cost.veoUsd).toBeCloseTo(estimateVeoCostUsd(GEMINI_MODELS.VEO_LITE, 8), 6);
  });

  it("reports narration in characters, the unit that is actually billed", () => {
    const cost = estimateConceptCost(concept());
    expect(cost.voiceoverCharacters).toBe("Every session, every rep. Vaylo Sports keeps your training in one place.".length);
    expect(cost.hasNarration).toBe(true);
    expect(cost.voiceoverModel).toBe(ELEVENLABS_MODELS.FLASH);
  });

  it("does not charge for a concept with no narration", () => {
    const cost = estimateConceptCost(concept({ script: "" }));
    expect(cost.hasNarration).toBe(false);
    expect(cost.voiceoverCharacters).toBe(0);
  });

  it("adds up across all generated shots", () => {
    const cost = estimateConceptCost(
      concept({
        storyboard: [
          { shot: 1, description: "a", veoPrompt: "a", seconds: 8, useAppFootage: false },
          { shot: 2, description: "b", veoPrompt: "b", seconds: 6, useAppFootage: false },
          { shot: 3, description: "c", veoPrompt: "", seconds: 4, useAppFootage: true },
        ],
      }),
    );
    expect(cost.veoShots).toBe(2);
    expect(cost.veoSeconds).toBe(14);
    // 14 s at the standard tier's published $0.40/s rate.
    expect(cost.veoUsd).toBeCloseTo(5.6, 2);
  });

  it("costs nothing to generate when every shot uses real app footage", () => {
    const cost = estimateConceptCost(
      concept({ storyboard: [{ shot: 1, description: "screen", veoPrompt: "", seconds: 4, useAppFootage: true }] }),
    );
    expect(cost.veoShots).toBe(0);
    expect(cost.totalUsd).toBe(0);
  });
});

describe("the spending limit is enforced, not advised", () => {
  it("allows a step that stays within the limit", () => {
    const decision = checkBudget(25, 10, 2);
    expect(decision.allowed).toBe(true);
    expect(decision.remainingUsd).toBe(15);
  });

  it("allows a step that lands exactly on the limit, despite float noise", () => {
    // 0.1 + 0.2 style arithmetic must not refuse a legitimate request.
    const decision = checkBudget(0.3, 0.1, 0.2);
    expect(decision.allowed).toBe(true);
  });

  it("refuses a step that would exceed the limit, and says by how much", () => {
    const decision = checkBudget(5, 4.5, 2);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/over the \$5\.00 limit/);
    expect(decision.reason).toMatch(/Raise the limit/);
  });

  it("refuses everything when the budget is zero", () => {
    expect(checkBudget(0, 0, 0.01).allowed).toBe(false);
  });

  it("treats nonsense numbers as no budget rather than as free money", () => {
    expect(checkBudget(Number.NaN, 0, 1).allowed).toBe(false);
    expect(checkBudget(5, Number.NaN, Number.NaN).allowed).toBe(true);
  });

  it("never reports a negative remaining balance", () => {
    expect(checkBudget(5, 20, 1).remainingUsd).toBe(0);
  });
});

describe("the contract sent to the model", () => {
  it("asks for the three concepts the brief requires", () => {
    expect(CONCEPT_COUNT).toBe(3);
    expect(CONCEPT_SYSTEM_PROMPT).toContain("Produce 3 concepts");
  });
  it("states the fabrication rules to the model as well as enforcing them here", () => {
    expect(CONCEPT_SYSTEM_PROMPT).toMatch(/Do not invent statistics/i);
    expect(CONCEPT_SYSTEM_PROMPT).toMatch(/useAppFootage/);
  });
  it("declares every required concept field in the JSON schema", () => {
    expect([...AD_CONCEPT_SCHEMA.required].sort()).toEqual(
      ["callToAction", "coreMessage", "hook", "onScreenText", "rationale", "script", "storyboard", "title"].sort(),
    );
  });
  it("exposes the objectives and platforms the UI needs", () => {
    expect(Object.keys(CAMPAIGN_OBJECTIVES).length).toBeGreaterThanOrEqual(4);
    expect(AD_PLATFORMS.reels).toMatchObject({ presetId: "reels", aspect: "9:16" });
    expect(AD_PLATFORMS.landscape).toMatchObject({ presetId: "landscape", aspect: "16:9" });
  });
  it("tells the model a script is spoken words only, so the defect cannot recur", () => {
    expect(CONCEPT_SYSTEM_PROMPT).toContain("read aloud by a narration engine");
    expect(CONCEPT_SYSTEM_PROMPT).toMatch(/no speaker labels/);
  });
});

// ---------------------------------------------------------------------------
// Found by reading the first live run, not by imagining an error.
// ---------------------------------------------------------------------------

describe("the live-regression: a script is spoken words, not a screenplay", () => {
  // Verbatim from the first real OpenAI response. Sent to ElevenLabs, this
  // narrates "V-O colon" and "Total sixteen seconds" over the advert.
  const LIVE_OUTPUT =
    "VO: \u201cThe last rep isn\u2019t the last step. Log the session.\u201d End card: \u201cJoin the waitlist.\u201d Total: 12 seconds.";

  it("refuses the exact script the live run produced", () => {
    const result = validateConcept(concept({ script: LIVE_OUTPUT }));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/script must be the spoken words only/);
  });

  it("refuses every shape of stage direction", () => {
    const bad = [
      "VO: Keep showing up.",
      "NARRATOR: Keep showing up.",
      "Keep showing up. End card: Join the waitlist.",
      "Keep showing up. On screen: Log your session.",
      "Keep showing up. (Cut to: athlete) Log the session.",
      "Sfx: stadium crowd. Keep showing up.",
      "Keep showing up. Total: 16 seconds.",
      "Keep showing up. Runtime: 12 sec.",
      "Keep showing up for 20 seconds.",
    ];
    for (const script of bad) {
      const result = validateConcept(concept({ script }));
      expect(result.ok, `should refuse: ${script}`).toBe(false);
    }
  });

  it("accepts a clean spoken script", () => {
    const result = validateConcept(concept({ script: "The last rep is not the last step. Log the session every time." }));
    expect(result.ok).toBe(true);
  });

  it("has a name for what each rule caught, so the refusal explains itself", () => {
    for (const { what, pattern } of STAGE_DIRECTION_PATTERNS) {
      expect(what.length).toBeGreaterThan(3);
      expect(pattern.test("harmless words")).toBe(false);
    }
  });
});

describe("reducing a script to what is spoken", () => {
  it("drops a leading speaker label", () => {
    expect(spokenScript("VO: Keep showing up.")).toBe("Keep showing up.");
    expect(spokenScript("v.o.: Keep showing up.")).toBe("Keep showing up.");
    expect(spokenScript("Narrator: Keep showing up.")).toBe("Keep showing up.");
  });

  it("drops quotation marks wrapping the whole line, in either style", () => {
    expect(spokenScript("\u201cKeep showing up.\u201d")).toBe("Keep showing up.");
    expect(spokenScript('"Keep showing up."')).toBe("Keep showing up.");
  });

  it("leaves quotation marks inside the line alone", () => {
    expect(spokenScript('He said "go" and went.')).toBe('He said "go" and went.');
  });

  it("does NOT silently delete an interior direction \u2014 validation must report it", () => {
    const s = "Keep showing up. Total: 16 seconds.";
    expect(spokenScript(s)).toBe(s);
    expect(validateConcept(concept({ script: s })).ok).toBe(false);
  });

  it("never throws on junk", () => {
    expect(spokenScript(undefined as unknown as string)).toBe("");
    expect(spokenScript(null as unknown as string)).toBe("");
  });
});

describe("normalising whatever the model returned", () => {
  it("produces a valid concept from a messy one", () => {
    const messy = normaliseConcept({
      title: "  Title  ",
      hook: "Hook",
      coreMessage: "Message",
      script: "VO: \u201cSpoken words.\u201d",
      rationale: "Why",
      callToAction: "Join",
      onScreenText: ["  A  ", 7, null, "B"],
      storyboard: [
        { description: "shot", veoPrompt: "prompt", seconds: 8, useAppFootage: false },
        { description: "app", veoPrompt: "", seconds: 4, useAppFootage: true, shot: "2" },
      ],
    });
    expect(messy.title).toBe("Title");
    expect(messy.script).toBe("Spoken words.");
    expect(messy.onScreenText).toEqual(["A", "B"]);
    expect(messy.storyboard?.[0].shot).toBe(1); // no shot number \u2192 position
    expect(messy.storyboard?.[1].shot).toBe(2); // string shot number \u2192 number
    expect(messy.storyboard?.[1].useAppFootage).toBe(true);
    expect(validateConcept(messy).ok).toBe(true);
  });

  it("treats useAppFootage as strictly true, never truthy", () => {
    const c = normaliseConcept({ storyboard: [{ description: "x", useAppFootage: "yes" }] });
    expect(c.storyboard?.[0].useAppFootage).toBe(false);
  });

  it("does not throw on nothing at all", () => {
    expect(() => normaliseConcept(undefined)).not.toThrow();
    expect(normaliseConcept(null).onScreenText).toEqual([]);
  });
});

describe("reading the model's payload", () => {
  it("parses the documented wrapper from a JSON string", () => {
    expect(parseConceptPayload(JSON.stringify({ concepts: [1, 2, 3] }))).toHaveLength(3);
  });
  it("accepts an already-parsed object", () => {
    expect(parseConceptPayload({ concepts: ["a"] })).toEqual(["a"]);
  });
  it("returns nothing rather than throwing on invalid JSON", () => {
    expect(parseConceptPayload("not json")).toEqual([]);
    expect(parseConceptPayload("")).toEqual([]);
    expect(parseConceptPayload(null)).toEqual([]);
    expect(parseConceptPayload({ concepts: "three" })).toEqual([]);
  });
});
