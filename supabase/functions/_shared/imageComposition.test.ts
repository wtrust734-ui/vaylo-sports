import { describe, expect, it } from "vitest";
import { planComposition, buildFinalComposeArgs } from "./imageComposition.ts";
import { placementById } from "./imageAds.ts";

const TEXT = { headline: "Everyone tracks.", supportingCopy: "Nobody scores you.", cta: "Join the waitlist" };

describe("planComposition", () => {
  it("keeps the whole stack inside the placement safe areas", () => {
    const spec = planComposition(placementById("ig_story_reels"), TEXT, true);
    expect(spec.overflow).toEqual([]);
    const { headline, cta, logo } = spec.zones;
    const safeTop = Math.round(spec.height * 0.12);
    const safeBottom = Math.round(spec.height * 0.2);
    expect(headline.y).toBeGreaterThanOrEqual(safeTop);
    expect(cta.y + cta.boxH).toBeLessThanOrEqual(spec.height - safeBottom);
    expect(logo!.y).toBeGreaterThanOrEqual(safeTop);
    // CTA pads from the side margins, never edge-to-edge.
    expect(cta.x).toBeGreaterThan(0);
  });

  it("meets the headline legibility floor derived from output width", () => {
    const spec = planComposition(placementById("ig_feed_portrait"), TEXT, true);
    const floor = Math.max(48, Math.round(spec.width * 0.052));
    expect(spec.zones.headline.fontSize).toBeGreaterThanOrEqual(floor);
  });

  it("recomposes per placement rather than reusing one geometry", () => {
    const portrait = planComposition(placementById("ig_feed_portrait"), TEXT, true);
    const square = planComposition(placementById("ig_feed_square"), TEXT, true);
    expect(portrait.zones.headline.fontSize).not.toEqual(square.zones.headline.fontSize);
    expect(portrait.zones.cta.boxH).not.toEqual(square.zones.cta.boxH);
  });

  it("rejects an unreasonably long headline word as overflow rather than clipping", () => {
    const spec = planComposition(
      placementById("ig_feed_square"),
      { ...TEXT, headline: "Ultramarathontrainingprogramme" },
      true,
    );
    expect(spec.overflow.some((o) => o.includes("cannot fit the safe width"))).toBe(true);
  });

  it("rejects supporting copy that cannot fit two lines at the floor", () => {
    const spec = planComposition(placementById("ig_feed_square"), { ...TEXT, supportingCopy: "x".repeat(400) }, true);
    expect(spec.overflow.some((o) => o.includes("too long for two lines"))).toBe(true);
  });

  it("composes without a logo when none was supplied (no invented mark)", () => {
    const spec = planComposition(placementById("ig_feed_portrait"), TEXT, false);
    expect(spec.zones.logo).toBeUndefined();
    expect(spec.overflow).toEqual([]);
  });
});

describe("buildFinalComposeArgs", () => {

  it("adds a logo overlay as a second input, scaled — never redrawing the mark", () => {
    const spec = planComposition(placementById("ig_feed_portrait"), TEXT, true);
    const args = buildFinalComposeArgs({
      spec,
      backgroundPath: "/wk/bg.png",
      logoPath: "/wk/logo.jpg",
      fontPath: "/wk/font.ttf",
      outPath: "/wk/out.png",
      text: TEXT,
    });
    expect(args).toContain("/wk/logo.jpg");
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toMatch(/scale=\d+:\d+:force_original_aspect_ratio=decrease/);
    expect(fc).toMatch(/overlay=\d+:\d+/);
    expect(fc).toMatch(/\[v\]/);
    expect(args.join(" ")).not.toMatch(/-vf|shell/i);
    // argument array only
    expect(Array.isArray(args)).toBe(true);
    expect(args[0]).toBe("-y");
  });

  it("keeps text as drawtext data with escaped hazards", () => {
    const spec = planComposition(placementById("ig_feed_square"), { headline: "Run: it's 5pm, now", supportingCopy: undefined!, cta: "Join the waitlist" } as never, false);
    const args = buildFinalComposeArgs({
      spec,
      backgroundPath: "/wk/bg.png",
      fontPath: "/wk/font.ttf",
      outPath: "/wk/out.png",
      text: { headline: "Run: it's 5pm, now", cta: "Join the waitlist" },
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    // colon escaped, ASCII apostrophe turned typographic, comma survives inside quotes
    expect(fc).toContain("Run\\: it\u2019s 5pm, now");
    // the literal ASCII apostrophe never reaches the graph
    expect(fc).not.toContain("it's 5pm");
  });

  it("renders the exact composed dimensions for the placement", () => {
    const spec = planComposition(placementById("fb_feed_portrait"), TEXT, false);
    const args = buildFinalComposeArgs({ spec, backgroundPath: "/wk/bg.png", fontPath: "/wk/font.ttf", outPath: "/wk/out.png", text: TEXT });
    expect(args.join(" ")).toContain("pad=1440:1800");
  });
});
