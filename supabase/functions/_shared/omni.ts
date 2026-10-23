// ============================================================================
// GOOGLE OMNI FLASH — the video-generation adapter for AD STUDIO.
// ----------------------------------------------------------------------------
// Google retired the entire Veo 3.1 preview family on 2026-10-22 and named
// `gemini-omni-1.1-flash` (Interactions API) as the replacement, so this module
// now wraps THAT API. Every shape below was verified against the live endpoint
// on the day of the migration (POST /v1beta/interactions with background:true;
// GET /v1beta/interactions/{id} polling; status "in_progress"; the video
// arriving inline as base64 in a steps[].model_output item).
//
//   request   POST /v1beta/interactions
//             { model: "gemini-omni-1.1-flash", input: [text(+image)], background: true,
//               response_format: { type: "video", aspect_ratio, resolution } }
//   response  { id: "v1_…", status: "in_progress", steps: [...] }
//   poll      GET /v1beta/interactions/{id}
//             → { status: "completed"|"in_progress"|"failed", steps: [
//                  { type: "model_output", content: [{ type: "video",
//                     mime_type: "video/mp4", data: base64 }] } ...] }
//
// There is no documented negative-prompt field and no documented duration
// field on this endpoint: unwanted content is phrased into the prompt text
// (see videoPrompt.ts) and the engine clips the finished MP4 to the plan's
// shot length. Duration bounds below reflect the model's 3–10s output range.
//
// Pure functions only: no Deno globals, no network, no imports.
// ============================================================================

export type OmniAspectRatio = "16:9" | "9:16";
export type OmniResolution = "360p" | "720p" | "1080p" | "4k";

/** Current GA video model on the key this deployment uses. */
export const DEFAULT_OMNI_MODEL = "gemini-omni-1.1-flash";

/**
 * Published Gemini API price at 720p: $17.50 per 1M video output tokens ×
 * 5,792 tokens/second ≈ $0.101/s. Google publishes no per-resolution breakdown
 * for the other settings, so every estimate carries the "provider is the final
 * word" caveat at the call sites.
 */
export const OMNI_COST_PER_SECOND = 0.10136;

/** The model's documented output range. */
export const OMNI_MIN_DURATION = 3;
export const OMNI_MAX_DURATION = 10;
export const DEFAULT_OMNI_DURATION = 8;

export type OmniDuration = number;

export function normaliseDuration(seconds: unknown): OmniDuration {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return DEFAULT_OMNI_DURATION;
  return Math.min(OMNI_MAX_DURATION, Math.max(OMNI_MIN_DURATION, Math.round(n * 10) / 10));
}

export interface OmniRequestInput {
  prompt: string;
  aspectRatio?: OmniAspectRatio;
  durationSeconds?: unknown;
  resolution?: OmniResolution;
  /** image → video: the still the clip should start from. */
  image?: { base64: string; mimeType: string };
}

/**
 * Build the `interactions` body.
 *
 * The image, when present, goes FIRST as a `content` item — the documented
 * image-to-video input order is image then instruction text. `duration` is
 * phrased into the prompt (e.g. "3-second clip") because the endpoint exposes
 * no duration parameter; the engine trims the actual file to the plan length.
 */
export function buildOmniRequest(input: OmniRequestInput): Record<string, unknown> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("a prompt is required");
  const duration = normaliseDuration(input.durationSeconds);

  const inputItems: Record<string, unknown>[] = [];
  if (input.image) {
    if (!input.image.base64?.trim()) throw new Error("image input needs base64 data");
    inputItems.push({ type: "image", data: input.image.base64, mime_type: input.image.mimeType || "image/jpeg" });
  }
  inputItems.push({ type: "text", text: `${duration}-second clip. ${prompt}` });

  const responseFormat: Record<string, unknown> = { type: "video" };
  if (input.aspectRatio) responseFormat.aspect_ratio = input.aspectRatio;
  if (input.resolution) responseFormat.resolution = input.resolution;

  return {
    model: DEFAULT_OMNI_MODEL,
    input: inputItems,
    background: true,
    response_format: responseFormat,
  };
}

/** Estimated USD for a call, from the published per-second rate at 720p. */
export function estimateOmniCostUsd(durationSeconds: unknown, resolution?: OmniResolution): number {
  const seconds = normaliseDuration(durationSeconds);
  // Only 720p has a published per-second conversion; other resolutions are
  // estimated at the 720p rate (the provider's bill is the final word).
  return Math.round(OMNI_COST_PER_SECOND * seconds * 100) / 100;
}

export interface ParsedOmniInteraction {
  /** Interaction id, needed verbatim for the poll ("v1_…" without prefix). */
  name: string | null;
  done: boolean;
  /** Present once the interaction finishes successfully. */
  videoBase64: string | null;
  videoMimeType: string | null;
  /** Provider-reported failure, as an actionable sentence. */
  error: string | null;
  /** Coarse state while running, for a progress message. */
  state: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const RUNNING_STATES = new Set(["queued", "in_progress", "running", "pending", "processing", "started", "unfinished"]);

function readStatus(j: Record<string, unknown>): string | null {
  const v = j.status ?? j.state;
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof j.done === "boolean") return j.done ? "completed" : "in_progress";
  return null;
}

/** Walk the interaction's step tree looking for a video content item. */
function findVideo(value: unknown, depth = 0): { data: string; mimeType: string | null } | null {
  if (depth > 6) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideo(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const type = typeof obj.type === "string" ? obj.type : "";
    if ((type === "video" || type === "video_content") && typeof obj.data === "string" && obj.data.length > 100) {
      return { data: obj.data, mimeType: str(obj.mime_type) ?? str(obj.mimeType) ?? "video/mp4" };
    }
    // SDK-only convenience fields (output_video) or nested objects.
    for (const key of ["output_video", "video"]) {
      if (obj[key] && typeof obj[key] === "object") {
        const nested = findVideo(obj[key], depth + 1);
        if (nested) return nested;
      }
    }
    if (Array.isArray(obj["steps"])) {
      const nested = findVideo(obj["steps"], depth + 1);
      if (nested) return nested;
    }
    if (Array.isArray(obj.content)) {
      const nested = findVideo(obj.content, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function readError(j: Record<string, unknown>): string | null {
  const e = j.error;
  if (typeof e === "string" && e.trim()) return e.trim();
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (str(obj.message)) return str(obj.message);
    return JSON.stringify(obj).slice(0, 400);
  }
  return null;
}

/**
 * Read an interaction from either the start response or a poll.
 *
 * Tolerates both because the same parser serves the start call and every poll,
 * and a partially-populated body from a retry degrades into "still running"
 * rather than a crash.
 */
export function parseOmniInteraction(body: unknown): ParsedOmniInteraction {
  const root = (body as Record<string, unknown>) ?? {};
  const providerMessage = readError(root);
  if (providerMessage && !root.steps && !root.id) {
    return { name: null, done: true, videoBase64: null, videoMimeType: null, error: `the video provider rejected the request: ${providerMessage}`, state: "failed" };
  }

  const id = str(root.interaction_id) ?? str(root.id) ?? str(root.name);
  const cleanId = id ? id.replace(/^interactions\//, "") : null;
  const status = readStatus(root);
  const running = status ? RUNNING_STATES.has(status) : true;

  const video = findVideo(root.steps);
  // No video content found anywhere + a terminal status → a real failure.
  const failed = status && !running && !video;

  return {
    name: cleanId,
    done: !running,
    videoBase64: video?.data ?? null,
    videoMimeType: video?.mimeType ?? null,
    error: failed ? (providerMessage ?? `the video interaction finished in state "${status}" without returning a video`) : providerMessage,
    state: status ?? (running ? "in_progress" : "completed"),
  };
}

/**
 * Turn a provider failure into something the athlete can act on.
 *
 * The causes below have completely different fixes, and a generic message
 * helps nobody. The raw body is deliberately not echoed — it can carry
 * request metadata.
 */
export function describeOmniError(status: number, detail = ""): { error: string; code: string; status: number } {
  if (status === 401 || status === 403) {
    const billing = /billing|quota|permission|not enabled/i.test(detail);
    return {
      code: billing ? "billing_or_access" : "credentials_rejected",
      status: 502,
      error: billing
        ? "The Google project cannot use video generation: enable the Generative Language API and confirm billing on the project that owns GOOGLE_VIDEO_API."
        : "Google rejected GOOGLE_VIDEO_API. Check the key is current and unrestricted for the Generative Language API.",
    };
  }
  if (status === 404) {
    return {
      code: "model_not_found",
      status: 502,
      error: "The configured video model is not available to this Google key.",
    };
  }
  if (status === 429) {
    const exhausted = /quota|resource|limit/i.test(detail);
    return {
      code: "rate_limited",
      status: 429,
      error: exhausted
        ? "This Google project's video generation quota is exhausted. Try again after the quota window resets."
        : "Google is rate limiting video generation on this project. Try again shortly.",
    };
  }
  if (status === 400) {
    const unsafe = /safety|policy|block/i.test(detail);
    return unsafe
      ? { code: "blocked_by_policy", status: 400, error: "Google blocked this clip on safety grounds. Rewrite the shot description to avoid unsafe content." }
      : { code: "invalid_request", status: 400, error: "Google rejected the clip request. Check the prompt and clip length (3–10 seconds)." };
  }
  return { code: "provider_error", status: 502, error: `Google returned ${status} while generating the video.` };
}
