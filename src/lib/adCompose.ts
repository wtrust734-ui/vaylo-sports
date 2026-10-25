// ============================================================================
// adCompose — draw the finished image ad in the browser.
// ----------------------------------------------------------------------------
// The server-side compose step needs a hosted FFmpeg worker, and this deployment
// has none: RENDER_WORKER_URL is unset, so "Compose with brand text" could only
// ever answer "worker not configured". The ad is a still image with text over a
// generated background, which a canvas already does exactly and instantly — and
// the owner's own browser is the one place that always exists.
//
// The edge function still owns storage and ownership: this file only produces a
// PNG data URL, which `store_composed` validates, uploads and records as a
// composed artifact with lineage back to its background.
// ============================================================================

export interface AdComposeInput {
  /** Fresh signed URL for the generated background (same origin rules apply). */
  imageUrl: string;
  width: number;
  height: number;
  headline: string;
  supportingCopy?: string;
  cta: string;
}

const ACCENT = "#8505D5";
const INK = "#ffffff";

/** Cover the canvas with the image, preserving its aspect ratio. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Greedy wrap against the measured width; returns at most `maxLines` lines. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

export async function renderComposedAd(input: AdComposeInput): Promise<string> {
  const { imageUrl, width, height, headline, supportingCopy, cta } = input;
  if (!headline.trim() || !cta.trim()) throw new Error("the ad needs a headline and a call to action");

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("the generated background could not be loaded for composition"));
    setTimeout(() => reject(new Error("the generated background took too long to load")), 20_000);
  });
  img.src = imageUrl;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser cannot compose images (no 2D canvas)");

  drawCover(ctx, img, width, height);

  // Dark scrim from the lower half up, so white type stays legible on any art.
  const scrim = ctx.createLinearGradient(0, height * 0.38, 0, height);
  scrim.addColorStop(0, "rgba(0,0,0,0)");
  scrim.addColorStop(0.55, "rgba(0,0,0,0.62)");
  scrim.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, width, height);

  const margin = Math.round(width * 0.075);
  const maxTextWidth = width - margin * 2;
  const fontFamily = "'Inter', 'Helvetica Neue', Arial, sans-serif";

  // CTA pill sits on the bottom margin; everything else stacks above it.
  const ctaSize = Math.round(width * 0.034);
  ctx.font = `600 ${ctaSize}px ${fontFamily}`;
  const ctaTextWidth = ctx.measureText(cta).width;
  const pillH = Math.round(ctaSize * 2.3);
  const pillW = ctaTextWidth + Math.round(ctaSize * 2.8);
  const pillX = margin;
  const pillY = height - margin - pillH;

  const copySize = Math.round(width * 0.031);
  let cursorY = pillY - Math.round(copySize * 2.1);

  if (supportingCopy?.trim()) {
    ctx.font = `400 ${copySize}px ${fontFamily}`;
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    const lines = wrap(ctx, supportingCopy.trim(), maxTextWidth, 2);
    for (const lineText of [...lines].reverse()) {
      ctx.fillText(lineText, margin, cursorY + copySize);
      cursorY -= Math.round(copySize * 1.4);
    }
    cursorY -= Math.round(copySize * 0.8);
  }

  const headlineSize = Math.round(width * 0.072);
  ctx.font = `700 ${headlineSize}px ${fontFamily}`;
  ctx.fillStyle = INK;
  const headlineLines = wrap(ctx, headline.trim(), maxTextWidth, 3);
  const lineH = Math.round(headlineSize * 1.1);
  // Stack the headline upward from the cursor so it never collides with the CTA.
  for (const lineText of [...headlineLines].reverse()) {
    ctx.fillText(lineText, margin, cursorY);
    cursorY -= lineH;
  }

  // Brand mark, small and top-left — present, not competing with the headline.
  ctx.font = `700 ${Math.round(width * 0.023)}px ${fontFamily}`;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText("VAYLO", margin, margin + Math.round(width * 0.023));

  // CTA
  ctx.fillStyle = ACCENT;
  const r = pillH / 2;
  ctx.beginPath();
  ctx.moveTo(pillX + r, pillY);
  ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillH, r);
  ctx.arcTo(pillX + pillW, pillY + pillH, pillX, pillY + pillH, r);
  ctx.arcTo(pillX, pillY + pillH, pillX, pillY, r);
  ctx.arcTo(pillX, pillY, pillX + pillW, pillY, r);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${ctaSize}px ${fontFamily}`;
  ctx.fillText(cta, pillX + Math.round(ctaSize * 1.4), pillY + pillH / 2 + 1);

  try {
    return canvas.toDataURL("image/png");
  } catch {
    // A tainted canvas means the signed URL was served without CORS headers.
    throw new Error("the background image could not be read into the canvas (CORS) — reopen the project and retry");
  }
}
