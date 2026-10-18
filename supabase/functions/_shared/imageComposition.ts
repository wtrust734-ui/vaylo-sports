// ============================================================================
// imageComposition — the deterministic text/layout pass for image ads.
// ----------------------------------------------------------------------------
// RULES THIS STAGE ENFORCES (from the platform prompt and brand rules):
//   • advertising text is rendered here, never left to the image model;
//   • the official logo asset is overlaid exactly as supplied — never
//     redrawn, recoloured, re-GPU-enhanced or re-created;
//   • copy stays inside each placement's safe areas (UI zones for 9:16,
//     margins elsewhere) so platform chrome never crops it;
//   • headline legibility has a floor computed from the output's width;
//   • overflow/clipping is detected as a layout check, not hoped away;
//   • the frame is recomposed per placement, not stretched or cropped.
// Pure module: plans layouts and builds an FFmpeg argument ARRAY (drawing
// text, boxes and overlays); the worker spawns it without a shell.
// ============================================================================

import { type ImagePlacement } from "./imageAds.ts";

export interface CompositionTextInput {
  headline: string;
  supportingCopy?: string;
  cta: string;
  disclaimer?: string;
}

export interface CompositionSpec {
  placement: string;
  width: number;
  height: number;
  /** Overlay geometry, all in composed-output pixels. */
  zones: {
    headline: { x: number; y: number; maxW: number; fontSize: number };
    copy?: { x: number; y: number; maxW: number; fontSize: number };
    cta: { x: number; y: number; maxW: number; fontSize: number; boxH: number };
    disclaimer?: { x: number; y: number; maxW: number; fontSize: number };
    logo: { x: number; y: number; size: number };
  };
  colors: { navy: string; purple: string; white: string };
  /** Layout errors that are hard rejections (overflow/clip). Empty = composable. */
  overflow: string[];
}

const BRAND_WHITE = "#FFFFFF";

/** Font size floors (px at the composed width) so headlines never get lost. */
function headlineFloor(width: number): number {
  return Math.max(48, Math.round(width * 0.052));
}
function floorFor(width: number, share: number, min = 24): number {
  return Math.max(min, Math.round(width * share));
}

/**
 * Plan one composition. Rejects (overflow) rather than clipping: the prompt
 * text area is measured (approx. chars-per-line via 0.58em average advance)
 * and anything that would exceed the safe zone is reported, not scaled into
 * illegibility.
 */
export function planComposition(
  placement: ImagePlacement,
  text: CompositionTextInput,
  hasLogo: boolean,
  colors: { purple: string } = { purple: "#8505D5" },
): CompositionSpec {
  const { width, height, safeAreas } = placement;
  const sidePx = Math.round(width * safeAreas.sides);
  const topPx = Math.round(height * safeAreas.top);
  const bottomPx = Math.round(height * safeAreas.bottom);
  const usableW = width - 2 * sidePx;
  const headlineSize = headlineFloor(width);
  const copySize = floorFor(width, 0.032);
  const ctaSize = floorFor(width, 0.034);
  const ctaBoxH = Math.max(88, Math.round(ctaSize * 2.6));
  const logoSize = Math.max(72, Math.round(width * 0.09));

  const overflow: string[] = [];
  // Approximate wrapped height: headline up to 3 lines, copy up to 2 lines.
  const approxH = (s: string, size: number, maxW: number, maxLines: number) => {
    const perLine = Math.max(8, Math.floor((maxW / size) / 0.58));
    const lines = Math.min(maxLines, Math.ceil(s.length / perLine) || 1);
    return lines * Math.round(size * 1.22);
  };

  // Layout blocks flow bottom-up inside the safe zone for feed formats —
  // CTA anchored, copy above it, headline above that — landing-page gravity.
  const ctaY = height - bottomPx - ctaBoxH;
  const copyH = text.supportingCopy ? approxH(text.supportingCopy, copySize, usableW * 0.92, 2) : 0;
  const headlineH = approxH(text.headline, headlineSize, usableW * 0.92, 3);
  const stackTop = ctaY - copyH - Math.round(headlineSize * 0.4) - headlineH;
  if (stackTop < topPx) overflow.push("headline/copy stack would enter the top safe area — shorten the copy");

  if (text.supportingCopy) {
    const perLine = Math.floor((usableW * 0.92 / copySize) / 0.58);
    if (text.supportingCopy.length > perLine * 2) {
      overflow.push("supporting copy is too long for two lines at the legibility floor");
    }
  }

  // Headline single-word sanity: one word longer than the safe width is a clip.
  if (text.headline.split(/\s+/).some((w) => w.length * headlineSize * 0.58 > usableW)) {
    overflow.push("a headline word cannot fit the safe width at the legibility floor");
  }

  return {
    placement: placement.id,
    width,
    height,
    zones: {
      headline: { x: sidePx, y: stackTop, maxW: usableW * 0.92, fontSize: headlineSize },
      copy: text.supportingCopy ? { x: sidePx, y: ctaY - copyH - Math.round(copySize * 0.5), maxW: usableW * 0.92, fontSize: copySize } : undefined,
      cta: { x: sidePx, y: ctaY, maxW: usableW, fontSize: ctaSize, boxH: ctaBoxH },
      disclaimer: text.disclaimer
        ? { x: sidePx, y: topPx + Math.round(height * 0.01), maxW: usableW * 0.9, fontSize: floorFor(width, 0.018, 16) }
        : undefined,
      logo: hasLogo ? { x: sidePx, y: topPx, size: logoSize } : undefined,
    } as CompositionSpec["zones"],
    colors: { navy: "#07090F", purple: colors.purple, white: BRAND_WHITE },
    overflow,
  };
}

// ---------------------------------------------------------------------------
// FFmpeg argument builder — data only, no shell, no paths we don't own.
// ---------------------------------------------------------------------------

function escPathText(s: string): string {
  // drawtext text= escaping for the argument array: : and ' (and %) are the
  // practical hazards. The apostrophe becomes a typographic one so the single
  // quotes around the text value can never terminate early; inside the quoted
  // value, commas and parentheses are literal to the graph parser.
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");
}

/** Escape a filesystem path for a filtergraph option value (renderPlan's rule
 *  applies here too: a Windows drive colon terminates the option name). */
function escFilterPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export interface ComposeArgsInput {
  spec: CompositionSpec;
  /** Absolute paths inside the worker's WORK_DIR (already sanitised there). */
  backgroundPath: string;
  logoPath?: string;
  fontPath: string;
  outPath: string;
  text: CompositionTextInput;
}

/**
 * Simpler, single-chain final builder — the one the worker actually runs.
 * Logo overlay (when present) is composited by scaling the second input and
 * overlaying; all text draws ride the same chain.
 */
export function buildFinalComposeArgs(input: ComposeArgsInput): string[] {
  const { spec, backgroundPath, logoPath, fontPath, outPath, text } = input;
  const cta = spec.zones.cta;

  const draw = (t: string, z: { x: number; y: number; maxW: number; fontSize: number }, color: string, opts: { box?: boolean; centered?: boolean } = {}) =>
    `drawtext=fontfile='${escFilterPath(fontPath)}':text='${escPathText(t)}':fontsize=${z.fontSize}:fontcolor=${color}:x=${opts.centered ? "(w-text_w)/2" : z.x}:y=${z.y}:line_spacing=${Math.round(z.fontSize * 0.22)}`;

  const chain: string[] = [
    `scale=w='min(${spec.width},iw)':h='min(${spec.height},ih)':force_original_aspect_ratio=decrease`,
    `pad=${spec.width}:${spec.height}:(ow-iw)/2:(oh-ih)/2:color=0x07090F`,
    `drawbox=x=${cta.x}:y=${cta.y}:w=iw-2*${cta.x}:h=${cta.boxH}:color=0x07090F@0.75:t=fill`,
    draw(` ${text.cta} `, cta, spec.colors.white, { centered: true }),
  ];
  if (text.disclaimer && spec.zones.disclaimer) chain.push(draw(text.disclaimer, spec.zones.disclaimer, "0xFFFFFF@0.6"));
  if (text.supportingCopy && spec.zones.copy) chain.push(draw(text.supportingCopy, spec.zones.copy, "0xFFFFFF@0.92", { centered: true }));
  chain.push(draw(text.headline, spec.zones.headline, spec.colors.white, { centered: true }));

  if (logoPath && spec.zones.logo) {
    const z = spec.zones.logo;
    return [
      "-y",
      "-i", backgroundPath,
      "-i", logoPath,
      "-filter_complex",
      `[0:v]${chain.join(",")}[txt];` +
        `[1:v]scale=${z.size}:${z.size}:force_original_aspect_ratio=decrease[pad_logo];` +
        `[txt][pad_logo]overlay=${z.x}:${z.y}[v]`,
      "-map", "[v]",
      "-frames:v", "1",
      outPath,
    ];
  }
  return ["-y", "-i", backgroundPath, "-filter_complex", `[0:v]${chain.join(",")}[v]`, "-map", "[v]", "-frames:v", "1", outPath];
}
