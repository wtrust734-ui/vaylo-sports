// ============================================================================
// HEALTH CONNECT ENTRY POINTS
// ----------------------------------------------------------------------------
// Why this file exists: connecting a watch used to be reachable only from the
// Wearables screen, two levels down inside the Recover hub, which is what made
// it hard to find. The fix is three entry points — sign-up, onboarding and
// Profile — and the failure mode of a fix like that is silent: one of the three
// is dropped in a refactor and nothing breaks, because nothing was asserting
// that the door existed. The pop-up itself is rendered for real in
// HealthConnectPrompt.test.tsx; this file pins the wiring around it.
//
// Same pattern as androidNative.test.ts: the *sources* are pinned, because the
// behaviour behind them needs a real Android device with Health Connect
// installed and a real account, neither of which exists in CI.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  armHealthConnectOffer,
  clearHealthConnectOffer,
  healthConnectOfferArmed,
  healthConnectPrompted,
  markHealthConnectPrompted,
} from "./health/connectOffer";
import { HEALTH_CONNECT_CTA } from "@/components/health/HealthConnectPrompt";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const PROMPT = "/src/components/health/HealthConnectPrompt.tsx";
const OFFER = "/src/components/health/HealthConnectOffer.tsx";
const ONBOARDING = "/src/pages/Onboarding.tsx";
const AUTH = "/src/pages/Auth.tsx";
const PROFILE = "/src/pages/Profile.tsx";

describe("the pop-up itself", () => {
  const prompt = read(PROMPT);

  it("is the CTA the request asked for, word for word", () => {
    expect(HEALTH_CONNECT_CTA).toBe("Connect my Health Connect");
    expect(prompt).toContain('export const HEALTH_CONNECT_CTA = "Connect my Health Connect"');
  });

  it("reuses the one health hook instead of re-implementing consent", () => {
    expect(prompt).toContain("useHealthConnect()");
    // Connect, sync and disconnect all come from the hook — a second copy of
    // any of them is how the two doors drift apart.
    expect(prompt).toContain("hc.connect()");
    expect(prompt).toContain("hc.sync()");
    expect(prompt).toContain("hc.disconnect()");
  });

  it("names every read before asking, from the single permission catalog", () => {
    expect(prompt).toContain("HEALTH_PERMISSION_LIST");
    expect(prompt).toContain("Read access only");
  });

  it("is Android-only and flag-gated in its own right", () => {
    // Callers hide the entry point; this is the belt to that braces, so opening
    // the sheet on a build with no plugin can never offer a failing button.
    expect(prompt).toMatch(/const offered = isAndroid\(\) && isFlagOn\("wearableSync"\)/);
    expect(prompt).toMatch(/Health Connect runs on Android/);
  });

  it("never claims to have connected when the grant was declined", () => {
    // hc.connect() reports nothing about the outcome, so a success toast here
    // would congratulate somebody who just tapped "deny".
    expect(prompt).not.toMatch(/toast\.success/);
  });

  it("keeps disconnect separate from deleting what was already imported", () => {
    expect(prompt).toContain("Disconnect Health Connect? Vaylo will stop reading your health data");
    expect(prompt).toContain("Already-imported workouts stay until you delete them");
  });
});

describe("sign-up screen", () => {
  const auth = read(AUTH);

  it("offers Health Connect to a new account, and only on Android", () => {
    expect(auth).toMatch(/const offerHealthConnect = isAndroid\(\) && isFlagOn\("wearableSync"\)/);
    expect(auth).toContain("{!isLogin && offerHealthConnect && (");
    expect(auth).toContain("Connect my Health Connect");
  });

  it("shows the pop-up instead of pretending to connect without a session", () => {
    // There is no session on this screen by construction (a signed-in visitor is
    // redirected away above) and connect() is a no-op without one, so the tap
    // opens the sheet and the sheet arms the offer.
    expect(auth).toMatch(/onClick=\{\(\) => setShowHealthConnect\(true\)\}/);
    expect(auth).toContain("<HealthConnectPrompt");
    expect(auth).toMatch(/onArm=\{\(\) => \{/);
    // The arm lives inside onArm, i.e. after the mount: a stray arming at render
    // time could queue an offer nobody asked for.
    const mount = auth.indexOf("<HealthConnectPrompt");
    const arm = auth.indexOf("armHealthConnectOffer()");
    expect(arm, "armHealthConnectOffer() is missing").toBeGreaterThan(-1);
    expect(arm).toBeGreaterThan(mount);
    expect(auth).toMatch(/We'll ask to connect it the moment your account is ready/);
  });
});

describe("onboarding", () => {
  const page = read(ONBOARDING);

  it("mounts the offer and the standing way back in", () => {
    expect(page).toContain("<HealthConnectOffer");
    // The offer only knows which step it is on because onboarding tells it.
    expect(page).toContain("onLastStep={step === total - 1}");
    expect(page).toContain("Watch");
    // The row that keeps the offer findable after "Not now" wears the same words
    // as the pop-up's button, so there is one name for this action.
    expect(page).toContain("Connect my Health Connect");
  });

  it("mounts it only where the plugin exists", () => {
    expect(page).toMatch(/const wearableOffer = isAndroid\(\) && isFlagOn\("wearableSync"\)/);
    // The hook lives inside the offer, never in the page: one state read, and
    // none at all on a build that has no plugin to read about.
    expect(page).toMatch(/\{wearableOffer && \(\s*<HealthConnectOffer/);
    expect(page).not.toContain("useHealthConnect");
  });
});

// The offer, not the screen, is what decides this. It is a separate component
// precisely so the "ask at most once" logic is not entangled with onboarding's
// nine steps (and survives their reordering).
describe("the onboarding offer — when it asks", () => {
  const offer = read(OFFER);

  it("asks once per account", () => {
    expect(offer).toMatch(/healthConnectPrompted\(user\.id\)/);
    expect(offer).toMatch(/markHealthConnectPrompted\(user\.id\)/);
  });

  it("honours an offer armed at sign-up before the last step", () => {
    // `armed ||` is the branch that lets a sign-up tap open the sheet on entry;
    // without it the promise made on the previous screen is never kept.
    expect(offer).toMatch(/healthConnectOfferArmed\(\)/);
    expect(offer).toMatch(/if \(armed \|\| \(onLastStep && !healthConnectPrompted\(user\.id\)\)\)/);
  });

  it("does not ask an athlete who is already connected", () => {
    expect(offer).toMatch(/if \(hc\.status === "connected"\) \{/);
    expect(offer).toContain("clearHealthConnectOffer();");
  });
});

describe("profile", () => {
  const page = read(PROFILE);

  it("manages Health Connect from the account screen", () => {
    expect(page).toContain('label: "Health Connect"');
    expect(page).toContain("onClick: () => setShowHealthConnect(true)");
    expect(page).toContain("<HealthConnectPrompt open={showHealthConnect}");
  });

  it("keeps the row off builds with no Health Connect", () => {
    expect(page).toMatch(/const wearableOffer = isAndroid\(\) && isFlagOn\("wearableSync"\)/);
    expect(page).toMatch(/\.\.\.\(wearableOffer/);
  });
});

describe("the armed offer", () => {
  it("round-trips, and is cleared once it has been honoured", () => {
    clearHealthConnectOffer();
    expect(healthConnectOfferArmed()).toBe(false);

    armHealthConnectOffer();
    expect(healthConnectOfferArmed()).toBe(true);

    clearHealthConnectOffer();
    expect(healthConnectOfferArmed()).toBe(false);
  });

  it("remembers the ask per account, not per device", () => {
    expect(healthConnectPrompted("athlete-a")).toBe(false);

    markHealthConnectPrompted("athlete-a");
    expect(healthConnectPrompted("athlete-a")).toBe(true);
    expect(healthConnectPrompted("athlete-b")).toBe(false);
  });

  it("reads as not armed, and never throws, when storage is unavailable", () => {
    // Private mode and a disabled store both reach here; a render must not die
    // because the offer could not be remembered.
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage denied");
    });

    expect(healthConnectOfferArmed()).toBe(false);
    expect(healthConnectPrompted("athlete-a")).toBe(false);
    expect(() => armHealthConnectOffer()).not.toThrow();
    expect(() => markHealthConnectPrompted("athlete-a")).not.toThrow();
    expect(() => clearHealthConnectOffer()).not.toThrow();

    get.mockRestore();
    set.mockRestore();
    remove.mockRestore();
  });
});
