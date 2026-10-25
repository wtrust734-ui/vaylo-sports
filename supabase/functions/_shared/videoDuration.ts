// ============================================================================
// videoDuration — advert length vs. one generated clip.
// ----------------------------------------------------------------------------
// These bounds are different things and used to be conflated:
//   • the ADVERT is 6–60 seconds (the athlete's choice);
//   • one generated CLIP is 3–10 seconds (the model's own output range).
// Using the clip clamp for the advert silently turned every 15s request into a
// 10s spot. Pure functions only, so the rule is unit-testable.
// ============================================================================

import type { StoryboardScene } from "./videoAd.ts";

export const MIN_AD_SECONDS = 6;
export const MAX_AD_SECONDS = 60;
export const MIN_SHOT_SECONDS = 3;
export const MAX_SHOT_SECONDS = 10;

export function normaliseAdDuration(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.min(MAX_AD_SECONDS, Math.max(MIN_AD_SECONDS, Math.round(n)));
}

/**
 * How many shots an advert of this length needs: about four seconds each, never
 * more than six, and never so few that a shot would exceed the model's 10s cap.
 */
export function shotCountFor(durationSeconds: number): number {
  const target = normaliseAdDuration(durationSeconds);
  const ideal = Math.ceil(target / 4);
  const minimum = Math.ceil(target / MAX_SHOT_SECONDS);
  return Math.min(6, Math.max(1, minimum, ideal));
}

/**
 * Re-time a storyboard so its shots add up exactly to the advert's length, with
 * every shot inside the provider's 3–10s range. Returns null when the scene
 * count cannot cover the length within that range (the caller then falls back
 * to the deterministic planner) — a 60s advert cannot be three 20s clips.
 */
export function fitStoryboardToDuration(scenes: StoryboardScene[], durationSeconds: number): StoryboardScene[] | null {
  const target = normaliseAdDuration(durationSeconds);
  if (scenes.length === 0) return null;
  const per = target / scenes.length;
  if (per > MAX_SHOT_SECONDS || per < MIN_SHOT_SECONDS) return null;
  let cursor = 0;
  return scenes.map((scene, index) => {
    const isLast = index === scenes.length - 1;
    const duration = isLast ? Math.round((target - cursor) * 100) / 100 : Math.round(per * 100) / 100;
    const start = Math.round(cursor * 100) / 100;
    cursor += duration;
    return {
      ...scene,
      shot: index + 1,
      startSeconds: start,
      endSeconds: Math.round((start + duration) * 100) / 100,
      durationSeconds: duration,
    };
  });
}
