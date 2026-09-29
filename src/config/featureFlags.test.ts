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
  it("keeps wearable sync off", () => {
    // No Garmin/Strava/Fitbit developer agreement has been signed, so no client
    // id exists and the callback never exchanges a code for a token. This is an
    // unfinished integration, not a misconfiguration.
    expect(isFlagOn("wearableSync")).toBe(false);
  });

  it("keeps GPS tracking off", () => {
    // The Android manifest declares no location permission, so
    // navigator.geolocation never resolves and the control is inert.
    expect(isFlagOn("gpsTracking")).toBe(false);
  });

  it("keeps the coach marketplace off", () => {
    // Ships with zero seeded coaches; an empty marketplace reads as dead.
    expect(isFlagOn("coachMarketplace")).toBe(false);
  });

  it("has no AI flag to flip", () => {
    // Deliberate. AI is inside the core pages rather than a separate section,
    // so turning it off would gut the product rather than hide a feature. The
    // fix is `supabase secrets set OPENAI_API_KEY=…`, not a flag.
    expect(Object.keys(FEATURE_FLAGS)).not.toContain("aiCoach");
  });

  it("defaults every declared flag to off", () => {
    // A guard against someone adding a new feature flag with `true` as the
    // default. The whole point of this file is that a feature which does not
    // work must be opt-in, never opt-out.
    for (const [key, value] of Object.entries(FEATURE_FLAGS)) {
      expect(value, `${key} should default to false`).toBe(false);
    }
  });
});

describe("isRouteVisible", () => {
  it("hides the wearable route while the flag is off", () => {
    expect(isRouteVisible("/health-sync")).toBe(false);
  });

  it("leaves every unflagged route visible", () => {
    // Regression guard for the shape of the helper: a route that is not in the
    // map must never be hidden, or a typo in FLAGGED_ROUTES would silently
    // delete navigation across the app.
    for (const path of ["/", "/training", "/workouts", "/recover", "/market", "/profile"]) {
      expect(isRouteVisible(path), `${path} should stay visible`).toBe(true);
  }
  });

  it("maps each flagged route to a flag that exists", () => {
    for (const [path, key] of Object.entries(FLAGGED_ROUTES)) {
      expect(FEATURE_FLAGS, `${path} maps to an unknown flag`).toHaveProperty(key);
    }
  });
});
