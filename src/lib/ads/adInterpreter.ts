// ============================================================================
// VAYLO AD STUDIO — instruction → edit plan
// ----------------------------------------------------------------------------
// This turns "make the background darker and more premium" into
//   [{ op: "nudgeBackground", toneDelta: 0.18, vignetteDelta: 0.08 }]
//
// It is deliberately DETERMINISTIC. A provider-backed interpreter is an
// upgrade layered on top of this, not a replacement for it, for three reasons
// the brief asks for directly:
//
//   * MOCK/DEMO MODE. The editor must work with no API key at all. If the only
//     interpreter were an LLM call, every workflow would be dead without a key.
//   * DETERMINISTIC EDITS ARE FREE. "Trim five seconds" costs an LLM call under
//     an LLM interpreter, for a change that is pure arithmetic. Costing money
//     to subtract two numbers is a bug in the architecture.
//   * IT IS TESTABLE. Every rule here has a test with no network and no flake.
//
// The rule: a request this file recognises is executed locally and cannot fail
// from a provider outage. Anything it does not recognise is handed to the
// provider interpreter, and if that is unavailable the athlete is told plainly
// rather than shown a change that did not happen.
// ============================================================================

import {
  type AdDocument,
  type TextRole,
  PLATFORM_ASPECT,
  isVideoAd,
  findText,
} from "./adDocument";
import type { AdOp } from "./adOps";

/** An asset the athlete has uploaded and can refer to by name. */
export interface AdAsset {
  id: string;
  label: string;
  kind: "image" | "video";
  screenRecording?: boolean;
}

export interface InterpretContext {
  doc: AdDocument;
  /** Uploaded assets, newest last. "the screen recording I uploaded" resolves here. */
  assets?: AdAsset[];
}

export type Interpretation =
  | { kind: "ops"; ops: AdOp[]; reply: string }
  | { kind: "control"; control: "undo" | "redo" | "duplicate" | "export"; reply: string }
  | { kind: "clarify"; question: string; options?: string[]; reply: string }
  | { kind: "needsProvider"; reply: string };

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
};

/** "five", "5", "5.5" → 5 | 5 | 5.5. Returns null when there is no number. */
export function parseSeconds(text: string): number | null {
  const numeric = text.match(/(\d+(?:\.\d+)?)\s*(?:s\b|sec|secs|second|seconds)?/i);
  if (numeric) return Number(numeric[1]);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) return value;
  }
  return null;
}

/** Pull a quoted or "to X" payload out of "change the headline to 'X'". */
export function parseReplacementText(instruction: string): string | null {
  const quoted = instruction.match(/["'“”‘’]([^"'“”‘’]{1,200})["'“”‘’]/);
  if (quoted) return quoted[1].trim();

  const toClause = instruction.match(
    /\b(?:to|into|reads?|says?|say)\b\s*[:\-]?\s*(.{1,200})$/i,
  );
  if (toClause) {
    const value = toClause[1].trim().replace(/[.!,;]+$/, "").trim();
    if (value) return value;
  }
  return null;
}

const has = (text: string, ...words: string[]): boolean =>
  words.some((w) => new RegExp(`\\b${w}\\b`, "i").test(text));

const PURPLE = "#8505D5";
const PURPLE_DEEP = "#0b0518";

/**
 * Turn one instruction into a plan.
 *
 * Order matters: the most specific rules are tested first, so "make the logo
 * bigger" is never captured by the generic "make the headline bigger" rule, and
 * "undo the last change" is a control rather than an edit.
 */
export function interpret(instruction: string, ctx: InterpretContext): Interpretation {
  const raw = instruction.trim();
  if (!raw) return { kind: "needsProvider", reply: "I did not catch an instruction there." };
  const text = raw.toLowerCase();
  const { doc } = ctx;
  const video = isVideoAd(doc);

  // ---- Controls ----------------------------------------------------------
  if (has(text, "undo") && has(text, "change", "last", "undo")) {
    return { kind: "control", control: "undo", reply: "Stepping back to the previous version." };
  }
  if (/^\s*redo\b/i.test(text) || has(text, "redo")) {
    return { kind: "control", control: "redo", reply: "Re-applying the change." };
  }
  if (has(text, "export", "download", "render")) {
    return { kind: "control", control: "export", reply: "Opening the export options." };
  }
  if (has(text, "duplicate", "copy this", "another version", "alternative version")) {
    return { kind: "control", control: "duplicate", reply: "Duplicated this version so you can experiment without losing it." };
  }

  const ops: AdOp[] = [];
  const notes: string[] = [];

  // ---- Background --------------------------------------------------------
  if (has(text, "background")) {
    if (has(text, "darker", "dark", "premium", "moodier", "deeper")) {
      ops.push({ op: "nudgeBackground", toneDelta: 0.18, vignetteDelta: 0.08 });
      notes.push("Darkened the background and tightened the vignette for a more premium finish.");
    } else if (has(text, "lighter", "brighter", "brighter")) {
      ops.push({ op: "nudgeBackground", toneDelta: -0.18, vignetteDelta: -0.08 });
      notes.push("Lifted the background.");
    }
  }

  // ---- Palette -----------------------------------------------------------
  if (has(text, "purple") || (has(text, "blue") && has(text, "less", "reduce", "remove"))) {
    const purple = has(text, "more purple", "purple", "violet");
    if (purple || has(text, "less blue", "reduce the blue", "remove the blue")) {
      ops.push({ op: "setPalette", accent: PURPLE, backgroundDeep: PURPLE_DEEP });
      notes.push("Pushed the palette toward the brand purple and pulled the blue back.");
    }
  }

  // ---- Text --------------------------------------------------------------
  // Only act on the title when the instruction actually names one, so "make the
  // video feel faster" is never read as a copy change.
  const namesHeadline = has(text, "headline", "title", "head line", "heading");
  const namesSubhead = has(text, "subhead", "sub-headline", "subheadline", "body copy", "supporting line");
  const namesCta = has(text, "cta", "call to action", "button");

  if (namesHeadline || namesSubhead || namesCta) {
    const role: TextRole = namesHeadline ? "headline" : namesSubhead ? "subhead" : "cta";
    const replacement = parseReplacementText(raw);

    // Size is tested first so "make the headline bigger" can never be mistaken
    // for a copy change — it is the one instruction that mentions a text role
    // and means geometry, not words.
    const wantsResize = has(text, "bigger", "larger", "big", "smaller", "shrink", "reduce the size", "text size", "font size");
    const wantsLegibility = has(text, "easier to read", "readable", "more legible", "contrast");

    // Deliberately NOT including "to". "Move the call to action to the end"
    // would otherwise read as a copy change with the payload "the end",
    // and every CTA would silently become the words "the end".
    const wantsCopyChange = has(text, "change", "replace", "rewrite", "set", "update", "reads", "says", "say");

    if (wantsResize) {
      ops.push({ op: "nudgeTextSize", role, delta: has(text, "smaller", "shrink", "reduce") ? -0.012 : 0.012 });
      notes.push(`${has(text, "smaller", "shrink", "reduce") ? "Reduced" : "Enlarged"} the ${role}.`);
    } else if (wantsCopyChange) {
      if (!replacement) {
        // The brief's rule: ask only when a missing detail would materially
        // change the result. A headline with no new value is exactly that.
        return {
          kind: "clarify",
          question: `What should the ${role} say?`,
          options: role === "cta" ? ["Join the waitlist", "Discover Vaylo", "Follow Vaylo Sports"] : undefined,
          reply: `I can change the ${role} — I just need the new wording.`,
        };
      }
      ops.push({ op: "setText", role, text: replacement });
      notes.push(`Set the ${role} to “${replacement}”.`);
    } else if (wantsLegibility) {
      ops.push({ op: "setPalette", text: "#ffffff" });
      notes.push(`Raised the ${role} contrast for legibility.`);
    }
  }

  // ---- CTA position ------------------------------------------------------
  if ((namesCta || has(text, "cta", "call to action")) && has(text, "end", "bottom", "last", "final")) {
    ops.push({ op: "moveText", role: "cta", to: "bottom" });
    notes.push("Moved the call to action to the end card, bottom of frame.");
  }

  // ---- Logo --------------------------------------------------------------
  if (has(text, "logo") || has(text, "brand mark", "wordmark")) {
    if (has(text, "bigger", "larger", "big", "more prominent")) {
      ops.push({ op: "nudgeLogoScale", delta: has(text, "much", "a lot", "significantly") ? 0.10 : 0.05 });
      notes.push("Made the logo bigger.");
    } else if (has(text, "smaller", "reduce", "shrink", "smaller")) {
      ops.push({ op: "nudgeLogoScale", delta: -0.03 });
      notes.push("Made the logo smaller.");
    }
  }

  // ---- Format / placement ------------------------------------------------
  const platformHits = (Object.keys(PLATFORM_ASPECT) as Array<keyof typeof PLATFORM_ASPECT>).filter((p) =>
    new RegExp(`\\b${p}\\b`, "i").test(text),
  );
  const explicitAspect = raw.match(/\b(9\s*[:x/]\s*16|4\s*[:x/]\s*5|1\s*[:x/]\s*1|16\s*[:x/]\s*9)\b/i);
  if (platformHits.length > 0 || explicitAspect || has(text, "aspect ratio", "vertical", "square")) {
    const aspect = (() => {
      if (explicitAspect) {
        const normalised = explicitAspect[1].replace(/\s+/g, "").replace(/[x/]/gi, ":");
        return normalised as "9:16" | "4:5" | "1:1" | "16:9";
      }
      if (has(text, "square")) return "1:1" as const;
      if (has(text, "vertical") || platformHits.includes("tiktok") || platformHits.includes("reels")) return "9:16" as const;
      if (platformHits.length > 0) return PLATFORM_ASPECT[platformHits[0]];
      return doc.aspect;
    })();
    ops.push({ op: "setAspect", aspect });
    const named = platformHits.length ? platformHits.join(" and ") : aspect;
    notes.push(`Reformatted for ${named} (${aspect}).`);
  }

  // ---- Video: trimming ---------------------------------------------------
  if (video) {
    const seconds = parseSeconds(text);
    if (has(text, "remove", "trim", "cut", "delete", "lose", "take off") && seconds != null && has(text, "end", "last", "final", "tail")) {
      ops.push({ op: "trimEnd", seconds });
      notes.push(`Trimmed the last ${seconds}s.`);
    } else if (has(text, "remove", "trim", "cut", "delete") && seconds != null && has(text, "start", "first", "opening", "beginning")) {
      ops.push({ op: "trimStart", seconds });
      notes.push(`Trimmed the first ${seconds}s.`);
    }

    // Opening punch: the one edit that answers "make this more attention-grabbing".
    if (has(text, "attention", "grab", "hook", "opening", "first", "stop the scroll") &&
        has(text, "more", "better", "stronger", "punchier", "grabbing")) {
      ops.push({ op: "setClipTransition", index: 0, transition: { type: "punchIn", duration: 0.18 } });
      notes.push("Gave the opening a fast punch-in so the first frames land harder.");
    }

    // Pace.
    if (has(text, "faster", "pace", "quicker", "snappier", "more competitive", "energy")) {
      ops.push({ op: "nudgePace", delta: 0.15 });
      notes.push("Tightened the pacing so the cut reads as faster.");
    } else if (has(text, "slower", "calmer", "breathe")) {
      ops.push({ op: "nudgePace", delta: -0.15 });
      notes.push("Relaxed the pacing.");
    }

    // Captions.
    if (has(text, "caption", "captions", "subtitle", "subtitles")) {
      if (has(text, "remove", "turn off", "hide", "delete")) {
        ops.push({ op: "removeCaptions" });
        notes.push("Removed the caption track.");
      } else {
        if (has(text, "add", "put", "include", "burn")) ops.push({ op: "addCaptionsFromClips" });
        if (has(text, "easier to read", "bigger", "larger", "more readable", "legible")) {
          ops.push({ op: "nudgeCaptionSize", delta: 0.005 });
          notes.push("Enlarged the captions so they stay readable on a phone.");
        } else if (ops.length === 0) {
          ops.push({ op: "addCaptionsFromClips" });
        }
        if (!notes.some((n) => n.includes("caption"))) notes.push("Added captions timed to the cut.");
      }
    }

    // Clip surgery.
    const clipNumber = raw.match(/clip\s*(\d+)/i);
    if (has(text, "replace") && has(text, "footage", "clip", "video", "recording", "shot")) {
      const candidates = (ctx.assets ?? []).filter((a) => a.kind === "video");
      const preferred = candidates.find((a) => a.screenRecording) ?? candidates[candidates.length - 1];
      if (!preferred) {
        return {
          kind: "clarify",
          question: "Which footage should replace it? I do not have an uploaded video yet.",
          options: ["Upload a screen recording", "Keep the current footage"],
          reply: "I need the replacement footage before I can swap it in.",
        };
      }
      const index = clipNumber ? Math.max(0, Number(clipNumber[1]) - 1) : Math.max(0, (isVideoAd(doc) ? doc.clips.length : 1) - 1);
      ops.push({
        op: "replaceClipSource",
        index,
        src: preferred.id,
        label: preferred.label,
        screenRecording: preferred.screenRecording ?? false,
      });
      notes.push(`Swapped clip ${index + 1} for “${preferred.label}” and left the rest of the cut alone.`);
    }

    if (has(text, "remove") && clipNumber && !ops.some((o) => o.op === "removeClip")) {
      ops.push({ op: "removeClip", index: Math.max(0, Number(clipNumber[1]) - 1) });
      notes.push(`Removed clip ${clipNumber[1]}.`);
    }

    if ((has(text, "move", "reorder") || /move\s+clip/i.test(text)) && clipNumber) {
      const toMatch = raw.match(/\bto\s*(?:position|the)?\s*(\d+)/i);
      if (toMatch) {
        ops.push({ op: "reorderClip", from: Math.max(0, Number(clipNumber[1]) - 1), to: Math.max(0, Number(toMatch[1]) - 1) });
        notes.push(`Moved clip ${clipNumber[1]} to position ${toMatch[1]}.`);
      }
    }
  }

  if (ops.length === 0) {
    return {
      kind: "needsProvider",
      reply:
        "I could not map that to a change I can make locally. A provider interpreter can handle wording like that — but I will not pretend a change happened.",
    };
  }

  return { kind: "ops", ops, reply: notes.join(" ") || "Applied the change." };
}

/**
 * Does this look like copy the brand forbids?
 *
 * Ported from the ad slate's "copy that must not be added" list and the brand
 * knowledge base. The editor refuses these locally, before any provider call,
 * so a forbidden claim cannot be introduced by a paraphrase.
 */
const FORBIDDEN_CLAIMS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bai[-\s]?(powered|coach|driven)\b/i, why: "the AI features hard-fail without a provider key" },
  { pattern: /[£$€]\s?\d|\d+\s?\/\s?month|free trial|per month/i, why: "there is no checkout yet" },
  { pattern: /\b(guarantee|guaranteed)\b.*\b(result|performance|improve)/i, why: "performance cannot be guaranteed" },
  { pattern: /\b(prevent|predict|diagnose s?)\b.*\b(injur)/i, why: "injury prediction and prevention are not substantiated" },
  { pattern: /clinically proven|scientifically proven|diagnostic\b/i, why: "never claim clinical proof" },
  { pattern: /\b\d+%\s+(of\s+)?(athletes|users|people)\b/i, why: "invented statistics" },
];

export interface ClaimVerdict {
  blocked: boolean;
  reason?: string;
}

export function checkForbiddenClaims(text: string): ClaimVerdict {
  for (const rule of FORBIDDEN_CLAIMS) {
    if (rule.pattern.test(text)) return { blocked: true, reason: rule.why };
  }
  return { blocked: false };
}

/**
 * Guard an interpretation: if the copy an edit would introduce breaks the
 * brand's claim rules, the edit is refused before it reaches the document.
 */
export function guardInterpretation(result: Interpretation): Interpretation {
  if (result.kind !== "ops") return result;
  for (const op of result.ops) {
    if (op.op === "setText") {
      const verdict = checkForbiddenClaims(op.text);
      if (verdict.blocked) {
        return {
          kind: "clarify",
          question: `“${op.text}” breaks the brand's advertising rules (${verdict.reason}). What would you like the ${op.role} to say instead?`,
          reply: "I will not add that claim.",
        };
      }
    }
  }
  return result;
}

/** The roles that exist on this document, for the UI's quick-action chips. */
export const availableTextRoles = (doc: AdDocument): TextRole[] =>
  isVideoAd(doc) ? ["cta"] : (["headline", "subhead", "cta"] as TextRole[]).filter((r) => findText(doc, r) !== undefined);
