// ============================================================================
// CONCEPT → RENDER PLAN tests.
//
// The join between "an approved concept" and "an FFmpeg plan". What matters here
// is that it never invents an asset, never silently drops a caption, and places
// its text timings against the advert's real length.
// ============================================================================

import { describe, expect, it } from "vitest";

import { AD_PRESETS, BRAND } from "./renderPlan";
import { MAX_ON_SCREEN_TEXT, type AdConcept } from "./campaign";
import { buildConceptRenderPlan, conceptOverlays, conceptTimeline } from "./conceptToPlan";

const concept = (over: Partial<AdConcept> = {}): AdConcept => ({
  title: "Autumn consistency",
  hook: "Rain does not cancel a session.",
  coreMessage: "Log every session and the plan gets sharper.",
  script: "Rain does not cancel a session. Log it, and the plan gets sharper. Join the waitlist.",
  rationale: "Leads with the obstacle every autumny athlete recognises.",
  callToAction: "Join the waitlist",
  onScreenText: ["RAIN OR SHINE", "Log every session"],
  storyboard: [
    { shot: 1, description: "Athlete in the rain", veoPrompt: "athlete training in rain, floodlit pitch", seconds: 8, useAppFootage: false },
    { shot: 2, description: "Real app screen", veoPrompt: "", seconds: 4, useAppFootage: true },
  ],
  ...over,
});

const input = (over: Partial<Parameters<typeof buildConceptRenderPlan>[0]> = {}) => ({
  concept: concept(),
  presetId: "reels",
  clipPaths: { 1: "/tmp/shot1.mp4", 2: "/tmp/shot2.mp4" },
  narrationPath: "/tmp/narration.mp3",
  fontFile: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  outputPath: "/tmp/out.mp4",
  ...over,
});

describe("the timeline is the advert's own arithmetic", () => {
  it("places each shot one after another", () => {
    const { totalSeconds, timeline } = conceptTimeline(concept());
    expect(totalSeconds).toBe(12);
    expect(timeline.map((t) => [t.startSeconds, t.endSeconds])).toEqual([
      [0, 8],
      [8, 12],
    ]);
  });

  it("uses the storyboard order, not the shot numbers", () => {
    const { timeline } = conceptTimeline(
      concept({
        storyboard: [
          { shot: 9, description: "second", veoPrompt: "x", seconds: 4, useAppFootage: false },
          { shot: 2, description: "first", veoPrompt: "y", seconds: 4, useAppFootage: false },
        ],
      }),
    );
    expect(timeline[0].shot).toBe(9);
    expect(timeline[0].startSeconds).toBe(0);
    expect(timeline[1].startSeconds).toBe(4);
  });

  it("keeps the order in the plan itself", () => {
    const result = buildConceptRenderPlan(input());
    expect(result.timeline.map((t) => t.shot)).toEqual([1, 2]);
    // One input per shot, in that order.
    expect(result.plan?.inputCount).toBe(3); // two clips + narration
  });
});

describe("text placement against a real length", () => {
  it("gives the title the opening and the CTA the close", () => {
    const { overlays } = conceptOverlays(concept(), 12);
    const title = overlays.find((o) => o.role === "title");
    const cta = overlays.find((o) => o.role === "cta");
    expect(title).toMatchObject({ text: "RAIN OR SHINE", startSeconds: 0 });
    expect(cta?.startSeconds).toBe(9);
    expect(cta?.endSeconds).toBe(12);
  });

  it("fits the subhead between the two, never over them", () => {
    const { overlays } = conceptOverlays(concept(), 12);
    const title = overlays.find((o) => o.role === "title")!;
    const subhead = overlays.find((o) => o.role === "subhead")!;
    const cta = overlays.find((o) => o.role === "cta")!;
    expect(subhead.startSeconds).toBe(title.endSeconds);
    expect(subhead.endSeconds).toBe(cta.startSeconds);
  });

  it("uses the brand slogan, never one written by a model", () => {
    const { overlays } = conceptOverlays(concept(), 12);
    expect(overlays.find((o) => o.role === "slogan")?.text).toBe(BRAND.slogan);
  });

  it("keeps every overlay inside the advert", () => {
    for (const total of [6, 8, 12, 20, 30]) {
      for (const o of conceptOverlays(concept(), total).overlays) {
        expect(o.startSeconds, `start at ${total}s`).toBeGreaterThanOrEqual(0);
        expect(o.endSeconds, `end at ${total}s`).toBeLessThanOrEqual(total);
        expect(o.endSeconds).toBeGreaterThan(o.startSeconds);
      }
    }
  });

  it("leaves out a caption nobody could read instead of squeezing it in", () => {
    // Two seconds cannot hold a title, a subhead and a CTA. The subhead goes.
    const { overlays, unplacedText } = conceptOverlays(concept(), 2);
    expect(overlays.map((o) => o.role)).not.toContain("subhead");
    expect(unplacedText).toContain("Log every session");
  });

  it("never places a caption too briefly to read", () => {
    for (const total of [2, 3, 4, 6, 8, 12, 30]) {
      for (const o of conceptOverlays(concept(), total).overlays) {
        expect(o.endSeconds - o.startSeconds, `role ${o.role} at ${total}s`).toBeGreaterThanOrEqual(0.8);
      }
    }
  });

  it("does not complain about a line that merely repeats the call to action", () => {
    const { overlays, unplacedText, droppedDuplicates } = conceptOverlays(
      concept({ onScreenText: ["RAIN OR SHINE", "Log every session", "Join the waitlist"] }),
      20,
    );
    expect(droppedDuplicates).toBe(1);
    expect(unplacedText).toEqual([]);
    expect(overlays.find((o) => o.role === "cta")?.text).toBe("Join the waitlist");
  });

  it("reports text with no slot rather than dropping it", () => {
    const result = buildConceptRenderPlan(
      input({ concept: concept({ onScreenText: ["A", "B", "C", "D", "E"] }) }),
    );
    expect(result.unplacedText).toEqual(["C", "D", "E"]);
    expect(result.notes.join(" ")).toMatch(/not in the advert/);
  });

  it("agrees with the concept contract about how many lines fit", () => {
    // Two lines plus the CTA's own field is exactly what the layout holds.
    const text = ["First line", "Second line", "Join the waitlist"];
    expect(text.length - 1).toBe(MAX_ON_SCREEN_TEXT);
    const { unplacedText } = conceptOverlays(concept({ onScreenText: text }), 20);
    expect(unplacedText).toEqual([]);
  });
});

describe("assets are inputs, never inventions", () => {
  it("refuses to build when a clip is missing, and says which", () => {
    const result = buildConceptRenderPlan(input({ clipPaths: { 1: "/tmp/shot1.mp4" } }));
    expect(result.ok).toBe(false);
    expect(result.plan).toBeNull();
    expect(result.missing.join(" ")).toMatch(/shot 2: a real screen recording of the app/);
  });

  it("distinguishes a missing Veo clip from missing app footage", () => {
    const result = buildConceptRenderPlan(input({ clipPaths: {} }));
    expect(result.missing.join(" ")).toMatch(/shot 1: a Veo clip \(8s\)/);
    expect(result.missing.join(" ")).toMatch(/shot 2: a real screen recording of the app \(4s\)/);
  });

  it("refuses text without a font, because the runtime has none", () => {
    const result = buildConceptRenderPlan(input({ fontFile: undefined }));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/fontFile is required/);
  });

  it("needs a font for any text at all, including the CTA and the slogan", () => {
    // There is no arrangement of a valid concept that draws no text: the call to
    // action has its own slot and the slogan is always in the end card. So a font
    // is always required, and the plan says so instead of failing at render time.
    const result = buildConceptRenderPlan(input({ concept: concept({ onScreenText: [] }), fontFile: undefined }));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/fontFile is required/);
  });

  it("refuses an unknown preset before anything is rendered", () => {
    expect(buildConceptRenderPlan(input({ presetId: "billboard" })).problems.join(" ")).toMatch(/unknown preset/);
  });

  it("flags a storyboard with nothing in it", () => {
    const result = buildConceptRenderPlan(input({ concept: concept({ storyboard: [] }) }));
    expect(result.problems.join(" ")).toMatch(/no storyboard/);
  });

  it("carries the preset's real dimensions into the plan", () => {
    for (const [id, preset] of Object.entries(AD_PRESETS)) {
      const result = buildConceptRenderPlan(input({ presetId: id }));
      expect(result.plan?.width, id).toBe(preset.width);
      expect(result.plan?.height, id).toBe(preset.height);
      expect(result.plan?.aspect, id).toBe(preset.aspect);
    }
  });
});

describe("the mix is decided, not incidental", () => {
  it("attenuates the music bed under the narration, and does not pretend to duck it", () => {
    const result = buildConceptRenderPlan(input({ musicPath: "/tmp/music.mp3" }));
    const argv = result.plan?.argv.join(" ") ?? "";
    expect(argv).toMatch(/volume=0\.35/);
    expect(argv).toContain("alimiter");
    // The renderer declares `duckTo` but implements no sidechain, so asking for
    // ducking would be a no-op dressed up as a mixing decision.
    expect(argv).not.toContain("sidechain");
    expect(result.notes.join(" ")).toMatch(/dynamic ducking is not implemented/);
  });

  it("runs the music louder when there is no narration to sit under", () => {
    const result = buildConceptRenderPlan(input({ musicPath: "/tmp/music.mp3", narrationPath: undefined }));
    expect(result.plan?.argv.join(" ")).toMatch(/volume=0\.6/);
  });

  it("drops the clips' own audio when narration is present, and keeps it otherwise", () => {
    const narrated = buildConceptRenderPlan(input());
    const silent = buildConceptRenderPlan(input({ narrationPath: undefined }));
    expect(narrated.plan?.argv.filter((a) => a === "-i").length).toBe(3); // 2 clips + narration
    expect(silent.plan?.argv.filter((a) => a === "-i").length).toBe(2); // 2 clips, no audio inputs
    expect(silent.notes.join(" ")).toMatch(/clips keep their own audio/);
  });

  it("says so when there is no music bed rather than adding unlicensed audio", () => {
    const result = buildConceptRenderPlan(input());
    expect(result.notes.join(" ")).toMatch(/No unlicensed audio is ever added/);
    expect(result.plan?.argv.some((a) => /music/i.test(a))).toBe(false);
  });

  it("overlays the supplied logo artwork when it is given one", () => {
    const result = buildConceptRenderPlan(input({ logoPath: "/work/logo.png" }));
    expect(result.request?.logo?.src).toBe("/work/logo.png");
    expect(result.plan?.inputCount).toBe(4); // 2 clips + narration + logo
    expect(result.notes.join(" ")).not.toMatch(/no logo overlay/);
  });

  it("says the advert is not brand-complete when the logo is missing", () => {
    const result = buildConceptRenderPlan(input());
    expect(result.request?.logo).toBeUndefined();
    expect(result.notes.join(" ")).toMatch(/no logo overlay/);
  });

  it("warns when an advert never shows the product", () => {
    const noAppFootage = concept({
      storyboard: [{ shot: 1, description: "runner", veoPrompt: "x", seconds: 8, useAppFootage: false }],
    });
    const result = buildConceptRenderPlan(input({ concept: noAppFootage, clipPaths: { 1: "/tmp/shot1.mp4" } }));
    expect(result.notes.join(" ")).toMatch(/never shows the product/);
  });

  it("hands the worker a request, not just an argument list", () => {
    const result = buildConceptRenderPlan(input({ musicPath: "/tmp/music.mp3" }));
    const request = result.request;
    expect(request?.presetId).toBe("reels");
    expect(request?.clips.map((c) => c.src)).toEqual(["/tmp/shot1.mp4", "/tmp/shot2.mp4"]);
    expect(request?.voiceover?.src).toBe("/tmp/narration.mp3");
    expect(request?.music?.src).toBe("/tmp/music.mp3");
    expect(request?.keepSourceAudio).toBe(false);
    expect(request?.overlays?.map((o) => o.role)).toEqual(["title", "subhead", "cta", "slogan"]);
    expect(request?.outputPath).toBe("/tmp/out.mp4");
    // And no request when the advert cannot be built, so nothing can be rendered.
    expect(buildConceptRenderPlan(input({ clipPaths: {} })).request).toBeNull();
  });

  it("trims each clip to its storyboard length", () => {
    const argv = buildConceptRenderPlan(input()).plan?.argv ?? [];
    const joined = argv.join(" ");
    // 8s for the first shot, 4s for the second, each before its own input.
    expect(joined).toContain("-ss 0 -t 8 -i /tmp/shot1.mp4");
    expect(joined).toContain("-ss 0 -t 4 -i /tmp/shot2.mp4");
    // The narration must not be trimmed by anything: it carries no trim options.
    expect(joined).toContain("/tmp/shot2.mp4 -i /tmp/narration.mp3");
  });
});
