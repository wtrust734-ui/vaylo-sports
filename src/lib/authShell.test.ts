// Source assertions for the app-shell / auth / UX package (30 September 2026).
// Same pattern as dbSecurityMigration.test.ts and economyIntegrity.test.ts:
// these tests fail the suite if a future edit silently drops a route guard,
// a sign-out cache wipe, a destructive-action confirmation or an a11y label.
//
// Not covered here (needs a device or a real session, so they stay on the
// manual-verification list): Android hardware back, OAuth/purchase return
// flows, keyboard traversal and screen-reader output.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const APP = "/src/App.tsx";
const AUTH_CTX = "/src/contexts/AuthContext.tsx";
const LAYOUT = "/src/components/layout/AppLayout.tsx";
const GUARD = "/src/components/auth/RequireAdmin.tsx";
const STORAGE = "/src/lib/userStorage.ts";
const QUERY_CLIENT = "/src/lib/queryClient.ts";
const AUTH_PAGE = "/src/pages/Auth.tsx";
const GOALS = "/src/pages/Goals.tsx";
const NUTRITION = "/src/pages/Nutrition.tsx";

describe("routing — route guards", () => {
  const app = read(APP);

  it("every admin route is wrapped in RequireAdmin (role checked server-side)", () => {
    for (const page of ["AdminPricing", "AdminRewards", "AdminEventPacks", "AIDev"]) {
      expect(app).toMatch(
        new RegExp(`<RequireAdmin><${page} /></RequireAdmin>`)
      );
    }
  });

  it("AppLayout gates the outlet on session before anything renders", () => {
    const layout = read(LAYOUT);
    const loadingIdx = layout.indexOf("if (loading) return");
    const noSessionIdx = layout.indexOf('if (!session) return <Navigate to="/auth" replace />;');
    const outletIdx = layout.indexOf("<Outlet />");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(noSessionIdx).toBeGreaterThan(loadingIdx);
    expect(outletIdx).toBeGreaterThan(noSessionIdx);
  });

  it("AppLayout blocks incomplete onboarding from authenticated screens", () => {
    const layout = read(LAYOUT);

    // Still blocked: the redirect exists and is still gated on the profile being
    // incomplete. Removing either half would let a signed-in athlete past setup
    // with no sport, level or goal recorded.
    expect(layout).toMatch(/!profile\.onboarding_complete/);
    expect(layout).toMatch(/return <Navigate to="\/onboarding" replace \/>;/);

    // The one exemption is a GUEST, and it is the reason the redirect is now a
    // block rather than a one-liner: the preview has to open on the app with no
    // setup in front of it, and an anonymous browser session has no identity to
    // set up yet.
    //
    // Asserted through isGuestUser rather than a raw `is_anonymous` read so the
    // check cannot be satisfied by a hand-rolled test that disagrees with the
    // one src/lib/guestMode.ts documents, and asserted BEFORE the redirect so
    // the exemption cannot silently stop covering it.
    const guest = layout.indexOf("!isGuestUser(session?.user)");
    const redirect = layout.indexOf('return <Navigate to="/onboarding" replace />;');
    expect(guest, "AppLayout does not exempt guests from onboarding").toBeGreaterThan(-1);
    expect(guest).toBeLessThan(redirect);

    // A real account is never exempt: the condition must AND them together, not
    // branch on the guest first.
    expect(layout).toMatch(/!isGuestUser\(session\?\.user\)/);
    expect(layout).toMatch(/import \{ isGuestUser \} from "@\/lib\/guestMode"/);
  });

  it("a real session with an unreadable profile shows a retry screen, not empty screens", () => {
    const layout = read(LAYOUT);
    expect(layout).toMatch(/!profile && profileError/);
    expect(layout).toMatch(/Try again/);
  });

  it("unknown paths land on NotFound", () => {
    expect(app).toMatch(/<Route path="\*" element=\{<NotFound \/>\} \/>/);
  });

  it("the native shell uses HashRouter so refreshes and deep links survive", () => {
    expect(app).toMatch(/isNativeShell\(\) \? HashRouter : BrowserRouter/);
  });

  it("Android back drains the keyboard, then overlays, then history", () => {
    const keyboardIdx = app.indexOf("if (dismissKeyboard()) return;");
    const overlayIdx = app.indexOf("if (consumeBackPress()) return;");
    const historyIdx = app.indexOf("window.history.back();");
    expect(keyboardIdx).toBeGreaterThan(-1);
    expect(overlayIdx).toBeGreaterThan(keyboardIdx);
    expect(historyIdx).toBeGreaterThan(overlayIdx);
  });

  it("all three admin routes exist", () => {
    for (const path of ["/admin/pricing", "/admin/rewards", "/admin/event-packs"]) {
      expect(app).toMatch(new RegExp(`path="${path}"`));
    }
  });
});

describe("auth lifecycle", () => {
  it("sign-out clears the query cache and user-scoped storage even if the server call fails", () => {
    const ctx = read(AUTH_CTX);
    const start = ctx.indexOf("const signOut = async () => {");
    expect(start).toBeGreaterThan(-1);
    const body = ctx.slice(start, ctx.indexOf("\n  };", start));
    const finallyIdx = body.indexOf("} finally {");
    expect(finallyIdx).toBeGreaterThan(-1);
    const finallyBlock = body.slice(finallyIdx);
    expect(finallyBlock).toContain("queryClient.clear()");
    expect(finallyBlock).toContain("clearUserLocalState()");
    expect(finallyBlock).toContain("setProfile(null)");
  });

  it("user-scoped storage keys are registered and wiped on sign-out", () => {
    const storage = read(STORAGE);
    for (const key of [
      "vaylo_rpe_log_v1",
      "vaylo_trigger_prefs_v1",
      "vaylo_pending_referral",
      "vaylo_pending_join",
    ]) {
      expect(storage).toContain(`"${key}"`);
    }
    expect(storage).toMatch(/USER_SCOPED_STORAGE_PREFIXES = \["vaylo_arcade_best_"\]/);
    expect(storage).toMatch(/export function clearUserLocalState/);
    expect(read(AUTH_CTX)).toMatch(/import \{ clearUserLocalState \} from "@\/lib\/userStorage"/);
  });

  it("the single query client lives in its own module so sign-out can clear it", () => {
    expect(read(QUERY_CLIENT)).toMatch(/export const queryClient = new QueryClient\(\)/);
    expect(read(AUTH_CTX)).toMatch(/import \{ queryClient \} from "@\/lib\/queryClient"/);
    expect(read(APP)).toMatch(/import \{ queryClient \} from "@\/lib\/queryClient"/);
  });

  it("auth subscription is cleaned up and stale async updates are guarded", () => {
    const ctx = read(AUTH_CTX);
    expect(ctx).toMatch(/subscription\.unsubscribe\(\)/);
    expect(ctx).toMatch(/let active = true;/);
    expect(ctx).toMatch(/if \(!active\) return;/);
  });

  it("a failed profile load is surfaced as profileError, not silent emptiness", () => {
    const ctx = read(AUTH_CTX);
    expect(ctx).toMatch(/setProfileError\(/);
    expect(ctx).toMatch(/profileError: string \| null;/);
  });
});

describe("admin gate", () => {
  it("fails closed when the role check errors", () => {
    const guard = read(GUARD);
    // Error (network, revoked session) must land on "denied", never "admin".
    expect(guard).toMatch(/setState\(!error && data === true \? "admin" : "denied"\)/);
  });

  it("renders an explicit no-access state instead of the screen", () => {
    const guard = read(GUARD);
    expect(guard).toMatch(/state !== "admin"/);
    expect(guard).toMatch(/restricted to Vaylo Sports administrators/);
  });
});

describe("auth form (Auth.tsx)", () => {
  const page = read(AUTH_PAGE);

  it("email and password fields carry accessible names and autofill hints", () => {
    expect(page).toMatch(/aria-label="Email address"/);
    expect(page).toMatch(/autoComplete="email"/);
    expect(page).toMatch(/aria-label="Password"/);
    // Sign-in vs sign-up share one field, so the hint is conditional.
    expect(page).toMatch(/autoComplete=\{isLogin \? "current-password" : "new-password"\}/);
    expect(page).toMatch(/aria-label="New password"/);
    expect(page).toMatch(/aria-label="Confirm new password"/);
    expect(page).toMatch(/autoComplete="new-password"/);
    expect(page).toMatch(/autoComplete="one-time-code"/);
  });

  it("the show-password toggle announces its state and its icons are decorative", () => {
    expect(page).toMatch(
      /aria-label=\{showPassword \? "Hide password" : "Show password"\}/
    );
    expect(page).toMatch(/EyeOff size=\{16\} aria-hidden/);
  });

  it("the age/consent checkbox has an accessible label", () => {
    expect(page).toMatch(/aria-label="I am 13 or older and accept the Terms of Service and Privacy Policy"/);
  });
});

describe("destructive actions — Goals.tsx", () => {
  const page = read(GOALS);

  it("deleting an outcome goal confirms and names the cascade blast radius", () => {
    expect(page).toMatch(/Delete the goal "/);
    expect(page).toMatch(/This also permanently deletes its weekly habits, daily actions and all logged history/);
    expect(page).toMatch(/can't be undone/);
  });

  it("deletes are guarded against double-clicks", () => {
    expect(page).toMatch(/const \[deleting, setDeleting\] = useState\(false\)/);
    expect(page).toMatch(/disabled=\{deleting\}/);
    expect(page).toMatch(/if \(!confirmed \|\| deleting\) return;/);
  });

  it("delete controls have accessible names (icon-only buttons)", () => {
    expect(page).toMatch(/aria-label=\{`Delete goal: \$\{g\.title\}`\}/);
    expect(page).toMatch(/aria-label=\{`Stop tracking action: \$\{a\.title\}`\}/);
  });

  it("the daily-action row is not a button nested inside a button", () => {
    // Invalid HTML; screen readers skipped the delete control entirely.
    expect(page).not.toMatch(/e\.stopPropagation\(\)/);
    // The toggle is an explicit checkbox-flavoured control now.
    expect(page).toMatch(/role="checkbox"/);
    expect(page).toMatch(/aria-checked=\{done\}/);
    expect(page).toMatch(/handleToggle\(a\)/);
  });

  it("stopping a daily action confirms what happens to history", () => {
    expect(page).toMatch(/Stop tracking "/);
    expect(page).toMatch(/your logged history stays in your stats/);
  });
});

describe("destructive actions — Nutrition.tsx", () => {
  const page = read(NUTRITION);

  it("deleting a meal confirms the exact meal and warns it is irreversible", () => {
    expect(page).toMatch(/window\.confirm\(`Delete the meal "\$\{name\}" from today's log\? This can't be undone\.`\)/);
  });

  it("meal deletion is guarded against double-clicks", () => {
    expect(page).toMatch(/const \[deleting, setDeleting\] = useState\(false\)/);
    expect(page).toMatch(/if \(deleting\) return;/);
    expect(page).toMatch(/finally \{\s*\r?\n\s*setDeleting\(false\);/);
  });

  it("the meal delete control has an accessible name", () => {
    expect(page).toMatch(/aria-label=\{`Delete meal: \$\{meal\.name\}`\}/);
  });
});
