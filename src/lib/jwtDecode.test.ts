// ============================================================================
// DECODING A JWT SEGMENT WITHOUT THE BASE64URL TRAP
// ----------------------------------------------------------------------------
// The bug this guards: `JSON.parse(atob(token.split(".")[1]))` is wrong, because
// a JWT segment is base64URL — `-` and `_` stand in for `+` and `/`, and there
// is no padding. `atob` rejects all three, so the decode throws for a large
// fraction of real tokens. In delete-account that throw became 403
// reauth_required (deletion, a published capability, refusing for no visible
// reason); in export-my-data it was swallowed, so a bulk PII export lost its
// freshness check entirely.
//
// So the first thing these tests prove is that the case is real: the segments
// below CONTAIN the characters a bare atob cannot accept, assert that they do,
// and only then assert that the shared reader returns the claims anyway.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  jwtAgeSeconds,
  jwtClaims,
  jwtIssuedAt,
  jwtRole,
} from "../../supabase/functions/_shared/jwt";

/** A three-part token around one payload segment. */
const token = (payload: string): string => `eyJhbGciOiJIUzI1NiJ9.${payload}.c2lnbmF0dXJl`;

/**
 * The segment a real issuer would send: standard base64 with `+`/`/` swapped for
 * `-`/`_` and the padding removed.
 */
const segmentFor = (value: unknown): string =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("a segment that the base64 alphabet cannot express", () => {
  // Hand-computed, so this vector does not depend on any encoder: the payload is
  // `{"sub":">>>"}`, whose standard base64 is `eyJzdWIiOiI+Pj4ifQ==` — it contains
  // `+` and a pad, so on the wire it is `-`-carrying and unpadded. (An earlier
  // draft of this vector dropped the `OiI` group, which never decoded as JSON at
  // all; the test below is what caught it.)
  const HAND_WRITTEN = "eyJzdWIiOiI-Pj4ifQ";

  it("really does contain a character a bare atob rejects", () => {
    // If this ever stops holding, the rest of the file stops testing anything.
    expect(HAND_WRITTEN).toContain("-");
    expect(() => atob(HAND_WRITTEN)).toThrow();
  });

  it("is decoded anyway, because the shared reader translates and pads", () => {
    expect(jwtClaims(token(HAND_WRITTEN))).toEqual({ sub: ">>>" });
  });

  it("handles an encoder-produced segment with the same characters", () => {
    const segment = segmentFor({ sub: ">>>", note: "?+?" });
    expect(segment).toMatch(/[-_]/);
    expect(jwtClaims(token(segment))).toEqual({ sub: ">>>", note: "?+?" });
  });
});

describe("issued-at", () => {
  // `{"iat":1700000000}`, hand-computed and unpadded (the natural base64 ends
  // "==", which a JWT strips).
  const AT = "eyJpYXQiOjE3MDAwMDAwMDB9";

  it("reads iat from an unpadded segment", () => {
    expect(jwtIssuedAt(token(AT))).toBe(1700000000);
  });

  it("measures age against a supplied clock", () => {
    expect(jwtAgeSeconds(token(AT), 1_700_000_100_000)).toBe(100);
    // A clock skew that makes the token look future-dated is a negative age, not
    // a crash: the callers compare it against a maximum, so only the upper bound
    // matters here.
    expect(jwtAgeSeconds(token(AT), 1_699_999_900_000)).toBe(-100);
  });

  it("accepts a numeric string, which JSON issuers do send", () => {
    expect(jwtIssuedAt(token(segmentFor({ iat: "1700000000" })))).toBe(1700000000);
  });

  it("returns null rather than 0 when the claim is absent or useless", () => {
    for (const payload of [{ sub: "x" }, { iat: null }, { iat: "later" }, { iat: 0 }, { iat: -5 }, { iat: {} }]) {
      expect(jwtIssuedAt(token(segmentFor(payload))), JSON.stringify(payload)).toBeNull();
      expect(jwtAgeSeconds(token(segmentFor(payload)))).toBeNull();
    }
  });
});

describe("the role claim", () => {
  it("reads a string role and refuses anything else", () => {
    expect(jwtRole(token(segmentFor({ role: "service_role" })))).toBe("service_role");
    expect(jwtRole(token(segmentFor({ role: 7 })))).toBe("");
    expect(jwtRole(token(segmentFor({ sub: "x" })))).toBe("");
  });
});

describe("anything that is not a readable JWT", () => {
  it("returns null instead of throwing", () => {
    const notTokens = [
      "",
      "a",
      "onlyonepart",
      "two.parts",
      // A payload that is base64 but not JSON.
      token("bm90IGpzb24"),
      // A payload that is JSON but not an object.
      token(segmentFor("just a string")),
      token(segmentFor([1, 2, 3])),
      // A signature-only shape: the segment that would be read is the middle one.
      "..",
    ];

    for (const value of notTokens) {
      expect(jwtClaims(value), JSON.stringify(value)).toBeNull();
      expect(jwtIssuedAt(value), JSON.stringify(value)).toBeNull();
      expect(jwtRole(value), JSON.stringify(value)).toBe("");
    }
  });

  it("does not accept a non-string, which callers can pass by accident", () => {
    expect(jwtClaims(undefined as unknown as string)).toBeNull();
    expect(jwtClaims(null as unknown as string)).toBeNull();
    expect(jwtClaims(12345 as unknown as string)).toBeNull();
  });
});
