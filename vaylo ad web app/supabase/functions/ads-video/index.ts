// ============================================================================
// ads-video — Google Veo shot generation + render dispatch for Vaylo Ads.
//
// Concept-first pipeline (Prompt 5):
//   1. concept: turn a chat concept into a script + storyboard (Gemini).
//   2. start: launch ONE Veo shot (one prompt → one operation). Cost is gated:
//      nothing is billed until the caller passes confirm AND has seen the
//      estimate, because a single eight-second clip costs more than every
//      image this project generates.
//   3. poll: read the operation; on success the shot's asset path is recorded.
//   4. render: compose the finished advert from REAL assets only (Veo clips,
//      app footage, the supplied logo, the generated narration file) and
//      dispatch to the render worker.
//
// Honesty rules carried from Prompt 4 apply here: a concept is not an asset.
// Nothing in this file invents a substitute for a missing clip, logo or
// narration file; a missing asset is reported as missing.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { aiCallAllowed, authenticate, readJsonBody, spendForUser } from "../_shared/guard.ts";
import {
  DEFAULT_VEO_MODEL,
  buildVeoRequest,
  describeVeoError,
  estimateVeoCostUsd,
  normaliseDuration,
  parseVeoOperation,
  type VeoAspectRatio,
  type VeoResolution,
} from "../_shared/veo.ts";
import {
  type CaptionSpec,
  type StoryboardScene,
  type VideoConcept,
  estimateVideoCost,
  videoConceptToPlan,
} from "../_shared/videoAd.ts";
import {
  BRAND_NEGATIVE_PROMPT,
  buildScenePrompt,
  buildScriptPrompt,
  buildStoryboardPrompt,
  validateCaptionSpecs,
} from "../_shared/videoPrompt.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const jsonResp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const badReq = (message: string) => jsonResp({ error: message }, 400);
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const goKey = () => Deno.env.get("GOOGLE_VIDEO_API");

/** The models this deployment offers; anything else falls back to the default. */
const ALLOWED_VEO_MODELS = [DEFAULT_VEO_MODEL, "veo-3.1-fast-generate-preview"] as const;

// ---------------------------------------------------------------------------
// Test injectables — mirror the shared modules the handler is built from.
// ---------------------------------------------------------------------------

export {
  buildScriptPrompt,
  buildStoryboardPrompt,
  buildScenePrompt,
  BRAND_NEGATIVE_PROMPT,
  validateCaptionSpecs,
} from "../_shared/videoPrompt.ts";
export { estimateVideoCost, videoConceptToPlan } from "../_shared/videoAd.ts";
export { DEFAULT_VEO_MODEL, estimateVeoCostUsd, normaliseDuration } from "../_shared/veo.ts";
export type { VideoConcept, StoryboardScene, CaptionSpec } from "../_shared/videoAd.ts";

// ---------------------------------------------------------------------------
// Storyboard parsing
// ---------------------------------------------------------------------------

/**
 * Normalise a storyboard handed to this function from the chat layer. Every
 * scene keeps its real identity; only the parts the render pipeline reads are
 * coerced. A scene with no visual description is kept — its absence is *the*
 * reason the shot cannot be generated, and it must not be silently dropped.
 */
export function normaliseStoryboard(raw: unknown, durationSeconds: number): StoryboardScene[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => {
    const scene = (entry ?? {}) as Record<string, unknown>;
    const duration = Number(scene.durationSeconds) > 0 ? Number(scene.durationSeconds) : Math.max(2, Math.round((durationSeconds / 3) * 10) / 10);
    const startSeconds = Number(scene.startSeconds);
    return {
      shot: Number.isFinite(Number(scene.shot)) && Number(scene.shot) > 0 ? Number(scene.shot) : index + 1,
      startSeconds: Number.isFinite(startSeconds) ? startSeconds : 0,
      endSeconds: (Number.isFinite(startSeconds) ? startSeconds : 0) + duration,
      durationSeconds: duration,
      visualDescription: typeof scene.visualDescription === "string" ? scene.visualDescription : "",
      cameraMovement: typeof scene.cameraMovement === "string" ? scene.cameraMovement : "",
      subjectAction: typeof scene.subjectAction === "string" ? scene.subjectAction : "",
      environment: typeof scene.environment === "string" ? scene.environment : "",
      onScreenText: Array.isArray(scene.onScreenText) ? scene.onScreenText.filter((t): t is string => typeof t === "string" && t.trim().length > 0) : [],
      voiceoverSegment: typeof scene.voiceoverSegment === "string" ? scene.voiceoverSegment : "",
      soundEffects: Array.isArray(scene.soundEffects) ? scene.soundEffects.filter((s): s is string => typeof s === "string") : [],
      transition: scene.transition === "dissolve" || scene.transition === "cut" ? scene.transition : "none",
      source: typeof scene.source === "string" && scene.source.trim() ? scene.source.trim() : typeof scene.assetPath === "string" && scene.assetPath.trim() ? scene.assetPath.trim() : "",
      sourceType: typeof scene.sourceType === "string" && ["veo", "image_to_veo", "app_footage", "stock", "user_upload"].includes(scene.sourceType)
        ? scene.sourceType as StoryboardScene["sourceType"]
        : "veo",
      continuityKey: typeof scene.continuityKey === "string" && scene.continuityKey.trim() ? scene.continuityKey.trim() : "vaylo-athlete",
    };
  });
}

/**
 * The storyboard shots that still need a generated clip. Used both to show the
 * caller what has been produced and what is missing; never to fake progress.
 */
export function missingVeoShots(storyboard: StoryboardScene[]): StoryboardScene[] {
  return storyboard.filter((s) => (s.sourceType === "veo" || s.sourceType === "image_to_veo") && !s.source);
}

// ---------------------------------------------------------------------------
// Gemini script generation (the writing half of the concept pipeline)
// ---------------------------------------------------------------------------

export interface WrittenScript {
  hook: string;
  coreMessage: string;
  narrativeStructure: string;
  sceneSequence: string;
  script: string;
  onScreenText: string[];
  captions: CaptionSpec[];
}

/**
 * The model returns JSON for the script prompt; the storyboard prompt wants a
 * scenes array. Both are closed by the same rules card the prompts carry.
 */
export function parseWrittenScript(text: string): WrittenScript | null {
  const attempt = (raw: string): WrittenScript | null => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed) return null;
      const script = typeof parsed.script === "string" ? parsed.script.trim() : "";
      if (!script) return null;
      const captionsRaw = Array.isArray(parsed.captions) ? parsed.captions : [];
      const captions: CaptionSpec[] = captionsRaw.flatMap((c) => {
        if (typeof c !== "object" || c === null) return [];
        const cap = c as Record<string, unknown>;
        const start = Number(cap.startSeconds);
        const end = Number(cap.endSeconds);
        const body = typeof cap.text === "string" ? cap.text.trim() : "";
        if (!body || !Number.isFinite(start) || !Number.isFinite(end)) return [];
        return [{ startSeconds: start, endSeconds: end, text: body }];
      });
      return {
        hook: typeof parsed.hook === "string" ? parsed.hook.trim() : "",
        coreMessage: typeof parsed.coreMessage === "string" ? parsed.coreMessage.trim() : "",
        narrativeStructure: typeof parsed.narrativeStructure === "string" ? parsed.narrativeStructure.trim() : "",
        sceneSequence: typeof parsed.sceneSequence === "string" ? parsed.sceneSequence.trim() : "",
        script,
        onScreenText: Array.isArray(parsed.onScreenText) ? parsed.onScreenText.filter((t): t is string => typeof t === "string" && t.trim().length > 0) : [],
        captions,
      };
    } catch {
      return null;
    }
  };
  const direct = attempt(text.trim());
  if (direct) return direct;
  // The model sometimes wraps the JSON in prose or a code fence; take the
  // outermost brace-balanced block.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = attempt(text.slice(start, end + 1));
    if (candidate) return candidate;
  }
  return null;
}

async function geminiScript(prompt: string): Promise<{ ok: boolean; problems: string[]; script?: WrittenScript }> {
  if (!goKey()) return { ok: false, problems: ["GOOGLE_VIDEO_API is not configured"] };
  try {
    const res = await fetch(`${GEMINI_BASE}/models/gemini-2.5-flash-lite:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": goKey()!, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
      }),
    });
    if (!res.ok) {
      const described = describeVeoError(res.status, await res.text().catch(() => ""));
      console.error(`[ads-video] script generation failed status=${res.status}`, described.error);
      return { ok: false, problems: [described.error] };
    }
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (!text) return { ok: false, problems: ["the script writer returned an empty response"] };
    const parsed = parseWrittenScript(text);
    if (!parsed) return { ok: false, problems: ["the script writer returned text that could not be parsed as JSON"] };
    return { ok: true, problems: [], script: parsed };
  } catch (e) {
    console.error("[ads-video] script generation threw", e);
    return { ok: false, problems: ["script generation failed"] };
  }
}

// ---------------------------------------------------------------------------
// Concept generation: prompt → script + storyboard (no assets, no network spend)
// ---------------------------------------------------------------------------

export interface GeneratedConcept {
  concept: VideoConcept;
  storyboard: StoryboardScene[];
  script: WrittenScript;
}

export function deriveStoryboard(concept: VideoConcept): StoryboardScene[] {
  // Deterministic default storyboard: hooks and CTAs are short; an eight
  // second spot is three beats. Every shot starts as an unbilled Veo shot with
  // a shared continuity key so a multi-shot spot reads as one film.
  const shotCount = Math.min(3, Math.max(1, Math.floor(concept.durationSeconds / 3)));
  const per = Math.max(2, Math.round((concept.durationSeconds / shotCount) * 10) / 10);
  const beats = concept.sceneSequence.split(",").map((b) => b.trim()).filter(Boolean);
  const sourceTexts = [concept.hook, concept.message, concept.voiceover];
  const storyboard: StoryboardScene[] = [];
  let cursor = 0;
  for (let i = 0; i < shotCount; i++) {
    const duration = i === shotCount - 1 ? Math.max(2, concept.durationSeconds - cursor) : per;
    storyboard.push({
      shot: i + 1,
      startSeconds: Math.round(cursor * 100) / 100,
      endSeconds: Math.round((cursor + duration) * 100) / 100,
      durationSeconds: duration,
      visualDescription: beats[i] ?? sourceTexts[i % Math.max(1, sourceTexts.length)] ?? "",
      cameraMovement: i === 0 ? "slow push in" : i === shotCount - 1 ? "handheld pull out" : "lateral tracking",
      subjectAction: i === shotCount - 1 ? "athlete nods, braced, ready" : "athlete in motion, focused",
      environment: "clean outdoor training environment with brand-safe negative space",
      onScreenText: i === 0 ? concept.onScreenText.slice(0, 1) : [],
      voiceoverSegment: "",
      soundEffects: [],
      transition: "cut",
      source: "",
      sourceType: "veo",
      continuityKey: "vaylo-athlete",
    });
    cursor += duration;
  }
  return storyboard;
}

export function conceptPromptFrom(concept: VideoConcept, script: WrittenScript): string {
  return [
    `Objective: ${concept.objective}`,
    `Audience: ${concept.audience}`,
    `Hook: ${script.hook || concept.hook}`,
    `Core message: ${script.coreMessage || concept.message}`,
    `Narrative structure: ${script.narrativeStructure || concept.narrativeStructure}`,
    `Scene sequence: ${script.sceneSequence || concept.sceneSequence}`,
    `Call to action: ${concept.callToAction}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Gemini storyboard generation
// ---------------------------------------------------------------------------

async function geminiStoryboardPrompt(prompt: string): Promise<{ ok: boolean; scenes?: unknown[]; problems: string[] }> {
  if (!goKey()) return { ok: false, problems: ["GOOGLE_VIDEO_API is not configured"] };
  try {
    const res = await fetch(`${GEMINI_BASE}/models/gemini-2.5-flash-lite:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": goKey()!, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.6 },
      }),
    });
    if (!res.ok) {
      const described = describeVeoError(res.status, await res.text().catch(() => ""));
      console.error(`[ads-video] storyboard generation failed status=${res.status}`, described.error);
      return { ok: false, problems: [described.error] };
    }
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (!text) return { ok: false, problems: ["the storyboard writer returned an empty response"] };
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const candidate = start >= 0 && end > start ? text.slice(start, end + 1) : text;
    try {
      const parsed = JSON.parse(candidate) as { scenes?: unknown[] };
      if (Array.isArray(parsed.scenes) && parsed.scenes.length > 0) return { ok: true, scenes: parsed.scenes, problems: [] };
      return { ok: false, problems: ["the storyboard writer returned no scenes"] };
    } catch {
      return { ok: false, problems: ["the storyboard writer returned text that could not be parsed as JSON"] };
    }
  } catch (e) {
    console.error("[ads-video] storyboard generation threw", e);
    return { ok: false, problems: ["storyboard generation failed"] };
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const g = globalThis as { Deno?: { serve?: (h: (r: Request) => Promise<Response>) => void } };
if (typeof g.Deno !== "undefined" && typeof g.Deno!.serve === "function") {
  g.Deno!.serve(handler);
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);
  const userId = await authenticate(req);
  if (!userId) return jsonResp({ error: "Unauthorized" }, 401);

  const body = await readJsonBody(req);
  if (!body) return badReq("Invalid request body");
  const action = typeof body.action === "string" ? body.action : "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const admin = supabaseAdmin();

  try {
    switch (action) {
      case "concept":
        return await conceptAction(req, body, userId, admin);
      case "script":
        return await scriptAction(req, body, userId, admin);
      case "start":
        return await startAction(req, body, userId, admin);
      case "poll":
        return await pollAction(body, userId, admin);
      case "render":
        return await renderAction(req, body, userId, admin);
      case "jobStatus":
        return await jobStatusAction(body, userId, admin);
      default:
        return jsonResp({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("[ads-video] unhandled error", e);
    return jsonResp({ error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
}

// -------------------------------------------------------------------------
// jobStatus: read a render job's persisted state (owner-scoped, honest —
// a queued job is queued; only the worker's own writes move the status)
// -------------------------------------------------------------------------

async function jobStatusAction(body: Record<string, unknown>, userId: string, admin: AdminClient): Promise<Response> {
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) return badReq("jobId is required");
  const { data, error } = await admin
    .from("ad_video_render_jobs")
    .select("job_id, status, progress, error, storage_path, public_url")
    .eq("job_id", jobId)
    .eq("owner_id", userId)
    .single();
  if (error || !data) return jsonResp({ error: "Render job not found" }, 404);
  const row = data as Record<string, unknown>;
  return jsonResp({
    jobId: row.job_id,
    status: row.status,
    progress: row.progress,
    error: row.error ?? null,
    publicUrl: row.public_url ?? null,
  });
}

type AdminClient = ReturnType<typeof supabaseAdmin>;

function supabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// ---------------------------------------------------------------------------
// concept: full concept generation (script + storyboard + persistence)
// ---------------------------------------------------------------------------

async function conceptAction(req: Request, body: Record<string, unknown>, userId: string, admin: AdminClient): Promise<Response> {
  if (!(await aiCallAllowed(req, userId, "ads-video-concept", { max: 6, windowSeconds: 120 }))) {
    return jsonResp({ error: "Too many concept requests. Wait a moment and try again." }, 429);
  }
  if (!goKey()) {
    return jsonResp({ error: "Video generation is not configured on this deployment (GOOGLE_VIDEO_API is missing).", code: "not_configured" }, 503);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return badReq("prompt is required");
  if (prompt.length > 1500) return badReq("prompt is too long (max 1500 characters)");

  const objective = typeof body.objective === "string" && body.objective.trim() ? body.objective.trim().slice(0, 300) : "drive waitlist sign-ups";
  const audience = typeof body.audience === "string" && body.audience.trim() ? body.audience.trim().slice(0, 300) : "athletes 18-30";
  const angle = typeof body.angle === "string" ? body.angle.trim().slice(0, 600) : "";
  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 300) : prompt.slice(0, 300);
  const product = "Vaylo Sports";
  const placement = body.placement === "landscape" ? "landscape" : "reels";
  const durationSeconds = normaliseDuration(body.durationSeconds ?? 8);
  const callToAction = typeof body.callToAction === "string" && body.callToAction.trim() ? body.callToAction.trim().slice(0, 120) : "Join the waitlist";
  const appeal = typeof body.appeal === "string" ? body.appeal.trim().slice(0, 300) : "";

  const concept: VideoConcept = {
    objective,
    audience,
    angle,
    hook: "",
    message,
    product,
    narrativeStructure: "",
    sceneSequence: "",
    voiceover: "",
    onScreenText: [],
    audioDirection: "minimal, brand-safe ambience only",
    callToAction,
    durationSeconds,
    placement,
    appeal,
  };

  const brand = { name: "Vaylo Sports", slogan: "Train smarter.", positioning: "Premium, modern, ambitious sports technology" };

  const scriptPrompt = buildScriptPrompt(
    {
      objective,
      audience,
      angle: angle || message,
      message,
      product,
      durationSeconds,
      placement,
      voiceover: "",
      callToAction,
    },
    brand,
  );

  const written = await geminiScript(scriptPrompt);
  if (!written.ok || !written.script) {
    return jsonResp({ error: "Could not generate the script", problems: written.problems }, 422);
  }

  concept.hook = written.script.hook || message;
  concept.message = written.script.coreMessage || message;
  concept.onScreenText = written.script.onScreenText;
  concept.narrativeStructure = written.script.narrativeStructure;
  concept.sceneSequence = written.script.sceneSequence;
  concept.voiceover = written.script.script;

  // Storyboard: model-first, deterministic fallback so a storyboard writers
  // outage still yields a usable production plan the caller can review.
  let storyboardSource = "";
  let storyboardScenes: StoryboardScene[] = [];
  const storyboardPrompt = buildStoryboardPrompt({ ...concept }, { name: brand.name, positioning: brand.positioning }, 3);
  const generatedStoryboard = await geminiStoryboardPrompt(storyboardPrompt);
  if (generatedStoryboard.ok && generatedStoryboard.scenes) {
    const modelStoryboard = normaliseStoryboard(generatedStoryboard.scenes, durationSeconds);
    if (modelStoryboard.length > 0) storyboardScenes = modelStoryboard;
    storyboardSource = "model";
  }
  if (storyboardScenes.length === 0) {
    storyboardScenes = deriveStoryboard(concept);
    storyboardSource = "deterministic-fallback";
  }

  const conceptId = typeof body.conceptId === "string" && body.conceptId.length === 36 ? body.conceptId : crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    id: conceptId,
    owner_id: userId,
    concept_prompt: conceptPromptFrom(concept, written.script),
    model: DEFAULT_VEO_MODEL,
    duration_seconds: durationSeconds,
    aspect_ratio: placement === "reels" ? ("9:16" as const) : ("16:9" as const),
    hook: concept.hook,
    core_message: concept.message,
    script: concept.voiceover,
    storyboard: storyboardScenes,
    on_screen_text: concept.onScreenText,
    call_to_action: callToAction,
    status: "draft",
    cost_usd: 0,
    created_at: now,
    updated_at: now,
  } as Record<string, unknown>;

  const { error: insertErr } = await admin.from("ad_video_concepts").insert(row);
  if (insertErr) {
    console.error("[ads-video] could not insert concept", insertErr);
    return jsonResp({ error: "Could not save concept" }, 500);
  }

  return jsonResp({
    action: "concept",
    conceptId,
    concept: {
      id: conceptId,
      ...concept,
      aspectRatio: placement === "reels" ? "9:16" : "16:9",
    },
    storyboard: storyboardScenes,
    storyboardSource,
    captions: written.script.captions,
    hook: concept.hook,
  });
}

// ---------------------------------------------------------------------------
// script: regenerate (or refine) the script for an existing concept
// ---------------------------------------------------------------------------

async function scriptAction(req: Request, body: Record<string, unknown>, userId: string, admin: AdminClient): Promise<Response> {
  if (!(await aiCallAllowed(req, userId, "ads-video-script", { max: 6, windowSeconds: 120 }))) {
    return jsonResp({ error: "Too many script requests. Wait a moment and try again." }, 429);
  }
  if (!goKey()) {
    return jsonResp({ error: "Video generation is not configured on this deployment (GOOGLE_VIDEO_API is missing).", code: "not_configured" }, 503);
  }

  let concept: VideoConcept;
  let conceptId: string | null = null;

  const conceptRowId = typeof body.conceptId === "string" && body.conceptId.length === 36 ? body.conceptId : null;
  if (conceptRowId) {
    const { data: row, error: fetchErr } = await admin.from("ad_video_concepts").select("*").eq("id", conceptRowId).eq("owner_id", userId).maybeSingle();
    if (fetchErr || !row) return jsonResp({ error: "Concept not found" }, 404);
    const storedConcept = row as Record<string, unknown>;
    conceptId = conceptRowId;
    concept = {
      objective: typeof storedConcept.concept_prompt === "string" ? storedConcept.concept_prompt.slice(0, 300) : "drive waitlist sign-ups",
      audience: "athletes 18-30",
      angle: "",
      hook: typeof storedConcept.hook === "string" ? storedConcept.hook : "",
      message: typeof storedConcept.core_message === "string" ? storedConcept.core_message : "",
      product: "Vaylo Sports",
      narrativeStructure: "",
      sceneSequence: "",
      voiceover: typeof storedConcept.script === "string" ? storedConcept.script : "",
      onScreenText: Array.isArray(storedConcept.on_screen_text) ? (storedConcept.on_screen_text as string[]) : [],
      audioDirection: "minimal, brand-safe ambience only",
      callToAction: typeof storedConcept.call_to_action === "string" ? storedConcept.call_to_action : "Join the waitlist",
      durationSeconds: Number(storedConcept.duration_seconds) > 0 ? Number(storedConcept.duration_seconds) : 8,
      placement: storedConcept.aspect_ratio === "16:9" ? "landscape" : "reels",
      appeal: "",
    };
  } else {
    const freshConceptId = crypto.randomUUID();
    conceptId = freshConceptId;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return badReq("prompt is required when no conceptId is supplied");
    concept = {
      objective: "drive waitlist sign-ups",
      audience: "athletes 18-30",
      angle: "",
      hook: "",
      message: prompt.slice(0, 300),
      product: "Vaylo Sports",
      narrativeStructure: "",
      sceneSequence: "",
      voiceover: "",
      onScreenText: [],
      audioDirection: "minimal, brand-safe ambience only",
      callToAction: typeof body.callToAction === "string" && body.callToAction.trim() ? body.callToAction.trim().slice(0, 120) : "Join the waitlist",
      durationSeconds: normaliseDuration(body.durationSeconds ?? 8),
      placement: body.placement === "landscape" ? "landscape" : "reels",
      appeal: "",
    };
  }

  const brand = { name: "Vaylo Sports", slogan: "Train smarter.", positioning: "Premium, modern, ambitious sports technology" };
  const editDirection = typeof body.editDirection === "string" ? body.editDirection.trim().slice(0, 600) : "";
  const rewritePrompt = editDirection
    ? [
      "Rewrite this script to follow the requested direction.",
      `Direction: ${editDirection}`,
      "Keep the same product, audience and call to action.",
      "Return JSON only: { script, captions: [{ startSeconds, endSeconds, text }] }.",
      "Do not introduce statistics, prices, guarantees, testimonials or claims the original avoids.",
      JSON.stringify({ originalScript: concept.voiceover, concept: { audience: concept.audience, message: concept.message, product: concept.product, durationSeconds: concept.durationSeconds, callToAction: concept.callToAction }, brand }),
    ].join("\n")
    : buildScriptPrompt(concept, brand);

  const written = await geminiScript(rewritePrompt);
  if (!written.ok || !written.script) {
    return jsonResp({ error: "Could not generate the script", problems: written.problems }, 422);
  }

  const updatedScript = written.script;
  if (conceptId) {
    try {
      await admin.from("ad_video_concepts").update({
        script: updatedScript.script,
        hook: updatedScript.hook || concept.hook,
        core_message: updatedScript.coreMessage || concept.message,
        script_captions: updatedScript.captions,
        on_screen_text: updatedScript.onScreenText,
        updated_at: new Date().toISOString(),
      }).eq("id", conceptId);
    } catch (e) {
      console.error("[ads-video] could not store the generated script", e);
    }
  }

  return jsonResp({
    action: "script",
    conceptId,
    script: updatedScript.script,
    captions: updatedScript.captions,
    hook: updatedScript.hook || concept.hook,
  });
}

// ---------------------------------------------------------------------------
// start: one Veo shot generation (cost-gated)
// ---------------------------------------------------------------------------

async function startAction(req: Request, body: Record<string, unknown>, userId: string, admin: AdminClient): Promise<Response> {
  if (!(await aiCallAllowed(req, userId, "ads-video-start", { max: 6, windowSeconds: 60 }))) {
    return jsonResp({ error: "Too many video requests. Wait a moment and try again." }, 429);
  }
  if (!goKey()) {
    return jsonResp({ error: "Video generation is not configured on this deployment (GOOGLE_VIDEO_API is missing).", code: "not_configured" }, 503);
  }

  const conceptId = typeof body.conceptId === "string" && body.conceptId.length === 36 ? body.conceptId : null;
  const shot = Number(body.shot);
  const storyboardRaw = Array.isArray(body.storyboard) ? body.storyboard : [];
  const storyboard = normaliseStoryboard(storyboardRaw, normaliseDuration(body.durationSeconds ?? 8));

  const scene = storyboard.find((s) => Number.isFinite(shot) && s.shot === shot) ?? (storyboard.length === 1 ? storyboard[0] : undefined);
  const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : (scene ? buildScenePrompt(scene, { positioning: "Premium, modern, ambitious sports technology" }) : "");
  if (!prompt) return badReq("prompt or a storyboard scene is required so the shot has something real to generate");
  if (prompt.length > 1500) return badReq("prompt is too long (max 1500 characters)");

  const model = typeof body.model === "string" && (ALLOWED_VEO_MODELS as readonly string[]).includes(body.model) ? body.model : DEFAULT_VEO_MODEL;
  const durationSeconds = normaliseDuration(body.durationSeconds ?? (scene?.durationSeconds ?? 8));
  const estimatedCost = estimateVeoCostUsd(model, durationSeconds);

  const aspectRatio: VeoAspectRatio | undefined = body.aspectRatio === "16:9" || body.aspectRatio === "9:16" ? body.aspectRatio : undefined;
  const resolution: VeoResolution | undefined = body.resolution === "720p" || body.resolution === "1080p" ? body.resolution : undefined;

  let requestBody: Record<string, unknown>;
  try {
    requestBody = buildVeoRequest({
      prompt,
      negativePrompt: BRAND_NEGATIVE_PROMPT,
      aspectRatio: aspectRatio ?? (placementRatio(body.placement) ?? "9:16"),
      durationSeconds,
      resolution,
      personGeneration: "allow_adult",
    });
  } catch (err) {
    return badReq(err instanceof Error ? err.message : "invalid request");
  }

  // The gate: quote first, spend second. Without confirm this function always
  // returns the same estimate shape — the caller cannot be tricked into paying.
  if (body.confirm !== true) {
    return jsonResp({
      action: "start",
      requiresConfirmation: true,
      model,
      durationSeconds,
      estimatedCostUsd: estimatedCost,
      estimateNote: "Estimate from the published per-second rate; the provider is the final word on cost.",
      shot: scene?.shot,
      conceptId,
    });
  }

  // Duplicate-spend protection: if this owner already has a LIVE shot for the
  // same concept+shot number (running or done), return it instead of billing a
  // second generation — a refresh mid-flight or a re-sent confirm can never
  // create a duplicate charge. A FAILED shot is not caught by this guard, so a
  // genuine retry bills and runs a new attempt, which is correct.
  let existingLiveShot: Record<string, unknown> | null = null;
  if (conceptId) {
    const { data: liveShot } = await admin
      .from("ad_video_shots")
      .select("id, operation_id, state, model, duration_seconds, cost_usd")
      .eq("owner_id", userId)
      .eq("concept_id", conceptId)
      .eq("shot_number", scene?.shot ?? 1)
      .in("state", ["running", "done"])
      .limit(1)
      .maybeSingle();
    existingLiveShot = (liveShot as Record<string, unknown> | null) ?? null;
  }
  if (existingLiveShot) {
    return jsonResp({
      action: "start",
      duplicate: true,
      shotId: existingLiveShot.id,
      conceptId,
      operationId: existingLiveShot.operation_id,
      state: existingLiveShot.state,
      model: existingLiveShot.model,
      durationSeconds: Number(existingLiveShot.duration_seconds) || durationSeconds,
      estimatedCostUsd: Number(existingLiveShot.cost_usd) || 0,
      note: "An active or completed generation for this shot already exists — returning it instead of creating a second one. No new charge.",
    });
  }

  // Beta cost control: the confirmed Veo shot is metered in credits through
  // the same server-side ledger every other AI feature uses. Unlimited plans
  // are NOT exempt (metered path) — a subscription must not become unbounded
  // provider spend.
  const metered = await spendForUser(req, userId, "ads_video_shot", `Veo shot ${scene?.shot ?? 1} (${model}, ${durationSeconds}s)`, {
    source: "ads-video",
    billUnlimited: true,
    idempotencyKey: `veo:${crypto.randomUUID()}`,
  });
  if (!metered.success) {
    return jsonResp(
      {
        error: metered.error === "insufficient_credits"
          ? `Not enough credits for this shot (${metered.cost ?? "?"} needed; you have ${metered.balance ?? 0}). Top up and retry — nothing was charged.`
          : metered.error ?? "Could not record the credit charge",
        code: metered.error === "insufficient_credits" ? "insufficient_credits" : "metering_failed",
        credits: { cost: metered.cost, balance: metered.balance, shortfall: metered.shortfall },
      },
      metered.error === "insufficient_credits" ? 402 : 500,
    );
  }

  const res = await fetch(`${GEMINI_BASE}/models/${model}:predictLongRunning`, {
    method: "POST",
    headers: { "x-goog-api-key": goKey()!, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const described = describeVeoError(res.status, await res.text().catch(() => ""));
    return jsonResp({ error: described.error, code: described.code, estimatedCostUsd: estimatedCost, creditsCharged: metered.cost }, described.status === 429 ? 429 : 502);
  }

  const op = parseVeoOperation(await res.json());
  if (!op.name) {
    return jsonResp({ error: "Google accepted the request but returned no operation to poll.", code: "no_operation" }, 502);
  }

  // Persist the shot record so retry after a page refresh finds the operation.
  const shotId = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error: shotErr } = await admin.from("ad_video_shots").insert({
    id: shotId,
    owner_id: userId,
    concept_id: conceptId,
    shot_number: scene?.shot ?? 1,
    scene_json: scene ?? null,
    veo_prompt: prompt.slice(0, 1500),
    operation_id: op.name,
    state: op.state ?? "running",
    video_uri: op.videoUri ?? null,
    model,
    duration_seconds: durationSeconds,
    aspect_ratio: aspectRatio ?? (placementRatio(body.placement) ?? "9:16"),
    resolution: resolution ?? "1080p",
    cost_usd: estimatedCost,
    created_at: now,
    updated_at: now,
  });
  if (shotErr) {
    console.error("[ads-video] could not record shot", shotErr);
    // The shot has been billed at the provider already; the caller keeps the
    // operationId and UI can retry persistence separately. Never silently
    // pretend the spend did not happen.
    return jsonResp({ error: "Could not record the shot; persist its operationId manually", operationId: op.name, state: op.state ?? "running" }, 500);
  }

  return jsonResp({
    action: "start",
    shotId,
    conceptId,
    operationId: op.name,
    state: op.state ?? "running",
    model,
    durationSeconds,
    estimatedCostUsd: estimatedCost,
    creditsCharged: metered.cost,
    creditsBalance: metered.balance,
  });
}

function placementRatio(placement: unknown): VeoAspectRatio | undefined {
  return placement === "landscape" ? "16:9" : placement === "reels" ? "9:16" : undefined;
}

// ---------------------------------------------------------------------------
// poll: read an in-flight Veo operation (and update the stored shot)
// ---------------------------------------------------------------------------

async function pollAction(body: Record<string, unknown>, userId: string, admin: AdminClient): Promise<Response> {
  if (!goKey()) {
    return jsonResp({ error: "Video generation is not configured on this deployment (GOOGLE_VIDEO_API is missing).", code: "not_configured" }, 503);
  }
  const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
  if (!operationId) return badReq("operationId is required");
  if (operationId.includes("/") && !operationId.startsWith("models/")) return badReq("operationId must be an operation name returned by 'start'");

  const res = await fetch(`${GEMINI_BASE}/${operationId}`, { headers: { "x-goog-api-key": goKey()! } });
  if (!res.ok) {
    const described = describeVeoError(res.status, await res.text().catch(() => ""));
    console.error(`[ads-video] poll failed status=${res.status}`, described.error);
    return jsonResp({ error: described.error, code: described.code }, described.status === 429 ? 429 : 502);
  }

  const op = parseVeoOperation(await res.json());
  if (op.error && op.state === "failed") {
    // Preserve the record; a failed shot is a retryable fact, not a loss.
    if (body.shotId) {
      const shotId = typeof body.shotId === "string" ? body.shotId : "";
      if (shotId.length === 36) {
        try {
          await admin.from("ad_video_shots").update({ state: "failed", error: op.error, updated_at: new Date().toISOString() }).eq("id", shotId).eq("owner_id", userId);
        } catch (e) {
          console.error("[ads-video] could not store failed shot state", e);
        }
      }
    }
    return jsonResp({ action: "poll", done: true, state: "failed", error: op.error });
  }

  if (op.done && typeof body.shotId === "string" && body.shotId.length === 36) {
    try {
      await admin.from("ad_video_shots").update({
        state: op.state ?? "done",
        video_uri: op.videoUri ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", body.shotId).eq("owner_id", userId);
    } catch (e) {
      console.error("[ads-video] could not store completed shot", e);
    }
  }

  return jsonResp({ action: "poll", operationId, done: op.done, state: op.state, videoUri: op.videoUri, error: op.error });
}

// ---------------------------------------------------------------------------
// render: compose the finished advert from real assets, then dispatch to worker
// ---------------------------------------------------------------------------

async function renderAction(req: Request, body: Record<string, unknown>, userId: string, admin: AdminClient): Promise<Response> {
  if (!(await aiCallAllowed(req, userId, "ads-video-render", { max: 6, windowSeconds: 120 }))) {
    return jsonResp({ error: "Too many render requests. Wait a moment and try again." }, 429);
  }

  // Meter the dispatch (cheap; the worker itself is free to run). Retries of
  // the same failure share one idempotency key per job attempt.
  const renderMetered = await spendForUser(req, userId, "ads_video_render", "Video render dispatch", {
    source: "ads-video",
    idempotencyKey: `render:${crypto.randomUUID()}`,
  });
  if (!renderMetered.success) {
    return jsonResp({ error: renderMetered.error ?? "Could not record the credit charge", code: "metering_failed" }, renderMetered.error === "insufficient_credits" ? 402 : 500);
  }

  const conceptId = typeof body.conceptId === "string" && body.conceptId.length === 36 ? body.conceptId : "";
  if (!conceptId) return badReq("conceptId is required");

  const { data: rawConcept, error: fetchErr } = await admin.from("ad_video_concepts").select("*").eq("id", conceptId).eq("owner_id", userId).single();
  if (fetchErr || !rawConcept) return jsonResp({ error: "Concept not found" }, 404);
  const conceptRow = rawConcept as Record<string, unknown>;

  const durationSeconds = Number(conceptRow.duration_seconds) > 0 ? Number(conceptRow.duration_seconds) : 8;
  const placement = conceptRow.aspect_ratio === "16:9" ? "landscape" : "reels";
  const presetId = placement === "landscape" ? "landscape" : "reels";

  // Storyboard: latest from the caller (asset paths may be newer than the
  // stored row) or fall back to the stored storyboard.
  let storyboard = normaliseStoryboard(
    Array.isArray(body.storyboard) ? body.storyboard : conceptRow.storyboard,
    durationSeconds,
  );
  const assetPaths = (typeof body.assetPaths === "object" && body.assetPaths !== null ? body.assetPaths : {}) as Record<string, string>;
  storyboard = storyboard.map((scene) => assetPaths[String(scene.shot)] ? { ...scene, source: assetPaths[String(scene.shot)] } : scene);

  const voiceover = typeof body.voiceover === "string" ? body.voiceover.trim() : typeof conceptRow.script === "string" ? conceptRow.script.trim() : "";
  const captionsRaw = Array.isArray(body.captions) ? (body.captions as Record<string, unknown>[]) : Array.isArray(conceptRow.script_captions) ? (conceptRow.script_captions as Record<string, unknown>[]) : [];
  const captions: CaptionSpec[] = captionsRaw.flatMap((c) => {
    const start = Number(c.startSeconds);
    const end = Number(c.endSeconds);
    const text = typeof c.text === "string" ? c.text.trim() : "";
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ startSeconds: start, endSeconds: end, text }];
  });

  const captionProblems = validateCaptionSpecs(captions, durationSeconds);
  if (captionProblems.length > 0) return badReq(`Caption timing problems: ${captionProblems.join("; ")}`);

  const narrationPath = typeof body.narrationPath === "string" && body.narrationPath.trim() ? body.narrationPath.trim() : undefined;
  if (voiceover && !narrationPath) {
    // No narration file exists yet. Report instead of dropping the voiceover —
    // a missing narration is a work item, not a silent editorial decision.
    return jsonResp({
      error: "narrationPath is required because the concept has a voiceover; generate it with the voiceover API first",
      missing: ["narration file for the voiceover"],
    }, 422);
  }

  const concept: VideoConcept = {
    objective: "drive waitlist sign-ups",
    audience: "athletes 18-30",
    angle: typeof conceptRow.concept_prompt === "string" ? conceptRow.concept_prompt.slice(0, 300) : "",
    hook: typeof conceptRow.hook === "string" ? conceptRow.hook : "",
    message: typeof conceptRow.core_message === "string" ? conceptRow.core_message : "",
    product: "Vaylo Sports",
    narrativeStructure: "",
    sceneSequence: "",
    voiceover,
    onScreenText: Array.isArray(conceptRow.on_screen_text) ? (conceptRow.on_screen_text as string[]) : [],
    audioDirection: "minimal, brand-safe ambience only",
    callToAction: typeof conceptRow.call_to_action === "string" ? conceptRow.call_to_action : "Join the waitlist",
    durationSeconds,
    placement,
    appeal: "",
  };

  const logoPath = typeof body.logoPath === "string" && body.logoPath.trim() ? body.logoPath.trim() : undefined;
  const musicPath = typeof body.musicPath === "string" && body.musicPath.trim() ? body.musicPath.trim() : undefined;
  const fontFile = typeof body.fontFile === "string" && body.fontFile.trim() ? body.fontFile.trim() : undefined;
  const outputPath = `/tmp/renders/${crypto.randomUUID()}.mp4`;

  const planResult = videoConceptToPlan({
    concept,
    presetId,
    storyboard,
    script: { voiceover, captions },
    narrationPath,
    musicPath,
    logoPath,
    fontFile,
    outputPath,
  });

  if (!planResult.ok || !planResult.request) {
    return jsonResp({ error: "The advert cannot be rendered yet", problems: planResult.problems, missing: planResult.missing, notes: planResult.notes }, 422);
  }

  const missingShots = missingVeoShots(storyboard);
  const costEstimate = estimateVideoCost(storyboard, { text: voiceover });

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error: jobErr } = await admin.from("ad_video_render_jobs").insert({
    job_id: jobId,
    concept_id: conceptId,
    owner_id: userId,
    preset_id: planResult.preset?.id ?? presetId,
    render_request: planResult.request,
    status: "queued",
    progress: 0,
    cost_usd: 0,
    created_at: now,
    updated_at: now,
  });
  if (jobErr) {
    console.error("[ads-video] could not insert render job", jobErr);
    return jsonResp({ error: "Render could not be queued" }, 500);
  }

  const workerUrl = Deno.env.get("RENDER_WORKER_URL");
  const renderToken = Deno.env.get("RENDER_TOKEN");
  if (!workerUrl) {
    try {
      await admin.from("ad_video_render_jobs").update({ status: "failed", error: "RENDER_WORKER_URL is not configured", updated_at: new Date().toISOString() }).eq("job_id", jobId);
    } catch (e) {
      console.error("[ads-video] could not mark job failed", e);
    }
    return jsonResp({ error: "Render worker is not configured on this deployment", code: "not_configured" }, 503);
  }

  let workerResponse: Response;
  try {
    workerResponse = await fetch(`${workerUrl.replace(/\/$/, "")}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(renderToken ? { "x-render-token": renderToken } : {}) },
      body: JSON.stringify({ jobId, renderRequest: planResult.request }),
    });
  } catch (e) {
    console.error("[ads-video] worker dispatch failed", e);
    try {
      await admin.from("ad_video_render_jobs").update({ status: "failed", error: "worker dispatch failed", updated_at: new Date().toISOString() }).eq("job_id", jobId);
    } catch (err) {
      console.error("[ads-video] could not mark job failed", err);
    }
    return jsonResp({ error: "Render worker is not reachable" }, 503);
  }

  const workerBody = (await workerResponse.json().catch(() => ({}))) as { error?: string; state?: string; progress?: number };
  if (!workerResponse.ok) {
    try {
      await admin.from("ad_video_render_jobs").update({ status: "failed", error: workerBody.error ?? "Worker error", updated_at: new Date().toISOString() }).eq("job_id", jobId);
    } catch (e) {
      console.error("[ads-video] could not mark job failed", e);
    }
    return jsonResp({ error: workerBody.error ?? "Render failed", jobId }, 502);
  }

  try {
    await admin.from("ad_video_render_jobs").update({
      status: workerBody.state ?? "queued",
      progress: workerBody.progress ?? 0,
      updated_at: new Date().toISOString(),
    }).eq("job_id", jobId);
  } catch (e) {
    console.error("[ads-video] could not update job status", e);
  }

  return jsonResp({
    action: "render",
    jobId,
    state: workerBody.state ?? "queued",
    progress: workerBody.progress ?? 0,
    presetId,
    totalSeconds: planResult.totalSeconds,
    missingShots: missingShots.map((s) => s.shot),
    additionalCostUsd: 0,
    costNote: "Rendering itself costs nothing here; every provider spend (Veo shots, narration) was confirmed before its own start call.",
    estimate: costEstimate,
    notes: planResult.notes,
  });
}
