import { describe, expect, it } from "vitest";
import { SOURCES, planSources, candidatePages, sourceBy } from "./researchSources.ts";

describe("source registry — capability disclosure", () => {
  it("reports the ad libraries as not queryable with owner actions named", () => {
    for (const type of ["meta_library", "tiktok_library", "google_transparency"] as const) {
      const s = sourceBy(type);
      expect(s.accessible).toBe(false);
      expect(s.requires).toBeTruthy();
      expect(s.limits.length).toBeGreaterThan(20);
    }
  });

  it("keeps the always-available paths truly available", () => {
    for (const type of ["official_page", "press", "manual"] as const) {
      expect(sourceBy(type).accessible).toBe(true);
    }
  });

  it("documents the meta API's regional scope so nobody assumes worldwide coverage", () => {
    const s = sourceBy("meta_library");
    expect(s.promises).toMatch(/EU\/UK/);
    expect(s.limits).toMatch(/NO spend/i);
  });
});

describe("planSources — what actually runs for a scope", () => {
  it("runs pages/press/manual and reports blocked libraries with reasons", () => {
    const plan = planSources({});
    expect(plan.runnable).toEqual(["official_page", "press", "manual"]);
    expect(plan.blocked).toEqual([]); // default scope does not request them
  });

  it("lists a specific blocker when a blocked library is requested", () => {
    const plan = planSources({ sourceTypes: ["official_page", "meta_library"] });
    expect(plan.runnable).toEqual(["official_page"]);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0].reason).toMatch(/Meta Ad Library API is not queryable/);
  });
});

describe("candidatePages — bounded, https-only", () => {
  it("builds press and landing candidates from the stored website", () => {
    const pages = candidatePages("https://www.runna.com");
    expect(pages.map((p) => p.url)).toContain("https://www.runna.com/");
    expect(pages.every((p) => p.url.startsWith("https://"))).toBe(true);
  });

  it("refuses non-https input", () => {
    expect(candidatePages("http://www.runna.com")).toEqual([]);
  });
});
