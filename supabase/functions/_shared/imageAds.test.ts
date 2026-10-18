import { describe, expect, it } from "vitest";
import {
  PLACEMENTS,
  placementById,
  validateCustomSize,
  genBaseFor,
  validateConcept,
  buildGenerationPrompt,
  buildConceptsUserPrompt,
  CONCEPT_SYSTEM,
} from "./imageAds.ts";

describe("placement presets — verified against current platform specs", () => {
  it("covers the standard placements", () => {
    const ids = PLACEMENTS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["ig_feed_portrait", "ig_feed_square", "ig_story_reels", "tiktok_static", "fb_feed_portrait", "youtube_thumbnail"]));
  });

  it("provider-generable bases are 16-divisible and keep the ratio", () => {
    for (const p of PLACEMENTS) {
      expect(p.genWidth % 16).toBe(0);
      expect(p.genHeight % 16).toBe(0);
      const composedRatio = p.width / p.height;
      // Same ratio within 2% — composition resizes, not stretches.
      const genRatio = p.genWidth / p.genHeight;
      expect(Math.abs(genRatio - composedRatio) / composedRatio).toBeLessThan(0.02);
    }
  });

  it("stories/tikTok reserve UI areas top and bottom", () => {
    const story = placementById("ig_story_reels");
    expect(story.safeAreas.top).toBeGreaterThanOrEqual(0.1);
    expect(story.safeAreas.bottom).toBeGreaterThanOrEqual(0.2);
  });
});

describe("custom sizes", () => {
  it("composed sizes need bounds and ratio only (Meta's 1440x1800 is legitimate)", () => {
    expect(validateCustomSize(1080, 1080)).toBeNull();
    expect(validateCustomSize(1440, 1800)).toBeNull();
    // one pixel over the 3:1 bound still fails; size bounds apply regardless
    expect(validateCustomSize(3841, 1280)).toMatch(/between 256/);
    expect(validateCustomSize(48, 48)).toMatch(/between 256/);
    expect(validateCustomSize(200, 600)).toMatch(/between 256|between 1:3/);
  });

  it("genBaseFor keeps the aspect ratio and the 16-divisibility", () => {
    for (const [w, h] of [[1440, 1800], [1280, 720], [1080, 1920]]) {
      const base = genBaseFor(w, h);
      expect(base.genWidth % 16).toBe(0);
      expect(base.genHeight % 16).toBe(0);
      expect(Math.abs(base.genWidth / base.genHeight - w / h) / (w / h)).toBeLessThan(0.02);
      expect(Math.max(base.genWidth, base.genHeight)).toBeGreaterThanOrEqual(1024);
    }
  });
});

describe("concept validation", () => {
  const good = {
    objective: "installs",
    audience: "recreational runners 18-30",
    message: "One score for every sport",
    product: "VPR rating",
    angle: "categories comp",
    visualDirection: "silhouette against stadium haze, side-lit purple",
    headline: "Everyone tracks. Nobody scores you.",
    supportingCopy: "Vaylo computes your performance rating from your own logged metrics.",
    cta: "Join the waitlist",
    composition: "headline upper third, logo badge bottom-left, CTA button bottom",
    placements: ["ig_feed_portrait"],
    appeal: "athletes want comparable numbers, not diaries",
    evidenceRefs: ["f1"],
  };

  it("accepts a complete concept with an existing evidence id", () => {
    const v = validateConcept(good, new Set(["f1"]));
    expect(v.problems).toEqual([]);
    expect(v.value?.headline).toContain("Nobody scores you.");
  });

  it("rejects a concept citing findings from nowhere", () => {
    const v = validateConcept(good, new Set([]));
    expect(v.problems.join(" ")).toMatch(/citations not present/);
  });

  it("restricts placements to supported ones", () => {
    const bad = { ...good, placements: ["billboard"] };
    expect(validateConcept(bad, new Set(["f1"])).problems.join(" ")).toMatch(/placement/);
  });
});

describe("prompts", () => {
  const concept = {
    objective: "installs",
    audience: "runners",
    message: "scores over tracking",
    product: "VPR",
    angle: "comp angle",
    visualDirection: "stadium haze",
    headline: "Nobody scores you",
    supportingCopy: "Your rating from your own logs.",
    cta: "Join the waitlist",
    composition: "text lower third",
    placements: ["ig_feed_portrait"],
    appeal: "clarity",
    evidenceRefs: [],
  };
  const brand = { colors: { black: "#000000", navy: "#07090F", purple: "#8505D5" }, name: "Vaylo Sports" };

  it("generation prompt bans in-image text explicitly", () => {
    const p = buildGenerationPrompt(concept as never, brand);
    expect(p).toMatch(/no text,/i);
    expect(p).toMatch(/lettering/i);
    expect(p).toMatch(/deterministic pass/i);
    expect(p).toContain("#8505D5");
  });

  it("concept user prompt carries brand truth and only real findings", () => {
    const user = buildConceptsUserPrompt(
      { productName: "VPR", audience: "a", objective: "o", message: "m", cta: "x" },
      { name: "Vaylo Sports", slogan: "s", approvedCtas: ["Join the waitlist"], prohibitedClaims: ["no prices"] },
      3,
      [{ id: "f1", title: "Runna page", captured: { positioning: "plans" }, excerpt: "Personalised running plans." }],
    );
    const parsed = JSON.parse(user);
    expect(parsed.brand.mustNotClaim).toEqual(["no prices"]);
    expect(parsed.researchFindings[0].id).toBe("f1");
    expect(parsed.requestedConcepts).toBe(3);
    expect(CONCEPT_SYSTEM).toMatch(/never cite an id that was not supplied/);
  });
});
