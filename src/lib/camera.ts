// ============================================================================
// CAMERA
// ----------------------------------------------------------------------------
// Photo capture was the single most web-like thing left in the app: every
// capture button drove a hidden `<input type="file" capture>`, which on Android
// opens a thin system file picker — a separate app, a different visual
// language, no in-app control over the result, and no way to report progress
// while a multi-megabyte photo is being read.
//
// Inside the Capacitor shell this module drives `@capacitor/camera`, which uses
// the real `ACTION_IMAGE_CAPTURE` intent on the device. On the web it is not
// used at all: the caller keeps its own file input, because there the browser's
// file picker *is* the native control.
//
// The result is normalised to the shape the callers already use — a base64
// data URL for the edge function and an object URL for the preview — so the
// upload paths in FormAnalysis / Nutrition do not change when capture moves.
// ============================================================================

import { isNative, loadPlugin } from "@/lib/platform";

/** What the caller gets back, whichever path produced it. */
export interface CapturedPhoto {
  /** `data:image/jpeg;base64,…` — what ai-analyze expects in `image_base64`. */
  base64: string;
  /** Object URL for an <img> preview. Caller owns revoking it. */
  previewUrl: string;
  mimeType: string;
}

type CameraResultType = "uri" | "base64" | "dataUrl";

/**
 * The JS face of CameraCapturePlugin.kt. Not an npm package — see the Kotlin
 * file for why `@capacitor/camera` was not used (it needs the Kotlin 2.2
 * compiler; this project pins 1.9.24).
 */
interface CameraPlugin {
  capture: () => Promise<{ dataUrl?: string; mimeType?: string; bytes?: number; cancelled?: boolean }>;
  pick: () => Promise<{ dataUrl?: string; mimeType?: string; bytes?: number; cancelled?: boolean }>;
}

let cameraPlugin: CameraPlugin | null | undefined;

/**
 * Resolves the plugin once. `undefined` means "not tried yet", `null` means
 * "tried and unavailable", so a missing plugin costs one attempt rather than a
 * failed dynamic import per capture.
 */
async function getCamera(): Promise<CameraPlugin | null> {
  if (cameraPlugin !== undefined) return cameraPlugin;
  cameraPlugin = await loadPlugin<CameraPlugin>("VayloCamera");
  return cameraPlugin;
}

/**
 * True when the device can take a photo through the native camera rather than
 * the browser file input. Callers use this to label the button correctly —
 * "Take Photo" vs "Choose Photo" — which is the difference between an app and
 * a web page with a camera permission prompt.
 */
export const hasNativeCamera = (): boolean => isNative() && cameraPlugin !== null;

/**
 * Takes a photo with the device camera.
 *
 * Resolves `null` when there is no native camera, when the athlete cancels, or
 * when the capture fails — a cancelled camera must not be an error toast, so
 * the caller treats `null` as "nothing happened".
 */
export async function capturePhoto(): Promise<CapturedPhoto | null> {
  const camera = await getCamera();
  if (!camera) return null;
  try {
    return normalise(await camera.capture());
  } catch {
    return null;
  }
}

/**
 * Picks an existing photo. Native: the real system photo picker. Never used on
 * the web — there the file input is already the right control.
 */
export async function pickPhoto(): Promise<CapturedPhoto | null> {
  const camera = await getCamera();
  if (!camera) return null;
  try {
    return normalise(await camera.pick());
  } catch {
    return null;
  }
}

/**
 * The Kotlin side already downsizes, rotates and encodes, so all that arrives
 * here is a data URL. The preview is the same string — there is no second blob
 * to allocate, and a data URL needs no revoking.
 */
function normalise(result: {
  dataUrl?: string;
  mimeType?: string;
  bytes?: number;
  cancelled?: boolean;
}): CapturedPhoto | null {
  if (!result?.dataUrl) return null;
  const mimeType = result.mimeType ?? "image/jpeg";
  return {
    base64: result.dataUrl,
    previewUrl: result.dataUrl,
    mimeType,
  };
}
