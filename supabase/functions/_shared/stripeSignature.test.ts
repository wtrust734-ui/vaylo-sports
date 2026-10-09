// ============================================================================
// stripe-signature — verified against frozen vectors
// ----------------------------------------------------------------------------
// The two digests below were computed OUTSIDE this repository, with OpenSSL's
// HMAC-SHA256 (node:crypto), from the secret, timestamp and body written next to
// them. That matters: a test that computed the expected signature by calling the
// same helper it is testing would pass even if the helper's HMAC construction
// were wrong in a way that made every real webhook fail — and the failure would
// only appear as Stripe quietly retrying a delivery nobody was reading.
//
//   node -e 'console.log(require("crypto").createHmac("sha256", SECRET)
//     .update(TIMESTAMP + "." + BODY).digest("hex"))'
//
// The replay window is exercised with an injected `now`, so the test does not
// depend on the clock and will not start failing in 2027.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  constantTimeEquals,
  hmacSha256Hex,
  parseStripeSignatureHeader,
  verifyStripeSignature,
} from "./stripeSignature.ts";

const SECRET = "whsec_test_secret_vaylo";
const TIMESTAMP = 1728300000;
const BODY = '{"id":"evt_test_1","type":"checkout.session.completed"}';
const DIGEST = "5fe86e483881dea7b34c5da0568f4fa92f5ca88fe3b64c272c80f08101e25c2a";

const header = (t: number, ...signatures: string[]) =>
  [`t=${t}`, ...signatures.map((s) => `v1=${s}`)].join(",");

describe("the HMAC construction", () => {
  it("matches OpenSSL for a known secret, timestamp and body", async () => {
    expect(await hmacSha256Hex(SECRET, `${TIMESTAMP}.${BODY}`)).toBe(DIGEST);
  });

  it("canonicalises through hex, in lowercase", async () => {
    const hex = await hmacSha256Hex(SECRET, "anything");
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifying a delivery", () => {
  it("accepts a correctly signed webhook", async () => {
    const verdict = await verifyStripeSignature({
      header: header(TIMESTAMP, DIGEST),
      payload: BODY,
      secret: SECRET,
      now: TIMESTAMP,
    });
    expect(verdict).toEqual({ ok: true });
  });

  it("accepts the second of two signatures, so a secret rotation is survived", async () => {
    // Stripe sends both the old and new signature while a secret is rotated.
    // Rejecting on the first line alone would take the endpoint down mid-rotation.
    const verdict = await verifyStripeSignature({
      header: header(TIMESTAMP, "0".repeat(64), DIGEST),
      payload: BODY,
      secret: SECRET,
      now: TIMESTAMP,
    });
    expect(verdict.ok).toBe(true);
  });

  it("rejects a signature made with a different secret", async () => {
    const vendor = "e8a73c49e20127ff76779987e36b39baa64963093399470c958676ba16cfdea2";
    const verdict = await verifyStripeSignature({
      header: header(TIMESTAMP, vendor),
      payload: BODY,
      secret: SECRET,
      now: TIMESTAMP,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining("does not match") });
  });

  it("rejects a body that was altered after signing", async () => {
    // The reason the raw body is hashed and never a re-serialised parse: this
    // exact string is one byte different and must fail.
    const verdict = await verifyStripeSignature({
      header: header(TIMESTAMP, DIGEST),
      payload: '{"id":"evt_test_1","type":"checkout.session.completed","amount":1}',
      secret: SECRET,
      now: TIMESTAMP,
    });
    expect(verdict.ok).toBe(false);
  });

  it("rejects a replay outside the freshness window", async () => {
    const stale = await verifyStripeSignature({
      header: header(TIMESTAMP, DIGEST),
      payload: BODY,
      secret: SECRET,
      now: TIMESTAMP + 301,
    });
    expect(stale.ok).toBe(false);

    // And accepts the same delivery one second earlier, so the window is a
    // boundary rather than "anything not right now".
    const inside = await verifyStripeSignature({
      header: header(TIMESTAMP, DIGEST),
      payload: BODY,
      secret: SECRET,
      now: TIMESTAMP + 299,
    });
    expect(inside.ok).toBe(true);
  });

  it("rejects a tolerable timestamp with a wrong signature", async () => {
    const verdict = await verifyStripeSignature({
      header: header(TIMESTAMP, "a".repeat(64)),
      payload: BODY,
      secret: SECRET,
      now: TIMESTAMP,
    });
    expect(verdict.ok).toBe(false);
  });

  it("rejects the absences and the malformed", async () => {
    const base = { payload: BODY, secret: SECRET, now: TIMESTAMP };
    expect((await verifyStripeSignature({ ...base, header: null })).ok).toBe(false);
    expect((await verifyStripeSignature({ ...base, header: "" })).ok).toBe(false);
    expect((await verifyStripeSignature({ ...base, header: "v1=abc" })).ok).toBe(false);
    expect((await verifyStripeSignature({ ...base, header: "t=1728300000" })).ok).toBe(false);
    expect((await verifyStripeSignature({ ...base, header: header(TIMESTAMP, DIGEST), secret: "" })).ok).toBe(
      false,
    );
  });
});

describe("reading the header", () => {
  it("ignores schemes it does not know", () => {
    // Stripe has added versions before. An unknown field must not become a
    // rejected delivery.
    const parsed = parseStripeSignatureHeader("t=1728300000,v0=deadbeef,v1=ABCD,weird");
    expect(parsed.timestamp).toBe(1728300000);
    expect(parsed.signatures).toEqual(["abcd"]);
  });

  it("refuses a timestamp that is not a usable number", () => {
    // `Number("")` is 0 and `Number("now")` is NaN. Both would be worse than no
    // timestamp: 0 fails every freshness check, NaN passes all of them.
    expect(parseStripeSignatureHeader("t=now,v1=abcd").timestamp).toBeNull();
    expect(parseStripeSignatureHeader("t=,v1=abcd").timestamp).toBeNull();
    expect(parseStripeSignatureHeader("t=0,v1=abcd").timestamp).toBeNull();
    expect(parseStripeSignatureHeader(null).signatures).toEqual([]);
  });

  it("tolerates the whitespace a proxy may introduce", () => {
    const parsed = parseStripeSignatureHeader(" t=1728300000 , v1=abcd ");
    expect(parsed.timestamp).toBe(1728300000);
    expect(parsed.signatures).toEqual(["abcd"]);
  });
});

describe("the comparison", () => {
  it("is true only for identical, non-empty strings", () => {
    expect(constantTimeEquals("abcd", "abcd")).toBe(true);
    expect(constantTimeEquals("abcd", "abce")).toBe(false);
    expect(constantTimeEquals("abcd", "abc")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(false);
  });
});
