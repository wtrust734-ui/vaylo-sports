/**
 * ad-agent — the reasoning AI that coordinates the ad-editing tools.
 *
 * `ai-service` is a single-shot text endpoint with no tool calling, so nothing
 * in the product could previously decide between "this is a deterministic edit"
 * and "this needs the image model". This function does exactly that one job.
 *
 * It is deliberately PLANNING-FIRST, for two reasons the brief asks for:
 *
 *  - Deterministic editing must be free. The model returns ops; the browser
 *    applies them with `applyOps`, which costs nothing and cannot fail on a
 *    provider outage. This function never spends money to subtract two numbers.
 *
 *  - Paid calls need consent. `generate_image` / `edit_image` come back as a
 *    plan flagged `requiresPaidCall`, with an estimated cost, and are only
 *    executed when the caller explicitly passes `execute: true`.
 *
 * Unlike every other AI endpoint in this app, this one does NOT spend credits —
 * it is an ad-production tool, not an athlete feature, and it is not wired into
 * the credits economy. That is deliberate; see the note in the report.
 *
 * POST body:
 *   { instruction, doc, assets?, history?, model?, execute? }
 * Response:
 *   { kind: "ops", ops, explanation }
 *   { kind: "clarify", question, options }
 *   { kind: "image", tool, request, estimatedCostUsd, requiresPaidCall }
 *   { kind: "image", tool, images: [...], usage }   // only when execute: true
 */

import { aiCallAllowed, authenticate, readJsonBody } from "../_shared/guard.ts";
import {
  AD_AGENT_MODEL,
  buildAdAgentRequest,
  parseAdAgentResponse,
  type DocSummary,
} from "../_shared/adToolSchema.ts";
import {
  buildGenerationPayload,
  buildEditPayload,
  readImageResults,
  type ImageModel,
  type OutputFormat,
} from "../_shared/imageApiPayload.ts";

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

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
// The Responses API, not Chat Completions — see the note on buildAdAgentRequest.
// gpt-6-luna rejects function tools on /v1/chat/completions outright.
const OPENAI_PLAN_URL = "https://api.openai.com/v1/responses";
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images";

/**
 * Rough per-operation cost, so the UI can warn before spending. Token-based and
 * therefore an estimate, not a quote — it is labelled as such to the athlete.
 */
const ESTIMATED_COST_USD = { generate: 0.01, edit: 0.025 };

/**
 * Translate a provider failure into something actionable.
 *
 * A generic "something went wrong" is worse than useless here: the four
 * failures below have completely different fixes, and they are the four the
 * brief asks to be reported clearly.
 */
function describeProviderError(status: number, detail: string): { error: string; status: number; code: string } {
  if (status === 401 || status === 403) {
    const verification = /verif/i.test(detail);
    return {
      code: verification ? "org_not_verified" : "credentials_rejected",
      status: 502,
      error: verification
        ? "OpenAI rejected the request pending organization verification. Verify the organization in the OpenAI dashboard."
        : "OpenAI rejected the API key. Check that OPENAI_API_KEY is current and belongs to this project.",
    };
  }
  if (status === 404 || /model_not_found|does not exist/i.test(detail)) {
    return { code: "model_not_found", status: 502, error: "The configured model is not available to this OpenAI account." };
  }
  if (status === 429) {
    const quota = /quota|billing|exceeded your current/i.test(detail);
    return {
      code: quota ? "quota_exceeded" : "rate_limited",
      status: 429,
      error: quota
        ? "The OpenAI account is out of credit or has hit its spending limit. Add billing credit in the OpenAI dashboard."
        : "OpenAI is rate limiting this project. Retry shortly.",
    };
  }
  if (status === 400 && /billing|payment/i.test(detail)) {
    return { code: "billing_required", status: 402, error: "OpenAI requires a payment method on this account." };
  }
  return { code: "provider_error", status: 502, error: `OpenAI returned ${status}.` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await readJsonBody(req);
    if (!body) return json({ error: "Invalid request body" }, 400);

    if (!(await aiCallAllowed(req, userId, "ad-agent", { max: 30, windowSeconds: 60 }))) {
      return json({ error: "Too many edit requests. Wait a moment and try again." }, 429);
    }

    if (!OPENAI_API_KEY) {
      // The honest answer, not a silent mock. A demo mode belongs in the client.
      return json(
        { error: "OpenAI is not configured on this deployment (OPENAI_API_KEY is missing).", code: "not_configured" },
        503,
      );
    }

    const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
    if (!instruction) return json({ error: "instruction is required" }, 400);
    if (instruction.length > 2000) return json({ error: "instruction is too long (max 2000 characters)" }, 400);

    const doc = body.doc as DocSummary | undefined;
    if (!doc || (doc.kind !== "image" && doc.kind !== "video")) {
      return json({ error: "doc must describe the current image or video ad" }, 400);
    }

    const execute = body.execute === true;
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : AD_AGENT_MODEL;
    // Overridable so the deployment can pin a cheaper or newer image model
    // without a code change; the helper validates the rest of the payload.
    const imageModel: ImageModel | undefined =
      typeof body.imageModel === "string" && body.imageModel.trim() ? body.imageModel.trim() : undefined;

    // The client sends whatever it has; keep only well-formed asset descriptors
    // rather than trusting the shape, since it feeds straight into the prompt.
    const assets: Array<{ id: string; label: string; kind: string; screenRecording?: boolean }> = Array.isArray(
      body.assets,
    )
      ? (body.assets as unknown[]).flatMap((entry) => {
          const a = entry as Record<string, unknown> | null;
          if (!a || typeof a !== "object") return [];
          if (typeof a.id !== "string" || typeof a.label !== "string") return [];
          return [
            {
              id: a.id,
              label: a.label,
              kind: typeof a.kind === "string" ? a.kind : "image",
              screenRecording: a.screenRecording === true,
            },
          ];
        })
      : [];

    const history = (Array.isArray(body.history) ? (body.history as unknown[]) : [])
      .flatMap((entry) => {
        const m = entry as Record<string, unknown> | null;
        if (!m || typeof m !== "object") return [];
        if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") return [];
        if (typeof m.content !== "string" || !m.content.trim()) return [];
        return [{ role: m.role as "user" | "assistant" | "system", content: m.content }];
      })
      .slice(-10);

    // ---- 1. Ask the model which tool to use ------------------------------
    const agentRequest = buildAdAgentRequest({ instruction, doc, assets, history, model });

    const response = await fetch(OPENAI_PLAN_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(agentRequest),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const described = describeProviderError(response.status, detail);
      console.error(`[ad-agent] planning failed status=${response.status} code=${described.code}`);
      return json({ error: described.error, code: described.code }, described.status === 429 ? 429 : 502);
    }

    const parsed = parseAdAgentResponse(await response.json());
    if (parsed.error) {
      return json({ error: parsed.error, code: "agent_unreadable" }, 502);
    }

    const call = parsed.toolCalls[0];
    if (!call) {
      // The model answered in prose. Usually a refusal of a forbidden claim.
      return json({ kind: "reply", reply: parsed.message ?? "", model });
    }

    // ---- 2. Deterministic path: free, applied by the client --------------
    if (call.name === "apply_edit_ops") {
      const ops = Array.isArray(call.args.ops) ? call.args.ops : [];
      if (ops.length === 0) {
        return json({ kind: "reply", reply: "No change was needed for that.", model });
      }
      return json({
        kind: "ops",
        ops,
        explanation: typeof call.args.explanation === "string" ? call.args.explanation : "",
        model,
      });
    }

    if (call.name === "ask_clarification") {
      return json({
        kind: "clarify",
        question: typeof call.args.question === "string" ? call.args.question : "What would you like to change?",
        options: Array.isArray(call.args.options) ? call.args.options : [],
        model,
      });
    }

    // ---- 3. Paid path: planned first, executed only on consent -----------
    if (call.name === "generate_image" || call.name === "edit_image") {
      const tool = call.name;
      const outputFormat: OutputFormat =
        call.args.outputFormat === "jpeg" || call.args.outputFormat === "webp" ? call.args.outputFormat : "png";
      const prompt = typeof call.args.prompt === "string" ? call.args.prompt : instruction;

      if (!execute) {
        return json({
          kind: "image",
          tool,
          requiresPaidCall: true,
          estimatedCostUsd: tool === "generate_image" ? ESTIMATED_COST_USD.generate : ESTIMATED_COST_USD.edit,
          request: { prompt, size: call.args.size ?? "1024x1024", outputFormat },
          model,
        });
      }

      const references = Array.isArray(call.args.referenceAssetIds) ? (call.args.referenceAssetIds as string[]) : [];
      // Only real, resolvable images. An id alone is not bytes: sending
      // `asset:<id>` as a URL would have been wrapped into a bogus base64 body
      // and failed at the provider with a confusing error, so it is not sent.
      const referenceImages = (Array.isArray(body.referenceImages) ? (body.referenceImages as unknown[]) : []).filter(
        (image): image is string => typeof image === "string" && /^(data:image\/|https?:)/i.test(image.trim()),
      );

      let payload: Record<string, unknown> | undefined;
      let url = `${OPENAI_IMAGES_URL}/generations`;

      if (tool === "generate_image") {
        payload = buildGenerationPayload({ model: imageModel, prompt, size: call.args.size as string, outputFormat });
      } else {
        // Reference images matter: the model asked for one (usually the real
        // logo) but the client could not supply the bytes. Say so instead of
        // letting the image model invent a wordmark, which is exactly what
        // happened on the first live generation during testing.
        if (references.length > 0 && referenceImages.length === 0) {
          return json(
            {
              error: `This change needs the real asset (${references.join(", ")}). Attach it and try again.`,
              code: "missing_reference_asset",
              missingAssetIds: references,
            },
            400,
          );
        }
        const images = referenceImages;
        const built = buildEditPayload({
          model: imageModel,
          images: images.filter((i) => typeof i === "string"),
          prompt,
          size: call.args.size as string,
          outputFormat,
        });
        if (!built.ok) return json({ error: built.reason ?? "invalid image edit request", code: "invalid_request" }, 400);
        payload = built.payload;
        url = `${OPENAI_IMAGES_URL}/edits`;
      }

      const imageResponse = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!imageResponse.ok) {
        const detail = await imageResponse.text().catch(() => "");
        const described = describeProviderError(imageResponse.status, detail);
        console.error(`[ad-agent] image tool failed status=${imageResponse.status} code=${described.code}`);
        return json({ error: described.error, code: described.code }, described.status === 429 ? 429 : 502);
      }

      const imageBody = await imageResponse.json();
      const images = readImageResults(imageBody);
      if (images.length === 0) {
        return json({ error: "The image model returned no image.", code: "empty_result" }, 502);
      }

      return json({
        kind: "image",
        tool,
        images,
        outputFormat,
        size: (payload as { size?: string }).size,
        usage: (imageBody as { usage?: unknown }).usage ?? null,
        model,
      });
    }

    return json({ error: `The model asked for an unknown tool: ${call.name}`, code: "unknown_tool" }, 502);
  } catch (err) {
    console.error("[ad-agent] unhandled", err);
    return json({ error: "The editing agent failed.", code: "unhandled" }, 500);
  }
});
