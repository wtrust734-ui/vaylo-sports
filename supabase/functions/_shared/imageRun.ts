// ============================================================================
// imageRun — the image-ad engine's provider-contract helpers, node-testable.
// ----------------------------------------------------------------------------
// Like researchRun for ads-research: pure-ish helpers with the network call
// injected, the key read lazily (never at module scope so the import stays
// side-effect free for tests), and model-facing output COERCED defensively
// rather than trusted.
//
// Everything here reuses the audited payload builders in imageApiPayload.ts —
// the request shape IS the integration, and those payload builders were
// verified against the current API reference (see their header notes).
// ============================================================================

import { MODELS } from "./aiModels.ts";
import {
  buildGenerationPayload,
  buildEditPayload,
  readImageResults,
  base64Bytes,
  DEFAULT_IMAGE_MODEL,
} from "./imageApiPayload.ts";
import { buildGenerationPrompt, type ImageConcept } from "./imageAds.ts";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const GEN_TIMEOUT_MS = 120_000;
const EDIT_TIMEOUT_MS = 120_000;
const CONCEPT_TIMEOUT_MS = 30_000;

/** Secrets are read lazily: module import must stay clean for node-side tests. */
function openAiKey(): string | null {
  if (typeof Deno === "undefined" || !Deno.env) return null;
  return Deno.env.get("ADS_OPENAI_API_KEY") ?? Deno.env.get("OPENAI_API_KEY") ?? null;
}

// ---------------------------------------------------------------------------
// Concepts — one metered chat call over brand + brief + (optional) findings.
// ---------------------------------------------------------------------------

async function chatJson(system: string, user: string, maxTokens: number, timeoutMs: number): Promise<Record<string, unknown> | null> {
  if (!openAiKey()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELS.MINI,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // No temperature: the GPT-6 chat class accepts only its default (1) and
        // rejects any other value. `max_completion_tokens` is likewise the only
        // token-limit parameter it accepts. Both were 400s, so the request never
        // reached the model and every concept build stopped as "unusable result".
        response_format: { type: "json_object" },
        max_completion_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // The status and the provider's own message, so a failed concept call is
      // diagnosable from the function log instead of a bare "unusable result".
      // Never includes the request body or the key.
      console.error(`[imageRun] concept chat HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 600)}`);
      return null;
    }
    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ResearchFindingLite {
  id: string;
  title: string;
  captured: Record<string, string>;
  excerpt: string;
}

export async function requestConcepts(
  system: string,
  userPrompt: string,
  fetcher: typeof fetch = fetch,
): Promise<{ concepts: unknown[] | null; hardFail?: string }> {
  const parsed = await chatJson(system, userPrompt, 2400, CONCEPT_TIMEOUT_MS);
  if (!parsed) {
    return { concepts: null, hardFail: "the concept model did not return a usable result" };
  }
  const concepts = parsed.concepts;
  if (!Array.isArray(concepts) || concepts.length === 0) {
    return { concepts: null, hardFail: "the concept model returned no concepts" };
  }
  return { concepts: concepts.slice(0, 5) };
}

// ---------------------------------------------------------------------------
// Real image generation — the provider contract.
// ---------------------------------------------------------------------------

export interface GenerationOutcome {
  ok: boolean;
  /** base64 payload of the generated background, PNG. */
  imageB64: string | null;
  size: string;
  model: string;
  /** Tokens the provider reports, for usage tracking. */
  totalTokens: number | null;
  /** Provider-style error description; names the failure without a fake URL. */
  error?: string;
  status?: number;
}

export async function generateBackground(
  concept: ImageConcept,
  brand: { colors: { black: string; navy: string; purple: string }; name: string },
  size: string,
  fetcher: typeof fetch = fetch,
): Promise<GenerationOutcome> {
  if (!openAiKey()) {
    return { ok: false, imageB64: null, size, model: DEFAULT_IMAGE_MODEL, totalTokens: null, error: "IMAGE_NOT_CONFIGURED" };
  }
  const model = DEFAULT_IMAGE_MODEL;
  const prompt = buildGenerationPrompt(concept, brand);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEN_TIMEOUT_MS);
  try {
    const res = await fetcher(`${OPENAI_IMAGES_URL}/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildGenerationPayload({ model, prompt, n: 1, size, outputFormat: "png" })),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const message = res.status === 429
        ? "the image provider is rate-limiting this project — wait a moment and retry"
        : res.status === 401 || res.status === 403
          ? "the image provider rejected the credentials"
          : `the image provider refused the request (HTTP ${res.status})`;
      return {
        ok: false, imageB64: null, size, model, totalTokens: null,
        error: message, status: res.status, ...(detail ? {} : {}),
      };
    }
    const payload = await res.json();
    const images = readImageResults(payload);
    const first = images[0];
    if (!first?.b64_json || !first.b64_json.trim()) {
      return { ok: false, imageB64: null, size, model, totalTokens: null, error: "the provider returned no image data" };
    }
    const b64 = first.b64_json.trim();
    // A provider "success" with a 1-byte or absurdly large image is a failure
    // by quality: verify BEFORE claiming anything was generated.
    const bytes = base64Bytes(b64);
    if (bytes < 1024) {
      return { ok: false, imageB64: null, size, model, totalTokens: null, error: "the provider returned an implausibly small image" };
    }
    if (bytes > 50 * 1024 * 1024) {
      return { ok: false, imageB64: null, size, model, totalTokens: null, error: "the provider returned an image beyond the size limit" };
    }
    const usage = (payload as { usage?: { total_tokens?: number } }).usage?.total_tokens;
    return {
      ok: true,
      imageB64: b64,
      size,
      model,
      totalTokens: typeof usage === "number" ? usage : null,
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false, imageB64: null, size, model, totalTokens: null,
      error: aborted ? "the image request timed out" : "the image request failed on the network",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Visual revision against the ORIGINAL background via the edits endpoint. */
export interface EditOutcome extends Omit<GenerationOutcome, "size" | "model"> {
  model: string;
}
export async function editBackground(
  originalB64: string,
  instruction: string,
  size: string,
  fetcher: typeof fetch = fetch,
): Promise<EditOutcome> {
  if (!openAiKey()) {
    return { ok: false, imageB64: null, model: DEFAULT_IMAGE_MODEL, totalTokens: null, error: "IMAGE_NOT_CONFIGURED" };
  }
  const model = DEFAULT_IMAGE_MODEL;
  const built = buildEditPayload({ model, images: [`data:image/png;base64,${originalB64}`], prompt: instruction, n: 1, size, outputFormat: "png" });
  if (!built.ok) {
    return { ok: false, imageB64: null, model, totalTokens: null, error: built.reason ?? "the edit request was invalid" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EDIT_TIMEOUT_MS);
  try {
    const res = await fetcher(`${OPENAI_IMAGES_URL}/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify(built.payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false, imageB64: null, model, totalTokens: null,
        error: res.status === 429
          ? "the image provider is rate-limiting this project"
          : res.status === 401 || res.status === 403
            ? "the image provider rejected the credentials"
            : `the image provider refused the edit (HTTP ${res.status})`,
        status: res.status, ...(detail ? {} : {}),
      };
    }
    const payload = await res.json();
    const images = readImageResults(payload);
    const first = images[0];
    if (!first?.b64_json || !first.b64_json.trim()) {
      return { ok: false, imageB64: null, model, totalTokens: null, error: "the provider returned no edited image" };
    }
    const b64 = first.b64_json.trim();
    const usage = (payload as { usage?: { total_tokens?: number } }).usage?.total_tokens;
    return { ok: true, imageB64: b64, model, totalTokens: typeof usage === "number" ? usage : null };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, imageB64: null, model, totalTokens: null, error: aborted ? "the image edit timed out" : "the image edit failed on the network" };
  } finally {
    clearTimeout(timer);
  }
}
