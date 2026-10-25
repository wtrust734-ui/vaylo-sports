// ============================================================================
// ads-video — Google Gemini Omni video-shot generation + render dispatch for Vaylo Ads.
//
// Concept-first pipeline (Prompt 5):
//   1. concept: turn a chat request into real ad copy — hook, core message,
//      script and storyboard — written by OpenAI (the Creative Assistant's
//      provider). Google is used only for the generated shots below.
//   2. start: launch ONE generated shot (one prompt → one interaction on the
//      Gemini Omni Interactions API — Veo 3.1 was retired by Google on
//      2026-10-22; nothing else on this key generates video). Cost is gated:
//      nothing is billed until the caller passes confirm AND has seen the
//      estimate, because a single eight-second clip costs more than every
//      image this project generates.
//   3. poll: read the interaction; on success the shot's clip is stored in the
//      owner's private ads folder and its path recorded.
//   4. render: compose the finished advert from REAL assets only (generated
//      clips, app footage, the supplied logo, the generated narration file)
//      and dispatch to the render worker.
//
// Honesty rules carried from Prompt 4 apply here: a concept is not an asset.
// Nothing in this file invents a substitute for a missing clip, logo or
// narration file; a missing asset is reported as missing.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { aiCallAllowed, authenticate, readJsonBody, spendForUser } from "../_shared/guard.ts";
import  {
    normaliseDuration,
  } from "../_shared/omni.ts";
import {
  DEFAULT_OMNI_MODEL,
  buildOmniRequest,
  describeOmniError,
  estimateOmniCostUsd,
  parseOmniInteraction,
  type OmniAspectRatio,
  type OmniResolution,
} from "../_shared/omni.ts";
import { AIServiceError, generateAIResponse } from "../_shared/openai.ts";
import { fitStoryboardToDuration, normaliseAdDuration, shotCountFor } from "../_shared/videoDuration.ts";
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
  buildScriptCorrection,
  buildScriptPrompt,
  buildStoryboardPrompt,
  hookProblem,
  validateCaptionSpecs,
} from "../_shared/videoPrompt.ts";


const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const jsonResp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const badReq = (message: string) => jsonResp({ error: message }, 400);
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const goKey = () => Deno.env.get("GOOGLE_VIDEO_API");

/** The shot model this deployment offers (Gemini Omni Interactions API — Veo
 *  3.1 was retired by Google on 2026-10-22 and no longer resolves); anything
 *  else falls back to the default. */
const ALLOWED_SHOT_MODELS = [DEFAULT_OMNI_MODEL] as const;

// ---------------------------------------------------------------------------
// Test injectables — mirror the shared modules the handler is built from.
// ---------------------------------------------------------------------------

export {
  buildScriptPrompt,
  buildScriptCorrection,
  buildStoryboardPrompt,
  buildScenePrompt,
  hookProblem,
  BRAND_NEGATIVE_PROMPT,
  validateCaptionSpecs,
} from "../_shared/videoPrompt.ts";
export { estimateVideoCost, videoConceptToPlan } from "../_shared/videoAd.ts";
export { DEFAULT_OMNI_MODEL, estimateOmniCostUsd, normaliseDuration } from "../_shared/omni.ts";
export { MIN_AD_SECONDS, MAX_AD_SECONDS, normaliseAdDuration, shotCountFor, fitStoryboardToDuration } from "../_shared/videoDuration.ts";
export type { VideoConcept, StoryboardScene, CaptionSpec } from "../_shared/videoAd.ts";

// ---------------------------------------------------------------------------
// Storyboard parsing
// ---------------------------------------------------------------------------

/** One automatic retry after a provider-side failure (the failed call is not billed). */
export const MAX_SHOT_ATTEMPTS = 2;

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

/**
 * Concept and script text run on OpenAI — the same provider as the Creative
 * Assistant. Google on this project is for form analysis and video shots only.
 */
async function openaiScript(prompt: string): Promise<{ ok: boolean; problems: string[]; script?: WrittenScript }> {
  try {
    const result = await generateAIResponse({
      feature: "ads_video_concept",
      userPrompt: prompt,
      maxOutputTokens: 2048,
    });
    const parsed = parseWrittenScript(result.text);
    if (!parsed) return { ok: false, problems: ["the concept writer returned text that could not be parsed as JSON"] };
    return { ok: true, problems: [], script: parsed };
  } catch (e) {
    const message = e instanceof AIServiceError ? e.message : "concept generation failed";
    console.error("[ads-video] concept generation failed", message);
    return { ok: false, problems: [message] };
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
  const shotCount = shotCountFor(concept.durationSeconds);
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

async function openaiStoryboard(prompt: string): Promise<{ ok: boolean; scenes?: unknown[]; problems: string[] }> {
  try {
    const result = await generateAIResponse({
      feature: "ads_video_storyboard",
      userPrompt: prompt,
      maxOutputTokens: 2048,
    });
    const text = result.text;
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
    const message = e instanceof AIServiceError ? e.message : "storyboard generation failed";
    console.error("[ads-video] storyboard generation failed", message);
    return { ok: false, problems: [message] };
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
      case "preview":
        return await previewAction(body, userId, admin);
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
    .select("job_id, status, progress, error, storage_path, public_url, result")
    .eq("job_id", jobId)
    .eq("owner_id", userId)
    .single();
  if (error || !data) return jsonResp({ error: "Render job not found" }, 404);
  const row = data as Record<string, unknown>;

  // A finished render is watched through a FRESHLY SIGNED URL on every status
  // read: a signed URL persisted at report time expires, and a dead link is
  // exactly the “success the user cannot see” failure that started this work.
  // The row is already owner-scoped (eq owner_id), and the path is inside the
  // owner's own folder by the same rule render-job-result enforces on write.
  let watchUrl: string | null = typeof row.public_url === "string" && row.public_url.trim() ? row.public_url : null;
  const storagePath = typeof row.storage_path === "string" && row.storage_path.trim() ? row.storage_path.trim() : "";
  if (storagePath) {
    const { data: signed } = await admin.storage.from("ads").createSignedUrl(storagePath.replace(/^ads\//, ""), 60 * 60 * 12);
    if (signed?.signedUrl) watchUrl = signed.signedUrl;
  }

  // The editor's stage string (what Manus is doing right now) rides in the
  // job's result jsonb while it works; surface it so the UI can show motion.
  const stage = (row.result as { stage?: unknown } | null)?.stage;
  return jsonResp({
    jobId: row.job_id,
    status: row.status,
    progress: row.progress,
    error: row.error ?? null,
    stage: typeof stage === "string" ? stage : null,
    publicUrl: watchUrl,
  });
}

type AdminClient = ReturnType<typeof supabaseAdmin>;

function supabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// ---------------------------------------------------------------------------
// Private-asset resolution — screen recordings and narration live in the owner's
// PRIVATE ads bucket, and the render worker only downloads http(s) URLs. Any
// storage path passed by the caller is repaired into a signed URL here, but a
// path is only ever signed when it points INSIDE ads/{ownerId}/… (the same
// folder layout every upload path enforces), so one owner can never make this
// function sign, read or lend a file belonging to someone else.
// ---------------------------------------------------------------------------

const ADS_BUCKET = "ads";

/** A path that is a private ads-bucket object owned by the caller (not an
 *  already-usable http(s)/data source such as a Veo clip URI). */
export function isOwnerBucketPath(userId: string, raw: string | null | undefined): raw is string {
  if (!raw) return false;
  const s = raw.trim();
  if (!s || /^https?:\/\//i.test(s) || /^data:/i.test(s)) return false;
  const bare = s.replace(/^ads\//, "");
  return bare.startsWith(`${userId}/`) && !bare.includes("..");
}

/** Signed download URL for an object the owner already has rights to; `null`
 *  when storage refuses — callers must surface that, not silently drop it. */
export async function signOwnerAsset(admin: AdminClient, userId: string, raw: string): Promise<string | null> {
  const path = raw.trim().replace(/^ads\//, "");
  const { data } = await admin.storage.from(ADS_BUCKET).createSignedUrl(path, 60 * 60 * 12);
  return data?.signedUrl ?? null;
}

/** Replace every owner-owned storage path in a bag of render inputs with its
 *  signed URL; paths that already resolve (Veo URIs) pass through unchanged.
 *  A failure tones the whole render down: renderRequest is persisted so retry
 *  after a fix needs no re-quote. */
export async function resolveRenderSources(
  admin: AdminClient,
  userId: string,
  paths: Record<string, string | undefined>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const [key, raw] of Object.entries(paths)) {
    if (!raw || !isOwnerBucketPath(userId, raw)) continue;
    const url = await signOwnerAsset(admin, userId, raw);
    if (!url) return { ok: false, error: `Could not create a signed link for the stored asset “${key}” — the file could not be made downloadable` };
    paths[key] = url;
  }
  return { ok: true };
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
  // The request is context, not copy. It used to be the default `message`,
  // which is how a request like "create a video ad" became the ad's content.
  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, 300) : "";
  const product = "Vaylo Sports";
  const placement = body.placement === "landscape" ? "landscape" : "reels";
  const durationSeconds = normaliseAdDuration(body.durationSeconds ?? 10);
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
      angle,
      message,
      product,
      durationSeconds,
      placement,
      voiceover: "",
      callToAction,
    },
    brand,
    prompt,
  );

  // One corrective retry when the writer produces a hook that is really the
  // request in disguise. An instruction is never a valid fallback for ad copy:
  // if the retry also fails, the caller is told why instead of being handed a
  // script whose hook is their own sentence.
  let written = await openaiScript(scriptPrompt);
  let hookIssue = written.ok && written.script ? hookProblem(written.script.hook, prompt) : null;
  if (hookIssue) {
    console.warn(`[ads-video] concept hook rejected (${hookIssue}) — retrying once`);
    written = await openaiScript(buildScriptCorrection(scriptPrompt, hookIssue));
    hookIssue = written.ok && written.script ? hookProblem(written.script.hook, prompt) : null;
  }
  if (!written.ok || !written.script) {
    return jsonResp({ error: "Could not generate the concept", problems: written.problems }, 422);
  }
  if (hookIssue) {
    return jsonResp({
      error: `The writer did not produce a usable hook (${hookIssue}). Say what the ad should tell the viewer, or who it is for, and try again.`,
      code: "concept_hook_unusable",
      problems: [hookIssue],
    }, 422);
  }

  concept.hook = written.script.hook;
  concept.message = written.script.coreMessage || written.script.hook;
  concept.onScreenText = written.script.onScreenText;
  concept.narrativeStructure = written.script.narrativeStructure;
  concept.sceneSequence = written.script.sceneSequence;
  concept.voiceover = written.script.script;

  // Storyboard: model-first, deterministic fallback so a storyboard writers
  // outage still yields a usable production plan the caller can review.
  let storyboardSource = "";
  let storyboardScenes: StoryboardScene[] = [];
  const requestedShots = shotCountFor(durationSeconds);
  const storyboardPrompt = buildStoryboardPrompt({ ...concept }, { name: brand.name, positioning: brand.positioning }, requestedShots);
  const generatedStoryboard = await openaiStoryboard(storyboardPrompt);
  if (generatedStoryboard.ok && generatedStoryboard.scenes) {
    const modelStoryboard = normaliseStoryboard(generatedStoryboard.scenes, durationSeconds);
    // The model decides how many scenes to return; the advert's length is ours.
    // Re-time them so the shots cover the requested seconds exactly, and fall
    // back when its scene count cannot cover that length legally.
    const fitted = fitStoryboardToDuration(modelStoryboard, durationSeconds);
    if (fitted) {
      storyboardScenes = fitted;
      storyboardSource = "model";
    }
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
    model: DEFAULT_OMNI_MODEL,
    duration_seconds: durationSeconds,
    aspect_ratio: placement === "reels" ? ("9:16" as const) : ("16:9" as const),
    hook: concept.hook,
    core_message: concept.message,
    script: concept.voiceover,
    // The captions are returned to the caller AND stored: the player reads the
    // row later, so a caption spec that only existed in the response left every
    // finished ad playing without its timed text.
    script_captions: written.script.captions,
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
      // The client (and chatRun's narration/render steps) read `script`; the
      // domain object names the same text `voiceover`. Returning only
      // `voiceover` left every caller with an empty script and no narration.
      script: concept.voiceover,
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

  const written = await openaiScript(rewritePrompt);
  if (!written.ok || !written.script) {
    return jsonResp({ error: "Could not generate the script", problems: written.problems }, 422);
  }

  const updatedScript = written.script;
  // A revision may rewrite the hook, but it may not replace one with an
  // instruction. An unusable candidate keeps the hook the concept already had.
  const revisedHook = hookProblem(updatedScript.hook) === null ? updatedScript.hook : concept.hook;
  if (conceptId) {
    try {
      await admin.from("ad_video_concepts").update({
        script: updatedScript.script,
        hook: revisedHook,
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
    hook: revisedHook,
  });
}

// ---------------------------------------------------------------------------
// start: one generated video shot (Gemini Omni, cost-gated)
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
  const storyboard = normaliseStoryboard(storyboardRaw, normaliseAdDuration(body.durationSeconds ?? 10));

  let scene = storyboard.find((s) => Number.isFinite(shot) && s.shot === shot) ?? (storyboard.length === 1 ? storyboard[0] : undefined);
  if (!scene && conceptId) {
    // A confirm re-sent by a chat client often carries only the conceptId +
    // shot number: take that scene from the stored concept row so the shot has
    // real content to generate instead of refusing.
    const { data: conceptSceneRow } = await admin
      .from("ad_video_concepts")
      .select("storyboard")
      .eq("id", conceptId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (conceptSceneRow) {
      const stored = normaliseStoryboard(conceptSceneRow.storyboard, normaliseAdDuration(body.durationSeconds ?? 10));
      scene = stored.find((s) => Number.isFinite(shot) && s.shot === shot) ?? (stored.length === 1 ? stored[0] : undefined);
    }
  }
  const basePrompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : (scene ? buildScenePrompt(scene, { positioning: "Premium, modern, ambitious sports technology" }) : "");
  // Gemini Omni exposes no negative-prompt field: the brand bans ride inside
  // the prompt text.
  const prompt = basePrompt
    ? `${basePrompt} Avoid: ${BRAND_NEGATIVE_PROMPT}.`
    : "";
  if (!prompt) return badReq("prompt or a storyboard scene is required so the shot has something real to generate");
  if (prompt.length > 1500) return badReq("prompt is too long (max 1500 characters)");

  const model = typeof body.model === "string" && (ALLOWED_SHOT_MODELS as readonly string[]).includes(body.model) ? body.model : DEFAULT_OMNI_MODEL;
  const durationSeconds = normaliseDuration(body.durationSeconds ?? (scene?.durationSeconds ?? 8));
  const estimatedCost = estimateOmniCostUsd(durationSeconds);

  const aspectRatio: OmniAspectRatio | undefined = body.aspectRatio === "16:9" || body.aspectRatio === "9:16" ? body.aspectRatio : undefined;
  const resolution: OmniResolution | undefined = body.resolution === "720p" || body.resolution === "1080p" ? body.resolution : undefined;

  let requestBody: Record<string, unknown>;
  try {
    requestBody = buildOmniRequest({
      prompt,
      aspectRatio: aspectRatio ?? (placementRatio(body.placement) ?? "9:16"),
      durationSeconds,
      resolution,
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
  const metered = await spendForUser(req, userId, "ads_video_shot", `Generated shot ${scene?.shot ?? 1} (${model}, ${durationSeconds}s)`, {
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

  const res = await fetch(`${GEMINI_BASE}/interactions`, {
    method: "POST",
    headers: { "x-goog-api-key": goKey()!, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const described = describeOmniError(res.status, await res.text().catch(() => ""));
    return jsonResp({ error: described.error, code: described.code, estimatedCostUsd: estimatedCost, creditsCharged: metered.cost }, described.status === 429 ? 429 : 502);
  }

  const op = parseOmniInteraction(await res.json());
  if (!op.name) {
    return jsonResp({ error: "Google accepted the request but returned no interaction to poll.", code: "no_operation" }, 502);
  }

  // Persist the shot record so retry after a page refresh finds the operation.
  const shotId = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error: shotErr } = await admin.from("ad_video_shots").insert({
    id: shotId,
    owner_id: userId,
    concept_id: conceptId,
    shot_number: scene?.shot ?? 1,
    scene_json: scene ?? {},
    veo_prompt: prompt.slice(0, 1500),
    operation_id: op.name,
    state: shotRowState(op.state),
    // The interaction delivers its clip via the poll, not at start time.
    video_uri: null,
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

function placementRatio(placement: unknown): OmniAspectRatio | undefined {
  return placement === "landscape" ? "16:9" : placement === "reels" ? "9:16" : undefined;
}

/**
 * The ad_video_shots row only accepts running|done|failed, but the Omni
 * interaction reports in_progress/completed/failed. Map coarse interaction
 * states onto the row's enum: anything not known to be terminal stays "running"
 * so an unforeseen provider word can never break persistence again (a 500 here
 * used to orphan a billed generation).
 */
function shotRowState(state: string | null | undefined): "running" | "done" | "failed" {
  const s = (state ?? "").toLowerCase();
  if (["completed", "done", "finished", "succeeded"].includes(s)) return "done";
  if (["failed", "error", "cancelled", "canceled"].includes(s)) return "failed";
  return "running";
}

// ---------------------------------------------------------------------------
// poll: read an in-flight video interaction (and update the stored shot)
// ---------------------------------------------------------------------------

async function pollAction(body: Record<string, unknown>, userId: string, admin: AdminClient): Promise<Response> {
  if (!goKey()) {
    return jsonResp({ error: "Video generation is not configured on this deployment (GOOGLE_VIDEO_API is missing).", code: "not_configured" }, 503);
  }
  const operationId = typeof body.operationId === "string" ? body.operationId.trim().replace(/^interactions\//, "") : "";
  if (!operationId) return badReq("operationId is required");
  if (operationId.includes("/")) return badReq("operationId must be an interaction id returned by 'start'");

  const res = await fetch(`${GEMINI_BASE}/interactions/${operationId}`, { headers: { "x-goog-api-key": goKey()! } });
  if (!res.ok) {
    const described = describeOmniError(res.status, await res.text().catch(() => ""));
    console.error(`[ads-video] poll failed status=${res.status}`, described.error);
    return jsonResp({ error: described.error, code: described.code }, described.status === 429 ? 429 : 502);
  }

  const op = parseOmniInteraction(await res.json());
  const shotId = typeof body.shotId === "string" ? body.shotId : "";

  // A finished interaction with no video anywhere is a real failure — but the
  // provider rejecting a request it never charged for is often transient
  // (Google answers with a generic INVALID_ARGUMENT and no clip; the identical
  // prompt then succeeds). Retry ONE new interaction on the same shot record
  // before reporting failure, so a flaky call cannot dead-end a whole advert.
  if (op.done && !op.videoBase64) {
    const message = op.error ?? `the video interaction finished in state "${op.state}" without returning a video`;
    if (shotId.length === 36) {
      const { data: shotRow } = await admin
        .from("ad_video_shots")
        .select("attempts, veo_prompt, duration_seconds, aspect_ratio, resolution")
        .eq("id", shotId)
        .eq("owner_id", userId)
        .maybeSingle();
      const row = (shotRow ?? null) as Record<string, unknown> | null;
      const attempts = Number(row?.attempts) || 1;
      const storedPrompt = typeof row?.veo_prompt === "string" ? row.veo_prompt : "";
      if (row && storedPrompt && attempts < MAX_SHOT_ATTEMPTS) {
        try {
          const retryRes = await fetch(`${GEMINI_BASE}/interactions`, {
            method: "POST",
            headers: { "x-goog-api-key": goKey()!, "Content-Type": "application/json" },
            body: JSON.stringify(buildOmniRequest({
              prompt: storedPrompt,
              aspectRatio: row.aspect_ratio === "16:9" ? "16:9" : "9:16",
              durationSeconds: Number(row.duration_seconds) || 8,
              resolution: row.resolution === "720p" ? "720p" : undefined,
            })),
          });
          if (retryRes.ok) {
            const retryOp = parseOmniInteraction(await retryRes.json());
            if (retryOp.name) {
              await admin.from("ad_video_shots").update({
                operation_id: retryOp.name,
                state: "running",
                attempts: attempts + 1,
                error: null,
                updated_at: new Date().toISOString(),
              }).eq("id", shotId).eq("owner_id", userId);
              console.warn(`[ads-video] shot ${shotId} failed at the provider (${message}); retrying once`);
              return jsonResp({
                action: "poll",
                done: false,
                state: "running",
                retrying: true,
                operationId: retryOp.name,
                retryReason: message,
              });
            }
          } else {
            console.error(`[ads-video] retry start failed status=${retryRes.status}`);
          }
        } catch (e) {
          console.error("[ads-video] retry attempt threw", e);
        }
      }
      try {
        await admin.from("ad_video_shots").update({ state: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", shotId).eq("owner_id", userId);
      } catch (e) {
        console.error("[ads-video] could not store failed shot state", e);
      }
    }
    return jsonResp({ action: "poll", done: true, state: "failed", error: message });
  }

  let videoUri: string | null = null;
  if (op.done && op.videoBase64) {
    // The clip arrives inline as base64. It is stored in the OWNER'S folder in
    // the private ads bucket and the row keeps the storage path: only that
    // owner's own signed URLs can ever resolve it, so the clip never has to be
    // public for the render/dispatch pipeline to use it.
    try {
      const bytes = Uint8Array.from(atob(op.videoBase64), (c) => c.charCodeAt(0));
      const itemName = shotId.length === 36 ? shotId : crypto.randomUUID();
      const storagePath = `${userId}/shots/${itemName}.mp4`;
      const { error: upErr } = await admin.storage.from(ADS_BUCKET).upload(storagePath, bytes, {
        contentType: op.videoMimeType ?? "video/mp4",
      });
      if (upErr) throw new Error(upErr.message);
      videoUri = `ads/${storagePath}`;
    } catch (e) {
      const message = e instanceof Error ? e.message : "the finished clip could not be stored";
      if (shotId.length === 36) {
        try {
          await admin.from("ad_video_shots").update({ state: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", shotId).eq("owner_id", userId);
        } catch (err) {
          console.error("[ads-video] could not store failed shot state", err);
        }
      }
      return jsonResp({ error: `The clip was generated but could not be stored: ${message}`, code: "storage_failed" }, 502);
    }
  }

  if (op.done && shotId.length === 36) {
    try {
      await admin.from("ad_video_shots").update({
        state: videoUri ? "done" : shotRowState(op.state),
        video_uri: videoUri,
        updated_at: new Date().toISOString(),
      }).eq("id", shotId).eq("owner_id", userId);
    } catch (e) {
      console.error("[ads-video] could not store completed shot", e);
    }
  }

  return jsonResp({ action: "poll", done: op.done, state: op.state, videoUri: videoUri, error: op.error });
}

// ---------------------------------------------------------------------------
// preview: the finished advert as a playable cut
// ---------------------------------------------------------------------------
// Every shot clip is already a real stored file. This action signs each one
// (owner-scoped, 12h) plus the narration track and returns the cut — shot
// order, each clip's slot in the timeline, and the caption timing — so the app
// can play the advert back immediately, with no external editor and no FFmpeg
// host to be down. Nothing is invented: a shot with no stored clip is reported
// in `missing`, never skipped or substituted.

async function previewAction(body: Record<string, unknown>, userId: string, admin: AdminClient): Promise<Response> {
  const conceptId = typeof body.conceptId === "string" && body.conceptId.length === 36 ? body.conceptId : "";
  if (!conceptId) return badReq("conceptId is required");

  const { data: rawConcept, error } = await admin
    .from("ad_video_concepts")
    .select("*")
    .eq("id", conceptId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error || !rawConcept) return jsonResp({ error: "Concept not found" }, 404);
  const row = rawConcept as Record<string, unknown>;

  const durationSeconds = Number(row.duration_seconds) > 0 ? Number(row.duration_seconds) : 8;
  const storyboard = normaliseStoryboard(Array.isArray(row.storyboard) ? row.storyboard : [], durationSeconds);

  // Latest COMPLETED generation per shot number. A failed or running row never
  // stands in for a clip.
  const { data: shotRows } = await admin
    .from("ad_video_shots")
    .select("shot_number, video_uri, updated_at")
    .eq("owner_id", userId)
    .eq("concept_id", conceptId)
    .eq("state", "done")
    .order("updated_at", { ascending: false });
  const clipByShot = new Map<number, string>();
  for (const raw of (shotRows ?? []) as Record<string, unknown>[]) {
    const n = Number(raw.shot_number);
    const uri = typeof raw.video_uri === "string" ? raw.video_uri.trim() : "";
    if (!Number.isFinite(n) || !uri || clipByShot.has(n)) continue;
    clipByShot.set(n, uri);
  }

  const clips: { shot: number; url: string; durationSeconds: number; description: string }[] = [];
  const missing: number[] = [];
  for (const scene of storyboard) {
    const uri = clipByShot.get(scene.shot);
    if (!uri) { missing.push(scene.shot); continue; }
    let url: string | null = null;
    if (isOwnerBucketPath(userId, uri)) url = await signOwnerAsset(admin, userId, uri);
    else if (/^https?:\/\//i.test(uri)) url = uri;
    if (!url) { missing.push(scene.shot); continue; }
    clips.push({
      shot: scene.shot,
      url,
      durationSeconds: Math.max(1, Math.round((scene.endSeconds - scene.startSeconds) * 100) / 100) || scene.durationSeconds,
      description: scene.visualDescription,
    });
  }

  const narrationRaw = typeof body.narrationPath === "string" ? body.narrationPath.trim() : "";
  let narrationUrl: string | null = null;
  if (narrationRaw && isOwnerBucketPath(userId, narrationRaw)) narrationUrl = await signOwnerAsset(admin, userId, narrationRaw);
  // No narration path is passed when the build that made it is gone from this
  // session. Picking "the newest narration file in the account" would silently
  // put another concept's voiceover under this ad, so the cut plays silent and
  // the player says so instead.

  const captionsRaw = Array.isArray(row.script_captions) ? (row.script_captions as Record<string, unknown>[]) : [];
  const captions: CaptionSpec[] = captionsRaw.flatMap((c) => {
    const start = Number(c.startSeconds);
    const end = Number(c.endSeconds);
    const text = typeof c.text === "string" ? c.text.trim() : "";
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return [{ startSeconds: start, endSeconds: end, text }];
  });

  const totalSeconds = clips.reduce((sum, c) => sum + c.durationSeconds, 0);
  return jsonResp({
    action: "preview",
    conceptId,
    hook: typeof row.hook === "string" ? row.hook : "",
    callToAction: typeof row.call_to_action === "string" ? row.call_to_action : "",
    durationSeconds,
    totalSeconds: Math.round(totalSeconds * 100) / 100,
    clips,
    missing,
    narrationUrl,
    captions,
  });
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
  // The worker ignores this value and uses its own bundled font (FONT_FILE,
  // /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf); the plan still
  // requires one whenever the concept carries on-screen text. Without this
  // default EVERY render failed 422 ("a fontFile is required because the
  // concept has on-screen text") because no caller ever sends one.
  const fontFile = typeof body.fontFile === "string" && body.fontFile.trim()
    ? body.fontFile.trim()
    : Array.isArray(conceptRow.on_screen_text) && conceptRow.on_screen_text.length > 0
      ? (Deno.env.get("FONT_FILE") ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
      : undefined;
  const outputPath = `/tmp/renders/${crypto.randomUUID()}.mp4`;

  // Library screen recordings, narration files and the brand logo sit in the
  // owner's PRIVATE ads bucket; the render worker only accepts http(s) URLs.
  // Signed URLs are minted here for the OWNER'S OWN objects only — a caller
  // cannot make this function sign a file under anyone else's folder. The
  // stored job keeps the resolved URLs the worker reads.
  const renderSources: Record<string, string | undefined> = { narration: narrationPath, logo: logoPath, music: musicPath };
  for (const [shot, path] of Object.entries(assetPaths)) if (path) renderSources[`shot ${shot} clip`] = path;
  // Storyboard shots already carry their library path (e.g. an app-footage
  // recording picked when the concept was written). They must go through the
  // same owner-scoped signing — an unresolvable shot is a hard error below,
  // never a raw private path handed to the worker.
  for (const s of storyboard) if (s.source && !renderSources[`shot ${s.shot} clip`]) renderSources[`shot ${s.shot} clip`] = s.source;
  const resolvedSources = await resolveRenderSources(admin, userId, renderSources);
  if (!resolvedSources.ok) return jsonResp({ error: resolvedSources.error, code: "asset_resolution_failed" }, 503);

  const clipsResolved: Record<string, string> = {};
  for (const [key, path] of Object.entries(renderSources)) {
    const shotMatch = key.match(/^shot (\d+) clip$/);
    if (shotMatch && path) clipsResolved[shotMatch[1]] = path;
  }

  // The storyboard handed to the plan builder carries each shot's clip
  // source; after signing it must carry the signed URL, not the raw private
  // path, or the worker rejects the job as unresolvable.
  storyboard = storyboard.map((s) => (clipsResolved[String(s.shot)] ? { ...s, source: clipsResolved[String(s.shot)] } : s));

  const planResult = videoConceptToPlan({
    concept,
    presetId,
    storyboard,
    script: { voiceover, captions },
    narrationPath: renderSources.narration,
    musicPath: renderSources.music,
    logoPath: renderSources.logo,
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
    id: jobId,
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
    // No in-house FFmpeg worker on this deployment — Manus 2.0 is the editor.
    // The queued job already carries the full plan with signed owner-scoped
    // clip URLs, and the agent picks it up via manus-invoke
    // (render-jobs-fetch / render-job-result). A real handoff state, not a
    // fake success: the athlete is told the edit is waiting for the agent.
    const handedAt = new Date().toISOString();
    try {
      await admin.from("ad_video_render_jobs").update({ status: "handed_to_manus", updated_at: handedAt }).eq("job_id", jobId);
    } catch (e) {
      console.error("[ads-video] could not mark job handed to Manus", e);
    }
    return jsonResp({
      action: "render",
      jobId,
      state: "handed_to_manus",
      editor: "manus-2.0",
      presetId,
      totalSeconds: planResult.totalSeconds,
      missingShots: missingShots.map((s) => s.shot),
      additionalCostUsd: 0,
      costNote: "There is no charge for dispatch; the edit itself is performed by Manus 2.0, so no FFmpeg worker spend applies.",
      estimate: costEstimate,
      notes: [...planResult.notes, "queued for Manus 2.0: the agent edits the clip and reports back the finished file."],
    });
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
