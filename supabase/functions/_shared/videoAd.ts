// ============================================================================
// videoAd — the video-ad workflow domain model.
// ----------------------------------------------------------------------------
// This is the join between the conversation layer (chat) and the production
// layer (Veo shots, ElevenLabs narration, render worker, FFmpeg). It is pure and
// dependency-light so it can be tested without network, and so the same model
// applies whether a concept is written by OpenAI, edited by the athlete, or
// replayed from the database.
//
// The single most important rule carried from Prompt 4: A CONCEPT IS NOT AN
// ASSET. Copyrighted/brand-safe footage, the supplied logo and the narration
// file are all real assets; this module only describes what is needed and what
// is missing, never invents a substitute.
// ============================================================================

import type { RenderPlanInput, TextOverlay } from "./renderPlan.ts";
import { conceptTimeline, type ConceptPlanInput, type ConceptPlanResult, type TimelineEntry } from "./conceptToPlan.ts";
import { buildConceptRenderPlan } from "./conceptToPlan.ts";

// ---------------------------------------------------------------------------
// Concepts and scripts
// ---------------------------------------------------------------------------

export interface VideoConcept {
  objective: string;
  audience: string;
  angle: string;
  hook: string;
  message: string;
  product: string;
  narrativeStructure: string;
  sceneSequence: string;
  voiceover: string;
  onScreenText: string[];
  audioDirection: string;
  callToAction: string;
  durationSeconds: number;
  placement: string;
  appeal: string;
}

export interface VoiceoverRequest {
  text: string;
  voiceId: string;
  voiceName: string;
  modelId: string;
  stability: number;
  similarityBoost: number;
  style: number;
  languageCode?: string;
}

export type CaptionSpec = { startSeconds: number; endSeconds: number; text: string };

// ---------------------------------------------------------------------------
// Storyboard scene
// ---------------------------------------------------------------------------

export interface StoryboardScene {
  shot: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  visualDescription: string;
  cameraMovement: string;
  subjectAction: string;
  environment: string;
  onScreenText: string[];
  voiceoverSegment: string;
  soundEffects: string[];
  transition: "cut" | "dissolve" | "none";
  source: string;
  sourceType: ClipSourceType;
  continuityKey: string;
  uploadId?: string;
  licenseNote?: string;
}

export type ClipSourceType = "veo" | "image_to_veo" | "app_footage" | "stock" | "user_upload";

// ---------------------------------------------------------------------------
// Render-stage spec
// ---------------------------------------------------------------------------

export interface VideoRenderStage {
  presetId: string;
  totalSeconds: number;
  clips: {
    shot: number;
    src: string;
    trimStart: number;
    trimEnd: number;
    durationSeconds: number;
    transition?: { type: "cut" | "dissolve"; duration: number };
  }[];
  voiceoverPath?: string;
  musicPath?: string;
  logoPath?: string;
  fontFile?: string;
  outputPath: string;
  overlays: TextOverlay[];
  notes: string[];
  missing: string[];
}

// ---------------------------------------------------------------------------
// Cost estimate
// ---------------------------------------------------------------------------

export interface VideoCostEstimate {
  veoShots: number;
  veoSeconds: number;
  voiceoverCharacters: number;
  voiceoverCostUsd: number | null;
  totalUsd: number;
  narrativeContinuationPenaltyUsd: number;
  notes: string[];
}

export const VEO_COST_PER_SECOND_PUBLISHED = {
  "veo-3.1-fast-generate-preview": 0.15,
  "veo-3.1-generate-preview": 0.4,
} as const;

export function estimateVideoCost(
  storyboard: Pick<StoryboardScene, "sourceType" | "durationSeconds" | "voiceoverSegment">[],
  narrationSettings: { modelId?: string; text: string },
): VideoCostEstimate {
  const veoShots = storyboard.filter((s) => s.sourceType === "veo" || s.sourceType === "image_to_veo").length;
  const veoSeconds = storyboard.reduce<number>((total, s) => {
    if (s.sourceType === "veo" || s.sourceType === "image_to_veo") total += Math.max(4, s.durationSeconds);
    return total;
  }, 0);
  const voiceoverCharacters = narrationSettings.text ? narrationSettings.text.trim().length : 0;
  const voiceoverCostUsd = narrationSettings.text ? voiceoverCharacters * (narrationSettings.modelId === "eleven_multilingual_v2" ? 0.1 : 0.005) : null;
  const notes: string[] = [];
  if (voiceoverCharacters > 2000) notes.push(`the narration is long (${voiceoverCharacters} chars) and may need trimming to fit the clip`);
  if (veoSeconds > 48) notes.push("total Veo seconds exceed a single session greedy limit; split into multiple starts");
  return {
    veoShots,
    veoSeconds,
    voiceoverCharacters,
    voiceoverCostUsd,
    totalUsd: (veoShots * 0.4 * 4) + (voiceoverCostUsd ?? 0),
    narrativeContinuationPenaltyUsd: 0,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Concept → render plan bridge
// ---------------------------------------------------------------------------

export interface VideoConceptToPlanInput {
  concept: VideoConcept;
  presetId: string;
  storyboard: StoryboardScene[];
  script: { voiceover: string; captions: CaptionSpec[] };
  narrationPath?: string;
  musicPath?: string;
  logoPath?: string;
  fontFile?: string;
  outputPath: string;
}

export interface VideoConceptToPlanResult extends ConceptPlanResult {
  storyboard: StoryboardScene[];
  captionSpecs: CaptionSpec[];
}

export function videoConceptToPlan(input: VideoConceptToPlanInput): VideoConceptToPlanResult {
  const cinput: ConceptPlanInput = {
    concept: {
      hook: input.concept.hook,
      coreMessage: input.concept.message,
      script: input.script.voiceover,
      storyboard: input.storyboard.map((s) => ({
        shot: s.shot,
        description: s.visualDescription,
        veoPrompt: "",
        seconds: s.durationSeconds,
        useAppFootage: s.sourceType === "app_footage",
      })),
      callToAction: input.concept.callToAction,
      onScreenText: input.storyboard.flatMap((s) => s.onScreenText),
    },
    presetId: input.presetId,
    clipPaths: Object.fromEntries(input.storyboard.map((s) => [String(s.shot), s.source])),
    narrationPath: input.narrationPath,
    musicPath: input.musicPath ?? undefined,
    logoPath: input.logoPath ?? undefined,
    fontFile: input.fontFile ?? undefined,
    outputPath: input.outputPath,
  };
  const result = buildConceptRenderPlan(cinput);
  return {
    ...result,
    storyboard: input.storyboard,
    captionSpecs: input.script.captions ?? [],
  };
}
