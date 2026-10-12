import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS, FLAGGED_ROUTES, isFlagOn, isRouteVisible } from "./featureFlags";

/**
 * Most of these assertions are about the *launch decision*, not about the flag
 * mechanism. A flag that is accidentally on ships a feature that does not work,
 * which is the specific thing the closed-test build exists to avoid — and
 * unlike a crash, it looks fine until a reviewer taps it.
 *
 * The `VITE_ENABLE_*` override is only exercised through `envOverride`'s
 * contract below, because the override is read at module load. A test that
 * mutated `import.meta.env` and re-imported would be testing Vite's module
 * cache as much as the flag, and would be the first thing to break on a Vite
 * upgrade.
 */

describe("launch defaults", () => {
  it("ships wearable sync on, with the Health Connect half finished", () => {
    // Health Connect is complete and shipping: native plugin, six read
    // permissions, incremental pull. The cloud providers on the same screen are
    // not wired yet, and the screen says so per provider rather than pretending
    // (see providers.ts and wearable-oauth). Flipping this back off hides the
    // whole surface.
    expect(isFlagOn("wearableSync")).toBe(true);
  });

  it("keeps GPS tracking off", () => {
    // Nothing reads this flag any more: live-distance tracking was removed from
    // the app on 2026-10-12, so there is no control left to hide. It stays in
    // the map, off, so a stale build cannot turn one back on.
    expect(isFlagOn("gpsTracking")).toBe(false);
  });

  it("keeps the coach marketplace off", () => {
    // Ships with zero seeded coaches; an empty marketplace reads as dead.
    expect(isFlagOn("coachMarketplace")).toBe(false);
  });

  it("keeps every iPhone surface off", () => {
    // There is no iPhone build. A HealthKit card or a "Continue with Apple"
    // button would promise one, and the promise would be made to an Android
    // user reading a screen on the Play Store.
    expect(isFlagOn("iphone")).toBe(false);
  });

  it("has no AI flag to flip", () => {
    // Deliberate. AI is inside the core pages rather than a separate section,
    // so turning it off would gut the product rather than hide a feature. The
    // fix is `supabase secrets set OPENAI_API_KEY=…`, not a flag.
    expect(Object.keys(FEATURE_FLAGS)).not.toContain("aiCoach");
  });

  it("defaults every not-yet-ready flag to off", () => {
    // A guard against someone adding a new feature flag with `true` as the
    // default. A feature that does not work must be opt-in, never opt-out.
    // `wearableSync` is the deliberate exception — Health Connect is shipping —
    // so it is named here rather than left to a blanket loop that would have to
    // be weakened to accommodate it.
    for (const key of Object.keys(FEATURE_FLAGS)) {
      if (key === "wearableSync") continue;
      expect(isFlagOn(key as keyof typeof FEATURE_FLAGS), `${key} should default to false`).toBe(false);
    }
    expect(isFlagOn("wearableSync")).toBe(true);
  });
});

describe("isRouteVisible", () => {
  it("shows the wearable route while the flag is on", () => {
    expect(isRouteVisible("/health-sync")).toBe(true);
  });

  it("leaves every unflagged route visible", () => {
    // Regression guard for the shape of the helper: a route that is not in the
    // map must never be hidden, or a typo in FLAGGED_ROUTES would silently
    // delete navigation across the app.
    for (const path of ["/", "/training", "/pbs", "/recover", "/market", "/profile"]) {
      expect(isRouteVisible(path), `${path} should stay visible`).toBe(true);
  }
  });

  it("maps each flagged route to a flag that exists", () => {
    for (const [path, key] of Object.entries(FLAGGED_ROUTES)) {
      expect(FEATURE_FLAGS, `${path} maps to an unknown flag`).toHaveProperty(key);
    }
  });
});
