// ============================================================================
// imageAds — image-adpecific domain knowledge shared by the edge function,
// tests and the composition planner.
// ----------------------------------------------------------------------------
// Placement presets were verified against Meta/TikTok/YouTube ad specs on
// 2026-10-17 (sources in the report):
//   • IG Feed portrait 1440×1800 (4:5, Meta's current recommendation)
//   • IG Stories/Reels 1080×1920 (9:16); Meta documents 1440×2560 art — a
//     4× scale of the same 9:16 grid; composed output follows 1080×1920 with
//     the same safe-area fractions, upscaled exports can be requested.
//   • TikTok static 1080×1920 (9:16; carousel spec lists 720×1280 min)
//   • Facebook Feed 1440×1800 (4:5) and 1080×1080 (1:1) alternative
//   • YouTube thumbnail 1280×720 (16:9, min width 640; docs note 4K 16:9)
// Two facts drive the pipeline shape:
//   1. GPT-Image models need both sides divisible by 16 (imageApiPayload),
//      and 1440×1800/1280×720 are NOT — so the provider is asked for the
//      nearest 16-divisible same-ratio base, and the deterministic composer
//      produces the exact placement size.
//   2. Renders never come out with trusting-luck typography: the provider is
//      explicitly told to keep text OUT of the background art.
// ============================================================================

export interface ImagePlacement {
  id: string;
  label: string;
  width: number;
  height: number;
  /** Nearest provider-generable size for the background, same ratio. */
  genWidth: number;
  genHeight: number;
  safeAreas: { top: number; bottom: number; sides: number };
}

// Fractions apply to the composed output's dimensions; 9:16 UI zones scale
// with height, feed margins with width. Values conservative.
export const PLACEMENTS: ImagePlacement[] = [
  { id: "ig_feed_portrait", label: "Instagram Feed (4:5 portrait)", width: 1440, height: 1800, genWidth: 1024, genHeight: 1280, safeAreas: { top: 0.05, bottom: 0.12, sides: 0.05 } },
  { id: "ig_feed_square", label: "Instagram/Facebook Feed (1:1)", width: 1080, height: 1080, genWidth: 1024, genHeight: 1024, safeAreas: { top: 0.06, bottom: 0.12, sides: 0.05 } },
  { id: "ig_story_reels", label: "Instagram Stories/Reels cover (9:16)", width: 1080, height: 1920, genWidth: 1024, genHeight: 1792, safeAreas: { top: 0.12, bottom: 0.2, sides: 0.08 } },
  { id: "tiktok_static", label: "TikTok static creative (9:16)", width: 1080, height: 1920, genWidth: 1024, genHeight: 1792, safeAreas: { top: 0.1, bottom: 0.22, sides: 0.08 } },
  { id: "fb_feed_portrait", label: "Facebook Feed (4:5 portrait)", width: 1440, height: 1800, genWidth: 1024, genHeight: 1280, safeAreas: { top: 0.05, bottom: 0.12, sides: 0.05 } },
  { id: "youtube_thumbnail", label: "YouTube thumbnail (16:9)", width: 1280, height: 720, genWidth: 2048, genHeight: 1152, safeAreas: { top: 0.08, bottom: 0.08, sides: 0.05 } },
];

export const DEFAULT_PLACEMENT_IDS = ["ig_feed_portrait", "ig_story_reels"];

export function placementById(id: string): ImagePlacement {
  const found = PLACEMENTS.find((p) => p.id === id);
  if (!found) throw new Error(`unknown placement ${id}`);
  return found;
}

/** Custom composed sizes: bounds + ratio only. The 16-divisibility rule
 *  applies to provider generation (genBaseFor), not to composited output —
 *  FFmpeg renders any pixel size, so Meta's 1440×1800 is legitimate here. */
export function validateCustomSize(w: number, h: number): string | null {
  if (![w, h].every((n) => Number.isInteger(n) && n >= 256 && n <= 3840)) {
    return "custom size must be integers between 256 and 3840";
  }
  const r = w / h;
  if (r < 1 / 3 || r > 3) return "aspect ratio must be between 1:3 and 3:1";
  return null;
}

/** Provider-generable base for a custom composed size (nearest 16-divisible). */
export function genBaseFor(w: number, h: number): { genWidth: number; genHeight: number } {
  const round16 = (n: number) => Math.min(3840, Math.max(256, Math.round(n / 16) * 16));
  const long = round16(Math.max(w, h));
  const short = round16((long * Math.min(w, h)) / Math.max(w, h));
  return w >= h ? { genWidth: long, genHeight: short } : { genWidth: short, genHeight: long };
}

// ---------------------------------------------------------------------------
// Brief + concept
// ---------------------------------------------------------------------------

export interface ImageBrief {
  productName: string;
  audience: string;
  objective: string;
  message: string;
  headline?: string;
  cta: string;
  angle?: string;
  visualDirection?: string;
}

export interface ImageConcept {
  objective: string;
  audience: string;
  message: string;
  product: string;
  angle: string;
  visualDirection: string;
  headline: string;
  supportingCopy: string;
  cta: string;
  composition: string;
  placements: string[];
  appeal: string;
  evidenceRefs: string[];
}

export const CONCEPT_FIELDS = [
  "objective", "audience", "message", "product", "angle", "visualDirection",
  "headline", "supportingCopy", "cta", "composition", "placements", "appeal", "evidenceRefs",
] as const;

export function validateConcept(raw: unknown, knownEvidenceIds: Set<string>): { problems: string[]; value?: ImageConcept } {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object") return { problems: ["concept must be an object"] };
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  for (const f of CONCEPT_FIELDS) {
    if (f === "evidenceRefs" || f === "placements") continue; // array fields, handled below
    if (!str(o[f])) problems.push(`${f} is required`);
  }
  const placements = Array.isArray(o.placements)
    ? o.placements.filter((p): p is string => typeof p === "string").filter((p) => PLACEMENTS.some((pl) => pl.id === p))
    : [];
  if (!placements.length) problems.push("at least one supported placement is required");
  const evidenceRefs = Array.isArray(o.evidenceRefs)
    ? o.evidenceRefs.filter((e): e is string => typeof e === "string")
    : [];
  const unknownRefs = evidenceRefs.filter((e) => !knownEvidenceIds.has(e));
  if (unknownRefs.length) problems.push(`research citations not present in this project's findings: ${unknownRefs.join(", ")}`);
  if (problems.length) return { problems };
  const value: Record<string, unknown> = {};
  for (const f of CONCEPT_FIELDS) {
    if (f === "evidenceRefs") value[f] = evidenceRefs.slice(0, 6);
    else if (f === "placements") value[f] = placements.slice(0, 3);
    else value[f] = str(o[f]).slice(0, 400);
  }
  return { problems: [], value: value as unknown as ImageConcept };
}

/**
 * Concept prompt — deterministic prompt-assembly over brand + optional real
 * research evidence. Fabrication guard rails are in the prompt AND validated
 * after; the system prompt forbids invented statistics/reviews/claims.
 */
export const CONCEPT_SYSTEM = `You are the creative director for Vaylo Sports advertising. You produce image-ad concepts as JSON:
{"concepts":[{"objective":"","audience":"","message":"","product":"","angle":"","visualDirection":"","headline":"","supportingCopy":"","cta":"","composition":"","placements":["ig_feed_portrait"],"appeal":"","evidenceRefs":[...]}]}

Rules:
- meaninfully DIFFERENT concepts: distinct creative angle, visual approach and hook — not colour variations of one template;
- "cta" must come from the brand's approved CTA list when one is supplied;
- when research findings (rows with ids) are supplied: use them only as orientation; cite the ids you actually used in evidenceRefs; never cite an id that was not supplied; never copy a competitor's ad;
- never invent statistics, user counts, testimonials, review scores, prices or subscription claims;
- headline: max 8 words; supportingCopy: one sentence; composition: where each element sits in the frame;
- audience guidance: athletes, core 18-30; premium sports-technology feel; dark navy/black, restrained purple; no generic AI-startup vibes.`;

export function buildConceptsUserPrompt(brief: ImageBrief, brand: { name: string; slogan: string; approvedCtas: string[]; prohibitedClaims: string[] }, count: number, research?: { id: string; title: string; captured: Record<string, string>; excerpt: string }[]): string {
  return JSON.stringify({
    campaign: {
      product: brief.productName,
      audience: brief.audience,
      objective: brief.objective,
      message: brief.message,
      requestedAngle: brief.angle ?? "",
      visualDirection: brief.visualDirection ?? "",
    },
    brand: {
      name: brand.name,
      slogan: brand.slogan,
      approvedCtas: brand.approvedCtas,
      mustNotClaim: brand.prohibitedClaims,
    },
    requestedConcepts: Math.min(5, Math.max(1, count)),
    // Only findings the project actually holds — ids are validated on return.
    researchFindings:
      research?.map((f) => ({ id: f.id, title: f.title, observed: f.captured, excerpt: f.excerpt.slice(0, 300) })) ?? [],
  });
}

// ---------------------------------------------------------------------------
// Generation prompt — background art only; the composer owns wording.
// ---------------------------------------------------------------------------

export function buildGenerationPrompt(concept: ImageConcept, brand: { colors: { black: string; navy: string; purple: string }; name: string }): string {
  const { purple, navy, black } = brand.colors;
  return [
    "Photographic advertising background for a premium sports-technology brand.",
    `Scene from the creative direction: ${concept.visualDirection}.`,
    `Mood: ${concept.angle}. Athletes in ${concept.audience}.`,
    `Palette: deep ${black} to ${navy} background tones with restrained ${purple} accent lighting.`,
    "High contrast, cinematic but controlled, premium sports technology; no warm/clinical stock-photo feel.",
    "Absolutely no text, lettering, captions, logos, wordmarks, prices or UI overlays anywhere in the image — words are added later in a separate deterministic pass.",
    "No read/download buttons, no fictitious brand names or badges.",
  ].join(" ");
}

/** Statement returned to the user when a provider is unconfigured/disabled. */
export const IMAGE_NOT_CONFIGURED =
  "OpenAI is not configured on this deployment (ADS_OPENAI_API_KEY or OPENAI_API_KEY is missing).";
