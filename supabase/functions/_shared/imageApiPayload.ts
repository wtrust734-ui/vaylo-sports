// ============================================================================
// OpenAI Images API — request payloads, built as pure functions.
//
// These live in `_shared` and contain no Deno globals, no network and no
// imports, so they can be unit-tested directly (vitest includes
// `supabase/functions/**`). That matters because the payload shape IS the
// integration: three of the fields below were wrong in the previous version of
// `ai-images`, and nothing would have caught it except a real provider call.
//
// The corrections, each checked against the current API reference:
//
//  1. `response_format: "b64_json"` is DEPRECATED AND UNSUPPORTED for GPT Image
//     models. The current parameter is `output_format` ("png" | "jpeg" |
//     "webp"). Sending the old one asked the API for behaviour it no longer
//     offers for these models.
//
//  2. The edit endpoint takes `images: [{ image_url }]`, not a bare base64
//     string in an `image` field. `image_url` accepts a fully-qualified URL or
//     a base64 data URL, so no multipart upload is needed from an edge function.
//
//  3. The edit endpoint accepts UP TO 16 images, which is what makes
//     "use the screenshot I just uploaded as the product shot" possible at all.
//
// Reference: https://developers.openai.com/api/reference/resources/images/methods/edit
//            https://developers.openai.com/api/reference/resources/images/methods/generate
// ============================================================================

/** The GPT Image family. Any of these works for generate and edit. */
export const IMAGE_MODELS = [
  "gpt-image-2.5-flare",
  "gpt-image-2.5-flare-2026-09-08",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-sunburst-2026-09-08",
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
  "chatgpt-image-latest",
] as const;

export type ImageModel = (typeof IMAGE_MODELS)[number] | string;

/**
 * The default. Vaylo Ads are premium-palette, text-heavy sport creative, and
 * the 2.5 family is the one that supports arbitrary output sizes, which the
 * placement export needs (9:16, 4:5, 1:1, 16:9 are none of them 1024x1024).
 */
export const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-flare";

export type OutputFormat = "png" | "jpeg" | "webp";

/** The fixed sizes every GPT Image model accepts. */
export const STANDARD_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;

export const MAX_EDIT_IMAGES = 16;
/** Documented input limit for images supplied to the edit endpoint. */
export const MAX_INPUT_IMAGE_BYTES = 50 * 1024 * 1024;
/** Documented mask limit: PNG, same dimensions as the image. */
export const MAX_MASK_BYTES = 4 * 1024 * 1024;

/**
 * GPT Image 2 and 2.5 accept arbitrary output sizes: both dimensions divisible
 * by 16, aspect ratio between 1:3 and 3:1, and no side above 3840x2160.
 *
 * Unknown/older models get the standard set only. Guessing that a model accepts
 * arbitrary sizes would turn a wrong assumption into a 400 from the provider.
 */
export const supportsArbitrarySize = (model: ImageModel): boolean =>
  /^gpt-image-2/.test(model);

export interface SizeVerdict {
  ok: boolean;
  reason?: string;
}

export function validateSize(size: string, model: ImageModel): SizeVerdict {
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(size.trim());
  if (!match) return { ok: false, reason: `size must look like 1024x1024, got "${size}"` };

  const width = Number(match[1]);
  const height = Number(match[2]);

  if ((STANDARD_SIZES as readonly string[]).includes(size.trim())) return { ok: true };

  if (!supportsArbitrarySize(model)) {
    return { ok: false, reason: `model ${model} only supports ${STANDARD_SIZES.join(", ")}` };
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    return { ok: false, reason: "both dimensions must be divisible by 16" };
  }
  const ratio = width / height;
  if (ratio < 1 / 3 || ratio > 3) {
    return { ok: false, reason: "aspect ratio must be between 1:3 and 3:1" };
  }
  if (width > 3840 || height > 3840) {
    return { ok: false, reason: "no side may exceed 3840px" };
  }
  return { ok: true };
}

/** Strip a data-URL prefix, returning the bare base64 body. */
export const stripDataUrl = (value: string): string =>
  value.includes(",") ? value.split(",")[1] : value;

/**
 * Approximate decoded byte length of base64, without decoding it. Used to reject
 * an oversized payload before it is uploaded to the provider.
 */
export const base64Bytes = (value: string): number =>
  Math.floor((stripDataUrl(value).length * 3) / 4);

/** Normalise whatever the client sent into a data URL the API accepts. */
export function toDataUrl(value: string, fallbackMime = "image/png"): string {
  const trimmed = value.trim();
  if (/^data:image\/(png|jpe?g|webp|gif|heic);base64,/i.test(trimmed)) return trimmed;
  return `data:${fallbackMime};base64,${stripDataUrl(trimmed)}`;
}

export interface GenerationInput {
  model?: ImageModel;
  prompt: string;
  n?: number;
  size?: string;
  outputFormat?: OutputFormat;
  quality?: "low" | "medium" | "high" | "auto";
}

/**
 * Build the `/v1/images/generations` body.
 *
 * Note the absence of `response_format`. GPT Image models always return
 * base64; `output_format` chooses the encoding.
 */
export function buildGenerationPayload(input: GenerationInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: input.model ?? DEFAULT_IMAGE_MODEL,
    prompt: input.prompt,
    n: Math.min(10, Math.max(1, input.n ?? 1)),
    size: input.size ?? "1024x1024",
    output_format: input.outputFormat ?? "png",
  };
  if (input.quality) payload.quality = input.quality;
  return payload;
}

export interface EditInput {
  model?: ImageModel;
  /** One or more data URLs / public URLs. Order matters: the prompt refers to them. */
  images: string[];
  prompt?: string;
  n?: number;
  size?: string;
  outputFormat?: OutputFormat;
  /** Optional PNG mask data URL, same dimensions as the first image. */
  mask?: string;
}

export interface PayloadVerdict {
  ok: boolean;
  reason?: string;
  payload?: Record<string, unknown>;
}

/**
 * Build the `/v1/images/edits` body.
 *
 * Returns a verdict rather than throwing so the function can answer with a 400
 * and a reason instead of a 500 and a stack trace.
 */
export function buildEditPayload(input: EditInput): PayloadVerdict {
  if (input.images.length === 0) return { ok: false, reason: "at least one image is required" };
  if (input.images.length > MAX_EDIT_IMAGES) {
    return { ok: false, reason: `at most ${MAX_EDIT_IMAGES} images are accepted, got ${input.images.length}` };
  }

  const model = input.model ?? DEFAULT_IMAGE_MODEL;

  for (const image of input.images) {
    if (base64Bytes(image) > MAX_INPUT_IMAGE_BYTES) {
      return { ok: false, reason: "an input image is larger than 50 MB" };
    }
  }

  const size = input.size ?? "1024x1024";
  const sizeVerdict = validateSize(size, model);
  if (!sizeVerdict.ok) return { ok: false, reason: sizeVerdict.reason };

  if (input.mask && base64Bytes(input.mask) > MAX_MASK_BYTES) {
    return { ok: false, reason: "the mask is larger than 4 MB" };
  }

  const payload: Record<string, unknown> = {
    model,
    images: input.images.map((image) => ({ image_url: toDataUrl(image) })),
    n: Math.min(10, Math.max(1, input.n ?? 1)),
    size,
    output_format: input.outputFormat ?? "png",
  };

  if (input.prompt && input.prompt.trim()) payload.prompt = input.prompt.trim();

  // The mask is a separate documented parameter. Shape mirrors `images`, which
  // is the documented object form for this endpoint.
  if (input.mask) payload.mask = { image_url: toDataUrl(input.mask) };

  return { ok: true, payload };
}

/**
 * Read the image(s) out of a provider response, tolerating either the documented
 * `data[].b64_json` shape or a `data[].url` shape.
 */
export function readImageResults(body: unknown): Array<{ b64_json?: string; url?: string }> {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    // A provider error body can carry `null` or a string inside `data`. Reading
    // a property off those threw a TypeError, which turned a provider hiccup
    // into a 500 from our own function.
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((record) => ({
      b64_json: typeof record.b64_json === "string" ? record.b64_json : undefined,
      url: typeof record.url === "string" ? record.url : undefined,
    }))
    .filter((item) => item.b64_json || item.url);
}
