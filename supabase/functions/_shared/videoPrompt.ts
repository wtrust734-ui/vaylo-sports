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

export function buildScriptPrompt(
  concept: Pick<VideoConcept, "objective" | "audience" | "angle" | "message" | "product" | "durationSeconds" | "placement" | "voiceover" | "callToAction">,
  brand: { name: string; slogan: string; positioning: string },
  request = "",
): string {
  return JSON.stringify({
    task: "Design ONE video ad concept, then write its spoken script and on-screen captions. Return JSON only.",
    // Every field the pipeline stores must be asked for. When hook/coreMessage/
    // narrativeStructure/sceneSequence were omitted here the writer never
    // returned them, and ads-video fell back to the caller's instruction — the
    // ad's "hook" became the words "create a video ad".
    outputShape: {
      hook: "the ad's opening line — the first thing the viewer hears or reads: one specific sentence, max 12 words, that stops the right viewer. Real ad copy, not a label.",
      coreMessage: "the single thought the viewer should leave with — the benefit or idea, max 20 words.",
      narrativeStructure: "the beats in order, e.g. 'hook -> tension -> proof -> call to action'.",
      sceneSequence: "3-5 comma-separated visual beats an editor can shoot, specific to this audience and product.",
      onScreenText: "2-4 short on-screen lines, max 6 words each; no prices.",
      script: "one spoken voiceover paragraph, present tense, second person",
      captions: "timecoded lines against the finished advert",
      totalSeconds: "must match the concept's durationSeconds",
    },
    constraints: [
      "Write copy for the viewer. The request below is the advertiser's instruction and context ONLY — never copy it, quote it, or restate it as the hook, the coreMessage or any line of the script.",
      "If the request only says what to make (for example 'create a video ad'), invent the angle from the product, brand, audience and objective. Do not ask questions and do not echo the instruction.",
      "The hook must stand on its own as the first line of the ad: concrete, audience-specific, and free of the words 'create', 'make', 'generate', 'video ad' or 'advert'.",
      "The hook, coreMessage, sceneSequence, script and call to action must tell one consistent story.",
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
    request,
  });
}

/**
 * One corrective retry, used when the writer's hook is unusable. The rejection
 * reason travels with the original task so the second attempt keeps every other
 * rule instead of starting from a blank prompt.
 */
export function buildScriptCorrection(basePrompt: string, problem: string): string {
  return `${basePrompt}\n\nREJECTED PREVIOUS ATTEMPT: ${problem}. Rewrite the whole JSON object. The hook must be a real opening line of ad copy for the viewer; the request is context, never a line of the ad.`;
}

// ---------------------------------------------------------------------------
// Hook validation — an ad's first line, never the caller's instruction
// ---------------------------------------------------------------------------

const INSTRUCTION_OPENING =
  /^(please\s+|can you\s+|could you\s+|i want (you )?to\s+|i need (you )?to\s+)?(create|make|generate|build|design|produce|write|draft|come up with|film|shoot)\b/i;

const normaliseCopy = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Why a hook is unusable, or null when it is real ad copy.
 *
 * The bug this guards: the concept writer is handed the caller's request, and
 * a request like "create a video ad" used to end up as the ad's hook because
 * there was no hook to fall back on but the message. A hook that echoes the
 * brief, opens with an instruction or names the ad format is rejected rather
 * than stored.
 */
export function hookProblem(hook: string, request = ""): string | null {
  const value = hook.trim();
  if (!value) return "no hook was written";
  const words = value.split(/\s+/);
  if (words.length < 3) return "the hook is too short to be an opening line";
  if (INSTRUCTION_OPENING.test(value)) return "the hook is an instruction, not ad copy";
  const h = normaliseCopy(value);
  const r = normaliseCopy(request);
  if (r.length >= 6 && (h === r || r.includes(h) || (h.length >= 6 && h.includes(r)))) {
    return "the hook repeats the request instead of writing an ad line";
  }
  if (words.length <= 5 && /\b(video ad|advert|ad)\b/i.test(value)) {
    return "the hook names the format instead of the idea";
  }
  return null;
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
