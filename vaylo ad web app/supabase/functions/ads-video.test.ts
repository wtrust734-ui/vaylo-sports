import { describe, expect, it } from "vitest";
import { buildStoryboardPrompt, buildScenePrompt, buildImageToVideoPrompt, validateCaptionSpecs, BRAND_NEGATIVE_PROMPT } from "./_shared/videoPrompt.ts";
import { estimateVideoCost, StoryboardScene, VideoConcept, CaptionSpec, videoConceptToPlan } from "./_shared/videoAd.ts";

const BRAND_CONCEPT: VideoConcept = {
  objective: "waitlist sign-ups",
  audience: "athletes 18-30",
  angle: "measured, premium",
  hook: "track your real progress",
  message: "smarter training decisions",
  product: "Vaylo Sports",
  narrativeStructure: "short hook to proof to CTA",
  sceneSequence: "hook, key moment, proof, CTA",
  voiceover: "Most athletes track everything except the one thing that matters: what to do next.",
  onScreenText: ["Train smarter"],
  audioDirection: "minimal, brand-safe ambience only",
  callToAction: "Join the waitlist",
  durationSeconds: 8,
  placement: "reels",
  appeal: "for athletes who measure results",
};

const STORYBOARD_3_SHOTS: StoryboardScene[] = [
  {
    shot: 1,
    startSeconds: 0,
    endSeconds: 3,
    durationSeconds: 3,
    visualDescription: "athlete on track at blue hour, low angle",
    cameraMovement: "low tracking follow",
    subjectAction: "sprinting the opening 100m",
    environment: "blue-hour track",
    onScreenText: ["Train smarter"],
    voiceoverSegment: "Most athletes track everything except the one thing that matters: what to do next.",
    soundEffects: ["distant footsteps"],
    transition: "cut",
    source: "",
    sourceType: "veo",
    continuityKey: "track-bluehour-runner",
  },
  {
    shot: 2,
    startSeconds: 3,
    endSeconds: 5,
    durationSeconds: 2,
    visualDescription: "close-up of runner's face, focused",
    cameraMovement: "slow push in",
    subjectAction: "eyes fixed ahead",
    environment: "track lane foreground",
    onScreenText: [],
    voiceoverSegment: "Vaylo turns that data into the next run.",
    soundEffects: [],
    transition: "cut",
    source: "",
    sourceType: "veo",
    continuityKey: "track-bluehour-runner",
  },
  {
    shot: 3,
    startSeconds: 5,
    endSeconds: 8,
    durationSeconds: 3,
    visualDescription: "runner stopping and checking a phone screen negative space",
    cameraMovement: "handheld cut",
    subjectAction: "glances at watch, nods",
    environment: "track finish",
    onScreenText: [],
    voiceoverSegment: "Train smarter.",
    soundEffects: [],
    transition: "none",
    source: "",
    sourceType: "veo",
    continuityKey: "track-bluehour-runner",
  },
];

describe("videoPrompt", () => {
  it("buildStoryboardPrompt returns a JSON task with the right scene count", () => {
    const prompt = buildStoryboardPrompt(BRAND_CONCEPT, { name: "Vaylo Sports", positioning: "premium sports tech" }, 3);
    const parsed = JSON.parse(prompt);
    expect(parsed.task).toContain("production-ready storyboard");
    expect(parsed.scenes).toHaveLength(3);
    expect(typeof parsed.scenes[0].continuityKey).toBe("string");
    expect(parsed.constraints.length).toBeGreaterThan(0);
  });

  it("buildScenePrompt keeps the visual and camera direction and forbids overlays", () => {
    const scene = STORYBOARD_3_SHOTS[0];
    const prompt = buildScenePrompt(scene, { positioning: "premium sports tech" });
    expect(prompt).toContain("low tracking follow");
    expect(prompt).toContain("athlete on track at blue hour");
    expect(prompt.toLowerCase()).toContain("never add text, captions, logos");
  });

  it("buildImageToVideoPrompt preserves the still subject and adds the motion only", () => {
    const scene = STORYBOARD_3_SHOTS[1];
    const prompt = buildImageToVideoPrompt(scene, "a runner at blue hour on a track, low angle", { positioning: "premium sports tech" });
    expect(prompt).toContain("slow push in");
    expect(prompt).toContain("a runner at blue hour on a track, low angle");
    expect(prompt).toContain("do not invent a new scene");
    expect(prompt.toLowerCase()).toContain("no text, captions, logos");
  });

  it("BRAND_NEGATIVE_PROMPT lists the forbidden overlay terms", () => {
    const terms = BRAND_NEGATIVE_PROMPT.split(", ");
    expect(terms).toContain("text overlays");
    expect(terms).toContain("captions");
    expect(terms).toContain("logos");
    expect(terms).toContain("invented brand names");
  });

  it("validateCaptionSpecs rejects malformed, over-long, out-of-bounds and inverted captions", () => {
    const specs: CaptionSpec[] = [
      { startSeconds: 0, endSeconds: 3, text: "ok" },
      { startSeconds: 5, endSeconds: 3, text: "inverted" },
      { startSeconds: -1, endSeconds: 2, text: "negative start" },
      { startSeconds: 7, endSeconds: 9, text: "past end (8s)" },
      { startSeconds: 0, endSeconds: 2, text: "This caption is longer than twelve words and should be rejected by the validator." },
    ];
    const problems = validateCaptionSpecs(specs, 8);
    expect(problems.length).toBeGreaterThanOrEqual(4);
    expect(problems.some((p) => p.includes("start not less than end"))).toBe(true);
    expect(problems.some((p) => p.includes("negative start"))).toBe(true);
    expect(problems.some((p) => p.includes("exceeds the advert's"))).toBe(true);
    expect(problems.some((p) => p.includes("longer than 12 words"))).toBe(true);
  });
});

describe("estimateVideoCost", () => {
  it("counts Veo shots, Veo seconds, voiceover characters and produces a non-zero total", () => {
    const story: Parameters<typeof estimateVideoCost>[0] = [
      { durationSeconds: 3, voiceoverSegment: "", sourceType: "veo" },
      { durationSeconds: 2, voiceoverSegment: "", sourceType: "image_to_veo" },
      { durationSeconds: 1, voiceoverSegment: "", sourceType: "app_footage" },
    ];
    const estimate = estimateVideoCost(story, { modelId: "eleven_flash_v2_5", text: "Join the waitlist" });
    expect(estimate.veoShots).toBe(2);
    expect(estimate.veoSeconds).toBeGreaterThanOrEqual(6);
    expect(estimate.voiceoverCharacters).toBe(17);
    expect(estimate.totalUsd).toBeGreaterThan(0);
    expect(estimate.notes.length).toBe(0);
  });

  it("flags long narrations that may not fit", () => {
    const longText = "x".repeat(2500);
    const story: Parameters<typeof estimateVideoCost>[0] = [
      { durationSeconds: 4, voiceoverSegment: "", sourceType: "veo" },
    ];
    const estimate = estimateVideoCost(story, { modelId: "eleven_flash_v2_5", text: longText });
    expect(estimate.voiceoverCharacters).toBeGreaterThanOrEqual(2500);
    expect(estimate.notes.some((n) => n.includes("long"))).toBe(true);
  });

  it("returns null voiceover cost when there is no narration", () => {
    const story: Parameters<typeof estimateVideoCost>[0] = [
      { durationSeconds: 4, voiceoverSegment: "", sourceType: "veo" },
    ];
    const estimate = estimateVideoCost(story, { modelId: "eleven_flash_v2_5", text: "" });
    expect(estimate.voiceoverCostUsd).toBeNull();
  });

  it("multiplies the cheaper ElevenLabs tier cost by character count", () => {
    const story: Parameters<typeof estimateVideoCost>[0] = [
      { durationSeconds: 4, voiceoverSegment: "", sourceType: "veo" },
    ];
    const estimateFlash = estimateVideoCost(story, { modelId: "eleven_flash_v2_5", text: "Run the opening hook" });
    const estimateMultilingual = estimateVideoCost(story, { modelId: "eleven_multilingual_v2", text: "Run the opening hook" });
    expect(estimateFlash.voiceoverCostUsd).toBeLessThan(estimateMultilingual.voiceoverCostUsd as number);
  });
});

describe("videoConceptToPlan", () => {
  const underTest = videoConceptToPlan;
  const COMPLETE_STORYBOARD: StoryboardScene[] = STORYBOARD_3_SHOTS.map((scene, i) => ({
    ...scene,
    source: `/renders/shot-${i + 1}.mp4`,
  }));

  it("bridges a complete video concept into a render plan request", () => {
    const result = underTest({
      concept: BRAND_CONCEPT,
      presetId: "reels",
      storyboard: COMPLETE_STORYBOARD,
      script: { voiceover: BRAND_CONCEPT.voiceover, captions: [] },
      narrationPath: "/renders/narration.mp3",
      fontFile: "/fonts/Inter-SemiBold.ttf",
      outputPath: "/tmp/renders/test.mp4",
    });
    expect(result.ok).toBe(true);
    expect(result.totalSeconds).toBe(8);
    expect(result.timeline).toHaveLength(3);
    expect(result.request).not.toBeNull();
    expect(result.request?.clips).toHaveLength(3);
    expect(result.request?.voiceover?.src).toBe("/renders/narration.mp3");
    expect(result.plan).not.toBeNull();
    expect(result.notes.some((n) => /no music bed/i.test(n))).toBe(true);
    expect(result.missing.length).toBe(0);
    expect(Array.isArray(result.captionSpecs)).toBe(true);
  });

  it("reports a missing shot asset instead of inventing one", () => {
    const storyWithMissingSource: StoryboardScene[] = [
      {
        ...STORYBOARD_3_SHOTS[0],
        source: "",
      },
    ];
    const result = underTest({
      concept: BRAND_CONCEPT,
      presetId: "reels",
      storyboard: storyWithMissingSource,
      script: { voiceover: BRAND_CONCEPT.voiceover, captions: [] },
      narrationPath: "/renders/narration.mp3",
      fontFile: "/fonts/Inter-SemiBold.ttf",
      outputPath: "/tmp/renders/test.mp4",
    });
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBeGreaterThanOrEqual(1);
  });

  it("returns problems when a storyboard shot length adds up to zero", () => {
    const zeroLengthStory: StoryboardScene[] = [
      {
        ...STORYBOARD_3_SHOTS[0],
        durationSeconds: 0,
      },
    ];
    const result = underTest({
      concept: BRAND_CONCEPT,
      presetId: "reels",
      storyboard: zeroLengthStory,
      script: { voiceover: BRAND_CONCEPT.voiceover, captions: [] },
      outputPath: "/tmp/renders/test.mp4",
    });
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => /zero seconds/i.test(p))).toBe(true);
  });
});
