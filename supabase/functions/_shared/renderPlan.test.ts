// ============================================================================
// The render plan.
//
// The security test is the important one: the plan must be an ARGUMENT ARRAY
// with no shell in the path, so a caption full of shell metacharacters is inert.
// The rest pin the ffmpeg contract, because a filtergraph typo does not fail
// until minutes into a render.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  AD_PRESETS,
  BRAND,
  PRESET_IDS,
  buildProbeArgs,
  buildRenderPlan,
  coverFitFilter,
  escapeDrawtext,
  escapeFilterPath,
  fitFontSize,
  summariseProbe,
  type RenderPlanInput,
} from "./renderPlan";

const FONT = "C:/Windows/Fonts/arialbd.ttf";

const base = (over: Partial<RenderPlanInput> = {}): RenderPlanInput => ({
  presetId: "reels",
  clips: [{ src: "/work/clip1.mp4", trimStart: 0, trimEnd: 8, durationSeconds: 8 }],
  outputPath: "/work/out.mp4",
  fontFile: FONT,
  ...over,
});

const joined = (input: RenderPlanInput) => buildRenderPlan(input).argv.join(" ");

describe("the presets", () => {
  it("offers the four placements the brief names", () => {
    expect(PRESET_IDS.sort()).toEqual(["landscape", "reels", "shorts", "square"]);
  });

  it("uses the platforms' own upload dimensions", () => {
    expect(AD_PRESETS.reels).toMatchObject({ width: 1080, height: 1920, aspect: "9:16" });
    expect(AD_PRESETS.shorts).toMatchObject({ width: 1080, height: 1920, aspect: "9:16" });
    expect(AD_PRESETS.square).toMatchObject({ width: 1080, height: 1080, aspect: "1:1" });
    expect(AD_PRESETS.landscape).toMatchObject({ width: 1920, height: 1080, aspect: "16:9" });
  });

  it("carries the brand slogan, not a paraphrase of it", () => {
    expect(BRAND.slogan).toBe("Learn smarter. Train better. Perform better.");
  });

  it("refuses an unknown preset instead of guessing one", () => {
    expect(() => buildRenderPlan(base({ presetId: "billboard" }))).toThrow(/unknown preset/);
  });
});

describe("the plan is an argument array, never a shell command", () => {
  it("returns argv as an array with no shell in it", () => {
    const plan = buildRenderPlan(base());
    expect(Array.isArray(plan.argv)).toBe(true);
    expect(plan.argv.every((a) => typeof a === "string")).toBe(true);
    const flat = plan.argv.join(" ");
    for (const shell of ["sh -c", "bash", "cmd.exe", "powershell", "&&", "|", ">"]) {
      expect(flat).not.toContain(shell);
    }
  });

  it("keeps a hostile caption inside ONE argument, so it cannot become a command", () => {
    const hostile = "TRAIN; rm -rf / && $(whoami) | cat /etc/passwd";
    const plan = buildRenderPlan(base({ overlays: [{ role: "title", text: hostile, startSeconds: 0, endSeconds: 3 }] }));
    const withText = plan.argv.filter((a) => a.includes("drawtext"));
    expect(withText).toHaveLength(1);
    // The whole caption lives in a single argv entry.
    expect(withText[0]).toContain("rm -rf");
  });

  it("escapes the filtergraph metacharacters that would otherwise split the filter", () => {
    expect(escapeDrawtext("a:b")).toBe("a\\:b");
    expect(escapeDrawtext("it's")).toBe("it\\'s");
    expect(escapeDrawtext("50%")).toBe("50\\%");
    expect(escapeDrawtext("a,b;c")).toBe("a\\,b\\;c");
    expect(escapeDrawtext("[[x]]")).toBe("\\[\\[x\\]\\]");
    expect(escapeDrawtext("back\\slash")).toBe("back\\\\slash");
  });

  it("normalises a newline rather than dropping the text after it", () => {
    expect(escapeDrawtext("line one\nline two")).toBe("line one line two");
  });

  it("escapes a Windows drive letter in a filter path, which drawtext would misread as an option", () => {
    expect(escapeFilterPath("C:/Windows/Fonts/arial.ttf")).toBe("C\\:/Windows/Fonts/arial.ttf");
  });
});

describe("framing", () => {
  it("cover-fits so a landscape clip fills a vertical frame without distortion", () => {
    expect(coverFitFilter(1080, 1920)).toBe("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920");
  });

  it("scales the Veo source into a 9:16 frame in the plan", () => {
    expect(joined(base())).toContain("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920");
  });
});

describe("trimming and joining", () => {
  it("applies the trim window to the input it belongs to", () => {
    const argv = buildRenderPlan(base({ clips: [{ src: "a.mp4", trimStart: 2, trimEnd: 6 }] })).argv;
    const input = argv.indexOf("a.mp4");
    const seek = argv.indexOf("-ss");
    const length = argv.indexOf("-t");
    expect(argv[seek + 1]).toBe("2");
    expect(argv[length + 1]).toBe("4");
    // The bug that made a 12-second plan export as 16 seconds: these were emitted
    // after -i, so ffmpeg applied them to the NEXT input. A clip is trimmed by the
    // options that PRECEDE it.
    expect(seek).toBeLessThan(input);
    expect(length).toBeLessThan(input);
  });

  it("never lets one clip's trim fall on another input", () => {
    const argv = buildRenderPlan(
      base({
        clips: [
          { src: "a.mp4", trimStart: 0, trimEnd: 4 },
          { src: "b.mp4", trimStart: 0, trimEnd: 6 },
        ],
        voiceover: { src: "vo.mp3", volume: 1 },
      }),
    ).argv;

    // Each clip is trimmed, with its own length, by the options before it.
    const a = argv.indexOf("a.mp4");
    expect(argv.slice(a - 5, a + 1)).toEqual(["-ss", "0", "-t", "4", "-i", "a.mp4"]);
    const b = argv.indexOf("b.mp4");
    expect(argv.slice(b - 5, b + 1)).toEqual(["-ss", "0", "-t", "6", "-i", "b.mp4"]);

    // The voiceover input carries no trim at all: what precedes it is the end of
    // the previous clip. This is the exact failure that truncated the narration.
    const vo = argv.indexOf("vo.mp3");
    expect(argv[vo - 1]).toBe("-i");
    expect(argv[vo - 2]).toBe("b.mp4");

    // And nothing between the last input and the filtergraph tries to trim it.
    const between = argv.slice(argv.lastIndexOf("-i") + 1, argv.indexOf("-filter_complex"));
    expect(between.some((x) => x === "-ss" || x === "-t" || x === "-to")).toBe(false);
  });

  it("hard-cuts two clips together when no transition is asked for", () => {
    const plan = buildRenderPlan(base({ clips: [{ src: "a.mp4" }, { src: "b.mp4" }] }));
    expect(plan.argv.join(" ")).toContain("concat=n=2:v=1:a=0");
    expect(plan.inputCount).toBe(2);
  });

  it("cross-fades with an offset computed from the clips that came before it", () => {
    const plan = buildRenderPlan(
      base({
        clips: [
          { src: "a.mp4", durationSeconds: 8 },
          { src: "b.mp4", durationSeconds: 8, transition: { type: "dissolve", duration: 1 } },
        ],
      }),
    );
    const filter = plan.argv.join(" ");
    // 8s of footage followed by a 1s fade starting at 7s.
    expect(filter).toContain("xfade=transition=fade:duration=1:offset=7");
  });

  it("refuses a dissolve with no known clip length, rather than emitting a broken timeline", () => {
    expect(() =>
      buildRenderPlan(base({ clips: [{ src: "a.mp4" }, { src: "b.mp4", transition: { type: "dissolve", duration: 1 } }] })),
    ).toThrow(/durationSeconds is required/);
  });

  it("refuses a dissolve longer than the footage it would overlap", () => {
    expect(() =>
      buildRenderPlan(
        base({
          clips: [
            { src: "a.mp4", durationSeconds: 1 },
            { src: "b.mp4", durationSeconds: 1, transition: { type: "dissolve", duration: 5 } },
          ],
        }),
      ),
    ).toThrow(/longer than the 1s of footage/);
  });

  it("rejects an inverted trim window", () => {
    expect(() => buildRenderPlan(base({ clips: [{ src: "a.mp4", trimStart: 6, trimEnd: 2 }] }))).toThrow(
      /trimEnd must be greater than trimStart/,
    );
  });

  it("requires at least one clip and a destination", () => {
    expect(() => buildRenderPlan(base({ clips: [] }))).toThrow(/at least one clip/);
    expect(() => buildRenderPlan(base({ outputPath: "  " }))).toThrow(/outputPath is required/);
  });
});

describe("text and branding", () => {
  it("requires a font, because a silent drawtext failure is worse than an error", () => {
    expect(() =>
      buildRenderPlan(base({ fontFile: undefined, overlays: [{ role: "title", text: "x", startSeconds: 0, endSeconds: 1 }] })),
    ).toThrow(/fontFile is required/);
  });

  it("places each role in its own band and times it", () => {
    const filter = joined(
      base({
        overlays: [
          { role: "title", text: "TRAIN WITH INTENT", startSeconds: 0.5, endSeconds: 3.5 },
          { role: "cta", text: "Join the waitlist", startSeconds: 4, endSeconds: 7 },
        ],
      }),
    );
    expect(filter).toContain("drawtext");
    expect(filter).toContain("enable='between(t,0.5,3.5)'");
    expect(filter).toContain("enable='between(t,4,7)'");
  });

  it("gives the call to action a brand-purple box", () => {
    const filter = joined(base({ overlays: [{ role: "cta", text: "Start free", startSeconds: 4, endSeconds: 7 }] }));
    expect(filter).toContain(`box=1:boxcolor=${BRAND.purple}@0.92`);
    expect(filter).toContain(":boxborderw=");
  });

  it("gives a plain title no box, so it sits on the footage", () => {
    const filter = joined(
      base({ overlays: [{ role: "title", text: "TRAIN WITH INTENT", startSeconds: 0, endSeconds: 3 }] }),
    );
    expect(filter).toContain("drawtext");
    expect(filter).not.toContain("box=1");
  });

  it("shrinks a long headline instead of letting it run off both edges", () => {
    // A rendered ad clipped "TRAIN WITH INTENT" at 119px on a 1080 frame.
    const long = buildRenderPlan(
      base({ overlays: [{ role: "title", text: "TRAIN WITH INTENT EVERY SINGLE DAY", startSeconds: 0, endSeconds: 3 }] }),
    ).argv.join(" ");
    const at = Number(long.match(/fontsize=(\d+)/)![1]);
    expect(at).toBeLessThan(119);
    // Approximate check that the string now fits: 0.62 avg glyph advance.
    expect(at * 31 * 0.62).toBeLessThanOrEqual(1080 * 0.9);
  });

  it("keeps the designed size for a headline that already fits", () => {
    const short = buildRenderPlan(
      base({ overlays: [{ role: "title", text: "GO FASTER", startSeconds: 0, endSeconds: 3 }] }),
    ).argv.join(" ");
    expect(Number(short.match(/fontsize=(\d+)/)![1])).toBe(119);
  });

  it("never shrinks text below a legible floor", () => {
    expect(fitFontSize("x".repeat(400), 200, 1080)).toBe(24);
  });

  it("fits on the longest line when the text already wraps", () => {
    expect(fitFontSize("short\nthis line is much longer", 200, 1080)).toBeLessThan(200);
  });

  it("never returns zero or NaN for empty text", () => {
    expect(fitFontSize("", 100, 1080)).toBe(100);
    expect(Number.isFinite(fitFontSize("a", 100, 1080))).toBe(true);
  });

  it("draws the real logo artwork, scaled and inset instead of stretched to a corner", () => {
    const plan = buildRenderPlan(base({ logo: { src: "/work/logo.png" } }));
    const graph = plan.argv[plan.argv.indexOf("-filter_complex") + 1];
    expect(graph).toContain("scale=238:-1[lg]"); // 22% of 1080
    expect(graph).toContain("overlay=x=65:y=65"); // 6% of the shorter side
    expect(graph).toContain("[lgout]null[vfinal]");
  });

  it("keeps the logo's input index right when music and voiceover are present", () => {
    const plan = buildRenderPlan(
      base({
        clips: [{ src: "a.mp4" }, { src: "b.mp4" }],
        music: { src: "m.mp3", volume: 0.3 },
        voiceover: { src: "vo.mp3", volume: 1 },
        logo: { src: "/work/logo.png" },
      }),
    );
    expect(plan.inputCount).toBe(5);
    const inputs = plan.argv.filter((a, i) => plan.argv[i - 1] === "-i");
    expect(inputs).toEqual(["a.mp4", "b.mp4", "m.mp3", "vo.mp3", "/work/logo.png"]);
    // Index 4 is the logo: 2 clips + music + voiceover.
    expect(plan.argv[plan.argv.indexOf("-filter_complex") + 1]).toContain("[4:v]scale=");
  });

  it("adds no image input when there is no logo", () => {
    const plan = buildRenderPlan(base());
    expect(plan.inputCount).toBe(1);
    expect(plan.argv.join(" ")).not.toContain("[lg]");
  });

  it("holds the logo inside a sane band rather than letting a caller ask for a full-frame stamp", () => {
    const graph = (ratio: number) => {
      const p = buildRenderPlan(base({ logo: { src: "l.png", widthRatio: ratio, marginRatio: 4 } }));
      return p.argv[p.argv.indexOf("-filter_complex") + 1];
    };
    expect(graph(9)).toContain("scale=540:-1"); // clamped to half the width
    expect(graph(0)).toContain("scale=54:-1"); // clamped to a visible minimum
    expect(graph(0.22)).toContain("overlay=x=162:y=162"); // margin clamped to 15%
  });

  it("skips an overlay whose text is empty instead of rendering an empty box", () => {
    const filter = joined(base({ overlays: [{ role: "title", text: "   ", startSeconds: 0, endSeconds: 2 }] }));
    expect(filter).not.toContain("drawtext");
  });
});

describe("audio", () => {
  it("normalises and limits the source audio so it cannot clip", () => {
    const filter = joined(base({ keepSourceAudio: true }));
    expect(filter).toContain("loudnorm=I=-16:TP=-1.5:LRA=11");
    expect(filter).toContain("alimiter=limit=0.95");
  });

  it("mixes music and voiceover together", () => {
    const filter = joined(
      base({
        keepSourceAudio: true,
        music: { src: "m.mp3", volume: 0.3 },
        voiceover: { src: "v.wav", volume: 1 },
      }),
    );
    expect(filter).toContain("amix=inputs=3");
    expect(filter).toContain("volume=0.3");
  });

  it("clamps a volume above 1 rather than allowing it through", () => {
    const filter = joined(base({ music: { src: "m.mp3", volume: 9 } }));
    expect(filter).toContain("volume=1,");
  });

  it("drops the audio track entirely when there is no audio", () => {
    expect(buildRenderPlan(base()).argv).toContain("-an");
  });
});

describe("the encode is the compatible one", () => {
  it("uses H.264 High/yuv420p, AAC and a faststart MP4", () => {
    const argv = buildRenderPlan(base({ keepSourceAudio: true })).argv;
    expect(argv).toContain("libx264");
    expect(argv).toContain("yuv420p");
    expect(argv.join(" ")).toContain("+faststart");
    expect(argv).toContain("aac");
    expect(argv).toContain("128k");
    expect(argv[argv.length - 1]).toBe("/work/out.mp4");
  });

  it("bounds the render so a stuck job cannot run forever", () => {
    const argv = buildRenderPlan(base()).argv;
    // lastIndexOf: the output bound is the `-t` that follows the filtergraph.
    // Clip trims use `-t` too, but they sit before their own input.
    expect(argv[argv.lastIndexOf("-t") + 1]).toBe("60");
  });

  it("reports the frame size and an estimated length for the progress UI", () => {
    const plan = buildRenderPlan(base({ presetId: "shorts" }));
    expect(plan).toMatchObject({ width: 1080, height: 1920, aspect: "9:16" });
    expect(plan.estimatedSeconds).toBe(8);
  });
});

describe("validating the finished file", () => {
  it("asks ffprobe for the facts worth asserting on", () => {
    const args = buildProbeArgs("/work/out.mp4");
    expect(args).toContain("-show_entries");
    expect(args[args.length - 1]).toBe("/work/out.mp4");
  });

  it("summarises a real ffprobe body", () => {
    const result = summariseProbe({
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1080, height: 1920 },
        { codec_type: "audio", codec_name: "aac", channels: 2 },
      ],
      format: { duration: "8.033333", size: "2411234", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
    });
    expect(result).toEqual({
      hasVideo: true,
      hasAudio: true,
      width: 1080,
      height: 1920,
      durationSeconds: 8.033333,
      bytes: 2411234,
    });
  });

  it("reports an absent stream as absent, not as zero", () => {
    const result = summariseProbe({ streams: [{ codec_type: "video", width: 1080, height: 1080 }], format: {} });
    expect(result.hasAudio).toBe(false);
    expect(result.durationSeconds).toBeNull();
    expect(result.bytes).toBeNull();
  });

  it("does not throw on an empty or malformed body", () => {
    expect(() => summariseProbe({})).not.toThrow();
    expect(() => summariseProbe(undefined)).not.toThrow();
    expect(summariseProbe({}).hasVideo).toBe(false);
  });
});
