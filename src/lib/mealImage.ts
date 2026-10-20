// ============================================================================
// MEAL IMAGE — the photo a Calorie Scan sends, made reliable
// ----------------------------------------------------------------------------
// The scan used to read whatever the picker produced with readAsDataURL and
// send it straight to ai-analyze. Two things broke because of that, and they
// are the two failures athletes hit:
//
//  • A modern phone photo is 12MP and 3–6 MB — 4–8 MB as base64. The edge
//    function's guarded body cap is 10 MB, and a photo encoded for the wire
//    sits right against it, so the request dies in the relay before an image
//    is ever read. No resize, no second chance.
//  • An iPhone library photo is often HEIC. ai-analyze used to accept HEIC —
//    the vision provider cannot read it — so the request validated, spent a
//    credit, failed at the provider, and came back refunded as "AI analysis
//    failed". A format the scan cannot analyse is not a scan failure to hand
//    back as one.
//
// This module fixes both at the client edge, and it is the ONLY place the web
// upload path touches pixels:
//  1. validate the file type (the same allowlist the provider can read) and
//     size BEFORE anything else — an unsupported or oversized file is a clear
//     local message, never a charged server round trip;
//  2. decode with createImageBitmap, which honours the file's EXIF orientation
//     — the encoded result is upright, which is what the model and the preview
//     both want;
//  3. re-encode: longest edge ≤ MAX_EDGE px, JPEG at quality 0.85, stepping
//     down if the encoded result still approaches the server cap.
//
// What the caller gets back is a `data:image/jpeg;base64,…` — the exact shape
// ai-analyze expects, small enough (typically 100–400 KB) to ride the existing
// `supabase.functions.invoke` without any of the old payload problems. The
// native camera path (src/lib/camera.ts, the Kotlin plugin) already downsizes
// and encodes the same way; this module gives the web path the same guarantee.
//
// Where the browser cannot decode HEIC (Android Chrome, most desktop browsers),
// that is said plainly — the failed scan surface is a change the athlete can
// make (use Take Photo, which encodes JPEG), not a provider error.
// ============================================================================

/** The provider's own supported set — mirrored client-side so a request that reaches the server is one the provider can read. */
export const SUPPORTED_MEAL_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** Longest edge after the downscale. A 26cm plate read from 1600px carries every portion cue the prompt asks for. */
export const MAX_EDGE_PX = 1600;

/** A file bigger than this before decoding is not worth attempting — a photo never needs it and a document is not a photo. */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** How many bytes the ENCODED data URL may produce. Sits under the server's ~8MB decoded cap for every step down. */
export const MAX_OUTPUT_BYTES = 7 * 1024 * 1024;

const STEPS: { edge: number; quality: number }[] = [
  { edge: MAX_EDGE_PX, quality: 0.85 },
  { edge: MAX_EDGE_PX, quality: 0.7 },
  { edge: 1280, quality: 0.7 },
  { edge: 1024, quality: 0.6 },
];

/** The one error type the scan UI catches — a message the athlete can act on. */
export class MealImageError extends Error {
  /** True when the fix is "take the photo again with the camera button", not something generic. */
  readonly useCamera: boolean;
  constructor(message: string, opts: { useCamera?: boolean } = {}) {
    super(message);
    this.name = "MealImageError";
    this.useCamera = opts.useCamera ?? false;
  }
}

/**
 * The file's own MIME, trusted but never blank: pickers occasionally report
 * `""`, and `accept="image/*"` lets a mislabelled file through. A missing type
 * on an input the scan handed us is treated as JPEG (the overwhelmingly
 * probable real type), never as a pass-through.
 */
const inputMime = (file: Pick<File | Blob, "type">): string => file.type || "image/jpeg";

/**
 * Decode to pixels and return a re-encoded JPEG data URL.
 * Throws MealImageError with an athlete-readable message on every failure.
 * Never throws on an EMPTY preview — that is not a failure, the caller has a
 * retry; only on a file that cannot become a photo the server can analyse.
 */
export const normalizeMealImage = async (file: Blob): Promise<string> => {
  if (file.size <= 0) throw new MealImageError("That file is empty — choose a real photo.");
  if (file.size > MAX_INPUT_BYTES) {
    throw new MealImageError(
      `That photo is too large to scan (${Math.round(file.size / 1024 / 1024)} MB). Try a smaller one — the scan downsizes automatically, so a normal camera photo is fine.`,
    );
  }

  const mime = inputMime(file);
  if (!SUPPORTED_MEAL_IMAGE_TYPES.includes(mime)) {
    throw new MealImageError(
      "That isn't a photo file — scans accept JPEG, PNG, WebP or an iPhone HEIC photo.",
    );
  }

  const bitmap = await decodeImage(file);
  if (bitmap) {
    try {
      return await encode(bitmap, STEPS);
    } finally {
      bitmap.close();
    }
  }

  // Decode failed. HEIC has its own, actionable answer; everything else is
  // reported as a hard read — an image the browser cannot decode at all.
  if (mime.startsWith("image/heic") || mime.startsWith("image/heif")) {
    throw new MealImageError(
      "That photo is in HEIC format, which this browser can't decode. Use the Take Photo button instead — it saves a JPEG the scan can read.",
      { useCamera: true },
    );
  }
  throw new MealImageError(
    "Couldn't read that photo. Is the file a valid, uncorrupted image? Try a different one.",
  );
};

/** Decode a file into pixels. Returns null rather than throwing so the caller decides what the failure means. */
async function decodeImage(file: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  // `imageOrientation: "from-image"` bakes the EXIF rotation into the decoded
  // pixels, so the re-encode is upright regardless of which camera wrote the file.
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Older engines reject the options bag entirely; plain decode is still
    // worth one try (Safari, which is the interesting case for HEIC, has
    // honoured EXIF at decode since iOS 13 even without the option).
  }
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

/** Canvas-draw and encode at each step until one fits under the output cap. */
async function encode(bitmap: ImageBitmap, steps: { edge: number; quality: number }[]): Promise<string> {
  for (const step of steps) {
    const scale = Math.min(1, step.edge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", step.quality);
    // ~3 raw bytes per 4 base64 chars, exact enough for a cap check.
    if ((dataUrl.length * 3) / 4 <= MAX_OUTPUT_BYTES) return dataUrl;
  }
  throw new MealImageError(
    "That photo wouldn't compress small enough to scan. Try a photo with less detail in the background.",
  );
}
