import { describe, expect, it, vi } from "vitest";
import { fetchPage, retrieveScope, modelJson, coerceAnalysis, ANALYSIS_SYSTEM } from "../_shared/researchRun.ts";

// ---------------------------------------------------------------------------
// fetchPage over a mocked fetcher — the real network is NOT touched here.
// ---------------------------------------------------------------------------

function res(init: { ok?: boolean; status?: number; ct?: string; body?: string }) {
  return new Response(init.body ?? "", {
    status: init.status ?? (init.ok === false ? 500 : 200),
    headers: { "content-type": init.ct ?? "text/html" },
  });
}

describe("fetchPage", () => {
  it("returns extracted html for a text response", async () => {
    const r = await fetchPage("https://x.test/", async () => res({ body: "<h1>hi</h1>", ct: "text/html; charset=utf-8" }));
    expect(r.ok).toBe(true);
    expect(r.html).toContain("hi");
  });

  it("refuses non-textual content types", async () => {
    const r = await fetchPage("https://x.test/img", async () => res({ body: "xx", ct: "image/png" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not textual/);
  });

  it("surfaces non-200 statuses", async () => {
    const r = await fetchPage("https://x.test/", async () => res({ ok: false, status: 403 }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("HTTP 403");
  });

  it("maps an aborted fetch to the 'timeout' error path, not a crash", async () => {
    const fetcher = vi.fn(() => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    }) as unknown as typeof fetch;
    const r = await fetchPage("https://x.test/", fetcher);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("timeout");
    expect(r.html).toBe("");
  });
});

// ---------------------------------------------------------------------------
// retrieveScope — dedupe, caps and notes over the injectable fetcher
// ---------------------------------------------------------------------------

const COMPETITORS = [
  { id: "c-strava", name: "Strava", website: "https://www.strava.com" },
  { id: "c-runna", name: "Runna", website: null },
];

function fakeFetcher(pageText: Record<string, string>) {
  return (async (url: string) => {
    const body = pageText[url];
    if (body === undefined) return res({ ok: false, status: 404 });
    return res({ body });
  }) as unknown as typeof fetch;
}

describe("retrieveScope", () => {
  it("discloses when a manual-only scope has nothing retrievable", async () => {
    const out = await retrieveScope(COMPETITORS, { sourceTypes: ["manual"], refresh: false }, new Map(), fakeFetcher({}));
    expect(out.fetches).toBe(0);
    expect(out.findings).toEqual([]);
    expect(out.notes.some((n) => n.includes("manual ingest until those APIs are approved"))).toBe(true);
  });

  it("records an honest note for competitors without a website", async () => {
    // Web scope: Strava's pages are fetched; Runna has no website on record.
    const out = await retrieveScope(COMPETITORS, { sourceTypes: [], refresh: false }, new Map(), fakeFetcher({}));
    expect(out.fetches).toBeGreaterThan(0);
    expect(out.notes.some((n) => n.includes("Runna: no website on record"))).toBe(true);
  });

  it("retrieves pages, extracts titles and text, and stores hashes", async () => {
    const pages = {
      "https://www.strava.com/": "<html><head><title>Strava</title></head><body>Record every run. Join today.</body></html>",
      "https://www.strava.com/press": "<html><title>Strava press</title><body>Runna acquisition</body></html>",
      // deliberately absent from the map → HTTP 404
    };
    const out = await retrieveScope(COMPETITORS, { sourceTypes: [], refresh: false }, new Map(), fakeFetcher(pages));
    expect(out.findings).toHaveLength(2);
    expect(out.findings[0].title).toBe("Strava");
    expect(out.findings[0].hash).toBeTruthy();
    expect(out.notes.some((n) => n.includes("news → HTTP 404"))).toBe(true);
    expect(out.fetches).toBe(3);
  });

  it("skips identical re-retrievals unless refresh is set", async () => {
    const html = "<html><title>Runna</title><body>Personalised running plans</body></html>";
    const hash = (await import("../_shared/researchPipeline.ts")).contentHash(
      (await import("../_shared/researchPipeline.ts")).extractText(html),
    );
    const known = new Map([["c-strava", new Set([hash])]]);
    const out = await retrieveScope(
      [{ id: "c-strava", name: "Strava", website: "https://www.strava.com" }],
      { sourceTypes: [], refresh: false },
      known,
      fakeFetcher({ "https://www.strava.com/": html }),
    );
    expect(out.findings).toHaveLength(0);
    expect(out.notes.some((n) => n.includes("identical to already-retrieved content"))).toBe(true);

    const refreshed = await retrieveScope(
      [{ id: "c-strava", name: "Strava", website: "https://www.strava.com" }],
      { sourceTypes: [], refresh: true },
      known,
      fakeFetcher({ "https://www.strava.com/": html }),
    );
    expect(refreshed.findings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// modelJson — keyless behaviour and good/bad payloads
// ---------------------------------------------------------------------------

describe("modelJson", () => {
  it("returns null when no key is configured (never invents output)", async () => {
    expect(await modelJson(ANALYSIS_SYSTEM, "x")).toBeNull();
  });
});

describe("coerceAnalysis keeps the honest shape", () => {
  it("drops empty captured fields so thin pages stay thin", () => {
    const a = coerceAnalysis("f1", { id: "f1", captured: { cta: "  ", positioning: "Plans that adapt" }, quotes: ["Plans that adapt"], unavailable: ["images"] });
    expect(a.captured).toEqual({ positioning: "Plans that adapt" });
    expect(a.quotes).toEqual(["Plans that adapt"]);
    expect(a.unavailable).toEqual(["images"]);
  });
});
