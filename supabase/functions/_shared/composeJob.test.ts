import { describe, expect, it } from "vitest";
import { buildComposePlan, validateComposeRequest, verifyOutput, OUTPUT_BYTES_MIN, OUTPUT_BYTES_MAX, type ComposeJobRequest } from "./composeJob.ts";

const GOOD: ComposeJobRequest = {
  jobId: "abcd1234",
  placementId: "ig_feed_portrait",
  background: "job/bg.png",
  logo: "job/logo.png",
  text: { headline: "Train smarter", supportingCopy: "Learn. Train. Perform.", cta: "Join the waitlist" },
};

describe("validateComposeRequest", () => {
  it("accepts a well-formed request with a known placement", () => {
    const v = validateComposeRequest(GOOD);
    expect(v.ok).toBe(true);
    expect(v.request?.placementId).toBe("ig_feed_portrait");
  });

  it("defaults the placement when none given", () => {
    const v = validateComposeRequest({ jobId: "abcd1234", background: "bg", text: { headline: "h", cta: "c" } });
    expect(v.ok).toBe(true);
    expect(v.request?.placementId).toBe("ig_feed_portrait");
  });

  it("rejects junk jobIds and missing background/text", () => {
    expect(validateComposeRequest({ ...GOOD, jobId: "x" }).reason).toMatch(/jobId/);
    expect(validateComposeRequest({ jobId: "abcd1234", text: { headline: "h", cta: "c" } }).reason).toMatch(/background/);
    expect(validateComposeRequest({ jobId: "abcd1234", background: "bg", text: { headline: "", cta: "c" } }).reason).toMatch(/headline/);
    expect(validateComposeRequest({ jobId: "abcd1234", background: "bg", text: { headline: "h", cta: "" } }).reason).toMatch(/cta/);
  });

  it("rejects unknown placements with the supported list", () => {
    const v = validateComposeRequest({ ...GOOD, placementId: "vhs_tape" });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("ig_feed_portrait");
  });

  it("accepts a custom size within bounds and rejects out-of-bounds", () => {
    const okSize = validateComposeRequest({ ...GOOD, placementId: "custom", custom: { width: 1080, height: 1920 } });
    expect(okSize.ok).toBe(true);
    expect(okSize.request?.custom).toEqual({ width: 1080, height: 1920 });

    const tooSmall = validateComposeRequest({ ...GOOD, placementId: "custom", custom: { width: 100, height: 100 } });
    expect(tooSmall.reason).toMatch(/between 256 and 3840/);

    // Just past the 3:1 bound (3:1 exactly is allowed, matching imageAds).
    const tooWide = validateComposeRequest({ ...GOOD, placementId: "custom", custom: { width: 3840, height: 1280 - 16 } });
    expect(tooWide.reason).toMatch(/between 1:3 and 3:1/);
  });

  it("validates the brand purple hex format and bounds text length", () => {
    expect(validateComposeRequest({ ...GOOD, brand: { purple: "purple" } }).reason).toMatch(/#RRGGBB/);
    const longHeadline = "x".repeat(301);
    const v = validateComposeRequest({ ...GOOD, text: { headline: longHeadline, cta: "c" } });
    // trimmed to 300 by design, so it IS accepted — but never longer.
    expect(v.ok).toBe(true);
    expect(v.request?.text.headline.length).toBe(300);
  });
});

describe("buildComposePlan", () => {
  it("produces an argument array that scales/pads to the placement size", () => {
    const result = buildComposePlan({
      request: GOOD,
      backgroundPath: "/wk/job/bg.png",
      logoPath: "/wk/job/logo.png",
      fontPath: "/wk/font.ttf",
      outPath: "/wk/job/out.png",
    });
    if ("overflow" in result) throw new Error(JSON.stringify(result));
    const argv = result.plan.argv;
    expect(Array.isArray(argv)).toBe(true);
    const joined = argv.join(" ");
    expect(joined).toContain("pad=1440:1800");
    expect(joined).not.toContain("rm -rf");
  });

  it("displays the headline text in the filter chain, escaped", () => {
    const result = buildComposePlan({
      request: { ...GOOD, text: { headline: "Run: it's 5pm, now", cta: "Join" } },
      backgroundPath: "/wk/bg.png",
      logoPath: "/wk/logo.png",
      fontPath: "/wk/font.ttf",
      outPath: "/wk/out.png",
    });
    if ("overflow" in result) throw new Error(JSON.stringify(result));
    const fc = result.plan.argv[result.plan.argv.indexOf("-filter_complex") + 1];
    // apostrophe turned typographic, colon escaped
    expect(fc).toContain("Run\\: it’s 5pm, now");
    expect(fc).not.toContain("it's 5pm");
  });

  it("renders the exact composed dimensions for the placement", () => {
    const result = buildComposePlan({
      request: { ...GOOD, placementId: "fb_feed_portrait" },
      backgroundPath: "/wk/bg.png",
      fontPath: "/wk/font.ttf",
      outPath: "/wk/out.png",
    });
    if ("overflow" in result) throw new Error(JSON.stringify(result));
    expect(result.plan.argv.join(" ")).toContain("pad=1440:1800");
  });

  it("returns overflow verdicts rather than clipping, and honours allowOverflow", () => {
    const crazy = { ...GOOD, text: { headline: "This headline is far too long for a single ad frame at any reasonable font floor", supportingCopy: "y".repeat(299), cta: "Join" } };
    const refused = buildComposePlan({
      request: crazy,
      backgroundPath: "/wk/bg.png",
      fontPath: "/wk/font.ttf",
      outPath: "/wk/out.png",
    });
    if (!("overflow" in refused) || !refused.overflow.length) throw new Error("expected overflow to be refused");
    const forced = buildComposePlan({
      request: { ...crazy, allowOverflow: true },
      backgroundPath: "/wk/bg.png",
      fontPath: "/wk/font.ttf",
      outPath: "/wk/out.png",
    });
    if ("overflow" in forced) throw new Error(JSON.stringify(forced));
    expect(forced.plan.argv.length).toBeGreaterThan(0);
  });
});

describe("verifyOutput", () => {
  it("refuses to bless a missing, tiny or oversized output", () => {
    expect(verifyOutput(0)).toMatch(/no file/);
    expect(verifyOutput(OUTPUT_BYTES_MIN - 1)).toMatch(/suspiciously small/);
    expect(verifyOutput(OUTPUT_BYTES_MAX + 1)).toMatch(/exceeds .* limit/);
    expect(verifyOutput(OUTPUT_BYTES_MIN * 2)).toBeNull();
  });
});
