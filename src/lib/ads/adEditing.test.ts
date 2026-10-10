// ============================================================================
// The conversational editing pipeline, under test.
//
// Each block below is one of the acceptance tests from the brief, written as an
// executable check against the real engine rather than described in prose. The
// tests that matter most are the "and nothing else moved" assertions: the brief
// asks for edits that do not disturb unrelated elements, and that is exactly
// the kind of promise that quietly stops being true without a test.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  findLogo,
  findText,
  isImageAd,
  isVideoAd,
  newImageAd,
  newVideoAd,
  visibleFingerprint,
  videoDuration,
  __resetIds,
  type ImageAdDocument,
  type VideoAdDocument,
} from "./adDocument";
import { applyOps, type AdOp } from "./adOps";
import {
  beforeAfter,
  canRedo,
  canUndo,
  commit,
  createStore,
  currentDoc,
  currentRevision,
  duplicate,
  lineage,
  recordFailure,
  redo,
  restore,
  undo,
  __resetRevisionIds,
  type RevisionStore,
} from "./adRevisions";
import { checkForbiddenClaims, guardInterpretation, interpret, parseSeconds, type AdAsset } from "./adInterpreter";

const reset = () => {
  __resetIds();
  __resetRevisionIds();
};

const imageAd = () =>
  newImageAd({
    headline: "Train smarter",
    subhead: "Structured sessions for every sport",
    cta: "Join the waitlist",
  });

/** Run one instruction end to end, exactly as the UI would. */
function run(store: RevisionStore, instruction: string, assets?: AdAsset[]) {
  const doc = currentDoc(store);
  const result = guardInterpretation(interpret(instruction, { doc, assets }));
  if (result.kind !== "ops") return { store, result, ops: [] as AdOp[] };
  const applied = applyOps(doc, result.ops);
  return {
    store: commit(store, applied.doc, instruction, applied.summary, applied.skipped.map((s) => s.reason)),
    result,
    ops: result.ops,
  };
}

// ---------------------------------------------------------------------------
// Test A — darker background, then change only the headline
// ---------------------------------------------------------------------------

describe("Test A: generate an image ad, darken the background, then change only the headline", () => {
  it("darkens the background without touching the copy", () => {
    reset();
    const before = imageAd();
    const step = run(createStore(before), "Make the background darker and more premium.");

    const after = currentDoc(step.store) as ImageAdDocument;
    expect(after.background.tone).toBeGreaterThan(before.background.tone);
    expect(after.background.vignette).toBeGreaterThan(before.background.vignette);

    // The headline is the point: darkening must not have disturbed it.
    expect(findText(after, "headline")?.text).toBe("Train smarter");
    expect(step.result).toMatchObject({ kind: "ops" });
  });

  it("then changes the headline while preserving the darker background", () => {
    reset();
    let store = createStore(imageAd());
    store = run(store, "Make the background darker and more premium.").store;
    const toneAfterDarkening = (currentDoc(store) as ImageAdDocument).background.tone;

    store = run(store, "Change the headline to 'Train Smarter. Perform Better.'").store;
    const doc = currentDoc(store) as ImageAdDocument;

    expect(findText(doc, "headline")?.text).toBe("Train Smarter. Perform Better.");
    // The previous accepted change survived the next one.
    expect(doc.background.tone).toBe(toneAfterDarkening);
    // And the edit was surgical: everything except the headline text is identical.
    const before = findText(imageAd(), "headline");
    const afterLayer = findText(doc, "headline");
    expect(afterLayer?.fontSize).toBe(before?.fontSize);
    expect(afterLayer?.x).toBe(before?.x);
    expect(findText(doc, "subhead")?.text).toBe("Structured sessions for every sport");
    expect(findLogo(doc)?.scale).toBe(findLogo(imageAd())?.scale);
  });
});

// ---------------------------------------------------------------------------
// Nothing else moves
// ---------------------------------------------------------------------------

describe("edits do not disturb unrelated elements", () => {
  it("makes the logo bigger and changes nothing else at all", () => {
    reset();
    const before = imageAd();
    const { doc } = applyOps(before, [{ op: "nudgeLogoScale", delta: 0.05 }]);
    const after = doc as ImageAdDocument;

    expect(findLogo(after)?.scale).toBeCloseTo((findLogo(before)?.scale ?? 0) + 0.05, 4);

    // Compare everything that is not the logo.
    const strip = (d: ImageAdDocument) => ({
      ...visibleFingerprint(d),
      layers: (visibleFingerprint(d).layers as Array<Record<string, unknown>>).filter((l) => l.id !== "logo"),
    });
    expect(strip(after)).toEqual(strip(before));
  });

  it("never mutates the document it was given", () => {
    reset();
    const before = imageAd();
    const snapshot = JSON.stringify(before);

    applyOps(before, [
      { op: "setText", role: "headline", text: "Something else" },
      { op: "nudgeLogoScale", delta: 0.1 },
      { op: "setAspect", aspect: "1:1" },
    ]);

    // The input document is byte-identical after being edited. This is what
    // makes every earlier revision in history trustworthy.
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("refuses an empty string rather than blanking the headline", () => {
    reset();
    const { doc, skipped } = applyOps(imageAd(), [{ op: "setText", role: "headline", text: "   " }]);
    expect(findText(doc, "headline")?.text).toBe("Train smarter");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/empty/);
  });

  it("reports an op it cannot apply instead of silently claiming success", () => {
    reset();
    const { applied, skipped } = applyOps(imageAd(), [{ op: "trimEnd", seconds: 5 }]);
    expect(applied).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/video/);
  });
});

// ---------------------------------------------------------------------------
// Test B — video: trim the end, add captions, move the CTA
// ---------------------------------------------------------------------------

describe("Test B: trim the final five seconds, add captions and move the CTA to the end", () => {
  const videoAd = () =>
    newVideoAd({
      clips: [
        { src: "a.mp4", label: "Sport", out: 6 },
        { src: "b.mp4", label: "App demo", out: 6, screenRecording: true },
        { src: "c.mp4", label: "The score", out: 6 },
      ],
      cta: "Join the waitlist",
    });

  it("removes exactly five seconds from the end of the cut", () => {
    reset();
    const before = videoAd();
    expect(videoDuration(before)).toBe(18);

    const { doc } = applyOps(before, [{ op: "trimEnd", seconds: 5 }]);
    expect(videoDuration(doc as VideoAdDocument)).toBeCloseTo(13, 3);
  });

  it("drops a clip entirely when the trim is longer than that clip", () => {
    reset();
    const { doc } = applyOps(videoAd(), [{ op: "trimEnd", seconds: 7 }]);
    const video = doc as VideoAdDocument;
    expect(video.clips).toHaveLength(2);
    expect(videoDuration(video)).toBeCloseTo(11, 3);
  });

  it("adds captions timed to the cut, then moves the CTA to the end card", () => {
    reset();
    let doc = videoAd() as VideoAdDocument;
    doc = applyOps(doc, [{ op: "addCaptionsFromClips" }]).doc as VideoAdDocument;

    expect(doc.captions).toHaveLength(3);
    expect(doc.captions[0]).toMatchObject({ text: "Sport", start: 0, end: 6 });
    expect(doc.captions[2].end).toBeCloseTo(18, 3);

    const moved = applyOps(doc, [{ op: "moveText", role: "cta", to: "bottom" }]).doc as VideoAdDocument;
    expect(moved.cta.y).toBeGreaterThan(0.8);
    // Captions survived the CTA move.
    expect(moved.captions).toHaveLength(3);
  });

  it("re-derives captions after a trim so they cannot drift out of sync", () => {
    reset();
    const trimmed = applyOps(videoAd(), [{ op: "trimEnd", seconds: 5 }]).doc as VideoAdDocument;
    const captioned = applyOps(trimmed, [{ op: "addCaptionsFromClips" }]).doc as VideoAdDocument;
    expect(captioned.captions[captioned.captions.length - 1].end).toBeCloseTo(13, 3);
  });

  it("re-timing the cut shortens the rendered timeline", () => {
    reset();
    const { doc } = applyOps(videoAd(), [{ op: "nudgePace", delta: 0.2 }]);
    expect(videoDuration(doc as VideoAdDocument)).toBeLessThan(18);
  });
});

// ---------------------------------------------------------------------------
// Test C — replace one clip with uploaded footage
// ---------------------------------------------------------------------------

describe("Test C: replace a specific clip with uploaded footage", () => {
  const uploads: AdAsset[] = [
    { id: "upload-1.png", label: "Poster", kind: "image" },
    { id: "recording-1.mp4", label: "Screen recording", kind: "video", screenRecording: true },
  ];

  const videoAd = () =>
    newVideoAd({
      clips: [
        { src: "a.mp4", label: "Sport", out: 4 },
        { src: "b.mp4", label: "App demo", out: 4 },
        { src: "c.mp4", label: "The score", out: 4 },
      ],
    });

  it("swaps only the named clip and leaves the rest of the cut untouched", () => {
    reset();
    const before = videoAd();
    const result = guardInterpretation(
      interpret("Replace clip 2 with the screen recording I uploaded", { doc: before, assets: uploads }),
    );
    expect(result.kind).toBe("ops");

    const { doc } = applyOps(before, (result as { ops: AdOp[] }).ops);
    const after = doc as VideoAdDocument;

    expect(after.clips[1].src).toBe("recording-1.mp4");
    expect(after.clips[1].screenRecording).toBe(true);
    // The other clips are structurally identical — this is the whole requirement.
    expect(after.clips[0]).toEqual(before.clips[0]);
    expect(after.clips[2]).toEqual(before.clips[2]);
    // Length preserved: a replacement should not silently change the runtime.
    expect(videoDuration(after)).toBeCloseTo(videoDuration(before), 3);
  });

  it("asks which footage when nothing has been uploaded, instead of guessing", () => {
    reset();
    const result = interpret("Replace this footage with the screen recording I uploaded", {
      doc: videoAd(),
      assets: [],
    });
    expect(result.kind).toBe("clarify");
    expect((result as { question: string }).question).toMatch(/footage/i);
  });
});

// ---------------------------------------------------------------------------
// Test D — three successive edits all persist
// ---------------------------------------------------------------------------

describe("Test D: three successive edits all persist", () => {
  it("keeps every accepted change", () => {
    reset();
    let store = createStore(imageAd());

    store = run(store, "Make the background darker.").store;
    store = run(store, "Make the headline bigger.").store;
    store = run(store, "Make the Vaylo logo bigger.").store;

    const doc = currentDoc(store) as ImageAdDocument;
    expect(doc.background.tone).toBeGreaterThan(0);
    expect(findText(doc, "headline")?.fontSize).toBeGreaterThan(0.085);
    expect(findLogo(doc)?.scale).toBeGreaterThan(0.14);
    expect(lineage(store)).toHaveLength(4);
  });

  it("does not revert an earlier change when a later one is made", () => {
    reset();
    let store = createStore(imageAd());
    store = run(store, "Make the background darker.").store;
    store = run(store, "Now make the headline bigger.").store;

    const doc = currentDoc(store) as ImageAdDocument;
    // "Now ..." must not be read as a fresh asset request that resets the背景.
    expect(doc.background.tone).toBeGreaterThan(0);
    expect(findText(doc, "headline")?.fontSize).toBeGreaterThan(0.085);
  });
});

// ---------------------------------------------------------------------------
// Test E — undo and restore
// ---------------------------------------------------------------------------

describe("Test E: undo an edit and restore a previous version", () => {
  it("undoes the last change and redoes it exactly", () => {
    reset();
    let store = createStore(imageAd());
    store = run(store, "Make the background darker.").store;
    const afterFirstDoc = JSON.stringify(currentDoc(store));

    store = run(store, "Make the headline bigger.").store;
    expect(canUndo(store)).toBe(true);

    const undone = undo(store);
    expect(JSON.stringify(currentDoc(undone))).toBe(afterFirstDoc);

    const redone = redo(undone);
    expect(JSON.stringify(currentDoc(redone))).toBe(JSON.stringify(currentDoc(store)));
  });

  it("undoes one change while keeping the others", () => {
    reset();
    let store = createStore(imageAd());
    store = run(store, "Make the background darker.").store;
    const darkTone = (currentDoc(store) as ImageAdDocument).background.tone;
    store = run(store, "Make the headline bigger.").store;
    store = run(store, "Make the Vaylo logo bigger.").store;

    store = undo(store); // undo the logo
    const doc = currentDoc(store) as ImageAdDocument;
    expect(findLogo(doc)?.scale).toBe(0.14);
    expect(findText(doc, "headline")?.fontSize).toBeGreaterThan(0.085);
    expect(doc.background.tone).toBe(darkTone);
  });

  it("restores any revision from history", () => {
    reset();
    let store = createStore(imageAd());
    const firstId = currentRevision(store).id;
    store = run(store, "Make the background darker.").store;
    store = run(store, "Change the headline to 'Perform better'").store;

    store = restore(store, firstId);
    const doc = currentDoc(store) as ImageAdDocument;
    expect(doc.background.tone).toBe(0);
    expect(findText(doc, "headline")?.text).toBe("Train smarter");

    // Restoring is not a dead end: redo steps forward again.
    expect(canRedo(store)).toBe(true);
  });

  it("does not move at the root", () => {
    reset();
    const store = createStore(imageAd());
    expect(canUndo(store)).toBe(false);
    expect(undo(store).headId).toBe(store.headId);
  });
});

// ---------------------------------------------------------------------------
// Test F — a failed call must not cost the last working asset
// ---------------------------------------------------------------------------

describe("Test F: a failed provider call leaves the last working asset available", () => {
  it("keeps the head and the asset intact when an edit fails", () => {
    reset();
    let store = createStore(imageAd());
    store = run(store, "Make the background darker.").store;
    const goodDoc = JSON.stringify(currentDoc(store));
    const goodHead = store.headId;

    store = recordFailure(store, "Regenerate the whole image in a cinematic style", "provider returned 502");

    expect(store.headId).toBe(goodHead);
    expect(JSON.stringify(currentDoc(store))).toBe(goodDoc);
    expect(store.failures).toHaveLength(1);
    expect(store.failures[0].error).toMatch(/502/);
    // A failure is not a revision, so it cannot be undone into existence.
    expect(lineage(store)).toHaveLength(2);
  });

  it("still allows editing after a failure", () => {
    reset();
    let store = recordFailure(createStore(imageAd()), "x", "boom");
    store = run(store, "Make the headline bigger.").store;
    expect((currentDoc(store) as ImageAdDocument).layers.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Versioning: duplicate and before/after
// ---------------------------------------------------------------------------

describe("versions can be duplicated and compared", () => {
  it("duplicates the current version without overwriting it", () => {
    reset();
    let store = createStore(imageAd());
    store = run(store, "Make the background darker.").store;
    const toneBefore = (currentDoc(store) as ImageAdDocument).background.tone;

    store = duplicate(store);
    store = run(store, "Change the headline to 'A different direction'").store;

    const doc = currentDoc(store) as ImageAdDocument;
    expect(findText(doc, "headline")?.text).toBe("A different direction");
    // The duplicated-from version still exists, one undo away, unharmed.
    const parent = undo(store);
    expect((currentDoc(parent) as ImageAdDocument).background.tone).toBe(toneBefore);
    expect(findText(currentDoc(parent) as ImageAdDocument, "headline")?.text).toBe("Train smarter");
  });

  it("offers the before/after pair for the last accepted edit", () => {
    reset();
    let store = createStore(imageAd());
    store = run(store, "Make the background darker.").store;
    const { before, after } = beforeAfter(store);
    expect(before).not.toBeNull();
    expect((before as ImageAdDocument).background.tone).toBe(0);
    expect((after as ImageAdDocument).background.tone).toBeGreaterThan(0);
  });

  it("has no before-image on the very first revision", () => {
    reset();
    expect(beforeAfter(createStore(imageAd())).before).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The interpreter itself
// ---------------------------------------------------------------------------

describe("the interpreter maps the brief's example instructions", () => {
  const ctx = { doc: imageAd() };
  const videoCtx = {
    doc: newVideoAd({ clips: [{ src: "a.mp4", label: "Sport", out: 8 }, { src: "b.mp4", label: "Demo", out: 8 }] }),
  };

  it("reads plain numbers and number words as seconds", () => {
    expect(parseSeconds("remove the last five seconds")).toBe(5);
    expect(parseSeconds("trim 7s from the end")).toBe(7);
    expect(parseSeconds("cut the final 12.5 seconds")).toBe(12.5);
    expect(parseSeconds("make it premium")).toBeNull();
  });

  // Each case names the document it is meant for. Inferring the context from
  // the wording was the bug in the first draft of this test: a caption
  // instruction was being sent to an image ad and then read as a failure.
  const cases: Array<{ says: string; target: "image" | "video"; op: string; expected: Record<string, unknown> }> = [
    { says: "Make the background darker and more premium.", target: "image", op: "nudgeBackground", expected: { toneDelta: 0.18 } },
    { says: "Change the headline to 'Train Smarter. Perform Better.'", target: "image", op: "setText", expected: { role: "headline", text: "Train Smarter. Perform Better." } },
    { says: "Make the Vaylo logo bigger.", target: "image", op: "nudgeLogoScale", expected: { delta: 0.05 } },
    { says: "Use more purple and less blue.", target: "image", op: "setPalette", expected: { accent: "#8505D5" } },
    { says: "Remove the last five seconds.", target: "video", op: "trimEnd", expected: { seconds: 5 } },
    { says: "Add captions and make them easier to read.", target: "video", op: "addCaptionsFromClips", expected: {} },
    { says: "Make this version suitable for TikTok and Instagram Reels.", target: "image", op: "setAspect", expected: { aspect: "9:16" } },
    { says: "Keep everything the same, but change the headline to 'Train Smarter.'", target: "image", op: "setText", expected: { role: "headline", text: "Train Smarter." } },
    { says: "Move the call to action to the end.", target: "video", op: "moveText", expected: { role: "cta", to: "bottom" } },
  ];

  for (const { says, target, op, expected } of cases) {
    it(`“${says}” → ${op}`, () => {
      const result = interpret(says, target === "video" ? videoCtx : ctx);
      expect(result.kind).toBe("ops");
      const ops = (result as { ops: AdOp[] }).ops;
      const match = ops.find((o) => o.op === op);
      expect(match, `expected ${op} in ${JSON.stringify(ops)}`).toBeDefined();
      expect(match).toMatchObject(expected);
    });
  }

  it("asks what the headline should say rather than blanking or guessing", () => {
    // The brief gives this exact sentence with no replacement value. The honest
    // answer is one short question, not a no-op dressed up as success.
    const result = interpret("Keep everything the same, but change the headline.", ctx);
    expect(result.kind).toBe("clarify");
    expect((result as { question: string }).question).toMatch(/what should the headline say/i);
  });

  it("does not turn 'move the CTA to the end' into CTA copy reading 'the end'", () => {
    const result = interpret("Move the call to action to the end.", videoCtx);
    const ops = (result as { ops: AdOp[] }).ops;
    expect(ops.some((o) => o.op === "setText")).toBe(false);
  });

  it("treats undo as a control, not an edit", () => {
    const result = interpret("Undo the last change.", ctx);
    expect(result).toMatchObject({ kind: "control", control: "undo" });
  });

  it("plans a punch-in for a more attention-grabbing opening", () => {
    const result = interpret("Make the opening three seconds more attention-grabbing.", videoCtx);
    const ops = (result as { ops: AdOp[] }).ops;
    expect(ops).toContainEqual({ op: "setClipTransition", index: 0, transition: { type: "punchIn", duration: 0.18 } });
  });

  it("plans faster pacing without touching the copy", () => {
    const result = interpret("Make the video feel faster and more competitive.", videoCtx);
    const ops = (result as { ops: AdOp[] }).ops;
    expect(ops).toContainEqual({ op: "nudgePace", delta: 0.15 });
    expect(ops.some((o) => o.op === "setText")).toBe(false);
  });

  it("admits when it cannot map an instruction", () => {
    const result = interpret("Make it look like a film noir poster from the 1940s", ctx);
    expect(result.kind).toBe("needsProvider");
  });
});

// ---------------------------------------------------------------------------
// Brand-claim guard
// ---------------------------------------------------------------------------

describe("the brand-claim guard", () => {
  it("blocks claims the ad slate forbids", () => {
    for (const bad of [
      "AI-powered coaching",
      "Only £4.99 per month",
      "Guaranteed performance improvements",
      "Predict injuries before they happen",
      "Clinically proven to boost VPR",
      "92% of athletes improved",
    ]) {
      expect(checkForbiddenClaims(bad).blocked, bad).toBe(true);
    }
  });

  it("allows the claim the brand actually stands on", () => {
    expect(checkForbiddenClaims("VPR is calculated on your device, from the metrics you log.").blocked).toBe(false);
  });

  it("refuses to write a forbidden claim into the ad, and explains why", () => {
    const result = guardInterpretation(interpret("Change the headline to 'AI-powered coaching'", { doc: imageAd() }));
    expect(result.kind).toBe("clarify");
    expect((result as { question: string }).question).toMatch(/brand's advertising rules/);
    expect((result as { reply: string }).reply).toMatch(/will not add/);
  });
});

// ---------------------------------------------------------------------------
// Format targeting
// ---------------------------------------------------------------------------

describe("format targeting", () => {
  it("knows a video ad is not an image ad", () => {
    reset();
    expect(isVideoAd(newVideoAd({ clips: [] }))).toBe(true);
    expect(isImageAd(imageAd())).toBe(true);
  });

  it("reformats for a named placement", () => {
    reset();
    const { doc } = applyOps(imageAd(), [{ op: "setAspect", aspect: "4:5" }]);
    expect(doc.aspect).toBe("4:5");
    // Resizing must not reflow the copy — that is a separate, explicit edit.
    expect(visibleFingerprint(doc).layers).toEqual(visibleFingerprint(imageAd()).layers);
  });
});
