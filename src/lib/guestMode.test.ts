import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { guestEntryAvailable, isGuestUser, displayNameFor, GUEST_DISPLAY_NAME } from "@/lib/guestMode";
import { isNativeShell } from "@/lib/platform";

const ROOT = resolve(__dirname, "..", "..");
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// These assertions exist because the failure mode is a silent regression in the
// one direction that matters most. If guest entry leaks into the APK build,
// every Android user loses their real account: OAuth stops working, the app
// cannot find a credential they already have, and nothing errors until someone
// reports being unable to sign in. If guest entry stops working on the web, a
// visitor lands on the wall of inert buttons again — annoying, and exactly what
// this work was meant to remove. Neither is visible without a test.

describe("guest entry availability", () => {
  it("is available on the web, which is where the sign-in wall was", () => {
    // No Capacitor bridge in a jsdom environment, so this is the browser case.
    expect(guestEntryAvailable()).toBe(true);
  });

  it("is unavailable inside the Capacitor shell, so the APK keeps its real sign-in", () => {
    // The APK's OAuth returns through the com.vaylosports.app://auth-callback
    // scheme, which does not need an owned domain, so it works there. Signing an
    // Android user in as a guest would strand anyone with existing credentials.
    //
    // isNativeShell reads the injected global, so drive it directly rather than
    // constructing a fake window/UA pair: this tests the gate in guestMode
    // rather than re-testing platform detection, which has its own tests.
    // The BRIDGE itself, not an object containing it — globalThis.Capacitor is
    // the bridge, so assigning a wrapper here reads as a bridge with no
    // isNativePlatform, and the check quietly falls through to "not native".
    const bridge = { isNativePlatform: () => true, getPlatform: () => "android" };
    const original = (globalThis as { Capacitor?: unknown }).Capacitor;
    (globalThis as { Capacitor?: unknown }).Capacitor = bridge;
    try {
      expect(isNativeShell()).toBe(true);
      expect(guestEntryAvailable()).toBe(false);
    } finally {
      (globalThis as { Capacitor?: unknown }).Capacitor = original;
    }
  });

  it("reuses the one isNativeShell, rather than re-deriving native-ness", () => {
    // A second, thinner copy of "am I native?" is how guest mode ends up
    // offered to the APK. guestMode must import the real one.
    const module = src("src/lib/guestMode.ts");
    expect(module).toMatch(/import \{ isNativeShell \} from "@\/lib\/platform"/);
    // And must not define its own.
    expect(module).not.toMatch(/export const isNativeShell/);
  });

  it("is not consulted anywhere in the native-only code paths", () => {
    // nativeOAuth.ts is the APK's OAuth handler. Guest mode has no business
    // there, and a stray call would mean an APK user silently becoming a guest.
    expect(src("src/lib/nativeOAuth.ts")).not.toMatch(/guestEntryAvailable|guestMode/);
  });
});

describe("classifying a guest", () => {
  it("treats only an explicitly anonymous user as a guest", () => {
    expect(isGuestUser({ is_anonymous: true })).toBe(true);
    expect(isGuestUser({ is_anonymous: false })).toBe(false);
    expect(isGuestUser({ is_anonymous: null })).toBe(false);
    expect(isGuestUser({})).toBe(false);
    expect(isGuestUser(null)).toBe(false);
    expect(isGuestUser(undefined)).toBe(false);
  });

  it("does not treat a missing flag as a guest", () => {
    // The failure this guards: an older client, or a session restored from a
    // token minted before the flag existed, has no is_anonymous. Reading that
    // as "guest" would give a real athlete the guest display name and hide their
    // real one.
    expect(isGuestUser({ is_anonymous: undefined })).toBe(false);
  });
});

describe("the name a guest is shown", () => {
  it("gives a guest an explicit label rather than a blank", () => {
    // An anonymous user has no email and no metadata, so every derivation path
    // in ensureProfile yields null. A blank avatar and an empty header read as a
    // broken account.
    expect(displayNameFor(null, true)).toBe(GUEST_DISPLAY_NAME);
    expect(displayNameFor({ full_name: null }, true)).toBe(GUEST_DISPLAY_NAME);
    expect(displayNameFor({ full_name: "" }, true)).toBe(GUEST_DISPLAY_NAME);
    expect(displayNameFor({ full_name: "   " }, true)).toBe(GUEST_DISPLAY_NAME);
  });

  it("prefers a real name the guest has since set", () => {
    // A guest who goes through onboarding and types a name must be shown it.
    // Otherwise the guest label overwrites their own choice.
    expect(displayNameFor({ full_name: "Sam" }, true)).toBe("Sam");
  });

  it("does not invent a name for a real account that has none", () => {
    // Only guests get the fallback. A signed-in athlete with an empty
    // full_name should render whatever the app already rendered before, not a
    // word this module made up.
    expect(displayNameFor(null, false)).toBe("");
    expect(displayNameFor({ full_name: "" }, false)).toBe("");
  });
});

describe("the web build reaches the app without a sign-in wall", () => {
  it("redirects /auth into the app on the web, but only once there is a session", () => {
    // Deleting the route would 404 the path the marketing site links to. The
    // redirect is conditional on a session existing AND guest entry not having
    // failed — see AuthGate. Asserted on the guard itself, because an
    // unconditional redirect is what locks every visitor out while the
    // Anonymous provider is disabled in the dashboard.
    const app = src("src/App.tsx");
    expect(app).toMatch(/const AuthGate = \(\) => \{/);
    expect(app).toMatch(/if \(!guestEntryAvailable\(\)\) return <Auth \/>;/);
    // A guest session counts. It used to have an exception, on the theory that
    // it made the OAuth buttons reachable for guests — and the effect was that a
    // fresh visitor whose session had not been created yet was parked on the
    // sign-in screen for ever instead of being sent into the app. The preview
    // must open IN THE APP.
    expect(app).toMatch(/if \(session && !guestError\) return <Navigate to="\/" replace \/>;/);
    expect(app).not.toMatch(/&& !isGuestUser\(session\.user\)/);
    // The fallback: no session means the real sign-in page, which works with
    // email + password on a preview host.
    expect(app).toMatch(/return <Auth \/>;\s*\};/);
  });

  it("opens on the app itself, with no setup in front of it", () => {
    // The other half of "no setup": AuthGate sends a guest to "/", and AppLayout
    // must not then bounce them into the onboarding wizard.
    //
    // Asserted as an ORDER — the guest check has to sit before the redirect —
    // because the two on separate lines still leave the wizard in front of the
    // app, which is precisely the wall this removes.
    const layout = src("src/components/layout/AppLayout.tsx");
    const guest = layout.indexOf("!isGuestUser(session?.user)");
    const redirect = layout.indexOf('return <Navigate to="/onboarding" replace />;');
    expect(guest, "AppLayout does not gate onboarding for guests").toBeGreaterThan(-1);
    expect(redirect, "the onboarding redirect has moved").toBeGreaterThan(-1);
    expect(guest).toBeLessThan(redirect);
    expect(layout).toMatch(/import \{ isGuestUser \} from "@\/lib\/guestMode"/);

    // A real account is still walked through setup — the gate is about guests,
    // not about abandoning onboarding.
    expect(layout).toMatch(/!profile\.onboarding_complete/);
  });

  it("keeps the web build reachable when guest sign-in is refused", () => {
    // The state this exists for: Anonymous provider off, so GoTrue rejects
    // signInAnonymously. AppLayout must send the visitor somewhere usable rather
    // than bouncing between /app screens, and /auth must render the real page.
    const layout = src("src/components/layout/AppLayout.tsx");
    expect(layout).toMatch(/if \(guestError && !session\) return <Navigate to="\/auth" replace \/>;/);
    // No dead-end retry screen whose button cannot succeed.
    expect(layout).not.toMatch(/Retry guest session/);
  });

  it("still registers the real Auth page for the APK", () => {
    // The APK is not a web preview: its OAuth works. If this branch ever
    // disappears, the Android sign-in screen 404s.
    const app = src("src/App.tsx");
    expect(app).toMatch(/if \(!guestEntryAvailable\(\)\) return <Auth \/>;/);
    const auth = src("src/pages/Auth.tsx");
    expect(auth).toMatch(/Continue with Google/);
    expect(auth).toMatch(/Continue with Discord/);
    // Email and password stays on the APK's page too — a user with an existing
    // account and no OAuth provider configured must still be able in.
    expect(auth).toMatch(/signInWithPassword/);
  });

  it("signs a web visitor in anonymously when there is no session", () => {
    const ctx = src("src/contexts/AuthContext.tsx");
    expect(ctx).toMatch(/signInAnonymously/);
    // Guarded on guestEntryAvailable, or the APK would do this too.
    expect(ctx).toMatch(/if \(!guestEntryAvailable\(\)\) return;/);
  });

  it("never overwrites a real session with a guest", () => {
    // Re-reading the session and bailing when one exists is what stops a signed
    // in athlete who opens the web build from being swapped for a guest.
    const ctx = src("src/contexts/AuthContext.tsx");
    expect(ctx).toMatch(/getSession\(\)/);
    expect(ctx).toMatch(/if \(data\.session\) return;/);
  });

  it("attempts guest entry at most once per load", () => {
    // signInAnonymously fires onAuthStateChange, which re-runs the auth effect.
    // Without the once-flag, each event could mint another account.
    const ctx = src("src/contexts/AuthContext.tsx");
    expect(ctx).toMatch(/if \(attempted\) return;/);
  });

  it("surfaces a failed guest sign-in instead of hanging on the loader", () => {
    // GoTrue rejects anonymous sign-in when the provider is off in the
    // dashboard. Left unhandled the athlete would sit on a spinner forever.
    const ctx = src("src/contexts/AuthContext.tsx");
    expect(ctx).toMatch(/guestError/);
    // And it must release the loader, or nothing renders at all.
    expect(ctx).toMatch(/setGuestError\(error\?\.message \?\? "Couldn't start a guest session\."\);\s*\n?\s*setLoading\(false\);/);
  });

  it("mints a replacement guest on sign-out rather than stranding the visitor", () => {
    // There is no credential to sign back in with, so signing a guest out and
    // dropping them on a wall they cannot pass is a dead end.
    const ctx = src("src/contexts/AuthContext.tsx");
    expect(ctx).toMatch(/const wasGuest = isGuestUser\(user\)/);
    expect(ctx).toMatch(/if \(!wasGuest \|\| !guestEntryAvailable\(\)\) return;/);
  });
});

describe("the database refuses to pay a guest", () => {
  const migration = () =>
    src("supabase/migrations/20261003120000_anonymous_guest_no_starter_credits.sql");

  it("grants zero starter credits to an anonymous user", () => {
    // Without this, unauthenticated signInAnonymously is a script that mints 50
    // credits per call. That is the whole cost of guest mode and it is closed
    // here rather than left to rate limiting that does not exist.
    const sql = migration();
    expect(sql).toMatch(/IF NEW\.is_anonymous IS DISTINCT FROM true THEN\s+v_start := public\.starting_credits\(\);/);
    expect(sql).toMatch(/v_start integer := 0;/);
  });

  it("writes no ledger row for a zero grant", () => {
    // A "+0 starter credits" transaction is noise that reads as a real entry.
    expect(migration()).toMatch(/IF v_start <> 0 THEN[\s\S]*credit_transactions/);
  });

  it("still gives every account a profile and a free subscription", () => {
    // The account has to look real: screens read the subscription, and an
    // account without one reads as broken rather than as a guest.
    const sql = migration();
    expect(sql).toMatch(/INSERT INTO public\.profiles \(user_id, credits\) VALUES \(NEW\.id, v_start\);/);
    expect(sql).toMatch(/INSERT INTO public\.subscriptions/);
  });

  it("records the guest flag on the profile, in the same transaction", () => {
    // auth.users is not readable under RLS, so the profile column is the only
    // way to answer this from the database side.
    const sql = migration();
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false/);
  });

  it("leaves existing accounts alone", () => {
    // The change must only affect accounts created from now on.
    const sql = migration();
    expect(sql).toMatch(/UPDATE public\.profiles p[\s\S]*u\.is_anonymous IS TRUE/);
  });
});
