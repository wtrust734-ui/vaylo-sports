// ============================================================================
// THE APP'S LEGAL LINKS MUST MATCH THE PUBLISHED SITE'S LAYOUT
// ----------------------------------------------------------------------------
// This exists because of a bug that shipped. `VITE_LEGAL_BASE_URL` was set to
// the bare Netlify origin (https://vaylo-sports.netlify.app) instead of the
// documents' directory (.../legal). Every slug in legalUrls.ts is appended to
// that base, so 23 of the 26 documents resolved to
// https://vaylo-sports.netlify.app/<slug>/ — which is a 404. Two of the three
// that did not 404 were worse than a 404: /privacy/ and /contact/ exist at the
// site root as *different pages* (the Privacy & Data Centre and the Contact
// page), so tapping "Privacy Policy" in the app silently opened the wrong
// document.
//
// Nothing caught it. The bundle contained the string, `npm run site:build`
// passed, all 26 URLs on the host returned 200, and 618 tests passed — because
// every existing assertion checked that the *documents* were correct, never
// that the *link the app builds* pointed at them. It was found by tapping the
// row on a real device and reading the URL the Custom Tab had loaded.
//
// So the invariant asserted here is the join between two facts that live in
// different places and used to be checked separately:
//
//   1. `legalUrl(slug)` produces `<VITE_LEGAL_BASE_URL>/<slug>/`
//   2. the published site serves each document at `website/<base-path>/<slug>/`
//
// If the base changes and the site layout does not (or vice versa), this fails.
// It is deliberately offline: it reads the generated output rather than
// fetching, so it runs in CI and cannot pass because a network call was flaky.
// ============================================================================

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { LEGAL_BASE_URL, type LegalSlug } from "@/lib/legalUrls";

const root = resolve(__dirname, "../..");
const SITE = join(root, "website");

/** The path part of the configured base, e.g. "/legal" for ".../legal". */
const basePath = (() => {
  try {
    const u = new URL(LEGAL_BASE_URL);
    return u.pathname.replace(/\/+$/, "");
  } catch {
    // The inert "/legal" fallback used by an unconfigured build.
    return "";
  }
})();

describe("the app's legal links resolve on the published host", () => {
  it("points at an absolute URL, not the in-app /legal fallback", () => {
    // A relative base means an unconfigured build, where every legal link is
    // inert. That is a legitimate state for a local build but not for a
    // release, and a release that silently ships it looks identical in the
    // bundle to one that does not.
    expect(
      /^https?:\/\//.test(LEGAL_BASE_URL),
      `VITE_LEGAL_BASE_URL is "${LEGAL_BASE_URL}" — the released app's legal links would be inert`
    ).toBe(true);
  });

  it("uses the /legal directory, where the documents are actually published", () => {
    // The specific regression. The site root holds *other* pages (/privacy/,
    // /contact/, /support/…) whose names collide with some slugs, so a base of
    // "/" does not merely 404 — it links to the wrong page.
    expect(
      basePath,
      `VITE_LEGAL_BASE_URL is "${LEGAL_BASE_URL}"; the documents are published under website/legal/, not at the site root`
    ).toBe("/legal");
  });

  it("has a generated file behind every slug the app can link to", () => {
    // The registry is read out of the module, so a slug added to legalUrls.ts
    // is covered here without touching this test.
    const slugs: LegalSlug[] = [
      "privacy",
      "terms",
      "ai-disclaimer",
      "health-safety",
      "community-guidelines",
      "child-safety",
      "cookies",
      "competition-terms",
      "purchases",
      "refunds",
      "account-deletion",
      "data-rights",
      "intellectual-property",
      "advertising",
      "report-safety-concern",
      "report-content",
      "security-disclosure",
      "complaints",
      "ai-training-advice",
      "video-analysis-disclaimer",
      "injury-guidance",
      "nutrition-disclaimer",
      "mental-wellbeing",
      "wearable-health-privacy",
      "ai-data-use",
      "contact",
    ];

    const missing = slugs.filter(
      (slug) => !existsSync(join(SITE, `${basePath.slice(1)}/${slug}/index.html`))
    );
    expect(
      missing,
      `these app links would 404 on ${LEGAL_BASE_URL}: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("matches the slug list in the documents' own cross-link nav", () => {
    // A second, independent source of truth: the index the app opens. If a
    // document exists in the app's registry but not in the published index (or
    // vice versa) the athlete and the reviewer are reading different sets.
    const index = readFileSync(join(SITE, "legal/index.html"), "utf8");
    for (const slug of ["privacy", "terms", "cookies", "child-safety", "purchases"] as const) {
      expect(index, `legal/index.html does not link ${slug}`).toContain(`legal/${slug}/`);
    }
  });
});
