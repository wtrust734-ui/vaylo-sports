// ============================================================================
// LEGAL PAGES LIVE IN THE APP
// ----------------------------------------------------------------------------
// Every legal link in the app used to call openExternal(): the browser opened
// on vaylo-sports.netlify.app, the app went to the background, and the reader
// lost their place — on the very documents that must be findable. The viewer
// route (/legal/:slug, src/pages/LegalDocument.tsx) renders the same
// published HTML inside the app instead.
//
// This suite pins the four things that made that a real change rather than a
// claim:
//   1. the route exists, top-level (no session gate — the sign-up screen links
//      to Terms before an account exists);
//   2. the viewer renders bundled content, with no network and no external
//      navigation;
//   3. no screen sends a legal document to the website any more;
//   4. every document the library promises is a document the generated module
//      actually contains — a link to a slug that is not published would 404
//      inside the app.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LEGAL_PAGES } from "../../supabase/functions/legal/pages.generated";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const app = read("/src/App.tsx");
const viewer = read("/src/pages/LegalDocument.tsx");
const legalPage = read("/src/pages/Legal.tsx");

describe("the document viewer route", () => {
  it("is registered, and lazy like the other late-loaded screens", () => {
    expect(app).toMatch(/const LegalDocument = lazy\(\(\) => import\("\.\/pages\/LegalDocument"\)\)/);
    // Wrapped in BareScreen on 2026-10-08: that wrapper is what gives the
    // screens rendered outside AppLayout the same entering fade every in-app
    // screen has, and it does not change the fact that this route is
    // registered here and lazy.
    expect(app).toMatch(
      /<Route path="\/legal\/:slug" element=\{<BareScreen><LegalDocument \/><\/BareScreen>} \/>/,
    );
  });

  it("sits outside AppLayout so a signed-out reader is not bounced to sign-in", () => {
    // The sign-up screen links to Terms and Privacy before an account exists.
    // Under AppLayout's session gate that link would redirect to /auth — the
    // wall this whole feature exists to avoid.
    const route = app.indexOf('<Route path="/legal/:slug"');
    const layout = app.indexOf('<Route element={<AppLayout />}');
    expect(route, "the viewer route is missing").toBeGreaterThan(-1);
    expect(layout, "AppLayout route not found").toBeGreaterThan(-1);
    expect(route, "the viewer route is inside AppLayout").toBeLessThan(layout);
  });
});

describe("the viewer renders bundled content", () => {
  it("reads the generated document module, not the website", () => {
    expect(viewer).toMatch(
      /import \{ LEGAL_PAGES \} from "\.\.\/\.\.\/supabase\/functions\/legal\/pages\.generated"/,
    );
    expect(viewer).not.toMatch(/fetch\(/);
    expect(viewer).not.toMatch(/openExternal/);
    expect(viewer).not.toMatch(/vaylo-sports\.netlify\.app/);
  });

  it("renders the document in an iframe (its styles must not reach the app)", () => {
    // The documents ship their own <style> with body/main/h1 rules. Injected
    // into the app DOM those rules would restyle the whole application.
    expect(viewer).toMatch(/srcDoc=\{page\.html\}/);
    expect(viewer).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("has a not-found state instead of a blank frame", () => {
    expect(viewer).toMatch(/Document not found/);
    expect(viewer).toMatch(/navigate\("\/legal"\)/);
  });
});

describe("no screen sends a legal document to the website", () => {
  const SURFACES = [
    "/src/pages/Legal.tsx",
    "/src/pages/Profile.tsx",
    "/src/pages/Safety.tsx",
    "/src/pages/Auth.tsx",
  ];

  it.each(SURFACES)("%s opens documents through the in-app route", (file) => {
    const src = read(file);
    expect(src, `${file} still opens a legal URL externally`).not.toMatch(
      /openExternal\((PRIVACY_POLICY_URL|TERMS_OF_SERVICE_URL|ACCOUNT_DELETION_URL|[A-Z_]*_URL)\)/,
    );
    expect(src, `${file} links the published site directly`).not.toMatch(
      /vaylo-sports\.netlify\.app\/legal/,
    );
  });

  it("no app screen anchors to a root-absolute legal path", () => {
    // A root-absolute href is a document load past the /play/ mount: it lands
    // on the marketing site's 404 (playMount.test.ts enforces this globally;
    // this re-checks it specifically for legal routes, which is where the
    // regression is most likely).
    for (const file of ["/src/pages/Legal.tsx", "/src/pages/Safety.tsx"]) {
      expect(read(file)).not.toMatch(/href=\{?["'`]\/legal/);
    }
  });
});

describe("the library promises only published documents", () => {
  /** Slugs listed in the Legal centre's LIBRARY table. */
  const librarySlugs = [...legalPage.matchAll(/slug: "([a-z-]+)"/g)].map((m) => m[1]);

  it("lists a meaningful library", () => {
    expect(librarySlugs.length).toBeGreaterThanOrEqual(20);
  });

  it("every slug in the app resolves to a generated document", () => {
    for (const slug of librarySlugs) {
      expect(LEGAL_PAGES[slug], `no generated document for "${slug}"`).toBeTruthy();
      expect(LEGAL_PAGES[slug].html, `"${slug}" has empty HTML`).toMatch(/<html/);
    }
  });

  it("every generated document is reachable from the library", () => {
    // The other direction: a document published on the site but absent from
    // the in-app list is a page a reader cannot find in the app.
    for (const slug of Object.keys(LEGAL_PAGES)) {
      expect(librarySlugs, `"${slug}" is not listed in the app library`).toContain(slug);
    }
  });

  it("legalPath is the single in-app path helper", () => {
    const urls = read("/src/lib/legalUrls.ts");
    expect(urls).toMatch(/export const legalPath = \(slug: LegalSlug\): string => `\/legal\/\$\{slug\}`/);
  });
});
