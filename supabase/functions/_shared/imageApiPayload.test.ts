// ============================================================================
// These tests exist because the integration IS the payload. The previous
// `ai-images` function sent `response_format: "b64_json"` and a bare base64
// `image` string, which the current API does not accept for GPT Image models.
// Nothing but a real provider call would have caught that, so the shape is
// pinned here instead.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  MAX_EDIT_IMAGES,
  buildEditPayload,
  buildGenerationPayload,
  readImageResults,
  supportsArbitrarySize,
  toDataUrl,
  validateSize,
} from "./imageApiPayload";

describe("generation payload", () => {
  it("uses output_format and never the deprecated response_format", () => {
    const payload = buildGenerationPayload({ prompt: "a dark premium sports ad" });
    expect(payload.output_format).toBe("png");
    expect(payload).not.toHaveProperty("response_format");
  });

  it("defaults to a real model id and clamps n", () => {
    const payload = buildGenerationPayload({ prompt: "x", n: 99 });
    expect(supportsArbitrarySize(payload.model as string)).toBe(true);
    expect(payload.n).toBe(10);
    expect(buildGenerationPayload({ prompt: "x", n: 0 }).n).toBe(1);
  });
});

describe("edit payload", () => {
  const image = "data:image/png;base64,AAAA";

  it("sends images as an array of { image_url }, not a bare base64 image field", () => {
    const result = buildEditPayload({ images: [image] });
    expect(result.ok).toBe(true);
    expect(result.payload).not.toHaveProperty("image");
    expect(result.payload).not.toHaveProperty("response_format");
    expect(result.payload?.images).toEqual([{ image_url: image }]);
  });

  it("supports more than one reference image, which the single-image shape could not", () => {
    const result = buildEditPayload({ images: [image, "data:image/png;base64,BBBB"] });
    expect(result.ok).toBe(true);
    expect(result.payload?.images).toHaveLength(2);
  });

  it("rejects an empty image set and an oversized set with a reason, not a throw", () => {
    expect(buildEditPayload({ images: [] })).toMatchObject({ ok: false });
    const tooMany = Array.from({ length: MAX_EDIT_IMAGES + 1 }, () => image);
    expect(buildEditPayload({ images: tooMany })).toMatchObject({
      ok: false,
      reason: expect.stringContaining(String(MAX_EDIT_IMAGES)),
    });
  });

  it("omits an empty prompt rather than sending one", () => {
    expect(buildEditPayload({ images: [image], prompt: "   " }).payload).not.toHaveProperty("prompt");
    expect(buildEditPayload({ images: [image], prompt: "darken" }).payload?.prompt).toBe("darken");
  });

  it("carries a mask when one is supplied", () => {
    const result = buildEditPayload({ images: [image], mask: "data:image/png;base64,CCCC" });
    expect(result.payload?.mask).toEqual({ image_url: "data:image/png;base64,CCCC" });
  });
});

describe("size validation", () => {
  it("accepts the standard sizes on any model", () => {
    for (const size of ["1024x1024", "1536x1024", "1024x1536"]) {
      expect(validateSize(size, "gpt-image-1").ok, size).toBe(true);
    }
  });

  it("accepts the vertical ad size on the 2.5 family", () => {
    // 1080x1920 is divisible by 16 (1080/16=67.5) -> not valid.
    expect(validateSize("1080x1920", "gpt-image-2.5-flare").ok).toBe(false);
    // The real 9:16 the placement export uses.
    expect(validateSize("1024x1824", "gpt-image-2.5-flare").ok).toBe(true);
  });

  it("rejects sizes the model cannot produce, instead of letting the provider 400", () => {
    expect(validateSize("1088x1920", "gpt-image-1")).toMatchObject({ ok: false, reason: expect.stringContaining("1024x1024") });
    expect(validateSize("1088x1920", "gpt-image-2.5-flare").ok).toBe(true);
    expect(validateSize("1000x2000", "gpt-image-2.5-flare")).toMatchObject({ ok: false, reason: expect.stringContaining("divisible by 16") });
    expect(validateSize("512x3840", "gpt-image-2.5-flare")).toMatchObject({ ok: false, reason: expect.stringContaining("1:3") });
    expect(validateSize("3840x3856", "gpt-image-2.5-flare")).toMatchObject({ ok: false, reason: expect.stringContaining("3840") });
    expect(validateSize("not-a-size", "gpt-image-2.5-flare")).toMatchObject({ ok: false });
  });

  it("refuses an invalid size through the edit builder", () => {
    const result = buildEditPayload({ images: ["data:image/png;base64,AAAA"], size: "999x999" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/divisible by 16/);
  });
});

describe("normalising input", () => {
  it("passes a data URL through untouched", () => {
    expect(toDataUrl("data:image/webp;base64,ZZZ")).toBe("data:image/webp;base64,ZZZ");
  });

  it("wraps a bare base64 body", () => {
    expect(toDataUrl("ZZZ")).toBe("data:image/png;base64,ZZZ");
  });
});

describe("reading provider responses", () => {
  it("reads the documented b64_json shape", () => {
    expect(readImageResults({ data: [{ b64_json: "AAA" }] })).toEqual([{ b64_json: "AAA", url: undefined }]);
  });

  it("tolerates a url shape and ignores junk", () => {
    expect(readImageResults({ data: [{ url: "https://x/y.png" }, {}, null] })).toEqual([
      { b64_json: undefined, url: "https://x/y.png" },
    ]);
  });

  it("returns an empty list rather than throwing on a malformed body", () => {
    expect(readImageResults(undefined)).toEqual([]);
    expect(readImageResults({ data: "nope" })).toEqual([]);
  });
});
