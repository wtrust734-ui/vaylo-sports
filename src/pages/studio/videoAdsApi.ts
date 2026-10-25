// ============================================================================
// videoAdsApi — typed client for the real video pipeline (ads-video + voiceover).
// ----------------------------------------------------------------------------
// Every call maps to a server endpoint that owns its own auth, validation and
// cost gate:
//   concept    → OpenAI writes the hook, script and storyboard (no shot spend)
//   start      → ONE generated shot (Gemini Omni); always quotes first
//                (confirm:false), spends only when the caller re-sends
//                confirm:true with the same shape
//   poll       → operation state; a provider-rejected attempt is retried once
//                server-side, then retained for a manual retry
//   generate   → ElevenLabs narration (billed characters reported per call)
//   render     → compose the finished ad; requires real assets for every shot
//   jobStatus  → render job state as persisted server-side
// Nothing here fabricates success: failures surface as typed errors carrying
// the server's own message.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { edgeErrorMessage, edgeErrorMessageWithProblems } from "@/lib/edgeErrors";

async function invokeAdsVideo<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ads-video", { body });
  if (error) throw new Error(await edgeErrorMessageWithProblems(error));
  return data as T;
}

// ---------------------------------------------------------------------------
// Concept
// ---------------------------------------------------------------------------

export interface VideoStoryboardScene {
  shot: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  visualDescription: string;
  cameraMovement: string;
  subjectAction: string;
  environment: string;
  source: string;
  sourceType: string;
  continuityKey: string;
}

export interface VideoCaptions {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface VideoConceptResult {
  conceptId: string;
  concept: {
    id?: string;
    hook: string;
    message: string;
    script: string;
    narrativeStructure?: string;
    sceneSequence?: string;
    callToAction: string;
    durationSeconds: number;
  };
  storyboard: VideoStoryboardScene[];
  storyboardSource: string;
  captions: VideoCaptions[];
  hook: string;
}

export function generateVideoConcept(input: {
  prompt: string;
  placement?: "reels" | "landscape";
  durationSeconds: number;
  callToAction?: string;
}): Promise<VideoConceptResult> {
  return invokeAdsVideo<VideoConceptResult>({
    action: "concept",
    prompt: input.prompt,
    placement: input.placement ?? "reels",
    durationSeconds: input.durationSeconds,
    callToAction: input.callToAction,
  });
}

// ---------------------------------------------------------------------------
// Generated shots — quote-then-confirm
// ---------------------------------------------------------------------------

export interface ShotQuote {
  requiresConfirmation: true;
  model: string;
  durationSeconds: number;
  estimatedCostUsd: number;
  shot?: number;
  conceptId?: string | null;
}

export interface ShotStart {
  shotId: string;
  conceptId: string | null;
  operationId: string;
  state: string;
  estimatedCostUsd: number;
}

/** Quotes the cost for one shot: no money moves on this call. */
export async function quoteShot(input: {
  conceptId?: string | null;
  shot?: number;
  storyboard?: unknown[];
  durationSeconds?: number;
  placement?: "reels" | "landscape";
}): Promise<ShotQuote> {
  const res = await invokeAdsVideo<ShotQuote>({
    action: "start",
    ...(input.conceptId ? { conceptId: input.conceptId } : {}),
    ...(input.shot !== undefined ? { shot: input.shot } : {}),
    ...(input.storyboard ? { storyboard: input.storyboard } : {}),
    ...(input.durationSeconds ? { durationSeconds: input.durationSeconds } : {}),
    ...(input.placement ? { placement: input.placement } : {}),
  });
  if (!res || (res as { requiresConfirmation?: boolean }).requiresConfirmation !== true) {
    throw new Error("The provider did not return a cost quote; refusing to start a paid shot without one.");
  }
  return res;
}

/** Spends on one generated shot only after the quote was reviewed. */
export async function startShot(quote: ShotQuote): Promise<ShotStart> {
  const body: Record<string, unknown> = {
    action: "start",
    confirm: true,
    model: quote.model,
    durationSeconds: quote.durationSeconds,
    ...(quote.conceptId ? { conceptId: quote.conceptId } : {}),
    ...(quote.shot !== undefined ? { shot: quote.shot } : {}),
  };
  return invokeAdsVideo<ShotStart>(body);
}

export interface ShotPoll {
  done: boolean;
  state: string;
  videoUri?: string | null;
  error?: string | null;
  /** True when the server replaced a provider-rejected interaction with a
   *  fresh attempt on the same shot record. Poll the `operationId` returned
   *  alongside it, not the original one. */
  retrying?: boolean;
  /** The new interaction id after an automatic retry. */
  operationId?: string;
  /** The provider's own reason for the rejected attempt. */
  retryReason?: string | null;
}

export function pollShot(shotId: string, operationId: string): Promise<ShotPoll> {
  return invokeAdsVideo<ShotPoll>({ action: "poll", shotId, operationId });
}

// ---------------------------------------------------------------------------
// Voiceover — billed characters are the cost; the server reports them per call
// ---------------------------------------------------------------------------

export interface VoiceQuote {
  characters: number;
  valid: boolean;
}

export async function validateVoiceover(text: string): Promise<VoiceQuote> {
  const { data, error } = await supabase.functions.invoke("voiceover", {
    body: { action: "validate", text },
  });
  if (error) throw new Error(await edgeErrorMessage(error));
  return data as VoiceQuote;
}

export interface VoiceAudio {
  characters: number;
  audio: string;
  mimeType: string;
  cached: boolean;
}

export async function generateVoiceover(input: { text: string; voiceId?: string; styleId?: string }): Promise<VoiceAudio> {
  const { data, error } = await supabase.functions.invoke("voiceover", {
    body: {
      action: "generate",
      text: input.text,
      // The server defaults to premium_tech as well; sending it keeps the brand
      // read explicit here instead of relying on an invisible fallback.
      styleId: input.styleId ?? "premium_tech",
      ...(input.voiceId ? { voiceId: input.voiceId } : {}),
    },
  });
  if (error) throw new Error(await edgeErrorMessage(error));
  return data as VoiceAudio;
}

/** Stores the narration file in the owner's storage folder; path handed to render. */
export async function uploadNarration(audioBase64: string, mimeType: string): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error("Sign in to store the narration");
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const ext = mimeType.includes("wav") ? "wav" : "mp3";
  const path = `${uid}/narration-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("ads").upload(path, bytes, { contentType: mimeType });
  if (error) throw new Error(error.message);
  return `ads/${path}`;
}

// ---------------------------------------------------------------------------
// Playback — the finished cut, signed for the owner
// ---------------------------------------------------------------------------

export interface AdClip {
  shot: number;
  url: string;
  durationSeconds: number;
  description: string;
}

export interface AdPreview {
  conceptId: string;
  hook: string;
  callToAction: string;
  durationSeconds: number;
  totalSeconds: number;
  clips: AdClip[];
  /** Storyboard shots with no stored clip — reported, never substituted. */
  missing: number[];
  narrationUrl: string | null;
  captions: VideoCaptions[];
}

/** Returns every shot clip and the narration as freshly signed URLs, so the ad
 *  plays immediately without a render worker or an external editor. */
export function previewAd(conceptId: string, narrationPath: string | null): Promise<AdPreview> {
  return invokeAdsVideo<AdPreview>({
    action: "preview",
    conceptId,
    ...(narrationPath ? { narrationPath } : {}),
  });
}

// ---------------------------------------------------------------------------
// Render + job status
// ---------------------------------------------------------------------------

export interface RenderJob {
  jobId: string;
  state: string;
  progress: number;
  missingShots?: number[];
  notes?: string[];
}

/** Quotes the render (and fails before spending when assets are missing). */
export async function renderVideo(input: {
  conceptId: string;
  voiceover: string;
  captions: VideoCaptions[];
  narrationPath: string | null;
  assetPaths: Record<string, string>;
}): Promise<RenderJob> {
  return invokeAdsVideo<RenderJob>({
    action: "render",
    conceptId: input.conceptId,
    voiceover: input.voiceover,
    captions: input.captions,
    ...(input.narrationPath ? { narrationPath: input.narrationPath } : {}),
    assetPaths: input.assetPaths,
  });
}

export interface JobStatus {
  jobId: string;
  status: string;
  progress: number;
  error?: string | null;
  /** What the editor is doing right now (live stage string from the server). */
  stage?: string | null;
  publicUrl?: string | null;
}

export function jobStatus(jobId: string): Promise<JobStatus> {
  return invokeAdsVideo<JobStatus>({ action: "jobStatus", jobId });
}
