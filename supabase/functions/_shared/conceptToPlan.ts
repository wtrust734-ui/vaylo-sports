// ============================================================================
// CONCEPT → RENDER PLAN.
//
// This is the join between Step 2 (an approved concept) and Step 4 (FFmpeg
// assembly). It was missing: the render worker could build and execute a plan,
// and the campaign layer could produce concepts, but nothing turned one into the
// other, so "generate the advert" was a hand-written plan every time.
//
// It is pure, like every other module in `_shared`, so the mapping is unit-tested
// and the executor stays replaceable. It does NOT generate anything: clips, the
// narration file and the music bed are inputs, and anything missing is REPORTED
// rather than substituted. Substituting is how an advert ends up showing a
// generated imitation of the app, which the brief forbids.
//
// TWO CONSTRAINTS THIS FILE HONOURS RATHER THAN REDISCOVERS
//
//  1. The overlay layout has four fixed slots — title, subhead, cta, slogan —
//     and one overlay per slot, positioned for the whole timeline. A concept
//     with more lines than slots cannot show them all in this layout, so the
//     extras are returned in `unplacedText` instead of being dropped silently.
//     The concept contract caps on-screen text at MAX_ON_SCREEN_TEXT for exactly
//     this reason.
//
//  2. Music is optional and never invented. There is no licensed bed in this
//     project, and the brief forbids unlicensed audio, so a plan without a music
//     path is a narration-and-ambience mix and says so in `notes`.
// ============================================================================

import {
  AD_PRESETS,
  BRAND,
  buildRenderPlan,
  type AdPreset,
  type RenderPlan,
  type RenderPlanInput,
  type TextOverlay,
} from "./renderPlan.ts";
import type { AdConcept } from "./campaign.ts";

/** The shortest a caption can be on screen and still be read. */
const MIN_TEXT_SECONDS = 0.8;

export interface TimelineEntry {
  shot: number;
  /** Where this shot starts in the finished advert. */
  startSeconds: number;
  endSeconds: number;
  /** True when the shot is real app footage supplied by the advertiser. */
  useAppFootage: boolean;
  /** The file the renderer will read. Empty when the asset is still missing. */
  src: string;
}

export interface ConceptPlanInput {
  concept: Partial<AdConcept>;
  presetId: string;
  /** Server-side path per shot number: a Veo clip or an uploaded screen recording. */
  clipPaths?: Record<number, string>;
  /** Server-side path or data URL of the ElevenLabs narration. */
  narrationPath?: string;
  /** A licensed music bed. Optional on purpose. */
  musicPath?: string;
  /**
   * The supplied Vaylo Sports logo. Optional, but an advert without it is not
   * brand-compliant, so the notes say so rather than substituting anything.
   */
  logoPath?: string;
  /** Path to a .ttf. Required whenever the concept has on-screen text. */
  fontFile?: string;
  outputPath: string;
}

export interface ConceptPlanResult {
  ok: boolean;
  /** Why the advert cannot be built as specified. */
  problems: string[];
  /** Assets the advertiser must supply. Never filled in with a substitute. */
  missing: string[];
  /** What the render worker is given. This is the handoff the pipeline uses. */
  request: RenderPlanInput | null;
  /** The same thing built into an ffmpeg argument list, for inspection. */
  plan: RenderPlan | null;
  preset: AdPreset | null;
  totalSeconds: number;
  timeline: TimelineEntry[];
  overlays: TextOverlay[];
  /** On-screen lines that this layout has no slot for. */
  unplacedText: string[];
  notes: string[];
}

/** Where each shot sits in the finished advert, and how long it runs. */
export function conceptTimeline(concept: Partial<AdConcept>): { totalSeconds: number; timeline: TimelineEntry[] } {
  let cursor = 0;
  const timeline = (concept.storyboard ?? []).map((shot, i) => {
    const seconds = Number(shot?.seconds) > 0 ? Number(shot.seconds) : 0;
    const entry: TimelineEntry = {
      shot: Number.isFinite(Number(shot?.shot)) ? Number(shot?.shot) : i + 1,
      startSeconds: Math.round(cursor * 100) / 100,
      endSeconds: Math.round((cursor + seconds) * 100) / 100,
      useAppFootage: shot?.useAppFootage === true,
      src: "",
    };
    cursor += seconds;
    return entry;
  });
  return { totalSeconds: Math.round(cursor * 100) / 100, timeline };
}

/**
 * Place the concept's text into the four fixed slots.
 *
 * Timings are derived from the advert's own length rather than a fixed number of
 * seconds, so a 6-second cut and a 30-second cut both read correctly: the title
 * owns the opening quarter, the CTA owns the close, and the subhead fills what is
 * left over. A slot that would be on screen for less than MIN_TEXT_SECONDS is
 * left empty and reported — a caption nobody can read is worse than no caption.
 */
export function conceptOverlays(concept: Partial<AdConcept>, totalSeconds: number): { overlays: TextOverlay[]; unplacedText: string[]; droppedDuplicates: number } {
  const text = Array.isArray(concept.onScreenText)
    ? concept.onScreenText.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean)
    : [];

  const overlays: TextOverlay[] = [];
  const unplacedText: string[] = [];

  const ctaText = (concept.callToAction ?? "").trim();
  // The CTA has its own field and its own slot, so a line that merely repeats it
  // is dropped rather than counted as an unplaceable extra. Models add it often.
  const slots = ctaText ? text.filter((t) => t.toLowerCase() !== ctaText.toLowerCase()) : text;
  const droppedDuplicates = text.length - slots.length;
  const ctaSeconds = Math.min(3, Math.max(1.5, totalSeconds * 0.25));
  const ctaStart = Math.max(0, totalSeconds - ctaSeconds);

  // Slot 1 — title, over the opening.
  const title = slots.shift();
  if (title) {
    const end = Math.min(totalSeconds, Math.max(MIN_TEXT_SECONDS, Math.min(totalSeconds * 0.25, ctaStart)));
    if (end > 0) overlays.push({ role: "title", text: title, startSeconds: 0, endSeconds: end });
    else unplacedText.push(title);
  }

  // Slot 2 — subhead, between the title and the CTA.
  const subhead = slots.shift();
  const titleEnd = overlays.find((o) => o.role === "title")?.endSeconds ?? 0;
  if (subhead) {
    if (ctaStart - titleEnd >= MIN_TEXT_SECONDS) {
      overlays.push({ role: "subhead", text: subhead, startSeconds: titleEnd, endSeconds: ctaStart });
    } else {
      unplacedText.push(subhead);
    }
  }

  // Slot 3 — the campaign's call to action, over the close.
  if (ctaText) overlays.push({ role: "cta", text: ctaText, startSeconds: ctaStart, endSeconds: totalSeconds });

  // Anything a concept carries beyond the slots is reported, never dropped.
  for (const extra of slots) unplacedText.push(extra);
  // The slogan is the brand's, not the model's, so it is never invented.
  if (totalSeconds >= 4) {
    overlays.push({
      role: "slogan",
      text: BRAND.slogan,
      startSeconds: Math.max(ctaStart, totalSeconds - 2.5),
      endSeconds: totalSeconds,
    });
  }

  return { overlays, unplacedText, droppedDuplicates };
}

/**
 * Turn an approved concept into everything the render worker needs.
 *
 * Volume policy, stated because it is a real mixing decision: narration is the
 * foreground at full level; a music bed sits under it and is ducked further
 * while the narration plays. When a concept has narration the clips' own audio
 * is dropped, because generated ambience under a voiceover is uncontrolled and
 * the advert's message has to be intelligible. With no narration the clips keep
 * their own audio and the music bed, if any, carries the piece.
 */
export function buildConceptRenderPlan(input: ConceptPlanInput): ConceptPlanResult {
  const problems: string[] = [];
  const missing: string[] = [];
  const notes: string[] = [];

  const concept = input.concept ?? {};
  const preset = AD_PRESETS[input.presetId];
  if (!preset) {
    return {
      ok: false,
      problems: [`unknown preset: ${input.presetId}`],
      missing: [],
      request: null,
      plan: null,
      preset: null,
      totalSeconds: 0,
      timeline: [],
      overlays: [],
      unplacedText: [],
      notes: [],
    };
  }

  const shots = Array.isArray(concept.storyboard) ? concept.storyboard : [];
  if (shots.length === 0) problems.push("the concept has no storyboard, so there is nothing to cut together");

  const { totalSeconds, timeline } = conceptTimeline(concept);
  if (shots.length > 0 && totalSeconds <= 0) problems.push("the storyboard's shot lengths add up to zero seconds");

  const clipPaths = input.clipPaths ?? {};
  const timelineWithSources = timeline.map((entry) => {
    const src = clipPaths[entry.shot] ?? "";
    if (!src) {
      missing.push(
        `shot ${entry.shot}: ${entry.useAppFootage ? "a real screen recording of the app" : "a Veo clip"} (${entry.endSeconds - entry.startSeconds}s)`,
      );
    }
    return { ...entry, src };
  });

  const hasNarration = typeof input.narrationPath === "string" && input.narrationPath.trim().length > 0;
  const hasMusic = typeof input.musicPath === "string" && input.musicPath.trim().length > 0;

  if (!input.outputPath?.trim()) problems.push("an output path is required");

  // Text needs a font at render time, and the runtime has none. Refusing here
  // beats a render that fails after the athlete has waited for it.
  const wantsText = conceptOverlays(concept, totalSeconds).overlays.length > 0;
  if (wantsText && !input.fontFile?.trim()) problems.push("a fontFile is required because the concept has on-screen text");

  if (problems.length > 0 || missing.length > 0) {
    return {
      ok: false,
      problems,
      missing,
      request: null,
      plan: null,
      preset,
      totalSeconds,
      timeline: timelineWithSources,
      overlays: [],
      unplacedText: [],
      notes,
    };
  }

  const { overlays, unplacedText } = conceptOverlays(concept, totalSeconds);
  if (unplacedText.length > 0) {
    notes.push(
      `${unplacedText.length} on-screen line(s) have no slot in this layout and are not in the advert: ${unplacedText.join(" / ")}`,
    );
  }
  const hasLogo = typeof input.logoPath === "string" && input.logoPath.trim().length > 0;
  if (!hasLogo) notes.push("no logo overlay: the advert carries the slogan and the brand palette, but not the supplied artwork.");
  if (!hasMusic) notes.push("no music bed: this is a narration-and-ambience mix. No unlicensed audio is ever added.");
  else if (hasNarration) notes.push("music is attenuated to 0.35 under the narration and limited at the end of the chain; dynamic ducking is not implemented by the renderer.");
  if (!hasNarration) notes.push("no narration: the clips keep their own audio.");
  if (!timeline.some((s) => s.useAppFootage) && (concept.storyboard ?? []).length > 0) {
    notes.push("no shot uses real app footage, so the advert never shows the product.");
  }

  // The worker is given this object, not an argv list: the plan is one
  // interpretation of it, and the runner owns the filesystem.
  const request: RenderPlanInput = {
      presetId: input.presetId,
      // Hard cuts between shots. A dissolve is available in the renderer, but it
      // shortens the timeline it joins, which would slide every caption this file
      // just placed against the shot lengths.
      clips: timelineWithSources.map((entry) => ({
        src: entry.src,
        trimStart: 0,
        trimEnd: entry.endSeconds - entry.startSeconds,
        durationSeconds: entry.endSeconds - entry.startSeconds,
      })),
      overlays,
      voiceover: hasNarration ? { src: input.narrationPath as string, volume: 1 } : undefined,
      // No `duckTo`: the renderer declares that field but does not implement
      // sidechain ducking, so asking for it would be a no-op dressed up as a
      // mixing decision. The bed is attenuated statically instead — quieter under
      // narration than on its own — and the plan explains that in `notes`.
      music: hasMusic ? { src: input.musicPath as string, volume: hasNarration ? 0.35 : 0.6 } : undefined,
    // Real artwork, never a generated stand-in.
    logo: hasLogo ? { src: input.logoPath as string } : undefined,
    keepSourceAudio: !hasNarration,
    fontFile: overlayFont(input.fontFile),
      outputPath: input.outputPath,
  };

  let plan: RenderPlan;
  try {
    plan = buildRenderPlan(request);
  } catch (e) {
    return {
      ok: false,
      problems: [`the render plan was refused: ${e instanceof Error ? e.message : "unknown error"}`],
      missing: [],
      request: null,
      plan: null,
      preset,
      totalSeconds,
      timeline: timelineWithSources,
      overlays,
      unplacedText,
      notes,
    };
  }

  return {
    ok: true,
    problems: [],
    missing: [],
    request,
    plan,
    preset,
    totalSeconds,
    timeline: timelineWithSources,
    overlays,
    unplacedText,
    notes,
  };
}

/** The font matters only if there is text, so it stays undefined otherwise. */
function overlayFont(fontFile?: string): string | undefined {
  return fontFile?.trim() ? fontFile : undefined;
}
