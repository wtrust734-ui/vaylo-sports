import { describe, expect, it } from "vitest";
import { fitStoryboardToDuration, normaliseAdDuration, shotCountFor } from "./_shared/videoDuration.ts";
import { parseOmniInteraction } from "./_shared/omni.ts";
import type { StoryboardScene } from "./_shared/videoAd.ts";

const scene = (shot: number, durationSeconds: number): StoryboardScene => ({
  shot,
  startSeconds: (shot - 1) * durationSeconds,
  endSeconds: shot * durationSeconds,
  durationSeconds,
  visualDescription: `shot ${shot}`,
  cameraMovement: "push in",
  subjectAction: "athlete moves",
  environment: "track",
  onScreenText: [],
  voiceoverSegment: "",
  soundEffects: [],
  transition: "cut",
  source: "",
  sourceType: "veo",
  continuityKey: "vaylo-athlete",
});

describe("advert duration is not the per-clip clamp", () => {
  it("keeps a requested 15-second advert at 15 seconds", () => {
    expect(normaliseAdDuration(15)).toBe(15);
  });

  it("keeps the 6–60s bounds", () => {
    expect(normaliseAdDuration(2)).toBe(6);
    expect(normaliseAdDuration(90)).toBe(60);
    expect(normaliseAdDuration("30")).toBe(30);
    expect(normaliseAdDuration(undefined)).toBe(10);
  });

  it("asks for enough shots to cover the advert within the model's 10s cap", () => {
    expect(shotCountFor(6)).toBe(2);
    expect(shotCountFor(10)).toBe(3);
    expect(shotCountFor(15)).toBe(4);
    expect(shotCountFor(60)).toBe(6);
  });
});

describe("fitStoryboardToDuration", () => {
  it("re-times shots so they add up to the advert's length", () => {
    const fitted = fitStoryboardToDuration([scene(1, 3.33), scene(2, 3.33), scene(3, 3.34)], 15);
    expect(fitted).not.toBeNull();
    expect(fitted!.map((s) => s.durationSeconds)).toEqual([5, 5, 5]);
    expect(fitted!.map((s) => s.startSeconds)).toEqual([0, 5, 10]);
    expect(fitted!.at(-1)!.endSeconds).toBe(15);
  });

  it("refuses a scene count that cannot cover the length legally", () => {
    expect(fitStoryboardToDuration([scene(1, 20), scene(2, 20), scene(3, 20)], 60)).toBeNull();
    expect(fitStoryboardToDuration([], 15)).toBeNull();
  });
});

describe("parseOmniInteraction surfaces the provider's own error", () => {
  it("reads errors[] on a failed interaction", () => {
    const parsed = parseOmniInteraction({
      id: "v1_test",
      status: "failed",
      steps: [],
      errors: [{ code: "INVALID_ARGUMENT", message: "There was a problem processing your request." }],
    });
    expect(parsed.done).toBe(true);
    expect(parsed.videoBase64).toBeNull();
    expect(parsed.error).toContain("There was a problem processing your request.");
    expect(parsed.error).toContain("INVALID_ARGUMENT");
  });

  it("does not call a completed interaction with a video a failure", () => {
    const parsed = parseOmniInteraction({
      id: "v1_test",
      status: "completed",
      steps: [{ type: "model_output", content: [{ type: "video", data: "x".repeat(200), mime_type: "video/mp4" }] }],
    });
    expect(parsed.done).toBe(true);
    expect(parsed.error).toBeNull();
    expect(parsed.videoBase64).toHaveLength(200);
  });
});
