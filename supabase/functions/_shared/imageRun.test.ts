import { afterEach, describe, expect, it } from "vitest";
import { generateBackground, editBackground, type GenerationOutcome } from "./imageRun.ts";
import type { ImageConcept } from "./imageAds.ts";

const CONCEPT: ImageConcept = {
  objective: "waitlist",
  audience: "runners 18-30",
  message: "score your sessions",
  product: "Vaylo Coach",
  angle: "score every session",
  visualDirection: "dawn track session",
  headline: "Train smarter",
  supportingCopy: "Learn. Train. Perform.",
  cta: "Join the waitlist",
  composition: "text bottom",
  placements: ["ig_feed_portrait"],
  appeal: "athletes who measure everything",
  evidenceRefs: [],
};

const BRAND = { colors: { black: "#000000", navy: "#07090f", purple: "#8505D5" }, name: "Vaylo Sports" };

/** The lazy key read is Deno-only; node tests polyfill just enough. */
async function withKeyAsync<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { Deno?: unknown };
  const prev = g.Deno;
  const env = new Map<string, string>([["ADS_OPENAI_API_KEY", "test-key"]]);
  g.Deno = { env: { get: (k: string) => env.get(k) ?? null } };
  try {
    return await fn();
  } finally {
    g.Deno = prev;
  }
}

afterEach(() => {
  // The polyfill restores itself, nothing persists.
});

describe("generateBackground — the provider contract", () => {
  it("refuses honestly when no key is configured (no network call)", async () => {
    let called = 0;
    const out = await generateBackground(CONCEPT, BRAND, "1024x1280", (async () => { called += 1; throw new Error("should not be called"); }) as unknown as typeof fetch);
    expect(out.ok).toBe(false);
    expect(out.error).toBe("IMAGE_NOT_CONFIGURED");
    expect(called).toBe(0);
  });

  it("sends the documented generation body (model, size, output_format png, n=1)", async () => {
    await withKeyAsync(async () => {
      let captured: { body: string; url: string; auth: string } | null = null;
      const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
        captured = {
          url: String(url),
          body: String(init?.body ?? ""),
          auth: String((init?.headers as Record<string, string>)?.Authorization ?? ""),
        };
        return new Response(JSON.stringify({ data: [{ b64_json: "a".repeat(2048) }] }), { status: 200 });
      }) as unknown as typeof fetch;
      const out = await generateBackground(CONCEPT, BRAND, "1024x1280", fetcher);
      expect(out.ok).toBe(true);
      expect(captured!.url).toBe("https://api.openai.com/v1/images/generations");
      expect(captured!.auth).toBe("Bearer test-key");
      const payload = JSON.parse(captured!.body);
      expect(payload.model).toBe("gpt-image-2.5-flare");
      expect(payload.size).toBe("1024x1280");
      expect(payload.output_format).toBe("png");
      expect(payload.n).toBe(1);
      expect(payload.prompt).toContain("Absolutely no text, lettering");
      expect(payload.prompt).not.toContain("Join the waitlist"); // wording stays OUT of the background prompt
    });
  });

  it("maps provider failures to honest, retryable messages", async () => {
    await withKeyAsync(async () => {
      const rate = await generateBackground(CONCEPT, BRAND, "1024x1280", (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch);
      expect(rate.ok).toBe(false);
      expect(rate.error).toContain("rate-limiting");
      const denied = await generateBackground(CONCEPT, BRAND, "1024x1280", (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
      expect(denied.error).toContain("rejected the credentials");
      const ref = await generateBackground(CONCEPT, BRAND, "1024x1280", (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch);
      expect(ref.error).toContain("HTTP 400");
      expect(ref.status).toBe(400);
    });
  });

  it("refuses an empty or implausibly small success body — never claims a fake image", async () => {
    await withKeyAsync(async () => {
      const empty = await generateBackground(CONCEPT, BRAND, "1024x1280", (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch);
      expect(empty.ok).toBe(false);
      expect(empty.error).toContain("no image data");
      const tiny = await generateBackground(CONCEPT, BRAND, "1024x1280", (async () => new Response(JSON.stringify({ data: [{ b64_json: "abc" }] }), { status: 200 })) as unknown as typeof fetch);
      expect(tiny.ok).toBe(false);
      expect(tiny.error).toContain("implausibly small");
    });
  });

  it("reports a network timeout honestly", async () => {
    await withKeyAsync(async () => {
      const fetcher = (async () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      }) as unknown as typeof fetch;
      const out = await generateBackground(CONCEPT, BRAND, "1024x1280", fetcher);
      expect(out.ok).toBe(false);
      expect(out.error).toContain("timed out");
    });
  });
});

describe("editBackground — the variant contract", () => {
  it("builds the edits payload with a data-URL image and returns the result", async () => {
    await withKeyAsync(async () => {
      let captured: string | null = null;
      const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        captured = String(init?.body ?? "");
        return new Response(JSON.stringify({ data: [{ b64_json: "b".repeat(2048) }] }), { status: 200 });
      }) as unknown as typeof fetch;
      const out = await editBackground("a".repeat(2048), "a morning track session", "1024x1280", fetcher);
      expect(out.ok).toBe(true);
      const payload = JSON.parse(captured!);
      expect(payload.model).toBe("gpt-image-2.5-flare");
      expect(payload.images[0].image_url).toMatch(/^data:image\/png;base64,/);
      expect(payload.prompt).toBe("a morning track session");
    });
  });

  it("refuses edit requests that violate the payload rules", async () => {
    await withKeyAsync(async () => {
      const out = await editBackground("", "instruction", "1024x1280", (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch);
      expect(out.ok).toBe(false);
    });
  });
});
