import { describe, it, expect } from "vitest";

import {
  FORM_VIDEO_BUCKET,
  FORM_VIDEO_LENGTH_LABEL,
  FORM_VIDEO_MIME,
  MAX_FORM_VIDEO_BYTES,
  MAX_FORM_VIDEO_SECONDS,
  UNVERIFIED_DURATION_MAX_BYTES,
  checkFormVideo,
  formVideoPath,
  type FormVideoCheck,
} from "./formVideo";

// ============================================================================
// The form-video gate, pinned at its boundaries.
//
// The caps here are enforced twice — once in the page so the athlete is told
// before a long upload, once in `video-form-analysis` because a client check is
// a convenience rather than a control — and the numbers live in two files that
// cannot import from each other. These cases are the record of what "at the
// limit" means, so a later change to one side is a failing test rather than a
// clip that uploads and is then refused by the server.
// ============================================================================

const MB = 1024 * 1024;

/** The rejection reason, or null when the clip passed. Keeps the union honest. */
const reasonOf = (check: FormVideoCheck) => (check.ok ? null : check.reason);

describe("formVideoPath", () => {
  it("keeps the clip inside the athlete's own folder", () => {
    const path = formVideoPath("user-123", "video/mp4", "abc-999");
    expect(path).toBe("user-123/abc-999.mp4");
    expect(path.split("/")).toHaveLength(2);
    expect(path.startsWith("user-123/")).toBe(true);
  });

  it("takes the extension from the MIME type, never from the file name", () => {
    expect(formVideoPath("user-123", "video/quicktime", "id1").endsWith(".mov")).toBe(true);
    expect(formVideoPath("user-123", "video/webm", "id2").endsWith(".webm")).toBe(true);
    // An unknown container still gets a path, and the validator is what refuses
    // it — the path builder must never be the thing that decides policy.
    expect(formVideoPath("user-123", "video/avi", "id3").endsWith(".mp4")).toBe(true);
  });

  it("replaces a path-traversing id instead of writing it", () => {
    const path = formVideoPath("user-123", "video/mp4", "../../etc/passwd");
    expect(path.includes("..")).toBe(false);
    expect(path.split("/")[0]).toBe("user-123");
    expect(path.split("/")).toHaveLength(2);
  });

  it("refuses an unsafe user id rather than building a path from it", () => {
    // A user id that is not a single safe segment could only be a bug or a
    // forgery upstream; writing under it would put the object outside the
    // folder the Storage policies and the function's owner check both assume.
    expect(() => formVideoPath("../other-user", "video/mp4", "id")).toThrow();
    expect(() => formVideoPath("", "video/mp4", "id")).toThrow();
    expect(() => formVideoPath("a/b", "video/mp4", "id")).toThrow();
  });
});

describe("checkFormVideo", () => {
  const clip = (over: Partial<Parameters<typeof checkFormVideo>[0]> = {}) => ({
    mimeType: "video/mp4",
    bytes: 4 * MB,
    seconds: 20,
    ...over,
  });

  it("accepts an ordinary clip", () => {
    expect(checkFormVideo(clip()).ok).toBe(true);
  });

  it("accepts a clip exactly at both caps", () => {
    const atLimits = checkFormVideo({
      mimeType: "video/mp4",
      bytes: MAX_FORM_VIDEO_BYTES,
      seconds: MAX_FORM_VIDEO_SECONDS,
    });
    expect(atLimits.ok).toBe(true);
  });

  it("allows a second of grace on duration, because metadata is not exact", () => {
    // Browsers round a container's duration, and a clip the athlete trimmed to
    // exactly the limit should not be refused for arithmetic.
    expect(checkFormVideo(clip({ seconds: MAX_FORM_VIDEO_SECONDS + 1 })).ok).toBe(true);
    expect(checkFormVideo(clip({ seconds: MAX_FORM_VIDEO_SECONDS + 5 }))).toEqual({
      ok: false,
      reason: "too-long",
      // The refusal quotes the cap the way the upload card words it, from the
      // same constant, so the two cannot drift apart.
      message: expect.stringContaining(FORM_VIDEO_LENGTH_LABEL),
    });
  });

  it("refuses a clip over the size cap", () => {
    // Derived from the constant rather than written out, so raising the cap
    // cannot leave this case asserting an obsolete number in the copy.
    expect(checkFormVideo(clip({ bytes: MAX_FORM_VIDEO_BYTES + 1 }))).toEqual({
      ok: false,
      reason: "too-large",
      message: expect.stringContaining(`${Math.round(MAX_FORM_VIDEO_BYTES / (1024 * 1024))}MB`),
    });
  });

  it("refuses an unsupported container and an empty file", () => {
    expect(reasonOf(checkFormVideo(clip({ mimeType: "video/avi" })))).toBe("unsupported-type");
    expect(reasonOf(checkFormVideo(clip({ mimeType: null })))).toBe("unsupported-type");
    expect(reasonOf(checkFormVideo(clip({ bytes: 0 })))).toBe("empty");
    expect(reasonOf(checkFormVideo(clip({ bytes: null })))).toBe("empty");
  });

  it("accepts an unreadable duration only while the file is small enough to be short", () => {
    // Unknown length is a real case, not a failure: some containers will not
    // report it. Below the fallback size the clip cannot plausibly be long, so
    // it is allowed; above it, the honest answer is to ask for a trimmed clip
    // rather than upload a cost nobody can predict.
    expect(
      checkFormVideo({ mimeType: "video/mp4", bytes: UNVERIFIED_DURATION_MAX_BYTES, seconds: null }).ok,
    ).toBe(true);
    expect(
      checkFormVideo({ mimeType: "video/mp4", bytes: UNVERIFIED_DURATION_MAX_BYTES + 1, seconds: null }),
    ).toEqual({
      ok: false,
      reason: "length-unknown",
      message: expect.stringContaining("Trim it to a shorter clip"),
    });
  });

  it("treats a non-finite duration as unknown rather than as zero", () => {
    // Infinity is what a container reports before it has been seeked. Read as a
    // number it would sail past every comparison, so it has to fall into the
    // unknown-length rule — which here means the size fallback decides.
    const big = { mimeType: "video/mp4", bytes: UNVERIFIED_DURATION_MAX_BYTES + 1 };
    expect(reasonOf(checkFormVideo({ ...big, seconds: Number.POSITIVE_INFINITY }))).toBe("length-unknown");
    expect(reasonOf(checkFormVideo({ ...big, seconds: Number.NaN }))).toBe("length-unknown");
    // ...and the same unknown length on a small file is allowed, because it
    // cannot plausibly be long.
    expect(checkFormVideo({ ...big, bytes: 4 * MB, seconds: Number.NaN }).ok).toBe(true);
  });

  it("keeps the accepted containers and a private bucket", () => {
    expect(FORM_VIDEO_MIME).toEqual(["video/mp4", "video/quicktime", "video/webm"]);
    expect(FORM_VIDEO_BUCKET).toBe("form-videos");
  });
});
