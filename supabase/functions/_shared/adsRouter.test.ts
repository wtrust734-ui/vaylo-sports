import { describe, expect, it } from "vitest";
import {
  classifyLocal,
  validateClassification,
  validateStep,
  CLARIFYING_QUESTION,
  type PlanStep,
} from "./adsRouter";

// ============================================================================
// Routing rules, pinned — acceptance desk for Prompt 2 §4.
// ============================================================================

describe("explicit requests route to their workflow", () => {
  it("an explicit image-ad request routes to the image workflow only", () => {
    const c = classifyLocal("Create an image ad promoting Vaylo Coach");
    expect(c.primary).toBe("image_ad");
    expect(c.steps.map((s) => s.type)).toEqual(["image_ad"]);
    expect(c.steps[0].options.format).toBe("image");
    expect(c.clarification).toBeNull();
  });

  it("an explicit video-ad request routes to the video workflow", () => {
    const c = classifyLocal("Make a 15-second video ad for launch");
    expect(c.primary).toBe("video_ad");
    expect(c.steps[0].options.format).toBe("video");
    expect(c.steps[0].options.durationSeconds).toBe(15);
  });

  it("an image request is never silently promoted into a video plan", () => {
    const c = classifyLocal("Create an image ad for Instagram, keep it as a static advertisement");
    expect(c.steps.every((s) => s.type !== "video_ad")).toBe(true);
  });

  it("a video request is never downgraded to a bare script", () => {
    const c = classifyLocal("Make a 15-second video ad");
    expect(c.steps.some((s) => s.type === "video_ad")).toBe(true);
    expect(c.clarification).toBeNull();
  });
});

describe("combined requests preserve the requested order", () => {
  it("research before creation stays in that order", () => {
    const c = classifyLocal("Research Strava and Runna before creating our campaign");
    expect(c.primary).toBe("competitor_research");
    expect(c.steps.map((s) => s.type)).toEqual(["competitor_research", "campaign_ideation"]);
  });

  it("creation-then-research keeps creation first", () => {
    const c = classifyLocal("Make a video ad, then research what Strava is running");
    expect(c.primary).toBe("video_ad");
    expect(c.steps.map((s) => s.type)).toEqual(["video_ad", "competitor_research"]);
  });

  it("known competitors are parsed from the message", () => {
    const c = classifyLocal("Research Strava and Runna before creating our campaign");
    const research = c.steps.find((s) => s.type === "competitor_research");
    expect(research?.options.competitors).toEqual(expect.arrayContaining(["strava", "runna"]));
  });
});

describe("ambiguity asks, and honest fallbacks", () => {
  it("a vague but action-shaped request asks one concise clarification", () => {
    const c = classifyLocal("help me with something for the launch");
    expect(c.clarification).toBe(CLARIFYING_QUESTION);
    expect(c.clarification!.length).toBeLessThan(240);
  });

  it("a plain question is answered, not misrouted into generation", () => {
    const c = classifyLocal("What does the asset library let me do?");
    expect(c.primary).toBe("platform_question");
    expect(c.clarification).toBeNull();
  });

  it("a plain concept request defaults to three concepts", () => {
    // No count stated — the default of three applies.
    const c = classifyLocal("Give me launch concepts");
    expect(c.primary).toBe("campaign_ideation");
    expect(c.steps[0].options.conceptCount).toBe(3);
    expect(c.clarification).toBeNull();
    // Five is explicit, so it must be honoured, and it must ask nothing.
    const cFive = classifyLocal("Give me five different launch concepts");
    expect(cFive.primary).toBe("campaign_ideation");
    expect(cFive.steps[0].options.conceptCount).toBe(5);
    expect(cFive.clarification).toBeNull();
  });
});

describe("validated workflow inputs", () => {
  it("durations are clamped into the supported band", () => {
    const c = classifyLocal("Make a 180-second video ad");
    expect(c.steps[0].options.durationSeconds).toBe(60);
    expect(validateStep(c.steps[0])).toEqual([]);
  });

  it("concept counts are clamped to the schema cap", () => {
    const c = classifyLocal("Give me 50 concepts");
    expect(c.steps[0].options.conceptCount).toBe(5);
  });

  it("a structurally invalid model answer is rejected outright", () => {
    expect(validateClassification({ primary: "image_ad", steps: [] })).toBeNull();
    expect(validateClassification({ primary: "junk", steps: [] })).toBeNull();
    expect(
      validateClassification({
        primary: "image_ad",
        steps: [{ type: "image_ad", options: { format: "video" } }],
      }),
    ).toBeNull();
    expect(
      validateClassification({
        primary: "video_ad",
        steps: [{ type: "video_ad", options: { format: "video", durationSeconds: 300 } }],
      }),
    ).toBeNull();
  });

  it("a valid model answer passes the same validator", () => {
    const good = {
      primary: "video_ad",
      steps: [
        { type: "competitor_research", options: {} },
        { type: "video_ad", options: { format: "video", durationSeconds: 15 } },
      ],
      clarification: null,
    };
    expect(validateClassification(good)).not.toBeNull();
  });
});

describe("library and revision intent", () => {
  it("an explicit library request opens the library", () => {
    const c = classifyLocal("Open the asset library");
    expect(c.primary).toBe("asset_library");
  });

  it("a revision names the part being changed", () => {
    const c = classifyLocal("Improve this advertisement's opening hook");
    expect(c.primary).toBe("creative_revision");
    expect(c.steps[0].options.revisionTarget).toBe("opening hook");
  });
});

describe("analyse, export and publish-related routing (Prompt 7)", () => {
  it("campaign results land in campaign_analyse, not research or ideation", () => {
    const c = classifyLocal("Show me the results from this campaign");
    expect(c.primary).toBe("campaign_analyse");
  });

  it("compare requests stay in the review lane with the query kept", () => {
    const c = classifyLocal("Compare these two creative concepts");
    expect(c.primary).toBe("campaign_analyse");
    expect(c.steps[0].options.query).toContain("ompare");
  });

  it("export requests carry the requested format", () => {
    const c = classifyLocal("Export the final video");
    expect(c.primary).toBe("export_asset");
    expect(c.steps[0].options.format).toBe("video");
  });

  it("publish/go-live language is never routed into a generation step", () => {
    const c = classifyLocal("Publish this ad go live today");
    expect(c.primary).toBe("platform_question");
  });

  it("the model validator accepts the new intents", () => {
    const c = validateClassification({
      primary: "campaign_analyse",
      steps: [{ type: "campaign_analyse", options: { query: "July launch campaign" } }, { type: "export_asset", options: { format: "video" } }],
      clarification: null,
    });
    expect(c).not.toBeNull();
    expect(c?.steps).toHaveLength(2);
  });
});
