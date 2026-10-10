// ============================================================================
// The Veo contract.
//
// The shapes asserted here were copied from live API traffic, not from
// documentation: the start response, the completed operation, and the rejection
// an empty body produces. That matters because this project already shipped one
// provider payload that was wrong in three places with a green test suite.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  DEFAULT_VEO_DURATION,
  DEFAULT_VEO_MODEL,
  VEO_COST_PER_SECOND,
  VEO_DURATIONS,
  buildVeoRequest,
  describeVeoError,
  estimateVeoCostUsd,
  normaliseDuration,
  parseVeoOperation,
} from "./veo";

// Captured verbatim from the live API.
const LIVE_START = { name: "models/veo-3.1-fast-generate-preview/operations/hhu2gkbxao08" };
// The real poll body nests the payload under `response`, beside `done`. Writing
// this fixture flattened the first time — the parser was right and the test was
// wrong, which is exactly why the live shape is recorded verbatim here.
const LIVE_DONE = {
  name: "models/veo-3.1-fast-generate-preview/operations/hhu2gkbxao08",
  done: true,
  response: {
    "@type": "type.googleapis.com/google.ai.generativelanguage.v1beta.PredictLongRunningResponse",
    generateVideoResponse: {
      generatedSamples: [
        { video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/f8sugf0e4oh8:download?alt=media" } },
      ],
    },
  },
};
const LIVE_EMPTY_BODY_REJECTION = {
  error: { code: 400, message: "No instances in the request.", status: "INVALID_ARGUMENT" },
};

describe("building the generation request", () => {
  it("sends the prompt the way the API expects it", () => {
    const body = buildVeoRequest({ prompt: "  an athlete sprinting at night  " });
    expect(body.instances).toEqual([{ prompt: "an athlete sprinting at night" }]);
  });

  it("carries the parameters that change the output, and nothing else", () => {
    const body = buildVeoRequest({
      prompt: "x",
      aspectRatio: "9:16",
      resolution: "1080p",
      personGeneration: "allow_adult",
      negativePrompt: "no text",
      durationSeconds: 8,
    });
    expect(body.parameters).toEqual({
      durationSeconds: 8,
      aspectRatio: "9:16",
      resolution: "1080p",
      personGeneration: "allow_adult",
      negativePrompt: "no text",
    });
  });

  it("always states a duration, because the model needs one", () => {
    const body = buildVeoRequest({ prompt: "x" });
    expect((body.parameters as { durationSeconds: number }).durationSeconds).toBe(DEFAULT_VEO_DURATION);
  });

  it("refuses an empty prompt rather than spending money on it", () => {
    expect(() => buildVeoRequest({ prompt: "   " })).toThrow(/prompt is required/);
  });
});

describe("clip length is snapped to a length the model accepts", () => {
  it("leaves a supported length alone", () => {
    for (const seconds of VEO_DURATIONS) expect(normaliseDuration(seconds)).toBe(seconds);
  });

  it("rounds DOWN, so a request never costs more than it was quoted", () => {
    // 7s must become 6s, not 8s: rounding up would silently raise the price.
    expect(normaliseDuration(7)).toBe(6);
    expect(normaliseDuration(5)).toBe(4);
  });

  it("never returns a length below the shortest, or one that is not on the list", () => {
    expect(normaliseDuration(1)).toBe(VEO_DURATIONS[0]);
    expect(normaliseDuration(0)).toBe(VEO_DURATIONS[0]);
    expect(normaliseDuration(-5)).toBe(VEO_DURATIONS[0]);
  });

  it("falls back to the default for a value that is not a number", () => {
    expect(normaliseDuration(undefined)).toBe(DEFAULT_VEO_DURATION);
    expect(normaliseDuration("eight")).toBe(DEFAULT_VEO_DURATION);
    expect(normaliseDuration(NaN)).toBe(DEFAULT_VEO_DURATION);
  });
});

describe("the cost estimate", () => {
  it("prices each tier from its own published rate", () => {
    expect(estimateVeoCostUsd(DEFAULT_VEO_MODEL, 8)).toBeCloseTo(0.24, 5);
    expect(estimateVeoCostUsd("veo-3.1-fast-generate-preview", 8)).toBeCloseTo(1.2, 5);
    expect(estimateVeoCostUsd("veo-3.1-generate-preview", 8)).toBeCloseTo(3.2, 5);
  });

  it("scales with clip length", () => {
    expect(estimateVeoCostUsd("veo-3.1-fast-generate-preview", 4)).toBeCloseTo(0.6, 5);
  });

  it("does not treat a requested 4.1 tier as free just because it is unknown", () => {
    // The default tier absorbs an unrecognised id, so a model that does not
    // exist is still estimated at a real price rather than at $0.
    expect(estimateVeoCostUsd("veo-4.1-lite", 8)).toBe(VEO_COST_PER_SECOND[DEFAULT_VEO_MODEL] * 8);
    expect(estimateVeoCostUsd("veo-4.1-lite", 8)).toBeGreaterThan(0);
  });
});

describe("reading the operation", () => {
  it("reads the operation name out of a fresh start", () => {
    const op = parseVeoOperation(LIVE_START);
    expect(op.name).toBe("models/veo-3.1-fast-generate-preview/operations/hhu2gkbxao08");
    expect(op.done).toBe(false);
    expect(op.videoUri).toBeNull();
  });

  it("reads the video uri out of a completed operation", () => {
    const op = parseVeoOperation(LIVE_DONE);
    expect(op.done).toBe(true);
    expect(op.videoUri).toBe("https://generativelanguage.googleapis.com/v1beta/files/f8sugf0e4oh8:download?alt=media");
    expect(op.error).toBeNull();
  });

  it("treats a running poll as still running, not as a failure", () => {
    const op = parseVeoOperation({ name: "models/x/operations/1", metadata: { state: "pending" } });
    expect(op.done).toBe(false);
    expect(op.error).toBeNull();
    expect(op.state).toBe("pending");
  });

  it("surfaces the provider's own rejection message", () => {
    const op = parseVeoOperation(LIVE_EMPTY_BODY_REJECTION);
    expect(op.error).toBe("No instances in the request.");
    expect(op.done).toBe(true);
    expect(op.videoUri).toBeNull();
  });

  it("reports a finish with no video instead of pretending it worked", () => {
    const op = parseVeoOperation({ name: "models/x/operations/1", done: true, response: {} });
    expect(op.videoUri).toBeNull();
    expect(op.error).toMatch(/without returning a video/);
  });

  it("degrades into 'running' on an unexpected body rather than throwing", () => {
    expect(() => parseVeoOperation(undefined)).not.toThrow();
    expect(parseVeoOperation({}).done).toBe(false);
    expect(parseVeoOperation("nonsense").done).toBe(false);
  });
});

describe("provider failures map to a fix", () => {
  it("separates a bad key from a project that cannot use video", () => {
    expect(describeVeoError(401).code).toBe("credentials_rejected");
    expect(describeVeoError(403, "billing not enabled").code).toBe("billing_or_access");
    expect(describeVeoError(403, "billing not enabled").error).toMatch(/billing/i);
  });

  it("names the clip lengths when the request is rejected", () => {
    expect(describeVeoError(400).error).toMatch(/4, 6 or 8 seconds/);
  });

  it("keeps a rate limit a rate limit", () => {
    expect(describeVeoError(429).status).toBe(429);
  });

  it("never leaks the raw provider body", () => {
    const secretish = 'key=AIzaSyLEAKED{"prompt":"internal"}';
    expect(describeVeoError(500, secretish).error).not.toContain("AIzaSyLEAKED");
  });
});
