// ============================================================================
// MEAL IMAGE — the validation the Calorie Scan runs before anything is uploaded
// ----------------------------------------------------------------------------
// These tests cover the paths that decide whether a photo ever reaches
// ai-analyze. They run in an environment where `createImageBitmap` does not
// resolve (no image decoder in the test DOM) and `canvas.toDataURL` returns a
// stub of the right shape, so the injected failure is the decode/encode path —
// exactly the case where the old code sent the raw file and later failed at
// the provider, spending a credit for nothing.
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  MealImageError,
  MAX_EDGE_PX,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  SUPPORTED_MEAL_IMAGE_TYPES,
  normalizeMealImage,
} from "./mealImage";

const jpegDataUrl = (bytes: number) =>
  `data:image/jpeg;base64,${"A".repeat(Math.max(0, Math.round((bytes * 4) / 3)))}`;

function fakeFile(type: string, bytes: number): File {
  const blob = new Blob([new Uint8Array(bytes)], { type });
  Object.defineProperty(blob, "size", { value: bytes });
  return blob as File;
}

describe("normalizeMealImage — the pre-upload gate", () => {
  it("accepts every MIME the provider reads", () => {
    expect(SUPPORTED_MEAL_IMAGE_TYPES).toEqual(
      expect.arrayContaining(["image/jpeg", "image/png", "image/webp"]),
    );
    // accomodates the modern camera phones too, when the browser can decode:
    expect(SUPPORTED_MEAL_IMAGE_TYPES).toContain("image/heic");
    expect(SUPPORTED_MEAL_IMAGE_TYPES).toContain("image/heif");
  });

  it("rejects an empty file without attempting a read", async () => {
    await expect(normalizeMealImage(fakeFile("image/jpeg", 0))).rejects.toThrow(MealImageError);
    await expect(normalizeMealImage(fakeFile("image/jpeg", 0))).rejects.toThrow(/empty/i);
  });

  it("rejects an oversized file before any pixel work", async () => {
    await expect(normalizeMealImage(fakeFile("image/jpeg", MAX_INPUT_BYTES + 1))).rejects.toThrow(
      /too large/i,
    );
  });

  it("rejects a non-image file with a message naming the accepted formats", async () => {
    await expect(normalizeMealImage(fakeFile("application/pdf", 500))).rejects.toThrow(/JPEG, PNG, WebP/);
  });

  it("rejects an undecodable HEIC with the camera alternative, not a provider error", async () => {
    await expect(normalizeMealImage(fakeFile("image/heic", 1200))).rejects.toMatchObject({
      name: "MealImageError",
      useCamera: true,
      message: expect.stringMatching(/HEIC/),
    });
  });

  it("rejects an undecodable JPEG as a plain read failure", async () => {
    await expect(normalizeMealImage(fakeFile("image/jpeg", 1200))).rejects.toThrow(MealImageError);
  });

  it("keeps the server under its own caps by contract", () => {
    // The output cap is below the server's decoded-image cap, so a normalising
    // client never trips validImagePayload on size.
    expect(MAX_OUTPUT_BYTES).toBeLessThan(8 * 1024 * 1024);
    expect(MAX_EDGE_PX).toBeGreaterThan(0);
  });

  it("produces a data URL the edge function accepts, after canvas encode", async () => {
    // The test DOM has no image decoder, so this exercises the fallback:
    // undecodable in tests but the real contract is asserted here.
    const bitmapStub = {
      width: 2000,
      height: 1500,
      close: () => undefined,
    } as unknown as ImageBitmap;
    const originalCreate = globalThis.createImageBitmap;
    const originalCanvas = globalThis.HTMLCanvasElement;
    // jsdom's canvas has no 2d context by default; the real code bails with a
    // MealImageError, which is acceptable behaviour in a DOM without a
    // decoder — this test asserts the shape that matters: never a raw file.
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async () => bitmapStub;
    const toDataUrl = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function () {
      return jpegDataUrl(100_000);
    };
    (HTMLCanvasElement.prototype as unknown as { getContext: () => CanvasRenderingContext2D }).getContext =
      function () {
        return { drawImage: () => undefined } as unknown as CanvasRenderingContext2D;
      };
    try {
      const url = await normalizeMealImage(fakeFile("image/jpeg", 1000));
      expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
    } finally {
      (globalThis as { createImageBitmap?: unknown }).createImageBitmap = originalCreate;
      HTMLCanvasElement.prototype.toDataURL = toDataUrl;
      (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext =
        originalCanvas === undefined ? undefined : HTMLCanvasElement.prototype.getContext;
    }
  });
});
