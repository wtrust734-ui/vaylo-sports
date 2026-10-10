// ============================================================================
// CAMPAIGN — brief validation, the concept contract, brand rules and cost.
// ----------------------------------------------------------------------------
// This is the layer that turns "I want an advert" into things the existing
// providers can act on. It is pure and dependency-light so it is unit-testable,
// and so the same rules apply whether a concept is written by OpenAI, edited by
// the athlete, or replayed from the database.
//
// The single most important rule in this file: A CONCEPT IS NOT AN ASSET. Every
// concept carries an estimated cost and is generated only after someone approves
// it, because the two providers behind it bill real money — Veo by the second,
// ElevenLabs by the character.
//
// It also owns the fabrication rules. The brief forbids inventing app features,
// reviews, statistics and performance claims, and a model asked for "a hook and
// a benefit" will happily invent all four. Those are checked here, before
// anything is generated or billed.
// ============================================================================

import { ELEVENLABS_MODELS, billedCharacters, validateScript } from "./elevenlabs.ts";
import { estimateVeoCostUsd, normaliseDuration } from "./veo.ts";
import { GEMINI_MODELS } from "./aiModels.ts";

/** Objectives a campaign can have. Kept small: each implies a different hook. */
export const CAMPAIGN_OBJECTIVES = {
  app_installs: "App installs",
  awareness: "Brand awareness",
  feature_adoption: "Feature adoption",
  community: "Community growth",
  waitlist: "Waitlist sign-ups",
} as const;

export type CampaignObjective = keyof typeof CAMPAIGN_OBJECTIVES;

/** Placements, with the preset each maps onto for rendering. */
export const AD_PLATFORMS = {
  tiktok: { label: "TikTok", presetId: "reels", aspect: "9:16", maxSeconds: 30 },
  reels: { label: "Instagram Reels", presetId: "reels", aspect: "9:16", maxSeconds: 30 },
  shorts: { label: "YouTube Shorts", presetId: "shorts", aspect: "9:16", maxSeconds: 60 },
  square: { label: "Square social", presetId: "square", aspect: "1:1", maxSeconds: 30 },
  landscape: { label: "Landscape / YouTube", presetId: "landscape", aspect: "16:9", maxSeconds: 60 },
} as const;

export type AdPlatform = keyof typeof AD_PLATFORMS;

/** Three concepts, so there is a real choice without an unbounded token bill. */
export const CONCEPT_COUNT = 3;

/**
 * On-screen text lines a concept may carry.
 *
 * TWO, and the number is derived from the render layout rather than chosen:
 * the layout has a title slot and a subhead slot, the call to action has its own
 * field and its own slot, and the slogan belongs to the brand. The cap used to be
 * six, which was a promise the assembly step could not keep — the extra lines
 * would simply never appear in the advert.
 *
 * A line that merely repeats the call to action is tolerated rather than counted;
 * models add it routinely, and rejecting a whole concept over a duplicate would
 * be pedantry.
 */
export const MAX_ON_SCREEN_TEXT = 2;

export interface CampaignBrief {
  name: string;
  objective: CampaignObjective;
  /** Who the advert is for, in the advertiser's words. */
  audience: string;
  platform: AdPlatform;
  /** Spending ceiling in USD. Paid generation is refused above it. */
  budgetUsd: number;
  /** The single message the advert must land. */
  message: string;
  /** The call to action the advert ends on. */
  callToAction: string;
}

export interface BriefValidation {
  ok: boolean;
  problems: string[];
}

const MAX_TEXT = 600;

/**
 * Validate a brief before anything is sent to a provider.
 *
 * Collects every problem rather than returning the first, because a form that
 * reports one error at a time is a form the athlete fills in four times.
 */
export function validateBrief(brief: Partial<CampaignBrief> | null | undefined): BriefValidation {
  const problems: string[] = [];
  const b = brief ?? {};

  const text = (value: unknown, label: string, min: number, max = MAX_TEXT) => {
    const s = typeof value === "string" ? value.trim() : "";
    if (s.length < min) problems.push(`${label} must be at least ${min} characters`);
    else if (s.length > max) problems.push(`${label} must be at most ${max} characters`);
    return s;
  };

  text(b.name, "Campaign name", 3, 120);
  text(b.audience, "Target audience", 3);
  text(b.message, "Campaign message", 3);
  text(b.callToAction, "Call to action", 2, 60);

  if (!b.objective || !(b.objective in CAMPAIGN_OBJECTIVES)) {
    problems.push(`Objective must be one of: ${Object.keys(CAMPAIGN_OBJECTIVES).join(", ")}`);
  }
  if (!b.platform || !(b.platform in AD_PLATFORMS)) {
    problems.push(`Platform must be one of: ${Object.keys(AD_PLATFORMS).join(", ")}`);
  }

  const budget = Number(b.budgetUsd);
  if (!Number.isFinite(budget) || budget < 0) problems.push("Budget must be a number of dollars, 0 or more");
  else if (budget > 10_000) problems.push("Budget above $10,000 is refused; raise it deliberately in the dashboard");

  // The message and the CTA are what the viewer actually reads, so brand rules
  // apply to them here rather than only to the narration later on.
  const messageViolations = validateScript(typeof b.message === "string" ? b.message : "");
  for (const v of messageViolations.violations) problems.push(`Campaign message: ${v}`);
  const ctaViolations = validateScript(typeof b.callToAction === "string" ? b.callToAction : "");
  for (const v of ctaViolations.violations) problems.push(`Call to action: ${v}`);

  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// The concept contract
// ---------------------------------------------------------------------------

/** One storyboard beat, which is also the input to one Veo generation. */
export interface StoryboardShot {
  /** 1-based position in the advert. */
  shot: number;
  /** What the camera sees. */
  description: string;
  /** Prompt handed verbatim to Veo. */
  veoPrompt: string;
  /** Clip length in seconds; must be a length Veo accepts. */
  seconds: number;
  /** True when this beat should show real app footage instead of generated video. */
  useAppFootage: boolean;
}

export interface AdConcept {
  /** Short working title. */
  title: string;
  /** The first three seconds; the part that decides whether anyone watches. */
  hook: string;
  /** What the advert is really saying. */
  coreMessage: string;
  /** Narration, as spoken. */
  script: string;
  /** The beats, in order. */
  storyboard: StoryboardShot[];
  /** Exact words that appear on screen. */
  onScreenText: string[];
  /** The closing line. */
  callToAction: string;
  /** One-line rationale, so the choice between three concepts is informed. */
  rationale: string;
}

/** JSON Schema handed to OpenAI, so the model returns this shape and not prose. */
export const AD_CONCEPT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    hook: { type: "string" },
    coreMessage: { type: "string" },
    script: { type: "string" },
    rationale: { type: "string" },
    callToAction: { type: "string" },
    onScreenText: { type: "array", items: { type: "string" } },
    storyboard: {
      type: "array",
      items: {
        type: "object",
        properties: {
          shot: { type: "integer" },
          description: { type: "string" },
          veoPrompt: { type: "string" },
          seconds: { type: "integer", enum: [4, 6, 8] },
          useAppFootage: { type: "boolean" },
        },
        required: ["shot", "description", "veoPrompt", "seconds", "useAppFootage"],
      },
    },
  },
  required: ["title", "hook", "coreMessage", "script", "rationale", "callToAction", "onScreenText", "storyboard"],
} as const;

/** Text a concept must never contain, beyond the shared variable rules. */
export const FABRICATION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(login|sign[- ]?in|dashboard|settings) (screen|page)\b/i, reason: "app screens must come from a real screenshot, not a description" },
  { pattern: /\b(as seen on|featured in|award[- ]winning)\b/i, reason: "unverifiable endorsements are forbidden" },
  { pattern: /\b(our users|athletes love|rated \d)\b/i, reason: "reviews and ratings must not be invented" },
  { pattern: /\b(will|guaranteed to) (improve|increase|boost|add) (your )?\w+/i, reason: "performance outcomes cannot be promised" },
  { pattern: /\b(\d+[,.]?\d*)\s*(k|m)?\+?\s*(athletes|users|downloads|installs)\b/i, reason: "user counts must not be invented" },
];

export interface ConceptValidation {
  ok: boolean;
  problems: string[];
}

/**
 * Things that are legitimate in a SCREENPLAY but wrong in a script that is read
 * aloud.
 *
 * Found by reading the real output rather than by testing: the first live run
 * returned `script: "VO: \u201cPitch or pavement. Keep showing up.\u201d End card:
 * \u201cJoin the waitlist.\u201d Total: 16 seconds."`. Sent to ElevenLabs, that is
 * narration which literally says "V-O colon" and "Total sixteen seconds" over the
 * advert, and it bills the characters. `voiceover` already forbids speaker labels,
 * so a concept carrying them can never be rendered as written.
 */
export const STAGE_DIRECTION_PATTERNS: Array<{ pattern: RegExp; what: string }> = [
  // A label anywhere in the line: VO:, Narrator:, End card:, On screen:, SFX:
  { pattern: /(^|[\s"'\u201c\u201d(\[])(vo|v\.o\.|voice ?over|narrator|end ?card|on ?screen|text|sfx|music|camera|cut to)\s*:/i, what: "a speaker or scene label" },
  // Timing notes belong in the storyboard, where they are used for real.
  { pattern: /\b(total|duration|runtime|length)\s*:?\s*\d+\s*(s|sec|secs|seconds?)\b/i, what: "a duration note" },
  { pattern: /\b\d+\s*(s|sec|secs|seconds?)\b/i, what: "a duration note" },
  { pattern: /^\s*\(?\s*(cut to|close[- ]up|wide shot|fade (in|out)|music (swells|fades))\b/i, what: "a camera direction" },
];

/**
 * Reduce a script to the words that are actually spoken.
 *
 * Narrow and deliberate: a single leading label, quotation marks wrapping the
 * whole line, and surrounding whitespace. It does NOT remove directions that sit
 * inside the sentence, because deleting text silently is worse than refusing it —
 * those are reported by validateConcept() instead.
 */
export function spokenScript(script: string): string {
  let s = String(script ?? "").trim();
  s = s.replace(/^\s*(vo|v\.o\.|voice ?over|narrator)\s*:\s*/i, "");
  s = s.replace(/^[\u201c\u201d"']+|[\u201c\u201d"']+$/g, "").trim();
  return s;
}

/**
 * Coerce whatever the model returned into the shape the rest of the app uses.
 *
 * Pure and exported so it can be tested here rather than only through the
 * deployed function, and so a concept loaded back out of the database goes
 * through exactly the same path as a freshly generated one.
 */
export function normaliseConcept(raw: unknown): Partial<AdConcept> {
  const c = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const shots = Array.isArray(c.storyboard) ? c.storyboard : [];
  return {
    title: str(c.title),
    hook: str(c.hook),
    coreMessage: str(c.coreMessage),
    script: spokenScript(str(c.script)),
    rationale: str(c.rationale),
    callToAction: str(c.callToAction),
    onScreenText: Array.isArray(c.onScreenText)
      ? c.onScreenText.filter((t): t is string => typeof t === "string").map((t) => t.trim())
      : [],
    storyboard: shots.map((s, i) => {
      const shot = (s ?? {}) as Record<string, unknown>;
      return {
        shot: Number.isFinite(Number(shot.shot)) ? Number(shot.shot) : i + 1,
        description: str(shot.description),
        veoPrompt: str(shot.veoPrompt),
        seconds: Number(shot.seconds),
        useAppFootage: shot.useAppFootage === true,
      };
    }),
  };
}

/** Pull the concepts array out of whatever the model returned. Never throws. */
export function parseConceptPayload(content: unknown): unknown[] {
  if (!content) return [];
  let parsed: unknown = content;
  if (typeof content === "string") {
    try {
      parsed = JSON.parse(content);
    } catch {
      return [];
    }
  }
  const holder = parsed as { concepts?: unknown } | null;
  return Array.isArray(holder?.concepts) ? holder.concepts : [];
}

/**
 * Validate a concept's structure and content.
 *
 * Structural checks matter because these values are passed straight into Veo,
 * ElevenLabs and FFmpeg: a missing prompt or a 3-second shot would surface as a
 * provider error minutes later, after money had been spent.
 */
export function validateConcept(concept: Partial<AdConcept> | null | undefined): ConceptValidation {
  const problems: string[] = [];
  const c = concept ?? {};

  const str = (v: unknown, label: string, min = 1, max = 1200) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (s.length < min) problems.push(`${label} is required`);
    else if (s.length > max) problems.push(`${label} is longer than ${max} characters`);
    return s;
  };

  str(c.title, "title", 2, 120);
  str(c.hook, "hook", 2, 240);
  str(c.coreMessage, "core message", 2, 400);
  str(c.script, "script", 2);
  str(c.callToAction, "call to action", 2, 60);
  str(c.rationale, "rationale", 2, 400);

  const textLines = Array.isArray(c.onScreenText)
    ? c.onScreenText.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
    : [];
  const ctaLower = (typeof c.callToAction === "string" ? c.callToAction : "").trim().toLowerCase();
  // A line that is just the call to action again is not an extra line.
  const extraLines = textLines.filter((t) => t.toLowerCase() !== ctaLower);
  if (textLines.length === 0) {
    problems.push("at least one on-screen text line is required");
  } else if (extraLines.length > MAX_ON_SCREEN_TEXT) {
    problems.push(
      `at most ${MAX_ON_SCREEN_TEXT} on-screen text lines are supported beyond the call to action (got ${extraLines.length}): they fill the title and subhead positions`,
    );
  }

  if (!Array.isArray(c.storyboard) || c.storyboard.length === 0) {
    problems.push("a storyboard with at least one shot is required");
  } else {
    if (c.storyboard.length > 8) problems.push("at most 8 shots are supported");
    for (const [i, shotRaw] of c.storyboard.entries()) {
      const shot = shotRaw as Partial<StoryboardShot>;
      const where = `shot ${i + 1}`;
      if (!shot?.description?.trim() && !shot?.useAppFootage) problems.push(`${where} needs a description`);
      // A shot that uses real app footage has no Veo prompt and is never billed.
      if (!shot?.useAppFootage) {
        if (!shot?.veoPrompt?.trim()) problems.push(`${where} needs a Veo prompt`);
        const seconds = normaliseDuration(shot?.seconds);
        if (seconds !== shot?.seconds) problems.push(`${where} must be 4, 6 or 8 seconds (got ${shot?.seconds})`);
      }
    }
  }

  // A script is read aloud, so it must contain only the words that are spoken.
  const script = typeof c.script === "string" ? c.script : "";
  for (const { pattern, what } of STAGE_DIRECTION_PATTERNS) {
    const hit = script.match(pattern);
    if (hit) problems.push(`script must be the spoken words only, but contains ${what} ("${hit[0].trim()}")`);
  }

  const narratable = [c.hook, c.script, c.coreMessage, c.callToAction].filter(Boolean).join(" ");
  for (const v of validateScript(narratable).violations) problems.push(`narration: ${v}`);

  const allText = [c.title, c.hook, c.coreMessage, c.script, c.callToAction, ...(c.onScreenText ?? [])]
    .filter(Boolean)
    .join(" ");
  for (const { pattern, reason } of FABRICATION_PATTERNS) {
    if (pattern.test(allText)) problems.push(`fabrication: ${reason}`);
  }

  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export interface ConceptCost {
  /** Veo generations, one per generated shot. */
  veoShots: number;
  veoSeconds: number;
  veoUsd: number;
  voiceoverModel: string;
  voiceoverCharacters: number;
  /** True when narration is billed at all. */
  hasNarration: boolean;
  /** Total for the paid provider steps. Rendering is CPU, not a provider bill. */
  totalUsd: number;
  /** Estimated wall-clock render time, for the progress UI. */
  estimatedRenderSeconds: number;
}

/**
 * Estimate what one concept costs to generate.
 *
 * Only the two metered providers are counted: Veo bills per second of generated
 * video, ElevenLabs per character of narration. FFmpeg rendering costs CPU on
 * whatever host runs the worker, which is not a per-call charge, so it is
 * reported separately as a duration rather than folded into a dollar figure.
 */
export function estimateConceptCost(concept: Partial<AdConcept>, model = ELEVENLABS_MODELS.FLASH): ConceptCost {
  const shots = (concept.storyboard ?? []).filter((s) => !s?.useAppFootage);
  const seconds = shots.reduce((total, s) => total + normaliseDuration(s?.seconds), 0);

  const narration = [concept.script].filter((t): t is string => typeof t === "string" && t.trim().length > 0).join(" ");
  const characters = billedCharacters(narration);

  // Priced per shot, never on the total.
  //
  // estimateVeoCostUsd() snaps its argument to a duration the model accepts,
  // because one API call can only be 4, 6 or 8 seconds. A concept's total is
  // routinely longer than 8 seconds, so feeding it the total silently collapsed
  // a 14-second storyboard to an 8-second price — under-reporting cost by $0.18
  // and, worse, under-reporting it against the spending limit. A total of zero
  // was snapped up to 4 seconds and quoted $0.12 for a concept that generates
  // nothing at all.
  const veoUsd =
    shots.length === 0
      ? 0
      : shots.reduce((total, s) => total + estimateVeoCostUsd(GEMINI_MODELS.VEO_LITE, s?.seconds), 0);
  // ElevenLabs is billed in characters and this key cannot read the plan, so no
  // per-character dollar rate is asserted here. It is reported as a count.
  const totalUsd = Math.round(veoUsd * 100) / 100;

  return {
    veoShots: shots.length,
    veoSeconds: seconds,
    veoUsd: Math.round(veoUsd * 10000) / 10000,
    voiceoverModel: model,
    voiceoverCharacters: characters,
    hasNarration: characters > 0,
    totalUsd,
    estimatedRenderSeconds: Math.max(1, Math.round(seconds / 8) + 3),
  };
}

export interface BudgetDecision {
  allowed: boolean;
  reason: string;
  /** What the limit is, what has been spent, and what this would add. */
  limitUsd: number;
  spentUsd: number;
  requestedUsd: number;
  remainingUsd: number;
}

/**
 * Decide whether a paid step may proceed.
 *
 * Refuses rather than warns. The brief says approval is required before
 * exceeding the configured limit, and a warning that is easy to click past is
 * not approval.
 */
export function checkBudget(limitUsd: number, spentUsd: number, requestedUsd: number): BudgetDecision {
  const limit = Number.isFinite(Number(limitUsd)) ? Math.max(0, Number(limitUsd)) : 0;
  const spent = Number.isFinite(Number(spentUsd)) ? Math.max(0, Number(spentUsd)) : 0;
  const requested = Number.isFinite(Number(requestedUsd)) ? Math.max(0, Number(requestedUsd)) : 0;
  const remaining = Math.max(0, limit - spent);
  const projected = Math.round((spent + requested) * 10000) / 10000;

  // Float noise must not refuse a request that lands exactly on the limit.
  if (projected > limit + 1e-9) {
    return {
      allowed: false,
      reason: `This would bring spend to $${projected.toFixed(2)}, over the $${limit.toFixed(2)} limit. Raise the limit to continue.`,
      limitUsd: limit,
      spentUsd: spent,
      requestedUsd: requested,
      remainingUsd: remaining,
    };
  }
  return {
    allowed: true,
    reason: `Within budget: $${projected.toFixed(2)} of $${limit.toFixed(2)} after this step.`,
    limitUsd: limit,
    spentUsd: spent,
    requestedUsd: requested,
    remainingUsd: remaining,
  };
}

/** The instructions given to OpenAI when writing concepts. */
export const CONCEPT_SYSTEM_PROMPT = `You write advertising concepts for Vaylo Sports.

Vaylo Sports is an all-sports training and performance-improvement app for athletes aged roughly 18-30. Slogan: "Learn smarter. Train better. Perform better." The brand is premium sports technology: dark navy and black, restrained purple accents, modern, competitive, credible. Never sound like a generic AI startup, a supplement brand or a gambling product.

Rules you must follow exactly:
- Produce ${CONCEPT_COUNT} concepts that are genuinely different in angle, not the same idea reworded.
- Do not invent app features. Describe only what the brief states the product does.
- Do not invent statistics, percentages, user counts, reviews, ratings, awards or endorsements.
- Do not promise athletic results, injury prevention or prediction, and never claim clinical proof.
- Never state a price, a trial or a monthly cost: there is no checkout.
- Never claim AI capabilities; they are not switched on.
- Never name wearables, health sync or the coach marketplace; all are off at launch.
- Set useAppFootage to true for any shot that should show the real app instead of generated video. Those shots need no Veo prompt and cost nothing.
- A generated shot must be 4, 6 or 8 seconds.
- The script is read aloud by a narration engine. It must contain ONLY the words to be spoken: no speaker labels (never "VO:" or "Narrator:"), no scene or camera notes, no "End card:", no quotation marks wrapping the whole line, and no duration or timing notes. Put timing in the storyboard's shot lengths instead.
- Keep on-screen text short enough to read in about two seconds, and give at most two lines on top of the call to action: they fill the title and subhead positions, and anything beyond those is not shown in the advert.

Every concept must have a hook that earns the first three seconds, one clear message, and a direct call to action.`;
