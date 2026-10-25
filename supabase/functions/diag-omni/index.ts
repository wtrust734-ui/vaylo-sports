// ============================================================================
// diag-omni — a LIVE probe for the Gemini Omni Flash video pipeline.
// ----------------------------------------------------------------------------
// Deployed ad hoc to verify what this project's Google key can actually reach
// before the ads-video rewrite is trusted in production. It never logs the key.
//
// Actions (all owner-authenticated):
//   models              → GET /v1beta/models (the key's own model list)
//   interactions        → POST /v1beta/interactions with background:true,
//                         then GET the interaction twice, returning every raw
//                         shape so the production parser can be written against
//                         the REAL provider response instead of assumptions.
// ============================================================================

import { authenticate, readJsonBody } from "../_shared/guard.ts";
import { buildOmniRequest } from "../_shared/omni.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const jsonResp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const g = globalThis as { Deno?: { serve?: (h: (r: Request) => Promise<Response>) => void } };
if (typeof g.Deno !== "undefined" && typeof g.Deno!.serve === "function") {
  g.Deno!.serve(handler);
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const userId = await authenticate(req);
  if (!userId) return jsonResp({ error: "Unauthorized" }, 401);

  // Null (no/invalid JSON body) behaves exactly as it did before: action stays
  // "" and the handler falls through to 400 "Unknown action". Defaulting here
  // is what lets the action branches below read body.id / body.prompt without
  // a null check each — they are only reachable when action matched, which
  // already required a parsed body.
  const body = (await readJsonBody(req)) ?? {};
  const action = typeof body.action === "string" ? body.action : "";
  const key = Deno.env.get("GOOGLE_VIDEO_API");
  if (!key) return jsonResp({ error: "GOOGLE_VIDEO_API missing" }, 503);

  try {
    if (action === "models") {
      const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
      const j = await res.json();
      const models = Array.isArray(j.models)
        ? j.models.map((m: { name?: string; supportedGenerationMethods?: string[] }) => ({
          name: m.name,
          methods: m.supportedGenerationMethods,
        }))
        : j;
      return jsonResp({ status: res.status, models }, res.status === 200 ? 200 : 502);
    }

    if (action === "generate") {
      // POST the exact kind of call ads-video's script writer makes, returning
      // the raw status (never the key) so a 404 with a message can be seen.
      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim().replace(/^models\//, "") : "gemini-2.5-flash-lite";
      const res = await fetch(`${BASE}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with the single word: ready" }] }],
          generationConfig: { maxOutputTokens: 16 },
        }),
      });
      const txt = await res.text();
      let parsed: unknown = txt;
      try { parsed = JSON.parse(txt); } catch { /* raw */ }
      return jsonResp({ model, status: res.status, body: stripData(parsed) }, res.ok ? 200 : 502);
    }

    if (action === "start") {
      // Fire ONE generation with the exact body ads-video builds, then return
      // the provider's immediate answer without waiting. Used to tell a
      // deterministic rejection (bad request/prompt) from a slow failure
      // without paying for a second call.
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      if (!prompt.trim()) return jsonResp({ error: "prompt is required" }, 400);
      let requestBody: Record<string, unknown>;
      try {
        requestBody = buildOmniRequest({
          prompt,
          aspectRatio: body.aspectRatio === "16:9" ? "16:9" : "9:16",
          durationSeconds: body.durationSeconds ?? 3.3,
          resolution: body.resolution === "720p" ? "720p" : body.resolution === "1080p" ? "1080p" : undefined,
        });
      } catch (e) {
        return jsonResp({ error: e instanceof Error ? e.message : "bad request" }, 400);
      }
      const postRes = await fetch(`${BASE}/interactions`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const txt = await postRes.text();
      let parsed: unknown = txt;
      try { parsed = JSON.parse(txt); } catch { /* raw */ }
      return jsonResp({ action: "start", httpStatus: postRes.status, body: stripData(parsed) }, postRes.ok ? 200 : 502);
    }

    if (action === "poll-interaction") {
      // Continue watching an interaction the function started earlier, without
      // starting a new (billed) generation.
      const rawId = typeof body.id === "string" ? body.id.trim() : "";
      if (!rawId) return jsonResp({ error: "id is required" }, 400);
      const id = rawId.replace(/^interactions\//, "");
      const getRes = await fetch(`${BASE}/interactions/${id}`, { headers: { "x-goog-api-key": key } });
      const getBody = await getRes.text();
      if (!getRes.ok) return jsonResp({ step: "poll", status: getRes.status, body: getBody.slice(0, 800) }, 502);
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(getBody) as Record<string, unknown>; } catch {
        return jsonResp({ step: "poll", status: getRes.status, body: getBody.slice(0, 800) }, 502);
      }
      const state = interactionState(parsed);
      return jsonResp(state && !terminalStates.has(state)
        ? { step: "poll", id, state, meta: { status: parsed.status } }
        : { step: "poll", id, status: getRes.status, state, summary: summariseVideo(parsed), fullWithoutData: stripData(parsed) });
    }

    if (action === "interactions") {
      const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : "A 3-second test clip: one red ball rolls slowly across a plain white surface in soft daylight. Silent video: no dialogue, no music, no text of any kind.";
      const postRes = await fetch(`${BASE}/interactions`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-omni-1.1-flash",
          input: prompt,
          background: true,
          response_format: { type: "video", aspect_ratio: "16:9", resolution: "360p" },
        }),
      });
      const postBody = await postRes.text();
      if (!postRes.ok) {
        return jsonResp({ step: "post", status: postRes.status, body: postBody.slice(0, 2000) }, postRes.status === 404 ? 502 : postRes.status);
      }
      const postJson = JSON.parse(postBody) as Record<string, unknown>;
      // Redact any accidental echoes of the key (belt and braces).
      const id = interactionId(postJson);
      if (!id) {
        return jsonResp({ step: "post", status: 200, note: "no interaction id found", bodyShapes: shapeOf(postJson) }, 502);
      }

      const polls: { afterSeconds: number; status: number; shapes: unknown }[] = [];
      for (const delay of [10, 15, 25, 40]) {
        await new Promise((r) => setTimeout(r, delay * 1000));
        const getRes = await fetch(`${BASE}/interactions/${id}`, { headers: { "x-goog-api-key": key } });
        const getBody = await getRes.text();
        let parsed: Record<string, unknown> | null = null;
        try { parsed = JSON.parse(getBody) as Record<string, unknown>; } catch { /* raw */ }
        polls.push({
          afterSeconds: delay,
          status: getRes.status,
          shapes: parsed ? shapeOf(parsed) : getBody.slice(0, 600),
        });
        const state = interactionState(parsed);
        if (state && terminalStates.has(state)) {
          // Final poll: trim video data lengths so the response stays small but
          // the exact field path is visible.
          const summary = summariseVideo(parsed);
          return jsonResp({ step: "poll", id, finalStatus: getRes.status, state, summary, fullWithoutData: stripData(parsed) });
        }
      }
      return jsonResp({ step: "poll-timeout", id, stateSoFar: polls });
    }

    return jsonResp({ error: "Unknown action", known: ["models", "generate", "interactions"] }, 400);
  } catch (e) {
    return jsonResp({ error: e instanceof Error ? e.message : "probe failed" }, 500);
  }
}

function shapeOf(v: unknown, depth = 0): unknown {
  if (v === null || depth > 5) return typeof v;
  if (Array.isArray(v)) {
    return v.length ? [shapeOf(v[0], depth + 1), `…${v.length} items`] : [];
  }
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = typeof val === "string" && val.length > 120 ? `string(${val.length})` : shapeOf(val, depth + 1);
    }
    return out;
  }
  return typeof v;
}

function stripData(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.map((x) => stripData(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "data" && typeof val === "string" && val.length > 64) out[k] = `base64(${val.length} chars, head=${val.slice(0, 24)})`;
      else out[k] = stripData(val, depth + 1);
    }
    return out;
  }
  return v;
}

function interactionId(j: Record<string, unknown> | null): string | null {
  if (!j) return null;
  for (const k of ["interaction_id", "id", "name"]) {
    const v = j[k];
    if (typeof v === "string" && v.trim()) return v.replace(/^interactions\//, "");
  }
  return null;
}

function interactionState(j: Record<string, unknown> | null): string | null {
  if (!j) return null;
  const v = j.status ?? j.state;
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof (j as { done?: unknown }).done === "boolean") {
    return (j as { done: boolean }).done ? "completed" : "in_progress";
  }
  return null;
}

// Real status values observed live on 2026-10-22: queued, in_progress,
// completed/failed on terminal. Treat anything in this set as still running.
const RUNNING_STATES = new Set(["queued", "in_progress", "running", "pending", "processing", "started"]);
const terminalStates = new Set(["completed", "succeeded", "failed", "error", "cancelled", "expired", "done"]);

function summariseVideo(j: Record<string, unknown> | null): unknown {
  if (!j) return null;
  const steps = Array.isArray(j.steps) ? j.steps : [];
  const videoSteps = steps
    .map((s) => s as Record<string, unknown>)
    .map((s) => ({ type: s.type, content: Array.isArray(s.content) ? s.content.map((c) => stripData(c)) : undefined }));
  return {
    topKeys: Object.keys(j),
    state: interactionState(j),
    stepTypes: steps.map((s) => (typeof (s as { type?: unknown }).type === "string" ? (s as { type: string }).type : "?")),
    videoSteps,
    hasOutputVideo: typeof (j as { output_video?: unknown }).output_video === "object",
    error: (j as { error?: unknown }).error ?? null,
  };
}
