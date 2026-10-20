/**
 * ad-video — Google Veo video generation for Vaylo Ads.
 *
 * Two actions, because Veo is asynchronous and the client cannot hold a request
 * open for the minute or two a render takes:
 *
 *   action: "start"  → quotes the cost, and only then starts a render
 *   action: "poll"   → reads an in-flight operation and returns the video when ready
 *
 * The cost gate is not decoration. A single eight-second Veo clip costs more
 * than every image this project has ever generated, so `start` refuses to spend
 * anything unless the caller passes `confirm: true` AND has been shown the
 * estimate — the same planning-first shape as `ad-agent`'s image tools.
 *
 * Secrets: GOOGLE_VIDEO_API only. Deliberately NOT GOOGLE_API, which is the
 * form-analysis key: keeping them apart means a video key with a billing problem
 * cannot take photo analysis down with it, and vice versa.
 *
 * POST body:
 *   { action: "start", prompt, aspectRatio?, durationSeconds?, resolution?, model?, confirm? }
 *   { action: "poll",  operationId }
 */

import { aiCallAllowed, authenticate, readJsonBody } from "../_shared/guard.ts";
import { GEMINI_MODELS } from "../_shared/aiModels.ts";
import {
  DEFAULT_VEO_DURATION,
  buildVeoRequest,
  describeVeoError,
  estimateVeoCostUsd,
  normaliseDuration,
  parseVeoOperation,
  type VeoAspectRatio,
  type VeoResolution,
} from "../_shared/veo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const GOOGLE_VIDEO_API = Deno.env.get("GOOGLE_VIDEO_API");
const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Models the caller may ask for. Anything else falls back to the cheap tier. */
const ALLOWED_MODELS = new Set<string>([GEMINI_MODELS.VEO_LITE, GEMINI_MODELS.VEO_FAST, GEMINI_MODELS.VEO_STANDARD]);

/**
 * Brand rules, enforced at the provider rather than trusted to the prompt.
 *
 * The first live image generation in this project invented a fictitious
 * "VERIDIAN SPORTS TECH" logo and an "AI-POWERED INSIGHTS" badge. Prompt text is
 * necessary but not sufficient, so the forbidden claims are sent as a negative
 * prompt as well.
 */
const BRAND_NEGATIVE_PROMPT = [
  "text overlays",
  "captions",
  "watermarks",
  "logos",
  "brand wordmarks",
  "invented brand names",
  "prices",
  "price tags",
  "discount badges",
  "AI-powered labels",
  "clinical or medical imagery",
  "guaranteed results",
].join(", ");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await readJsonBody(req);
    if (!body) return json({ error: "Invalid request body" }, 400);

    // Tighter than the other AI endpoints on purpose: each call here is a
    // render, and a render is expensive.
    if (!(await aiCallAllowed(req, userId, "ad-video", { max: 6, windowSeconds: 60 }))) {
      return json({ error: "Too many video requests. Wait a moment and try again." }, 429);
    }

    if (!GOOGLE_VIDEO_API) {
      return json(
        {
          error: "Video generation is not configured on this deployment (GOOGLE_VIDEO_API is missing).",
          code: "not_configured",
        },
        503,
      );
    }

    const action = typeof body.action === "string" ? body.action : "";

    // ---- poll: free, and the only way to collect a finished render --------
    if (action === "poll") {
      const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
      // Only a path the provider issued is accepted. An arbitrary string here
      // would turn this endpoint into a proxy for any Google URL.
      if (!operationId || !/^models\/[\w.-]+\/operations\/[\w-]+$/.test(operationId)) {
        return json({ error: "operationId must be an operation name returned by 'start'" }, 400);
      }

      const res = await fetch(`${GOOGLE_BASE}/${operationId}`, { headers: { "x-goog-api-key": GOOGLE_VIDEO_API } });
      if (!res.ok) {
        const described = describeVeoError(res.status);
        console.error(`[ad-video] poll failed status=${res.status} code=${described.code}`);
        return json({ error: described.error, code: described.code }, described.status === 429 ? 429 : 502);
      }

      const op = parseVeoOperation(await res.json());
      if (op.error && op.state === "failed") {
        return json({ error: op.error, code: "provider_error" }, 502);
      }
      return json({ action, operationId, done: op.done, state: op.state, videoUri: op.videoUri, error: op.error });
    }

    if (action !== "start") {
      return json({ error: "action must be 'start' or 'poll'" }, 400);
    }

    // ---- start -----------------------------------------------------------
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return json({ error: "prompt is required" }, 400);
    if (prompt.length > 1500) return json({ error: "prompt is too long (max 1500 characters)" }, 400);

    const model =
      typeof body.model === "string" && ALLOWED_MODELS.has(body.model) ? body.model : GEMINI_MODELS.VEO_LITE;
    const durationSeconds = normaliseDuration(body.durationSeconds ?? DEFAULT_VEO_DURATION);
    const estimatedCostUsd = estimateVeoCostUsd(model, durationSeconds);

    const aspectRatio: VeoAspectRatio | undefined = body.aspectRatio === "16:9" || body.aspectRatio === "9:16"
      ? body.aspectRatio
      : undefined;
    const resolution: VeoResolution | undefined =
      body.resolution === "720p" || body.resolution === "1080p" ? body.resolution : undefined;

    let request: Record<string, unknown>;
    try {
      request = buildVeoRequest({
        prompt,
        negativePrompt: BRAND_NEGATIVE_PROMPT,
        aspectRatio,
        durationSeconds,
        resolution,
      });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "invalid request" }, 400);
    }

    // The gate. Nothing above this line costs money; nothing below it happens
    // without an explicit confirmation from a caller that has seen the estimate.
    if (body.confirm !== true) {
      return json({
        action,
        requiresConfirmation: true,
        model,
        durationSeconds,
        aspectRatio: aspectRatio ?? "16:9",
        estimatedCostUsd,
        estimateNote: "Estimate from the published per-second rate; the provider is the final word on cost.",
        request,
      });
    }

    const res = await fetch(`${GOOGLE_BASE}/models/${model}:predictLongRunning`, {
      method: "POST",
      headers: { "x-goog-api-key": GOOGLE_VIDEO_API, "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const described = describeVeoError(res.status);
      console.error(`[ad-video] start failed status=${res.status} code=${described.code}`);
      return json({ error: described.error, code: described.code, estimatedCostUsd }, described.status === 429 ? 429 : 502);
    }

    const op = parseVeoOperation(await res.json());
    if (!op.name) {
      return json({ error: "Google accepted the request but returned no operation to poll.", code: "no_operation" }, 502);
    }

    return json({
      action,
      model,
      durationSeconds,
      aspectRatio: aspectRatio ?? "16:9",
      estimatedCostUsd,
      operationId: op.name,
      state: op.state,
    });
  } catch (err) {
    console.error("[ad-video] unhandled", err);
    return json({ error: "Video generation failed.", code: "unhandled" }, 500);
  }
});
