// ============================================================================
// videoPrompt — the script and narrative side of the video ad engine.
// ----------------------------------------------------------------------------
// Pure helpers only. They describe what the provider should build; they never
// build it. Prompts are closed under the brand rules carried from Prompt 4:
// no prices, no guarantees, no invented statistics, no testimonials, no clinical
// claims, no "AI coach" language, and the supplied logo is the only artwork used.
// ============================================================================

import type { StoryboardScene, VideoConcept, VoiceoverRequest, CaptionSpec } from "./videoAd.ts";
import { VOICEOVER_STYLES, FORBIDDEN_SCRIPT_PATTERNS, type VoiceoverStyle } from "./elevenlabs.ts";

export const BRAND_NEGATIVE_PROMPT = [
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
  "people reading text on phone screens that show fictitious UI",
].join(", ");

// ---------------------------------------------------------------------------
// Script generation prompt
// ---------------------------------------------------------------------------

export function buildScriptPrompt(concept: Pick<VideoConcept, "objective" | "audience" | "angle" | "message" | "product" | "durationSeconds" | "placement" | "voiceover" | "callToAction">, brand: { name: string; slogan: string; positioning: string }): string {
  return JSON.stringify({
    task: "Write a spoken narration script and on-screen captions ONLY for a single video ad. Return JSON only.",
    outputShape: {
      script: "one spoken voiceover paragraph, present tense, second person",
      captions: "timecoded lines against the finished advert",
      totalSeconds: "must match the concept's durationSeconds",
    },
    constraints: [
      "Do NOT invent statistics, review scores, user counts, testimonials or performance results.",
      "Do NOT mention price, trial, discount, subscription or checkout.",
      "Do NOT promise results, score improvements, injury prevention or guaranteed outcomes.",
      "Do NOT describe features that do not exist in the concept's product description.",
      "Use only the concept's angle and message; be specific to the audience named in the concept.",
      "Each caption must be no longer than 12 words and must fit the timing it is given.",
      "Return captions as an array of { startSeconds, endSeconds, text } — timecodes are against the finished video, not against the voiceover word count.",
    ],
    concept,
    brand,
  });
}

export function buildScriptRefinementPrompt(
  originalScript: string,
  originalCaptions: CaptionSpec[],
  editDirection: string,
  brand: { name: string },
): string {
  return JSON.stringify({
    task: "Edit the supplied voiceover script and captions to match the requested direction. Return JSON only: { script, captions }.",
    constraints: [
      "Keep timecodes consistent with the edited text.",
      "Do not introduce statistics, prices, guarantees, testimonials or brand claims the original avoided.",
      "Keep the same product name and the same CTA sentiment unless explicitly told to change it.",
    ],
    originalScript,
    originalCaptions,
    editDirection,
    brand,
  });
}

// ---------------------------------------------------------------------------
// Storyboard formatter
// ---------------------------------------------------------------------------

export interface StoryboardPromptScene {
  shot: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  visualDescription: string;
  cameraMovement: string;
  subjectAction: string;
  environment: string;
  continuityKey: string;
  sourceType: StoryboardScene["sourceType"];
}

export function buildStoryboardPrompt(concept: Pick<VideoConcept, "objective" | "audience" | "angle" | "message" | "product" | "durationSeconds" | "placement" | "narrativeStructure" | "hook">, brand: { name: string; positioning: string }, requestedShots: number): string {
  // Each shot is built independently but carries a continuityKey so the
  // production layer can ask for the same athlete/location/palette across shots.
  const sceneExamples: StoryboardPromptScene[] = [];
  let cursor = 0;
  for (let i = 0; i < Math.min(requestedShots, concept.durationSeconds / 3 + 1); i++) {
    sceneExamples.push({
      shot: i + 1,
      startSeconds: cursor,
      endSeconds: cursor + Math.max(2, concept.durationSeconds / (requestedShots || 1)),
      durationSeconds: Math.max(2, concept.durationSeconds / (requestedShots || 1)),
      visualDescription: "",
      cameraMovement: "",
      subjectAction: "",
      environment: "",
      continuityKey: "",
      sourceType: "veo",
    });
    cursor += Math.max(2, concept.durationSeconds / (requestedShots || 1));
  }

  return JSON.stringify({
    task: "Turn the concept into a production-ready storyboard. Return JSON only: { scenes: [{ shot, startSeconds, endSeconds, durationSeconds, visualDescription, cameraMovement, subjectAction, environment, continuityKey, sourceType }] }.",
    constraints: [
      "Scene durations must add up exactly to the concept's durationSeconds.",
      "Each shot is described so a Veo prompt can be written from it — one clear visual action and one environment.",
      "The continuityKey is the SAME for shots that need to look like one film: same athlete, same location, same palette, same clothing.",
      "Keep shots meaningfully different in framing and action, not just colour variations of one shot.",
      "Never promise results in the visual description.",
    ],
    concept,
    brand,
    scenes: sceneExamples,
  });
}

// ---------------------------------------------------------------------------
// Scene prompt builder
// ---------------------------------------------------------------------------

export function buildScenePrompt(scene: StoryboardScene, brand: { positioning: string }): string {
  return [
    `Vaylo Sports brand direction: ${brand.positioning}.`,
    `Shot ${scene.shot}, ${scene.durationSeconds}s, start ${scene.startSeconds}s.`,
    `Visual: ${scene.visualDescription}.`,
    `Camera: ${scene.cameraMovement}.`,
    `Action: ${scene.subjectAction}.`,
    `Environment: ${scene.environment}.`,
    `Continuity key: ${scene.continuityKey}.`,
    `Never add text, captions, logos, watermarks, brand names, prices, UI, phone screens or people reading text.`,
  ].join(" ");
}

export function buildImageToVideoPrompt(scene: StoryboardScene, imageDescription: string, brand: { positioning: string }): string {
  return [
    `Start from a still image described as: ${imageDescription}.`,
    `Add controlled motion: ${scene.cameraMovement} over ${scene.durationSeconds}s.`,
    `Brand direction: ${brand.positioning}.`,
    `Keep the same subject, clothing and environment as the still; do not invent a new scene.`,
    "No text, captions, logos, watermarks, prices, UI or phone screens.",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Narration prompt
// ---------------------------------------------------------------------------

export function buildNarrationPrompt(script: string, voiceStyle: VoiceoverStyle, brand: { name: string }): string {
  return [
    `Produce a narrated script of the voiceover text below, read by the voice '${voiceStyle.voiceName}' in the style labelled '${voiceStyle.label}'.`,
    `Brand: ${brand.name}.`,
    `Voice direction: ${voiceStyle.intent}`,
    `Read exactly this text: ${script}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Caption spec validation
// ---------------------------------------------------------------------------

export function validateCaptionSpecs(specs: CaptionSpec[], totalSeconds: number): string[] {
  const problems: string[] = [];
  for (const spec of specs) {
    if (spec.startSeconds < 0) problems.push(`caption at ${spec.startSeconds}s has a negative start`);
    if (spec.endSeconds > totalSeconds) problems.push(`caption ending at ${spec.endSeconds}s exceeds the advert's ${totalSeconds}s`);
    if (spec.startSeconds >= spec.endSeconds) problems.push(`caption "${spec.text.slice(0, 40)}" has start not less than end`);
    if (spec.text.split(/\s+/).length > 12) problems.push(`caption "${spec.text.slice(0, 50)}" is longer than 12 words`);
  }
  return problems;
}
