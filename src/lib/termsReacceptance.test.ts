// ============================================================================
// THE TERMS CHANGE IS ACTUALLY SHOWN, AND ACTUALLY RECORDED
// ----------------------------------------------------------------------------
// Section 17 of the Terms promises two things: that a material change is shown
// to the athlete in the app, and that they are asked to accept it. For a long
// time only the second half existed in reality — `profiles.terms_version` was
// written once at sign-up and never moved, so bumping the document changed what
// an athlete was bound by without anybody telling them. The published promise
// was ahead of the product, which is the failure mode this file exists to stop.
//
// These are assertions about the shipped code rather than about a rendered
// component, because what can silently regress is the wiring: a banner mounted
// on one screen, an accept that hides the banner without writing the record, or
// a prompt that can be dismissed so it stops asking. Each has its own test
// below, and the last one ties the code back to the clause that promises it.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { TERMS_VERSION } from "@/lib/consent";
import { LEGAL_PAGES } from "../../supabase/functions/legal/pages.generated";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const notice = read("/src/components/legal/TermsChangeNotice.tsx");
const app = read("/src/App.tsx");
const terms = LEGAL_PAGES["terms"].html;
const termsText = terms.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("the re-acceptance prompt", () => {
  it("is mounted app-wide, so no screen can be the one that forgets it", () => {
    // Inside AuthProvider/SubscriptionProvider and above the routes, next to the
    // offline banner. Mounting it in AppLayout instead would have been easier to
    // read and wrong: /auth and /onboarding render outside that layout.
    expect(app).toContain('import TermsChangeNotice from "@/components/legal/TermsChangeNotice"');
    expect(app).toContain("<TermsChangeNotice />");

    const mount = app.indexOf("<TermsChangeNotice />");
    const routes = app.indexOf("<Routes>");
    expect(mount, "the notice is missing from App.tsx").toBeGreaterThan(-1);
    expect(routes, "<Routes> not found").toBeGreaterThan(-1);
    expect(mount, "the notice is mounted inside the route table").toBeLessThan(routes);
  });

  it("compares the athlete's own recorded version against the current one", () => {
    // The profile is the only source of truth. A local \"already seen\" flag would
    // let a reinstall — or a device that was offline across the change — skip a
    // consent event that never took place.
    expect(notice).toMatch(/profile\.terms_version \?\? null/);
    expect(notice).toMatch(/recorded === TERMS_VERSION/);
    // Nothing may be remembered locally as a substitute for accepting.
    expect(notice).not.toMatch(/localStorage/);
    expect(notice).not.toMatch(/sessionStorage/);
  });

  it("writes the acceptance before it stops asking", () => {
    // The order is the point: stamp, then re-read the profile. Hiding the
    // banner first and writing afterwards is how a failed write leaves an
    // athlete who believes they accepted something on record.
    const stamp = notice.indexOf("await recordTermsAcceptance()");
    const hide = notice.indexOf("setAccepted(true)");
    const refresh = notice.indexOf("await refreshProfile()");
    expect(stamp, "the notice never records the acceptance").toBeGreaterThan(-1);
    expect(hide, "the notice never hides itself").toBeGreaterThan(-1);
    expect(refresh, "the notice does not re-read the profile").toBeGreaterThan(-1);
    expect(stamp, "the banner is hidden before the acceptance is written").toBeLessThan(hide);
    expect(hide, "the profile is refreshed before the banner is hidden").toBeLessThan(refresh);
  });

  it("cannot be dismissed without accepting", () => {
    // A banner with a close button is a banner people learn to close, and then
    // it protects nobody. There is no dismiss path in this component at all.
    expect(notice).not.toMatch(/\bDismiss\b/i);
    expect(notice).not.toMatch(/aria-label="Close"/);
    expect(notice).not.toMatch(/onClick=\{\(\) => setAccepted/);
  });

  it("offers deletion rather than presenting acceptance as compulsory", () => {
    // The athlete's exit from a change they do not want is deleting their
    // account, and it has to be reachable from the prompt itself.
    expect(notice).toContain('navigate("/settings/delete-account")');
    expect(notice).toMatch(/delete your account/i);
  });

  it("does not gate anything else in the app", () => {
    // It is a notice, not a wall: no route guard, no redirect, no early return
    // in the layout. The notice renders `null` and that is all it does.
    expect(notice).toMatch(/if \(!profile \|\| accepted\) return null;/);
    expect(notice).not.toMatch(/<Navigate\b/);
  });
});

describe("the promise and the code agree", () => {
  it("asks for exactly the version the Terms publish", () => {
    const published = terms.match(/Version\s+(\d+(?:\.\d+)*)/i);
    expect(published, "legal/terms.html has no version line").not.toBeNull();
    expect(TERMS_VERSION).toBe(published![1]);
    // And the prompt shows that version to the athlete, rather than a hardcoded
    // string that could drift from the constant.
    expect(notice).toContain("Version {TERMS_VERSION}");
    expect(notice).toContain("I accept version {TERMS_VERSION}");
  });

  it("keeps the clause that promises the prompt", () => {
    // Section 17 is the only clause that binds us to showing this. If someone
    // deletes the promise, this fails and the component above becomes
    // decoration rather than an obligation.
    expect(termsText).toMatch(/we will tell you in the app before it takes effect/i);
    expect(termsText).toMatch(/ask you to accept/i);
  });
});
