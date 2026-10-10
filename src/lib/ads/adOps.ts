// ============================================================================
// VAYLO AD STUDIO — the edit executor
// ----------------------------------------------------------------------------
// An instruction from the athlete becomes a list of Ops. An Op is a surgical,
// named change to exactly one thing. `applyOps` is the only thing that mutates
// a document, and it never mutates the input: it clones, applies, and returns
// a new document.
//
// Two rules are enforced structurally rather than promised in prose:
//
//  1. NON-DESTRUCTIVE. The input document is never modified. Every revision in
//     history is the output of one of these calls, so no earlier state can be
//     lost by editing.
//
//  2. SURGICAL. Each Op writes to its own field and reads nothing else. That is
//     what makes "make the headline bigger" provably unable to change the
//     background — there is no code path from one to the other.
//
// An Op that cannot apply (wrong document kind, out of range, nothing to
// remove) is *skipped and reported*, never silently treated as success. A
// skipped Op is how the UI can say "I did not change the pacing because this
// ad has no clips yet" instead of claiming a change that did not happen.
// ============================================================================

import {
  type AdDocument,
  type Aspect,
  type Caption,
  type ImageAdDocument,
  type LogoLayer,
  type TextLayer,
  type TextRole,
  type Transition,
  type VideoAdDocument,
  isImageAd,
  isVideoAd,
  nextId,
  videoDuration,
} from "./adDocument";

export type AdOp =
  | { op: "setText"; role: TextRole; text: string }
  | { op: "setTextSize"; role: TextRole; fontSize: number }
  | { op: "nudgeTextSize"; role: TextRole; delta: number }
  | { op: "setBackground"; tone?: number; gradient?: number; vignette?: number }
  | { op: "nudgeBackground"; toneDelta?: number; gradientDelta?: number; vignetteDelta?: number }
  | { op: "setLogoScale"; scale: number }
  | { op: "nudgeLogoScale"; delta: number }
  | { op: "setPalette"; accent?: string; background?: string; backgroundDeep?: string; text?: string }
  | { op: "setAspect"; aspect: Aspect }
  | { op: "moveText"; role: TextRole; y?: number; x?: number; to?: "top" | "center" | "bottom" }
  | { op: "setPace"; pace: number }
  | { op: "nudgePace"; delta: number }
  | { op: "trimEnd"; seconds: number }
  | { op: "trimStart"; seconds: number }
  | { op: "removeClip"; index: number }
  | { op: "reorderClip"; from: number; to: number }
  | { op: "replaceClipSource"; index: number; src: string; label?: string; screenRecording?: boolean }
  | { op: "setClipTransition"; index: number; transition: Transition }
  | { op: "addCaptionsFromClips" }
  | { op: "removeCaptions" }
  | { op: "setCaptionSize"; size: number }
  | { op: "nudgeCaptionSize"; delta: number };

/**
 * Every op name the executor understands, as data.
 *
 * The provider-backed interpreter describes ops to the model in a JSON schema
 * that lives on the server, which cannot import this file. That schema therefore
 * mirrors this list by hand — and `adToolSchema.test.ts` asserts the two match,
 * so adding an op here without adding it there fails the suite instead of
 * silently producing tool calls the executor rejects.
 */
export const AD_OP_NAMES: AdOp["op"][] = [
  "setText",
  "setTextSize",
  "nudgeTextSize",
  "setBackground",
  "nudgeBackground",
  "setLogoScale",
  "nudgeLogoScale",
  "setPalette",
  "setAspect",
  "moveText",
  "setPace",
  "nudgePace",
  "trimEnd",
  "trimStart",
  "removeClip",
  "reorderClip",
  "replaceClipSource",
  "setClipTransition",
  "addCaptionsFromClips",
  "removeCaptions",
  "setCaptionSize",
  "nudgeCaptionSize",
];

export interface SkippedOp {
  op: AdOp;
  reason: string;
}

export interface ApplyResult {
  /** The new document. On a total failure this is the input, unchanged. */
  doc: AdDocument;
  applied: AdOp[];
  skipped: SkippedOp[];
  /** Human-readable summary of what actually changed, for the chat transcript. */
  summary: string[];
}

const clone = <T>(value: T): T =>
  typeof structuredClone === "function" ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round = (value: number, dp = 3): number => Number(value.toFixed(dp));

/** Vertical anchors as fractions of height, for "move the CTA to the bottom". */
const ANCHOR_Y: Record<"top" | "center" | "bottom", number> = {
  top: 0.12,
  center: 0.46,
  bottom: 0.84,
};

/**
 * Clips are the unit of video time. Removing `seconds` from the end walks the
 * clips backwards from the last one, shortening each until the requested
 * duration is gone. Clips reduced to zero length are dropped — a zero-length
 * clip renders as a black flash, which is a bug, not an edit.
 */
function trimEnd(doc: VideoAdDocument, seconds: number): { doc: VideoAdDocument; removed: number } {
  let remaining = Math.max(0, seconds);
  const clips = [...doc.clips];
  for (let i = clips.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const clip = clips[i];
    const length = Math.max(0, clip.out - clip.in);
    if (length <= remaining) {
      remaining = round(remaining - length);
      clips.splice(i, 1);
    } else {
      clips[i] = { ...clip, out: round(clip.out - remaining) };
      remaining = 0;
    }
  }
  return { doc: { ...doc, clips }, removed: round(seconds - remaining) };
}

function trimStart(doc: VideoAdDocument, seconds: number): { doc: VideoAdDocument; removed: number } {
  let remaining = Math.max(0, seconds);
  const clips = [...doc.clips];
  for (let i = 0; i < clips.length && remaining > 0; i += 1) {
    const clip = clips[i];
    const length = Math.max(0, clip.out - clip.in);
    if (length <= remaining) {
      remaining = round(remaining - length);
      clips.splice(i, 1);
      i -= 1;
    } else {
      clips[i] = { ...clip, in: round(clip.in + remaining) };
      remaining = 0;
    }
  }
  return { doc: { ...doc, clips }, removed: round(seconds - remaining) };
}

/**
 * Captions derived from the clips themselves, laid end to end on the timeline.
 * Deterministic: the same clips always produce the same caption track, so an
 * athlete can regenerate captions after a trim and get a correct result rather
 * than duplicated text.
 *
 * Captions are derived on the *paced* timeline, because that is the timeline
 * the viewer sees.
 */
function captionsFromClips(doc: VideoAdDocument): Caption[] {
  const pace = doc.pace || 1;
  let cursor = 0;
  return doc.clips.map((clip) => {
    const duration = Math.max(0, clip.out - clip.in) / pace;
    const caption: Caption = {
      id: nextId("cap"),
      text: clip.label,
      start: round(cursor),
      end: round(cursor + duration),
    };
    cursor += duration;
    return caption;
  });
}

/** Which document kinds each Op is meaningful for. */
// `moveText` and the text-size ops are deliberately NOT image-only: a video ad
// still has a CTA layer, and "move the call to action to the end" has to work on
// it. The switch below rejects the roles a video ad does not have.
const IMAGE_ONLY: AdOp["op"][] = ["setBackground", "nudgeBackground", "setLogoScale", "nudgeLogoScale", "setPalette"];
const VIDEO_ONLY: AdOp["op"][] = [
  "trimEnd",
  "trimStart",
  "removeClip",
  "reorderClip",
  "replaceClipSource",
  "setClipTransition",
  "addCaptionsFromClips",
  "removeCaptions",
  "setCaptionSize",
  "nudgeCaptionSize",
  "setPace",
  "nudgePace",
];

/**
 * Apply a list of Ops, in order, to a document.
 *
 * Order matters and is preserved: "make the headline bigger" then "shrink the
 * headline" must end smaller, and a reorder followed by a trim must trim the
 * reordered timeline.
 */
export function applyOps(doc: AdDocument, ops: AdOp[]): ApplyResult {
  let next: AdDocument = clone(doc);
  const applied: AdOp[] = [];
  const skipped: SkippedOp[] = [];
  const summary: string[] = [];

  for (const op of ops) {
    if (IMAGE_ONLY.includes(op.op) && !isImageAd(next)) {
      skipped.push({ op, reason: `${op.op} only applies to image ads` });
      continue;
    }
    if (VIDEO_ONLY.includes(op.op) && !isVideoAd(next)) {
      skipped.push({ op, reason: `${op.op} only applies to video ads` });
      continue;
    }

    switch (op.op) {
      case "setText": {
        const text = op.text.trim();
        if (!text) {
          skipped.push({ op, reason: "refused to set empty text" });
          break;
        }
        if (isImageAd(next)) {
          const index = next.layers.findIndex((l) => l.kind === "text" && l.role === op.role);
          if (index < 0) {
            skipped.push({ op, reason: `no ${op.role} layer on this ad` });
            break;
          }
          const layer = next.layers[index] as TextLayer;
          next.layers[index] = { ...layer, text };
        } else {
          if (op.role !== "cta") {
            skipped.push({ op, reason: `video ads have no ${op.role} layer` });
            break;
          }
          next = { ...next, cta: { ...next.cta, text } };
        }
        applied.push(op);
        summary.push(`Changed the ${op.role} to "${text}".`);
        break;
      }

      case "setTextSize":
      case "nudgeTextSize": {
        const delta = op.op === "nudgeTextSize" ? op.delta : 0;

        // Each branch uses the type guard directly. Storing the guard in a
        // boolean (`const image = isImageAd(next)`) does NOT narrow `next`, and
        // the `else` then reads `.cta` off a union that has no such property.
        if (isVideoAd(next)) {
          if (op.role !== "cta") {
            skipped.push({ op, reason: `video ads have no ${op.role} layer` });
            break;
          }
          const current = next.cta.fontSize;
          const target = clamp(op.op === "setTextSize" ? op.fontSize : current + delta, 0.015, 0.2);
          if (target === current) {
            skipped.push({ op, reason: "text is already that size" });
            break;
          }
          next = { ...next, cta: { ...next.cta, fontSize: target } };
          applied.push(op);
          summary.push(`${target > current ? "Increased" : "Reduced"} the ${op.role} size.`);
          break;
        }

        // Reaching here means the guard rejected every other member of the union.
        const index = next.layers.findIndex((l) => l.kind === "text" && l.role === op.role);
        if (index < 0) {
          skipped.push({ op, reason: `no ${op.role} layer on this ad` });
          break;
        }
        const current = (next.layers[index] as TextLayer).fontSize;
        const target = clamp(op.op === "setTextSize" ? op.fontSize : current + delta, 0.015, 0.2);
        if (target === current) {
          skipped.push({ op, reason: "text is already that size" });
          break;
        }
        next.layers[index] = { ...(next.layers[index] as TextLayer), fontSize: target };
        applied.push(op);
        summary.push(`${target > current ? "Increased" : "Reduced"} the ${op.role} size.`);
        break;
      }

      case "setBackground":
      case "nudgeBackground": {
        const image = next as ImageAdDocument;
        const bg = { ...image.background };
        if (op.op === "setBackground") {
          if (op.tone !== undefined) bg.tone = clamp(op.tone, -1, 1);
          if (op.gradient !== undefined) bg.gradient = clamp(op.gradient, 0, 1);
          if (op.vignette !== undefined) bg.vignette = clamp(op.vignette, 0, 1);
        } else {
          bg.tone = clamp(bg.tone + (op.toneDelta ?? 0), -1, 1);
          bg.gradient = clamp(bg.gradient + (op.gradientDelta ?? 0), 0, 1);
          bg.vignette = clamp(bg.vignette + (op.vignetteDelta ?? 0), 0, 1);
        }
        next = { ...image, background: bg };
        applied.push(op);
        summary.push(
          bg.tone > 0 ? "Darkened the background and pushed it toward a more premium finish." : "Lightened the background.",
        );
        break;
      }

      case "setLogoScale":
      case "nudgeLogoScale": {
        const image = next as ImageAdDocument;
        const index = image.layers.findIndex((l) => l.kind === "logo");
        if (index < 0) {
          skipped.push({ op, reason: "this ad has no logo layer" });
          break;
        }
        const layer = image.layers[index] as LogoLayer;
        const target = clamp(op.op === "setLogoScale" ? op.scale : layer.scale + op.delta, 0.04, 0.6);
        if (target === layer.scale) {
          skipped.push({ op, reason: "the logo is already that size" });
          break;
        }
        image.layers[index] = { ...layer, scale: round(target, 4) };
        applied.push(op);
        summary.push(`${target > layer.scale ? "Made the logo bigger" : "Made the logo smaller"} (${Math.round(layer.scale * 100)}% → ${Math.round(target * 100)}% of width).`);
        break;
      }

      case "setPalette": {
        const image = next as ImageAdDocument;
        const palette = { ...image.palette };
        if (op.accent) palette.accent = op.accent;
        if (op.background) palette.background = op.background;
        if (op.backgroundDeep) palette.backgroundDeep = op.backgroundDeep;
        if (op.text) palette.text = op.text;
        next = { ...image, palette };
        applied.push(op);
        summary.push("Re-balanced the palette.");
        break;
      }

      case "setAspect": {
        if (next.aspect === op.aspect) {
          skipped.push({ op, reason: `already ${op.aspect}` });
          break;
        }
        const from = next.aspect;
        next = { ...next, aspect: op.aspect };
        applied.push(op);
        summary.push(`Reformatted ${from} → ${op.aspect}.`);
        break;
      }

      case "moveText": {
        if (isVideoAd(next)) {
          if (op.role !== "cta") {
            skipped.push({ op, reason: `video ads have no movable ${op.role} layer` });
            break;
          }
          const cta = next.cta;
          const y = op.to ? ANCHOR_Y[op.to] : (op.y ?? cta.y);
          next = { ...next, cta: { ...cta, y: clamp(y, 0.02, 0.94), x: clamp(op.x ?? cta.x, 0.02, 0.9) } };
          applied.push(op);
          summary.push(`Moved the call to action ${op.to ? `to the ${op.to}` : "position"}.`);
          break;
        }
        const image = next as ImageAdDocument;
        const index = image.layers.findIndex((l) => l.kind === "text" && l.role === op.role);
        if (index < 0) {
          skipped.push({ op, reason: `no ${op.role} layer on this ad` });
          break;
        }
        const layer = image.layers[index] as TextLayer;
        const y = op.to ? ANCHOR_Y[op.to] : (op.y ?? layer.y);
        image.layers[index] = { ...layer, y: clamp(y, 0.02, 0.94), x: clamp(op.x ?? layer.x, 0.02, 0.9) };
        applied.push(op);
        summary.push(`Moved the ${op.role} ${op.to ? `to the ${op.to}` : "position"}.`);
        break;
      }

      case "setPace":
      case "nudgePace": {
        const video = next as VideoAdDocument;
        if (video.clips.length === 0) {
          skipped.push({ op, reason: "there are no clips to re-time" });
          break;
        }
        const target = clamp(op.op === "setPace" ? op.pace : video.pace + op.delta, 0.5, 2.5);
        if (target === video.pace) {
          skipped.push({ op, reason: "already at that pace" });
          break;
        }
        next = { ...video, pace: round(target, 3) };
        applied.push(op);
        summary.push(`Retimed the cut to ${target.toFixed(2)}× — ${target > video.pace ? "faster" : "slower"}.`);
        break;
      }

      case "trimEnd": {
        const video = next as VideoAdDocument;
        if (video.clips.length === 0) {
          skipped.push({ op, reason: "no clips to trim" });
          break;
        }
        const result = trimEnd(video, op.seconds);
        if (result.removed === 0) {
          skipped.push({ op, reason: "nothing left to trim" });
          break;
        }
        next = result.doc;
        applied.push(op);
        summary.push(`Trimmed ${result.removed}s off the end.`);
        break;
      }

      case "trimStart": {
        const video = next as VideoAdDocument;
        if (video.clips.length === 0) {
          skipped.push({ op, reason: "no clips to trim" });
          break;
        }
        const result = trimStart(video, op.seconds);
        if (result.removed === 0) {
          skipped.push({ op, reason: "nothing left to trim" });
          break;
        }
        next = result.doc;
        applied.push(op);
        summary.push(`Trimmed ${result.removed}s off the start.`);
        break;
      }

      case "removeClip": {
        const video = next as VideoAdDocument;
        if (op.index < 0 || op.index >= video.clips.length) {
          skipped.push({ op, reason: `there is no clip ${op.index + 1}` });
          break;
        }
        const clips = video.clips.filter((_, i) => i !== op.index);
        next = { ...video, clips };
        applied.push(op);
        summary.push(`Removed clip ${op.index + 1}.`);
        break;
      }

      case "reorderClip": {
        const video = next as VideoAdDocument;
        if (op.from < 0 || op.from >= video.clips.length || op.to < 0 || op.to >= video.clips.length) {
          skipped.push({ op, reason: "that clip position does not exist" });
          break;
        }
        const clips = [...video.clips];
        const [moved] = clips.splice(op.from, 1);
        clips.splice(op.to, 0, moved);
        next = { ...video, clips };
        applied.push(op);
        summary.push(`Moved clip ${op.from + 1} to position ${op.to + 1}.`);
        break;
      }

      case "replaceClipSource": {
        const video = next as VideoAdDocument;
        if (op.index < 0 || op.index >= video.clips.length) {
          skipped.push({ op, reason: `there is no clip ${op.index + 1}` });
          break;
        }
        const existing = video.clips[op.index];
        const clips = [...video.clips];
        clips[op.index] = {
          ...existing,
          src: op.src,
          label: op.label ?? existing.label,
          screenRecording: op.screenRecording ?? existing.screenRecording,
          // A replacement source has its own timeline; keeping the old in/out
          // would silently crop the new footage to a length chosen for the old.
          in: 0,
          out: existing.out - existing.in,
        };
        next = { ...video, clips };
        applied.push(op);
        summary.push(`Replaced clip ${op.index + 1} with the uploaded footage, keeping the rest of the cut.`);
        break;
      }

      case "setClipTransition": {
        const video = next as VideoAdDocument;
        if (op.index < 0 || op.index >= video.clips.length) {
          skipped.push({ op, reason: `there is no clip ${op.index + 1}` });
          break;
        }
        const clips = [...video.clips];
        clips[op.index] = { ...clips[op.index], transitionIn: op.transition };
        next = { ...video, clips };
        applied.push(op);
        summary.push(`Changed the arrival of clip ${op.index + 1} to a ${op.transition.type}.`);
        break;
      }

      case "addCaptionsFromClips": {
        const video = next as VideoAdDocument;
        if (video.clips.length === 0) {
          skipped.push({ op, reason: "there are no clips to caption" });
          break;
        }
        const captions = captionsFromClips(video);
        next = { ...video, captions };
        applied.push(op);
        summary.push(`Added ${captions.length} caption${captions.length === 1 ? "" : "s"} timed to the cut.`);
        break;
      }

      case "removeCaptions": {
        const video = next as VideoAdDocument;
        if (video.captions.length === 0) {
          skipped.push({ op, reason: "there are no captions to remove" });
          break;
        }
        next = { ...video, captions: [] };
        applied.push(op);
        summary.push("Removed the caption track.");
        break;
      }

      case "setCaptionSize":
      case "nudgeCaptionSize": {
        const video = next as VideoAdDocument;
        const target = clamp(op.op === "setCaptionSize" ? op.size : video.captionSize + op.delta, 0.018, 0.09);
        if (target === video.captionSize) {
          skipped.push({ op, reason: "captions are already that size" });
          break;
        }
        next = { ...video, captionSize: round(target, 4) };
        applied.push(op);
        summary.push(`${target > video.captionSize ? "Enlarged" : "Reduced"} the captions for legibility.`);
        break;
      }

      default: {
        const exhaustive: never = op;
        skipped.push({ op: exhaustive, reason: "unsupported op" });
      }
    }
  }

  return { doc: next, applied, skipped, summary };
}

/** Convenience for the UI: apply once and read the new duration. */
export const applyOpsToVideo = (doc: VideoAdDocument, ops: AdOp[]): ApplyResult => applyOps(doc, ops);

export { videoDuration };
