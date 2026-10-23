// ============================================================================
// composeJob — the worker's compose job: validates a request, resolves the
// background (and optional logo) sources under WORK_DIR, plans the layout
// (imageComposition.planComposition) and produces the ffmpeg ARGUMENT ARRAY
// ready for spawn(binary, argv, { shell: false }).
// ----------------------------------------------------------------------------
// Pure and FFmpeg-free so vitest can exercise the whole plan inside the shared
// suite without spawning anything; the worker (worker/server.mjs) is the only
// component that actually runs it.
//
// SECURITY RULES (load-bearing, matching renderPlan's):
//   • ARGUMENT ARRAY only — never a shell string.
//   • filesystem paths arrive RESOLVED AND SANITISED by the worker (WORK_DIR
//     containment); this module never accepts or re-derives paths from user
//     input beyond passing the two already-safe arguments through.
//   • everything else (placement, colours, text) is validated server-side
//     below so a malformed request 400s before any render slot is consumed.
// ============================================================================

import { placementById, PLACEMENTS } from "./imageAds.ts";
import { planComposition, buildFinalComposeArgs } from "./imageComposition.ts";

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

export interface ComposeJobRequest {
  /** Worker- internal job id (already validated against the same regex). */
  jobId: string;
  placementId?: string;
  /** Custom composed size, only when placementId is "custom". */
  custom?: { width: number; height: number };
  /** Provider-generated background, as a stored data-URL or WORK_DIR path. */
  background: string;
  /** Approved brand logo — overlaid verbatim, never redrawn. */
  logo?: string;
  brand?: {
    /** Restrained purple accent, default from the brand palette. */
    purple?: string;
  };
  text: {
    headline: string;
    supportingCopy?: string;
    cta: string;
    disclaimer?: string;
  };
  /** True when the caller has already verified the layout has no overflow. */
  allowOverflow?: boolean;
}

export interface ValidateResult {
  ok: boolean;
  reason?: string;
  request?: ComposeJobRequest;
}

const MAX_TEXT = 300;
const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Validate a compose request. Deliberately throws a plain string so the worker
 * can 400 with the message rather than a stack trace.
 */
export function validateComposeRequest(raw: unknown): ValidateResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "a JSON body is required" };
  const o = raw as Record<string, unknown>;

  if (typeof o.jobId !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(o.jobId)) {
    return { ok: false, reason: "jobId must be 6-64 characters of letters, digits, dash or underscore" };
  }
  if (typeof o.background !== "string" || !o.background.trim()) {
    return { ok: false, reason: "the generated background is required" };
  }

  // Placement: known preset, or "custom" with a validateCustomSize-compliant
  // size. Value comes from PLACEMENTS server-side; the client never names a
  // custom width/height pair that bypasses the bounded range (audit E5).
  const placementId = typeof o.placementId === "string" ? o.placementId.trim() : "";
  let custom: { width: number; height: number } | undefined;
  if (placementId === "custom") {
    const c = (o.custom ?? {}) as Record<string, unknown>;
    const w = Number(c.width);
    const h = Number(c.height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || !PLACEMENTS.length) {
      return { ok: false, reason: "custom needs integer width/height" };
    }
    // Reuse the shared bound without importing a circular ref — mirror rules:
    if (w < 256 || w > 3840 || h < 256 || h > 3840) {
      return { ok: false, reason: "custom size must be integers between 256 and 3840" };
    }
    const ratio = w / h;
    if (ratio < 1 / 3 || ratio > 3) return { ok: false, reason: "aspect ratio must be between 1:3 and 3:1" };
    custom = { width: w, height: h };
  } else {
    try {
      placementById(placementId || "ig_feed_portrait");
    } catch {
      return { ok: false, reason: `placementId must be one of: ${PLACEMENTS.map((p) => p.id).join(", ")}, custom` };
    }
  }

  const text = (o.text ?? {}) as Record<string, unknown>;
  const headline = typeof text.headline === "string" ? text.headline.trim().slice(0, MAX_TEXT) : "";
  const cta = typeof text.cta === "string" ? text.cta.trim().slice(0, MAX_TEXT) : "";
  if (!headline) return { ok: false, reason: "text.headline is required" };
  if (!cta) return { ok: false, reason: "text.cta is required" };
  const supportingCopy = typeof text.supportingCopy === "string" ? text.supportingCopy.trim().slice(0, MAX_TEXT) : undefined;
  const disclaimer = typeof text.disclaimer === "string" ? text.disclaimer.trim().slice(0, MAX_TEXT) : undefined;

  let purple: string | undefined;
  if (o.brand && typeof o.brand === "object") {
    const b = (o.brand as Record<string, unknown>).purple;
    if (typeof b === "string") {
      if (!HEX.test(b)) return { ok: false, reason: "brand.purple must be a #RRGGBB hex string" };
      purple = b;
    }
  }

  return {
    ok: true,
    request: {
      jobId: o.jobId,
      placementId: placementId || "ig_feed_portrait",
      custom,
      background: o.background,
      logo: typeof o.logo === "string" && o.logo.trim() ? o.logo : undefined,
      brand: purple ? { purple } : undefined,
      text: { headline, supportingCopy, cta, disclaimer },
      allowOverflow: o.allowOverflow === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface ComposePlan {
  argv: string[];
  outPath: string;
  width: number;
  height: number;
  placementId: string;
  /** Layout rejections — the caller must fix these before dispatching. */
  overflow: string[];
}

/**
 * Return the ffmpeg argument array for the compose pass, or an overflow
 * verdict the workflow should surface (the workflow refuses, never clips).
 *
 * WORK_DIR_LOCAL is the worker's own local job dir: the caller has already
 * written background.png / logo.* / font.ttf there and hands in an absolute
 * path under it, which resolveSource in the worker honoured beforehand.
 */
export function buildComposePlan(input: {
  request: ComposeJobRequest;
  /** Absolute paths that are already WORK_DIR-contained. */
  backgroundPath: string;
  logoPath?: string;
  fontPath: string;
  outPath: string;
}): { plan: ComposePlan } | { overflow: string[] } {
  const placement = input.request.placementId === "custom"
    ? {
        id: "custom",
        label: "Custom",
        width: input.request.custom!.width,
        height: input.request.custom!.height,
        genWidth: input.request.custom!.width,
        genHeight: input.request.custom!.height,
        safeAreas: { top: 0.06, bottom: 0.12, sides: 0.05 },
      }
    : placementById(input.request.placementId ?? "ig_feed_portrait");

  const spec = planComposition(
    placement,
    input.request.text,
    Boolean(input.request.logo && input.logoPath),
    { purple: input.request.brand?.purple ?? "#8505D5" },
  );
  if (spec.overflow.length && !input.request.allowOverflow) return { overflow: spec.overflow };

  const argv = buildFinalComposeArgs({
    spec,
    backgroundPath: input.backgroundPath,
    logoPath: input.logoPath && input.request.logo ? input.logoPath : undefined,
    fontPath: input.fontPath,
    outPath: input.outPath,
    text: input.request.text,
  });

  return {
    plan: {
      argv,
      outPath: input.outPath,
      width: spec.width,
      height: spec.height,
      placementId: spec.placement,
      overflow: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Output verification policy (not the FFmpeg run itself): what the worker may
// accept as a "generated and composed" result, beyond exit code 0.
// ---------------------------------------------------------------------------

/** Minimum/maximum plausible PNG file size for an ad at the supported sizes. */
export const OUTPUT_BYTES_MIN = 10 * 1024;
export const OUTPUT_BYTES_MAX = 24 * 1024 * 1024;

export function verifyOutput(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return "the composition produced no file";
  if (bytes < OUTPUT_BYTES_MIN) return `output suspiciously small (${bytes} B) — refusing to claim success`;
  if (bytes > OUTPUT_BYTES_MAX) return `output exceeds the ${Math.round(OUTPUT_BYTES_MAX / 1048576)} MB limit`;
  return null;
}
