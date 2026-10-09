// ============================================================================
// DEMO MODE — tests for the clone's local seams
// ----------------------------------------------------------------------------
// These run with VITE_DEMO_MODE unset, i.e. DEMO_MODE === false, which is the
// state every real build ships in. What is asserted here is that the SEAMS
// themselves are sound: the guest session is a decodable, stable, anonymous
// shape, and the free-purchase store round-trips. The wiring around them
// (AuthContext, SubscriptionContext, billing) is covered by the existing suites
// that already run against DEMO_MODE=false — the branch that matters for the
// clone is the branch these helpers feed.
// ============================================================================

import { beforeEach, describe, expect, it } from "vitest";

import {
  DEMO_MODE,
  demoGrant,
  demoGuestId,
  demoGuestSession,
  demoPurchases,
} from "./demoMode";

describe("demo mode flag", () => {
  it("is off in normal builds — the clone alone sets VITE_DEMO_MODE", () => {
    // If this ever flips without a deliberate env change, every demo branch is
    // live in the APK and the Play bundle.
    expect(DEMO_MODE).toBe(false);
  });
});

describe("demo guest session", () => {
  it("is a decodable, far-future, anonymous session", () => {
    const session = demoGuestSession();
    expect(session.user.id).toBeTruthy();
    expect(session.user.is_anonymous).toBe(true);
    expect(session.user.email).toBeNull();

    const [header, payload, sig] = session.access_token.split(".");
    expect(sig).toBe("local-demo");
    const decode = (part: string) =>
      JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    expect(decode(header)).toMatchObject({ alg: "HS256", typ: "JWT" });
    const claims = decode(payload);
    expect(claims.sub).toBe(session.user.id);
    expect(claims.aud).toBe("authenticated");
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365);
  });

  it("keeps the same guest id across calls — a reload is the same athlete", () => {
    const first = demoGuestId();
    const second = demoGuestId();
    expect(second).toBe(first);
    expect(demoGuestSession().user.id).toBe(first);
  });
});

describe("free purchases", () => {
  beforeEach(() => {
    localStorage.removeItem("vaylo:demo:purchases");
  });

  it("round-trips grants so hasFeature can read them back", () => {
    expect(demoPurchases()).toEqual([]);
    demoGrant(["mental_gym"]);
    demoGrant(["form_analysis", "mental_gym"]); // idempotent
    expect(demoPurchases()).toEqual(["mental_gym", "form_analysis"]);
  });

  it("survives garbage in storage without throwing", () => {
    localStorage.setItem("vaylo:demo:purchases", "{not json");
    expect(demoPurchases()).toEqual([]);
    localStorage.setItem("vaylo:demo:purchases", '{"not":"an array"}');
    expect(demoPurchases()).toEqual([]);
  });
});
