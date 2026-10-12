// ============================================================================
// FORM VIDEO — the limits and the upload path, in one place
// ----------------------------------------------------------------------------
// Video form analysis used to send the clip as base64 inside the function's
// JSON body. That is what made the cap six megabytes, and six megabytes of
// phone video is five to fifteen seconds: not enough to show an approach, a
// complete rep and a follow-through, which is the footage a technique review
// actually needs.
//
// So the clip no longer travels through the request body at all. It is uploaded
// to a PRIVATE Supabase Storage bucket under the athlete's own id, and the
// function is told the path. The function downloads it with the service role,
// sends it to the provider, and deletes it again — the app promises the video is
// not kept, and that promise has to hold on the failure path too.
//
// Why a single source: the client enforces these limits so the athlete is told
// before a 25 MB upload, and the edge function enforces them again because a
// client check is a convenience, not a control. An edge function cannot import
// from src/, so `supabase/functions/video-form-analysis/index.ts` restates the
// numbers; formVideo.test.ts pins this file's values, and the comment there
// points back here.
// ============================================================================

/** Private bucket the clip is uploaded to. Created by migration, owner-scoped. */
export const FORM_VIDEO_BUCKET = "form-videos";

/**
 * Longest clip accepted, in seconds. A minute fits several complete reps for
 * most movements and is the point at which the provider bill — which is per
 * second of video, not per request — stops being predictable.
 */
export const MAX_FORM_VIDEO_SECONDS = 60;

/** Largest clip accepted. Measured on the server from the bytes themselves. */
export const MAX_FORM_VIDEO_BYTES = 25 * 1024 * 1024;

/**
 * Containers the provider will read. Anything else is refused up front rather
 * than uploaded and rejected: an unsupported file is the athlete's bandwidth.
 */
export const FORM_VIDEO_MIME = ["video/mp4", "video/quicktime", "video/webm"] as const;
export type FormVideoMime = (typeof FORM_VIDEO_MIME)[number];

/**
 * A file whose length could not be read is still usable, but only while it is
 * small enough that it cannot plausibly be long: at phone bitrates 8 MiB is
 * well inside a minute. Above that, the honest answer is to ask for a trimmed
 * clip rather than to upload something whose cost nobody can predict.
 */
export const UNVERIFIED_DURATION_MAX_BYTES = 8 * 1024 * 1024;

const EXTENSION_FOR_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** Ids and random ids are path segments; anything else would be a traversal. */
const SAFE_SEGMENT = /^[A-Za-z0-9-]{1,64}$/;

export type FormVideoRejection =
  | "unsupported-type"
  | "empty"
  | "too-large"
  | "too-long"
  | "length-unknown";

/**
 * The verdict on one clip. `ok` is a plain boolean rather than a discriminated
 * union because this project compiles with `strict: false` and
 * `strictNullChecks: false`, under which TypeScript cannot narrow the union —
 * `check.message` on the false branch is a type error at the call sites that
 * matter most (the page's toast, the test's reason reader). Optional fields on
 * one shape narrow by hand and compile everywhere.
 */
export type FormVideoCheck = {
  ok: boolean;
  /** Why it was refused. Absent when `ok` is true. */
  reason?: FormVideoRejection;
  /** The sentence to show the athlete. Absent when `ok` is true. */
  message?: string;
};

/**
 * Object path for one clip: `<userId>/<randomId>.<ext>`.
 *
 * The extension comes from the MIME type, never from the file name, so a name
 * like `clip.php.mp4` cannot land in the bucket under an extension the provider
 * would refuse — and the path is always exactly one folder deep under the
 * athlete's own id, which is what the Storage policies and the function's
 * owner check both rely on.
 */
export function formVideoPath(userId: string, mimeType: string, randomId: string): string {
  if (!SAFE_SEGMENT.test(userId)) throw new Error("formVideoPath: unsafe user id");
  const id = SAFE_SEGMENT.test(randomId) ? randomId : crypto.randomUUID();
  const ext = EXTENSION_FOR_MIME[mimeType] ?? "mp4";
  return `${userId}/${id}.${ext}`;
}

/**
 * The one place the limits are turned into a decision and a sentence.
 *
 * `seconds` may be null when the browser could not read the clip's metadata —
 * that is a real case for some containers, so it is handled explicitly instead
 * of being treated as a failure or silently allowed.
 */
export function checkFormVideo(input: {
  mimeType?: string | null;
  bytes?: number | null;
  seconds?: number | null;
}): FormVideoCheck {
  const { mimeType, bytes, seconds } = input;

  if (!mimeType || !(FORM_VIDEO_MIME as readonly string[]).includes(mimeType)) {
    return { ok: false, reason: "unsupported-type", message: "Upload an MP4, MOV or WebM video." };
  }
  if (!bytes || bytes <= 0) {
    return { ok: false, reason: "empty", message: "That file is empty. Pick the clip again." };
  }
  if (bytes > MAX_FORM_VIDEO_BYTES) {
    return {
      ok: false,
      reason: "too-large",
      message: `Clips must be under ${Math.round(MAX_FORM_VIDEO_BYTES / (1024 * 1024))}MB. Trim it and try again.`,
    };
  }
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    if (seconds > MAX_FORM_VIDEO_SECONDS + 1) {
      return {
        ok: false,
        reason: "too-long",
        message: `Clips must be up to ${MAX_FORM_VIDEO_SECONDS} seconds (this one is ${Math.round(seconds)}s). Trim it and try again.`,
      };
    }
    return { ok: true };
  }

  if (bytes > UNVERIFIED_DURATION_MAX_BYTES) {
    return {
      ok: false,
      reason: "length-unknown",
      message: "We could not read this clip's length. Trim it to under a minute and try again.",
    };
  }
  return { ok: true };
}

/** The limits, as one line for the upload card. Kept here so the copy and the rules cannot drift. */
export const FORM_VIDEO_LIMITS_COPY =
  `MP4, MOV or WebM · up to ${MAX_FORM_VIDEO_SECONDS} seconds · under ` +
  `${Math.round(MAX_FORM_VIDEO_BYTES / (1024 * 1024))}MB · full body in frame, side-on works best.`;

/**
 * Read a clip's duration from its own metadata.
 *
 * Deliberately returns null instead of throwing: a container the browser cannot
 * probe is a supported case (checkFormVideo then falls back to the size rule),
 * and a failed probe must not block an analysis the athlete has already paid
 * for in waiting time.
 */
export function readVideoDuration(file: File): Promise<number | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(value);
    };
    el.preload = "metadata";
    el.muted = true;
    el.onloadedmetadata = () =>
      finish(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => finish(null);
    // Some containers report duration as Infinity until they are seeked; a
    // timeout keeps a probe that never settles from hanging the upload.
    window.setTimeout(() => finish(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null), 4000);
    el.src = url;
  });
}
