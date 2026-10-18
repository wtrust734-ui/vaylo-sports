import { describe, expect, it } from "vitest";
import {
  classifyLink,
  extractText,
  extractTitle,
  extractMetaDescription,
  contentHash,
  normaliseScope,
  buildComparison,
  validateOpportunity,
  renderReport,
} from "./researchPipeline.ts";

describe("classifyLink — advertisements vs ordinary content", () => {
  it("recognises Meta ad-library records as ads", () => {
    expect(classifyLink("https://www.facebook.com/ads/library/?id=123")).toEqual({
      kind: "ad",
      sourceType: "meta_library",
    });
  });

  it("treats a brand's facebook page as organic, not an advertisement", () => {
    const link = classifyLink("https://www.facebook.com/strava");
    expect(link!.kind).toBe("organic");
    expect(link!.sourceType).toBe("social");
  });

  it("recognises the TikTok commercial-content library as ads and profiles as organic", () => {
    const lib = classifyLink("https://www.tiktok.com/commercial-content/library");
    const organic = classifyLink("https://www.tiktok.com/@runna");
    expect(lib!.kind).toBe("ad");
    expect(organic!.kind).toBe("organic");
  });

  it("classifies google transparency records as ads", () => {
    expect(classifyLink("https://adstransparency.google.com/report/advertiser/AR123")!.kind).toBe("ad");
  });

  it("classifies official pages and press", () => {
    expect(classifyLink("https://www.runna.com/pricing")?.sourceType).toBe("official_page");
    expect(classifyLink("https://press.strava.com/pb/articles/x")?.sourceType).toBe("press");
  });

  it("rejects garbage gracefully", () => {
    expect(classifyLink("not a url at all")).toBeNull();
  });
});

describe("extraction", () => {
  it("strips scripts and tags from retrieved HTML", () => {
    const html = `<html><head><title>Runna — Personalised Training</title></head>
      <script>var tracking = "never-leaks";</script>
      <body><h1>Get faster</h1><meta name="description" content="Personalised plans"></body></html>`;
    const text = extractText(html);
    expect(text).not.toContain("never-leaks");
    expect(text).toContain("Get faster");
    expect(extractTitle(html)).toBe("Runna — Personalised Training");
    expect(extractMetaDescription(html)).toBe("Personalised plans");
  });

  it("is bounded", () => {
    expect(extractText("x".repeat(20000)).length).toBeLessThanOrEqual(8000);
  });
});

describe("duplicate-result detection", () => {
  it("hashes identical content identically and different content differently", () => {
    expect(contentHash("same")).toBe(contentHash("same"));
    expect(contentHash("same")).not.toBe(contentHash("not same"));
  });
});

describe("scope validation", () => {
  it("requires at least one competitor and validates source types", () => {
    expect(normaliseScope({ competitors: [] }).ok).toBe(false);
    const bad = normaliseScope({ competitors: ["Strava"], sourceTypes: ["dark_web"] });
    expect(bad.ok).toBe(true); // unknown types are filtered, not fatal
    expect(bad.scope?.sourceTypes).toEqual([]);
    const good = normaliseScope({ competitors: ["Strava", "Runna"], topic: "personalised coaching", refresh: false });
    expect(good.ok).toBe(true);
    expect(good.scope?.competitors).toEqual(["Strava", "Runna"]);
  });
});

describe("comparison with unequal evidence", () => {
  it("never invents values when a competitor has no evidence", () => {
    const { rows, coverage } = buildComparison(
      [
        { id: "c1", name: "Strava" },
        { id: "c2", name: "Runna" },
      ],
      [
        { competitor_id: "c1", excerpt: "e", captured: { cta: "Join today", positioning: "Your record book" } },
      ],
    );
    expect(coverage).toEqual([
      { competitor: "Strava", evidenceCount: 1 },
      { competitor: "Runna", evidenceCount: 0 },
    ]);
    const ctaRow = rows.find((r) => r.dimension === "Calls to action")!;
    expect(ctaRow.rows[0].value).toBe("Join today");
    expect(ctaRow.rows[1].value).toBeNull();
  });
});

describe("opportunity validation rejects fabricated citations", () => {
  const known = new Set(["f1", "f2"]);
  const base = {
    observation: "Runna leads with plans",
    evidenceFindingIds: ["f1"],
    interpretation: "Clarity wins",
    gap: "Multi-sport",
    approach: "All-sports angle",
    suggestedFormat: "video",
    targetAudience: "18-30 athletes",
    hook: "One score across every sport",
    cta: "Join the waitlist",
    validationPlan: "A/B two hooks",
  };

  it("accepts a fully-formed opportunity with a real citation", () => {
    const v = validateOpportunity(base, known);
    expect(v.problems).toEqual([]);
    expect(v.value?.approach).toBe("All-sports angle");
  });

  it("rejects an opportunity citing findings that do not exist", () => {
    const v = validateOpportunity({ ...base, evidenceFindingIds: ["f999"] }, known);
    expect(v.problems[0]).toMatch(/not found/);
  });

  it("rejects an opportunity with missing required fields", () => {
    const clone = { ...base } as Record<string, unknown>;
    delete clone.hook;
    expect(validateOpportunity(clone, known).problems.some((p) => p.includes("hook"))).toBe(true);
  });
});

describe("report rendering discloses everything it should", () => {
  it("includes blocked sources, coverage and no-evidence markers", () => {
    const md = renderReport(
      { title: "T", scope: { competitors: ["Strava"] }, status: "partial", topic: "coaching" },
      [
        {
          title: "Strava press",
          kind: "page",
          source_type: "press",
          source_url: "https://press.strava.com/a",
          excerpt: "Runna acquisition",
          retrieved_at: "2026-10-17T10:00:00Z",
          competitor_name: "Strava",
          analysis_mode: "text",
        },
      ],
      buildComparison([{ id: "c1", name: "Strava" }], [{ competitor_id: "c1", captured: { cta: "Go" }, excerpt: "x" }]),
      [{ reason: "Meta Ad Library API is not queryable from this deployment." }],
      [],
    );
    expect(md).toContain("not queryable");
    expect(md).toContain("_no supporting evidence_");
    expect(md).toContain("https://press.strava.com/a");
    expect(md).toContain("Retrieved: 2026-10-17T10:00:00Z");
    expect(md).toContain("Unequal coverage is disclosed");
  });
});
