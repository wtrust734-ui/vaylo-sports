/**
* ai-images — server-side OpenAI image generation and editing for Vaylo Ad Studio.
*
* Only the server may hold the key. This function:
*  - authenticates the caller
*  - validates and size-caps image/text payloads
*  - calls OpenAI Images API (generate / edit) with OPENAI_API_KEY from server secrets
*  - returns the generated image as base64 (the client saves it to its own storage)
*
* No frontend code ever receives the key, and no request logs the key or the provider body.
*/

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiCallAllowed, authenticate, readJsonBody } from "../_shared/guard.ts";
import {
  DEFAULT_IMAGE_MODEL,
  buildEditPayload,
  buildGenerationPayload,
  readImageResults,
  toDataUrl,
  validateSize,
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
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images";

function badRequest(message: string) {
return json({ error: message }, 400);
}

function unauthorized() {
return json({ error: "Unauthorized" }, 401);
}

Deno.serve(async (req) => {
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

try {
const userId = await authenticate(req);
if (!userId) return unauthorized();

if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

const body = await readJsonBody(req);
if (!body) return badRequest("Invalid request body");

const action = typeof body.action === "string" ? body.action : "";
if (action !== "generate" && action !== "edit") {
return badRequest("action must be 'generate' or 'edit'");
}

if (!(await aiCallAllowed(req, userId, "ai-images", { max: 20, windowSeconds: 60 }))) {
return json({ error: "Too many requests. Wait a moment and try again." }, 429);
}

if (!OPENAI_API_KEY) {
console.error("[ai-images] OPENAI_API_KEY is not configured");
return json({ error: "Image generation is not configured" }, 500);
}

const model = typeof body.model === "string" && body.model.trim().length > 0 ? body.model.trim() : DEFAULT_IMAGE_MODEL;
// `output_format` is the current parameter. `response_format` is deprecated and
// unsupported for GPT Image models, which is what this function used to send.
const outputFormat: OutputFormat =
body.output_format === "jpeg" || body.output_format === "webp" ? body.output_format : "png";
const prompt =
action === "generate"
? typeof body.prompt === "string" && body.prompt.trim().length > 0
? body.prompt.trim()
: ""
: "";

if (action === "generate") {
if (!prompt) return badRequest("prompt is required for generate");
if (prompt.length > 8000) return badRequest("prompt is too long (max 8000 characters)");

const size = typeof body.size === "string" && body.size.trim().length > 0 ? body.size.trim() : "1024x1024";

// Reject a size the model cannot produce here, with a reason, rather than
// passing it through and translating the provider's 400 into a generic failure.
const sizeVerdict = validateSize(size, model);
if (!sizeVerdict.ok) return badRequest(sizeVerdict.reason ?? "unsupported size");

const response = await fetch(`${OPENAI_IMAGES_URL}/generations`, {
method: "POST",
headers: {
Authorization: `Bearer ${OPENAI_API_KEY}`,
"Content-Type": "application/json",
},
body: JSON.stringify(
buildGenerationPayload({
model,
prompt,
n: Number.isFinite(Number(body.n)) ? Number(body.n) : 1,
size,
outputFormat,
}),
),
});

if (!response.ok) {
const detail = await response.text().catch(() => "");
console.error(`[ai-images] generate failed status=${response.status} body=${detail.slice(0, 600)}`);
if (response.status === 429) return json({ error: "Image generation is busy. Try again in a moment." }, 429);
if (response.status === 401 || response.status === 403) return json({ error: "Image generation credentials were rejected" }, 502);
return json({ error: "Image generation failed", status: response.status }, 502);
}

const payload = await response.json();
const images = readImageResults(payload);
if (images.length === 0) {
console.error("[ai-images] empty image result", JSON.stringify(payload).slice(0, 400));
return json({ error: "Image generation returned no image" }, 502);
}

return json({
action,
model,
size,
count: images.length,
images,
usage: (payload.usage as { total_tokens?: number } | null)?.total_tokens
? { total_tokens: payload.usage.total_tokens }
: null,
});
}

if (action === "edit") {
// The edit endpoint takes an ARRAY of reference images. A single `image_b64` is
// still accepted so existing callers keep working, but it is normalised into
// the documented `images[].image_url` shape below.
const rawImages: string[] = Array.isArray(body.images)
? body.images.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
: typeof body.image_b64 === "string" && body.image_b64.trim().length > 0
? [body.image_b64.trim()]
: [];

if (rawImages.length === 0) return badRequest("images (or image_b64) is required for edit");

for (const candidate of rawImages) {
const body64 = candidate.includes(",") ? candidate.split(",")[1] : candidate;
if (!/^data:(image\/(png|jpe?g|webp|gif|heic));base64,/i.test(candidate) && !/^[A-Za-z0-9+/=]+$/.test(body64)) {
return badRequest("each image must be a data URL or base64");
}
}

const editImages = rawImages.map((candidate) => toDataUrl(candidate));

const mask_b64 = typeof body.mask_b64 === "string" && body.mask_b64.trim().length > 0 ? body.mask_b64.trim() : undefined;
// The 4 MB mask cap is enforced inside buildEditPayload, along with the
// 50 MB per-image cap and the 16-image limit.
const mask_formatted = mask_b64 ? toDataUrl(mask_b64) : undefined;

const edit_prompt =
typeof body.prompt === "string" && body.prompt.trim().length > 0
? body.prompt.trim()
: "";

const size = typeof body.size === "string" && body.size.trim().length > 0 ? body.size.trim() : "1024x1024";

const editRequest = buildEditPayload({
model,
images: editImages,
prompt: edit_prompt,
n: Number.isFinite(Number(body.n)) ? Number(body.n) : 1,
size,
outputFormat,
mask: mask_formatted,
});
if (!editRequest.ok) return badRequest(editRequest.reason ?? "invalid edit request");

const response = await fetch(`${OPENAI_IMAGES_URL}/edits`, {
method: "POST",
headers: {
Authorization: `Bearer ${OPENAI_API_KEY}`,
"Content-Type": "application/json",
},
body: JSON.stringify(editRequest.payload),
});

if (!response.ok) {
const detail = await response.text().catch(() => "");
console.error(`[ai-images] edit failed status=${response.status} body=${detail.slice(0, 600)}`);
if (response.status === 429) return json({ error: "Image editing is busy. Try again in a moment." }, 429);
if (response.status === 401 || response.status === 403) return json({ error: "Image editing credentials were rejected" }, 502);
return json({ error: "Image editing failed", status: response.status }, 502);
}

const payload2 = await response.json();
const images = readImageResults(payload2);
if (images.length === 0) {
  console.error("[ai-images] empty edit result", JSON.stringify(payload2).slice(0, 400));
  return json({ error: "Image editing returned no image" }, 502);
}

      return json({
        action,
        model,
        size,
        count: images.length,
        images,
        usage: (payload2.usage as { total_tokens?: number } | null)?.total_tokens
          ? { total_tokens: payload2.usage.total_tokens }
          : null,
      });
    }

    return badRequest("action must be 'generate' or 'edit'");
  } catch (err) {
    console.error("[ai-images] unhandled", err);
    return json({ error: "Image generation failed" }, 500);
  }
});
