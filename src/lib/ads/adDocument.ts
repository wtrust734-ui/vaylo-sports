// ============================================================================
// VAYLO AD STUDIO — the editable ad document
// ----------------------------------------------------------------------------
// An ad is not a PNG and it is not an MP4. It is a document: a description of
// what the ad is, which is then rendered. That inversion is the whole reason
// conversational editing can work.
//
// If the only artefact were the exported image, "make the headline bigger"
// would mean re-generating pixels and hoping the rest survives. Because the
// headline is a *layer with a font size*, changing it is arithmetic, and the
// logo, background and every other layer provably cannot move. The same holds
// for video: a clip is an object with an `in`/`out` pair, so "trim the last
// five seconds" is a number, not a re-shoot.
//
// Everything here is plain data plus pure functions, so the editing engine can
// be unit-tested without a browser, an API key or a network.
// ============================================================================

/** The placements the brand actually buys. Drives export dimensions. */
export type Aspect = "9:16" | "4:5" | "1:1" | "16:9";

export type Platform = "tiktok" | "reels" | "shorts" | "feed" | "youtube";

/** Render targets, in pixels, for each aspect. Vertical is the primary format. */
export const ASPECT_PIXELS: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

/** Which placement each platform expects. Used by "make this suitable for X". */
export const PLATFORM_ASPECT: Record<Platform, Aspect> = {
  tiktok: "9:16",
  reels: "9:16",
  shorts: "9:16",
  feed: "4:5",
  youtube: "16:9",
};

/**
 * The brand palette. These are the Vaylo tokens, and they are the *default*,
 * not a cage — the athlete may ask for "more purple and less blue", which
 * moves `accent` and `backgroundDeep`, but it never silently repaints the
 * whole document, because every other op leaves these fields alone.
 */
export interface Palette {
  /** Page/ground colour behind everything. Dark navy or black. */
  background: string;
  /** The deep end of the background gradient. */
  backgroundDeep: string;
  /** Purple accent, used for rules, chips and the CTA fill. */
  accent: string;
  /** Primary text colour. */
  text: string;
  /** Muted text colour for the subhead. */
  textMuted: string;
}

export const VAYLO_PALETTE: Palette = {
  background: "#05070f",
  backgroundDeep: "#000000",
  accent: "#8505D5",
  text: "#ffffff",
  textMuted: "#a9b0c6",
};

/** Text roles are fixed so the interpreter can address them unambiguously. */
export type TextRole = "headline" | "subhead" | "cta";

export const TEXT_ROLES: TextRole[] = ["headline", "subhead", "cta"];

export interface TextLayer {
  kind: "text";
  id: string;
  role: TextRole;
  text: string;
  /** Font size as a fraction of the canvas height, so it survives a resize. */
  fontSize: number;
  color: string;
  weight: number;
  tracking: number;
  align: "left" | "center" | "right";
  /** Anchor position as a fraction of width/height, 0..1, top-left of the box. */
  x: number;
  y: number;
  maxWidth: number;
}

export interface ImageLayer {
  kind: "image";
  id: string;
  /** Object URL or storage URL. Always an uploaded asset, never generated claims. */
  src: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fit: "cover" | "contain";
  opacity: number;
}

export interface LogoLayer {
  kind: "logo";
  id: string;
  /** The official mark. Never redrawn, never recoloured — see the brand rules. */
  src: string;
  /** Scale as a fraction of canvas width. The knob "make the logo bigger" moves. */
  scale: number;
  x: number;
  y: number;
}

export type Layer = TextLayer | ImageLayer | LogoLayer;

export interface BackgroundLayer {
  kind: "background";
  /** 0 = as authored; positive darkens, negative lifts. "Darker and more premium". */
  tone: number;
  /** 0 = flat, 1 = full gradient. Premium reads as a controlled gradient. */
  gradient: number;
  /** Vignette strength, 0..1. */
  vignette: number;
}

/**
 * How a clip arrives. `punchIn` is the one that reads as "attention-grabbing"
 * — a fast scale-up on the first frames — which is why "make the opening more
 * attention-grabbing" resolves to changing this and nothing else.
 */
export type TransitionType = "cut" | "dissolve" | "punchIn";

export interface Transition {
  type: TransitionType;
  /** Duration in seconds. Shorter reads as harder/faster. */
  duration: number;
}

/** A single shot in a video ad. */
export interface VideoClip {
  id: string;
  src: string;
  label: string;
  /** Source in-point, seconds. */
  in: number;
  /** Source out-point, seconds. */
  out: number;
  /** True when this clip is a real captured Vaylo screen recording. */
  screenRecording: boolean;
  /** How the clip arrives on screen. */
  transitionIn: Transition;
}

export interface Caption {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface VideoAdDocument {
  kind: "video";
  id: string;
  aspect: Aspect;
  fps: number;
  clips: VideoClip[];
  captions: Caption[];
  cta: TextLayer;
  /** Playback rate multiplier. "Make it feel faster and more competitive." */
  pace: number;
  /** Caption font size as a fraction of height. "Make captions easier to read." */
  captionSize: number;
}

export interface ImageAdDocument {
  kind: "image";
  id: string;
  aspect: Aspect;
  palette: Palette;
  background: BackgroundLayer;
  layers: Layer[];
}

export type AdDocument = ImageAdDocument | VideoAdDocument;

export type AdKind = AdDocument["kind"];

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

let seq = 0;
/** Deterministic, collision-free ids without pulling in a uuid dependency. */
export const nextId = (prefix: string): string => `${prefix}_${(++seq).toString(36)}`;

/** Test seam: makes ids reproducible across a suite. */
export const __resetIds = (): void => {
  seq = 0;
};

const textLayer = (
  role: TextRole,
  text: string,
  overrides: Partial<TextLayer> = {},
): TextLayer => ({
  kind: "text",
  id: `text_${role}`,
  role,
  text,
  fontSize: role === "headline" ? 0.085 : role === "subhead" ? 0.038 : 0.032,
  color: role === "cta" ? VAYLO_PALETTE.text : VAYLO_PALETTE.text,
  weight: role === "headline" ? 800 : role === "cta" ? 700 : 500,
  tracking: role === "headline" ? -0.02 : 0,
  align: "left",
  x: 0.08,
  y: role === "headline" ? 0.3 : role === "subhead" ? 0.46 : 0.82,
  maxWidth: 0.84,
  ...overrides,
});

export interface NewImageAdInput {
  headline: string;
  subhead?: string;
  cta?: string;
  aspect?: Aspect;
  /** The official logo path. Defaults to the mark shipped in /public. */
  logoSrc?: string;
}

/**
 * A new image ad. Text and the logo are separate layers from the start, which
 * is what makes them editable without regenerating the artwork.
 */
export const newImageAd = (input: NewImageAdInput): ImageAdDocument => ({
  kind: "image",
  id: nextId("ad"),
  aspect: input.aspect ?? "9:16",
  palette: { ...VAYLO_PALETTE },
  background: { kind: "background", tone: 0, gradient: 0.55, vignette: 0.35 },
  layers: [
    textLayer("headline", input.headline),
    textLayer("subhead", input.subhead ?? ""),
    textLayer("cta", input.cta ?? ""),
    {
      kind: "logo",
      id: "logo",
      src: input.logoSrc ?? "/logo.png",
      scale: 0.14,
      x: 0.08,
      y: 0.09,
    },
  ],
});

export interface NewVideoAdInput {
  aspect?: Aspect;
  fps?: number;
  clips: Array<{ src: string; label: string; in?: number; out?: number; screenRecording?: boolean }>;
  cta?: string;
}

export const newVideoAd = (input: NewVideoAdInput): VideoAdDocument => ({
  kind: "video",
  id: nextId("ad"),
  aspect: input.aspect ?? "9:16",
  fps: input.fps ?? 30,
  clips: input.clips.map((clip) => ({
    id: nextId("clip"),
    src: clip.src,
    label: clip.label,
    in: clip.in ?? 0,
    out: clip.out ?? 3,
    screenRecording: clip.screenRecording ?? false,
    // Cuts by default: a first assembly should show the edit honestly, with
    // every transition the athlete has not asked for left out of the way.
    transitionIn: { type: "cut", duration: 0 },
  })),
  captions: [],
  cta: textLayer("cta", input.cta ?? "Join the waitlist", { align: "center", x: 0.1, y: 0.84 }),
  pace: 1,
  captionSize: 0.03,
});

// ---------------------------------------------------------------------------
// Read-only helpers
// ---------------------------------------------------------------------------

export const isImageAd = (doc: AdDocument): doc is ImageAdDocument => doc.kind === "image";
export const isVideoAd = (doc: AdDocument): doc is VideoAdDocument => doc.kind === "video";

export const findText = (doc: AdDocument, role: TextRole): TextLayer | undefined =>
  isImageAd(doc)
    ? (doc.layers.find((l): l is TextLayer => l.kind === "text" && l.role === role))
    : doc.cta.role === role
      ? doc.cta
      : undefined;

export const findLogo = (doc: AdDocument): LogoLayer | undefined =>
  isImageAd(doc) ? (doc.layers.find((l): l is LogoLayer => l.kind === "logo")) : undefined;

/** Total runtime of a video ad after trimming and pacing, in seconds. */
export const videoDuration = (doc: VideoAdDocument): number => {
  const raw = doc.clips.reduce((sum, c) => sum + Math.max(0, c.out - c.in), 0);
  return raw / (doc.pace || 1);
};

/** Dimensions the document should render at. */
export const documentPixels = (doc: AdDocument): { width: number; height: number } =>
  ASPECT_PIXELS[doc.aspect];

export const platformsForAspect = (aspect: Aspect): Platform[] =>
  (Object.keys(PLATFORM_ASPECT) as Platform[]).filter((p) => PLATFORM_ASPECT[p] === aspect);

/**
 * A stable, structural fingerprint of everything the *viewer* can see.
 *
 * This exists so tests can assert the requirement that drives the whole
 * feature — "make the requested change without unnecessarily changing
 * unrelated elements" — instead of trusting it. If an edit touches a field it
 * was not asked to touch, the fingerprints differ in a way the test can name.
 */
export const visibleFingerprint = (doc: AdDocument): Record<string, unknown> => {
  if (isImageAd(doc)) {
    return {
      aspect: doc.aspect,
      palette: doc.palette,
      background: doc.background,
      layers: doc.layers.map((layer) => {
        if (layer.kind === "text") {
          return { id: layer.id, role: layer.role, text: layer.text, fontSize: layer.fontSize, x: layer.x, y: layer.y, align: layer.align };
        }
        if (layer.kind === "logo") return { id: layer.id, scale: layer.scale, x: layer.x, y: layer.y };
        return { id: layer.id, src: layer.src, x: layer.x, y: layer.y, w: layer.w, h: layer.h };
      }),
    };
  }
  return {
    aspect: doc.aspect,
    fps: doc.fps,
    pace: doc.pace,
    clips: doc.clips.map((c) => ({
      src: c.src,
      in: c.in,
      out: c.out,
      transitionIn: c.transitionIn.type,
      transitionDuration: c.transitionIn.duration,
    })),
    captions: doc.captions.map((c) => ({ text: c.text, start: c.start, end: c.end })),
    cta: { text: doc.cta.text, y: doc.cta.y },
    captionSize: doc.captionSize,
  };
};
