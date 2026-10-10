// ============================================================================
// GOOGLE VEO — the video-generation adapter for AD STUDIO.
// ----------------------------------------------------------------------------
// Form analysis and ad video generation are the two places this project talks
// to Google, and they use different APIs: analysis is `generateContent` (see
// _shared/google.ts), video is `predictLongRunning`, which starts a long-running
// operation that has to be polled. Hence a second module rather than a function
// bolted onto the first.
//
// Every shape below was taken from the live API, not from documentation, because
// the previous integration in this project shipped a payload that was wrong in
// three places and no test caught it:
//
//   request   POST /v1beta/models/{model}:predictLongRunning
//             { instances: [{ prompt }], parameters: { aspectRatio, ... } }
//   response  { name: "models/{model}/operations/{id}" }
//   poll      GET /v1beta/{operation.name}
//             done → { response: { generateVideoResponse: { generatedSamples:
//                      [{ video: { uri } }] } } }
//
// Pure functions only: no Deno globals, no network, no imports, so this is
// unit-testable beside the rest of `_shared`.
// ============================================================================

export type VeoAspectRatio = "16:9" | "9:16";
export type VeoResolution = "720p" | "1080p";

/**
 * Cost per second of generated video, in USD, by model.
 *
 * These are the published per-second rates and they are the reason every entry
 * point in `ad-video` is consent-gated. Treated as an estimate everywhere it is
 * surfaced, never as a quote.
 */
export const VEO_COST_PER_SECOND: Record<string, number> = {
  "veo-3.1-lite-generate-preview": 0.03,
  "veo-3.1-fast-generate-preview": 0.15,
  "veo-3.1-generate-preview": 0.4,
};

/**
 * The tier used when the caller names nothing, and the rate used for a model
 * this table has never heard of.
 *
 * Lite, not Fast: an unrecognised model must never be estimated at zero, or the
 * consent prompt becomes a lie, and it must not be estimated at the most
 * expensive tier either, which would scare a user off a cheap render.
 */
export const DEFAULT_VEO_MODEL = "veo-3.1-lite-generate-preview";

/** Veo accepts a fixed set of clip lengths. Anything else is rejected. */
export const VEO_DURATIONS = [4, 6, 8] as const;

/** The default when the caller says nothing: shortest usable clip on the cheap tier. */
export const DEFAULT_VEO_DURATION = 8;

/**
 * Snap a requested duration to a length the model accepts.
 *
 * The API rejects an unsupported value outright, and a rejected call still ends
 * the user's request, so this rounds down to the nearest allowed length rather
 * than forwarding something that will fail.
 */
export function normaliseDuration(seconds: unknown): number {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return DEFAULT_VEO_DURATION;
  const allowed = VEO_DURATIONS.filter((d) => d <= n);
  return allowed.length > 0 ? Math.max(...allowed) : VEO_DURATIONS[0];
}

export interface VeoRequestInput {
  prompt: string;
  /** What must NOT appear. Brand rules land here, not in the prompt text. */
  negativePrompt?: string;
  aspectRatio?: VeoAspectRatio;
  durationSeconds?: unknown;
  resolution?: VeoResolution;
  /** Whether people may appear. Veo defaults to conservative; ads need adults. */
  personGeneration?: "allow_adult" | "dont_allow";
}

/**
 * Build the `predictLongRunning` body.
 *
 * `parameters` is omitted entirely when it carries nothing meaningful — sending
 * `{}` is accepted, but omitting it is what the API's own examples do and it
 * leaves the model's defaults alone.
 */
export function buildVeoRequest(input: VeoRequestInput): Record<string, unknown> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("a prompt is required");

  const parameters: Record<string, unknown> = {
    durationSeconds: normaliseDuration(input.durationSeconds),
  };
  if (input.aspectRatio) parameters.aspectRatio = input.aspectRatio;
  if (input.resolution) parameters.resolution = input.resolution;
  if (input.personGeneration) parameters.personGeneration = input.personGeneration;
  if (input.negativePrompt && input.negativePrompt.trim()) parameters.negativePrompt = input.negativePrompt.trim();

  return { instances: [{ prompt }], parameters };
}

/** Estimated USD for a call, from the published per-second rate. */
export function estimateVeoCostUsd(model: string, durationSeconds: unknown): number {
  const rate = VEO_COST_PER_SECOND[model] ?? VEO_COST_PER_SECOND[DEFAULT_VEO_MODEL];
  const seconds = normaliseDuration(durationSeconds);
  // Two decimals, because more precision would suggest more accuracy than a
  // published list price can support.
  return Math.round(rate * seconds * 100) / 100;
}

export interface ParsedVeoOperation {
  /** Fully-qualified operation name, needed verbatim for the poll. */
  name: string | null;
  done: boolean;
  /** Present once the operation finishes successfully. */
  videoUri: string | null;
  /** Provider-reported failure, as an actionable sentence. */
  error: string | null;
  /** Coarse state while running, for a progress message. */
  state: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Read an operation from either the start response, a poll, or an error body.
 *
 * Tolerates all three because the same parser serves the start call and every
 * poll, and because a partially-populated body from a retry should degrade into
 * "still running" rather than into a crash.
 */
export function parseVeoOperation(body: unknown): ParsedVeoOperation {
  const root = (body as Record<string, unknown>) ?? {};
  const providerError = root.error as { message?: unknown; status?: unknown } | undefined;
  if (providerError) {
    return {
      name: null,
      done: true,
      videoUri: null,
      error: str(providerError.message) ?? str(providerError.status) ?? "the video provider rejected the request",
      state: "failed",
    };
  }

  const name = str(root.name);
  const done = root.done === true;

  const response = root.response as Record<string, unknown> | undefined;
  const generated = response?.generateVideoResponse as Record<string, unknown> | undefined;
  const samples = Array.isArray(generated?.generatedSamples) ? generated.generatedSamples : [];
  const firstVideo = (samples[0] as { video?: Record<string, unknown> } | undefined)?.video;
  const videoUri = str(firstVideo?.uri);

  const metadata = root.metadata as { state?: unknown } | undefined;

  return {
    name,
    done,
    videoUri,
    error: done && !videoUri && !metadata ? "the video operation finished without returning a video" : null,
    state: str(metadata?.state) ?? (done ? "done" : "running"),
  };
}

/**
 * Turn a provider failure into something the athlete can act on.
 *
 * Mirrors `describeProviderError` in ad-agent: the four causes below have
 * completely different fixes, and a generic message helps nobody. The raw body
 * is deliberately not echoed — it can carry request metadata.
 */
export function describeVeoError(status: number, detail = ""): { error: string; code: string; status: number } {
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
    return {
      code: "rate_limited",
      status: 429,
      error: "Google is rate limiting video generation on this project. Try again shortly.",
    };
  }
  if (status === 400) {
    return {
      code: "invalid_request",
      status: 400,
      error: "Google rejected the video request. Check the prompt and clip length (4, 6 or 8 seconds).",
    };
  }
  return { code: "provider_error", status: 502, error: `Google returned ${status} while generating the video.` };
}
