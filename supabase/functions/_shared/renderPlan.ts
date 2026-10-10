// ============================================================================
// AD RENDER ENGINE — the FFmpeg plan builder.
// ----------------------------------------------------------------------------
// WHY THIS FILE IS PURE, AND WHY IT RETURNS AN ARRAY
//
// The security requirement is "use safe subprocess execution rather than
// constructing shell commands from user input". The way that requirement is
// actually satisfied is structural: this module builds an ARGUMENT ARRAY and
// never a command string. There is no shell anywhere in the path, so a caption
// containing `; rm -rf /` or `$(whoami)` is just a caption — it cannot become an
// argument to anything but ffmpeg's own text filter.
//
// It is pure and import-free so it can be unit-tested in vitest beside the rest
// of `_shared`, and so the same plan can be executed by a container worker, a
// local CLI, or a test — the executor is replaceable, the plan is not.
//
// The deployment constraint this whole feature lives or dies on: Supabase Edge
// Functions CANNOT run FFmpeg. The edge runtime refuses to spawn subprocesses
// outright:
//
//   "Error: Spawning subprocesses is not allowed on Supabase Edge Runtime."
//
// ...plus a 2-second CPU budget per request. So this file is the half that runs
// anywhere, and `runRenderPlan` is the half that needs a real host.
// ============================================================================

export interface AdPreset {
  id: string;
  label: string;
  /** Output pixel dimensions. */
  width: number;
  height: number;
  aspect: "9:16" | "1:1" | "16:9";
}

/**
 * The placements the brief names. Dimensions are the platforms' own preferred
 * upload sizes rather than arbitrary ones, so an export does not get re-encoded
 * by the platform on the way in.
 */
export const AD_PRESETS: Record<string, AdPreset> = {
  reels: { id: "reels", label: "Instagram Reels / TikTok", width: 1080, height: 1920, aspect: "9:16" },
  shorts: { id: "shorts", label: "YouTube Shorts", width: 1080, height: 1920, aspect: "9:16" },
  square: { id: "square", label: "Square social", width: 1080, height: 1080, aspect: "1:1" },
  landscape: { id: "landscape", label: "Landscape / YouTube", width: 1920, height: 1080, aspect: "16:9" },
};

export const PRESET_IDS = Object.keys(AD_PRESETS);

/** Vaylo Sports brand, from the ad slate's palette. */
export const BRAND = {
  slogan: "Learn smarter. Train better. Perform better.",
  navy: "0x050710",
  black: "0x000000",
  purple: "0x8505D5",
} as const;

export interface TextOverlay {
  /** Which slot this is, so the layout never depends on array order. */
  role: "title" | "subhead" | "cta" | "slogan";
  text: string;
  /** Seconds into the finished video at which it appears. */
  startSeconds: number;
  endSeconds: number;
}

export interface ClipInput {
  /** Server-side path. Never a user-supplied string in production. */
  src: string;
  /** Trim window, in seconds. */
  trimStart?: number;
  trimEnd?: number;
  /**
   * Length of the clip AFTER trimming. Only needed when a dissolve is
   * requested, because `xfade` needs an absolute timeline offset and there is
   * no way to derive one from the inputs alone. Declared rather than probed so
   * this builder stays pure; the runner probes and fills it in.
   */
  durationSeconds?: number;
  /** Cross-fade into this clip instead of a hard cut. */
  transition?: { type: "cut" | "dissolve"; duration: number };
}

export interface AudioTrackInput {
  src: string;
  /** 1 = unchanged. Above 1 risks clipping; loudnorm is applied regardless. */
  volume: number;
  /** Duck under a voiceover. */
  duckTo?: number;
}

export interface RenderPlanInput {
  presetId: string;
  clips: ClipInput[];
  overlays?: TextOverlay[];
  /** Background music. */
  music?: AudioTrackInput;
  /** Voiceover, mixed on top of the music. */
  voiceover?: AudioTrackInput;
  /**
   * The Vaylo Sports logo, drawn over every frame.
   *
   * The brand rule is that the supplied artwork is used and never approximated,
   * so this takes a path to a real image file — the repository's own
   * `public/logo.png` — and there is no generated stand-in. Transparency is
   * preserved by `overlay`, and a single-frame input repeats for the whole
   * advert, which is why the logo does not need a duration of its own.
   */
  logo?: {
    src: string;
    /** Logo width as a fraction of the frame width. */
    widthRatio?: number;
    /** Margin from the top-left corner, as a fraction of the shorter side. */
    marginRatio?: number;
  };
  /** True when the clips carry their own audio (Veo clips do). */
  keepSourceAudio?: boolean;
  /** Path to a .ttf. Required for any text, since the runtime has no font. */
  fontFile?: string;
  outputPath: string;
  /** CRF for libx264. 23 is the x264 default; 20 is the quality choice. */
  crf?: number;
}

export interface RenderPlan {
  /** Arguments AFTER the binary name. Passed to spawn() as an array. */
  argv: string[];
  outputPath: string;
  width: number;
  height: number;
  aspect: string;
  estimatedSeconds: number;
  inputCount: number;
}

/** Frames-per-second for every export. 30 is what the platforms prefer. */
const OUTPUT_FPS = 30;

/**
 * Escape a string for FFmpeg's `drawtext` filter.
 *
 * Two separate hazards, handled separately:
 *  1. filtergraph syntax — `:` splits options, `\` escapes, `'` quotes the whole
 *     value, `%` starts a strftime expansion, `,` and `;` separate filters.
 *  2. the shell — irrelevant here, because nothing is shelled out.
 *
 * Newlines are normalised rather than escaped: drawtext cannot render a literal
 * newline in a single text option, and silently dropping text would be worse.
 */
export function escapeDrawtext(value: string): string {
  return String(value)
    .replace(/\r?\n/g, " ")
    // Backslash first, or it would escape the escapes added below.
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/**
 * Escape a filesystem path for use inside a filtergraph option value.
 *
 * Windows drive letters are the whole reason this exists: `C:/fonts/x.ttf` puts
 * a colon inside the option, which drawtext reads as the next option's name.
 */
export function escapeFilterPath(value: string): string {
  return String(value).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Shrink a font size until the text fits the frame width.
 *
 * Without this, a long headline is centred and then clipped at BOTH edges —
 * `x=(w-text_w)/2` happily returns a negative x. A rendered ad showed
 * "TRAIN WITH INTENT" losing its first and last characters this way.
 *
 * The glyph ratio is an approximation of a bold sans-serif advance width. It
 * cannot be exact without a font metrics library, so it deliberately errs on the
 * side of a smaller size, and the floor keeps text legible rather than letting
 * it shrink away to nothing on an absurdly long string.
 */
export function fitFontSize(text: string, baseSize: number, frameWidth: number, maxWidthRatio = 0.9): number {
  const lines = String(text).split(/\r?\n/);
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const glyphRatio = 0.62;
  const maxByWidth = (frameWidth * maxWidthRatio) / (longest * glyphRatio);
  return Math.max(24, Math.min(baseSize, Math.floor(maxByWidth)));
}

/**
 * Cover-fit: fill the frame, then centre-crop the overflow.
 *
 * Not `scale=...:force_original_aspect_ratio=decrease` with padding, because an
 * advert with black bars reads as an amateur upload, and not a plain scale
 * either, which would distort the athlete's proportions.
 */
export function coverFitFilter(width: number, height: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
}

/**
 * The trimmed length of a clip: declared when given, else derived from the trim
 * window, else the length Veo clips are (the common case here).
 */
function clipLength(clip: ClipInput, index: number): number {
  if (Number.isFinite(Number(clip.durationSeconds))) return Math.max(0.1, Number(clip.durationSeconds));
  const start = Number(clip.trimStart ?? 0) || 0;
  const end = Number(clip.trimEnd);
  if (Number.isFinite(end)) return Math.max(0.1, end - start);
  if (clip.transition && clip.transition.type === "dissolve" && clip.transition.duration > 0) {
    throw new Error(`clip ${index + 1}: durationSeconds is required to place a dissolve on it`);
  }
  return 8;
}

/** Snap a trim window into a sane range, so a bad request cannot emit nothing. */
function normaliseTrim(clip: ClipInput, index: number): { start: number | null; end: number | null } {
  const start = Number.isFinite(Number(clip.trimStart)) ? Math.max(0, Number(clip.trimStart)) : null;
  const end = Number.isFinite(Number(clip.trimEnd)) ? Math.max(0, Number(clip.trimEnd)) : null;
  if (start !== null && end !== null && end <= start) {
    throw new Error(`clip ${index + 1}: trimEnd must be greater than trimStart`);
  }
  return { start, end };
}

/**
 * Build the whole render as an ffmpeg argument array.
 *
 * Throws on invalid input rather than emitting a command that half-works: a
 * render that fails loudly is cheaper than one that silently drops a caption.
 */
export function buildRenderPlan(input: RenderPlanInput): RenderPlan {
  const preset = AD_PRESETS[input.presetId];
  if (!preset) throw new Error(`unknown preset: ${input.presetId}`);
  if (!Array.isArray(input.clips) || input.clips.length === 0) throw new Error("at least one clip is required");
  if (!input.outputPath.trim()) throw new Error("outputPath is required");

  const overlays = input.overlays ?? [];
  if (overlays.length > 0 && !input.fontFile) {
    // Without a font, drawtext fails at render time, after the user has waited.
    throw new Error("a fontFile is required when text overlays are requested");
  }
  for (const clip of input.clips) {
    if (typeof clip.src !== "string" || !clip.src.trim()) throw new Error("every clip needs a src");
  }

  const argv: string[] = [];
  // Ask questions never; the worker owns the filesystem.
  argv.push("-y", "-hide_banner", "-nostdin");

  // ---- inputs ----------------------------------------------------------
  for (const [index, clip] of input.clips.entries()) {
    const { start, end } = normaliseTrim(clip, index);
    // BOTH trim options must come BEFORE -i, and this was a real bug rather than
    // a stylistic preference: an option emitted after -i belongs to the NEXT
    // input, not the one it appears to follow. So a clip's trim landed on the
    // clip after it, the first clip was never trimmed at all, and the last
    // clip's -to truncated the NARRATION. Measured on a real export: a plan whose
    // timelines said 12 seconds produced a 16-second MP4 whose audio stream was
    // 4 seconds long, with every caption sitting against the wrong footage.
    //
    // -t is the duration form and is unambiguous on the input side, which is what
    // the arithmetic below already computes.
    if (start !== null) argv.push("-ss", String(start));
    if (end !== null) argv.push("-t", String(end - (start ?? 0)));
    argv.push("-i", clip.src);
  }
  const clipCount = input.clips.length;

  if (input.music) argv.push("-i", input.music.src);
  if (input.voiceover) argv.push("-i", input.voiceover.src);
  if (input.logo) argv.push("-i", input.logo.src);

  const musicIndex = input.music ? clipCount : null;
  const voiceIndex = input.voiceover ? clipCount + (input.music ? 1 : 0) : null;
  // Last input, so adding the logo shifts no other index.
  const logoIndex = input.logo ? clipCount + (input.music ? 1 : 0) + (input.voiceover ? 1 : 0) : null;

  // ---- video chain -----------------------------------------------------
  const filters: string[] = [];
  for (let i = 0; i < clipCount; i++) {
    filters.push(`[${i}:v]${coverFitFilter(preset.width, preset.height)},fps=${OUTPUT_FPS},format=yuv420p,setsar=1[v${i}]`);
  }

  // Concatenate, cross-fading where a clip asked for one.
  //
  // `xfade` takes an absolute offset into the growing timeline, so the running
  // length is tracked as segments are appended. A dissolve that would overlap
  // more than the clips it joins is refused rather than emitted as a filter the
  // renderer would fail on minutes later.
  const clipLengths = input.clips.map((c, i) => clipLength(c, i));
  let videoLabel = "v0";
  let runningSeconds = clipLengths[0];
  for (let i = 1; i < clipCount; i++) {
    const transition = input.clips[i].transition;
    const out = i === clipCount - 1 ? "vout" : `vx${i}`;
    const wanted = transition && transition.type === "dissolve" ? transition.duration : 0;
    if (wanted > 0) {
      const limit = Math.min(runningSeconds, clipLengths[i]);
      if (wanted >= limit) {
        throw new Error(
          `clip ${i + 1}: a ${wanted}s dissolve is longer than the ${limit}s of footage it would overlap`,
        );
      }
      const offset = Math.max(0, runningSeconds - wanted);
      filters.push(`[${videoLabel}][v${i}]xfade=transition=fade:duration=${wanted}:offset=${offset}[${out}]`);
      runningSeconds = runningSeconds + clipLengths[i] - wanted;
    } else {
      filters.push(`[${videoLabel}][v${i}]concat=n=2:v=1:a=0[${out}]`);
      runningSeconds += clipLengths[i];
    }
    videoLabel = out;
  }
  if (clipCount === 1) {
    filters.push(`[v0]null[vout]`);
    videoLabel = "vout";
  }

  // ---- text overlays ---------------------------------------------------
  const font = input.fontFile ? escapeFilterPath(input.fontFile) : null;
  if (font) {
    const byRole = new Map(overlays.map((o) => [o.role, o]));
    const layout: Array<{ role: TextOverlay["role"]; y: string; size: number; color: string; box: string }> = [
      { role: "title", y: "h*0.30", size: Math.round(preset.height * 0.062), color: "white", box: "0x000000@0.0" },
      { role: "subhead", y: "h*0.40", size: Math.round(preset.height * 0.036), color: "white@0.92", box: "0x000000@0.0" },
      { role: "cta", y: "h*0.74", size: Math.round(preset.height * 0.040), color: "white", box: `${BRAND.purple}@0.92` },
      { role: "slogan", y: "h*0.90", size: Math.round(preset.height * 0.028), color: "white@0.85", box: "0x000000@0.0" },
    ];

    let label = videoLabel;
    let n = 0;
    for (const slot of layout) {
      const overlay = byRole.get(slot.role);
      if (!overlay || !overlay.text.trim()) continue;
      const next = `vt${n++}`;
      const enable = `enable='between(t,${overlay.startSeconds},${overlay.endSeconds})'`;
      const box = slot.box.endsWith("@0.0")
        ? ""
        : `:box=1:boxcolor=${slot.box}:boxborderw=${Math.round(preset.height * 0.018)}`;
      // Fitted per overlay, so one long headline cannot overflow the frame.
      const size = fitFontSize(overlay.text, slot.size, preset.width);
      filters.push(
        `[${label}]drawtext=fontfile='${font}':text='${escapeDrawtext(overlay.text)}'` +
          `:fontcolor=${slot.color}:fontsize=${size}:x=(w-text_w)/2:y=${slot.y}` +
          `${box}:${enable}[${next}]`,
      );
      label = next;
    }
    videoLabel = label;
  }

  // ---- the logo --------------------------------------------------------
  // Drawn after the captions so it is never hidden by a text box, and inset from
  // the corner so it clears the platform's own controls and safe areas.
  if (logoIndex !== null && input.logo) {
    const widthRatio = Math.min(0.5, Math.max(0.05, input.logo.widthRatio ?? 0.22));
    const marginRatio = Math.min(0.15, Math.max(0, input.logo.marginRatio ?? 0.06));
    const logoWidth = Math.max(24, Math.round(preset.width * widthRatio));
    const margin = Math.round(Math.min(preset.width, preset.height) * marginRatio);
    filters.push(`[${logoIndex}:v]scale=${logoWidth}:-1[lg]`);
    filters.push(`[${videoLabel}][lg]overlay=x=${margin}:y=${margin}:format=auto[lgout]`);
    videoLabel = "lgout";
  }

  filters.push(`[${videoLabel}]null[vfinal]`);
  videoLabel = "vfinal";

  // ---- audio chain -----------------------------------------------------
  // White noise in the source also disappears here: loudnorm normalises to a
  // target, and the limiter is what stops music clipping when it is mixed.
  const audioParts: string[] = [];
  if (input.keepSourceAudio && clipCount > 0) {
    // The source audio gets the same treatment as the music and the voiceover.
    // It did not at first, which meant a loud Veo clip could clip against the
    // limiter while the quieter beds were perfectly normalised.
    audioParts.push(
      `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=0.8,` +
        `loudnorm=I=-16:TP=-1.5:LRA=11[abase]`,
    );
  }
  if (musicIndex !== null) {
    const v = Math.min(1, Math.max(0, input.music!.volume));
    audioParts.push(
      `[${musicIndex}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${v},` +
        `loudnorm=I=-16:TP=-1.5:LRA=11[amusic]`,
    );
  }
  if (voiceIndex !== null) {
    const v = Math.min(1, Math.max(0, input.voiceover!.volume));
    audioParts.push(
      `[${voiceIndex}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${v},` +
        `loudnorm=I=-16:TP=-1.5:LRA=11[avo]`,
    );
  }

  const mixSources = [input.keepSourceAudio ? "[abase]" : null, musicIndex !== null ? "[amusic]" : null, voiceIndex !== null ? "[avo]" : null]
    .filter((s): s is string => s !== null);
  if (mixSources.length > 1) {
    audioParts.push(`${mixSources.join("")}amix=inputs=${mixSources.length}:duration=first:dropout_transition=0,alimiter=limit=0.95[aout]`);
  } else if (mixSources.length === 1) {
    audioParts.push(`${mixSources[0]}alimiter=limit=0.95[aout]`);
  }

  filters.push(...audioParts);

  const hasAudio = audioParts.length > 0;
  if (hasAudio) argv.push("-filter_complex", filters.join(";"));
  else argv.push("-filter_complex", filters.filter((f) => !f.includes("[abase]") && !f.includes("[amusic]")).join(";"));

  argv.push("-map", `[${videoLabel}]`);
  if (hasAudio) argv.push("-map", "[aout]");

  // ---- encode ----------------------------------------------------------
  argv.push(
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", String(input.crf ?? 20),
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-level", "4.1",
    "-r", String(OUTPUT_FPS),
  );
  if (hasAudio) argv.push("-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2");
  else argv.push("-an");

  argv.push(
    "-movflags", "+faststart",
    // Bounded so a stuck render cannot run forever.
    "-t", "60",
    input.outputPath,
  );

  const estimatedSeconds = input.clips.reduce((total, c) => {
    const start = Number(c.trimStart ?? 0) || 0;
    const end = Number(c.trimEnd);
    const length = Number.isFinite(end) ? end - start : 8;
    return total + Math.max(0, length);
  }, 0);

  return {
    argv,
    outputPath: input.outputPath,
    width: preset.width,
    height: preset.height,
    aspect: preset.aspect,
    estimatedSeconds: Math.round(estimatedSeconds * 100) / 100,
    inputCount: clipCount + (input.music ? 1 : 0) + (input.voiceover ? 1 : 0) + (input.logo ? 1 : 0),
  };
}

/** ffprobe arguments for validating a finished export. */
export function buildProbeArgs(path: string): string[] {
  return [
    "-v", "error",
    "-show_entries", "format=duration,size,format_name",
    "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
    "-of", "json",
    path,
  ];
}

export interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  channels?: number;
}

export interface ProbeResult {
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  bytes: number | null;
}

/**
 * Summarise ffprobe output into the handful of facts worth asserting on.
 *
 * Deliberately tolerant: ffprobe reports numbers as numbers in JSON mode but
 * durations as strings, and a missing field must read as "absent", not as zero.
 */
export function summariseProbe(body: unknown): ProbeResult {
  const root = (body as { format?: Record<string, unknown>; streams?: unknown }) ?? {};
  const streams = (Array.isArray(root.streams) ? root.streams : []) as ProbeStream[];
  const video = streams.find((s) => s.codec_type === "video");
  const duration = Number((root.format?.duration as string | undefined) ?? NaN);
  const bytes = Number((root.format?.size as string | undefined) ?? NaN);

  return {
    hasVideo: Boolean(video),
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    width: typeof video?.width === "number" ? video.width : null,
    height: typeof video?.height === "number" ? video.height : null,
    durationSeconds: Number.isFinite(duration) ? duration : null,
    bytes: Number.isFinite(bytes) ? bytes : null,
  };
}
