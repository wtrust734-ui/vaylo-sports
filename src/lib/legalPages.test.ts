// Guards the legal pages that supabase/functions/legal serves.
//
// Why this test exists: those pages are the URLs Google Play reviews for the
// store listing's privacy policy and for the Data deletion requirement. Play
// fetches them from a live URL — there is no build step in the loop, and a
// failure is invisible until a reviewer rejects the listing or a real user
// follows the link. `supabase/functions/**` is also outside every tsconfig, so
// nothing else in the pipeline reads this file.
//
// Three things can silently go wrong, and each has an assertion below:
//
//   1. the committed output no longer matches legal/*.html, because someone
//      edited a page and forgot to re-run the generator
//   2. a page that is not self-contained — a script, font or image fetched from
//      a third party — which is both broken offline and indefensible in a
//      document about data handling
//   3. an unresolved %%TOKEN%%, which would publish a policy that names no one
//      and cannot be contacted
//
// The reproducibility check regenerates rather than pattern-matching the
// existing file, so it fails on any drift, including one this test's author did
// not think of.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  CONTACT_EMAIL,
  LEGAL_PAGES,
  OPERATOR_NAME,
} from "../../supabase/functions/legal/pages.generated";

const root = resolve(__dirname, "../..");
const GENERATED = join(root, "supabase/functions/legal/pages.generated.ts");

/** Windows checkouts are CRLF (core.autocrlf=true); compare content, not endings. */
const toLf = (text: string) => text.replace(/\r\n?/g, "\n");

// The registry is the single source of truth for which documents exist.
// Reading it here rather than repeating the list means a page added to
// legal/pages.json is picked up automatically: this file can no longer disagree
// with the registry about what is published, which is the drift the test exists
// to catch. (It previously held its own hardcoded copy of the list, and the two
// drifted the moment a document was added.)
const REGISTRY = JSON.parse(
  readFileSync(join(root, "legal", "pages.json"), "utf8")
) as { pages: Record<string, string> };

const slugToSource: Record<string, string> = Object.fromEntries(
  Object.entries(REGISTRY.pages).map(([slug, file]) => [slug, `legal/${file}`])
);

/** The published set. Anything added to one must be added to the other. */
const EXPECTED_SLUGS = Object.keys(slugToSource).sort();

// The documents Google Play actually fetches. Named explicitly so that removing
// one from the registry fails loudly here, rather than silently breaking the
// store listing review months from now.
const PLAY_REQUIRED_SLUGS = ["privacy", "terms", "account-deletion"] as const;

const workdir = mkdtempSync(join(tmpdir(), "legal-pages-"));
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

describe("generated legal pages", () => {
  it("covers every document Play asks for", () => {
    expect(Object.keys(LEGAL_PAGES).sort()).toEqual(EXPECTED_SLUGS);
    for (const slug of PLAY_REQUIRED_SLUGS) {
      expect(LEGAL_PAGES, `${slug} is required by Google Play and must stay published`).toBeTruthy();
      expect(
        slugToSource[slug],
        `${slug} is required by Google Play but is missing from legal/pages.json`
      ).toBeTruthy();
    }
    for (const [slug, page] of Object.entries(LEGAL_PAGES)) {
      expect(page.title, `${slug} needs a title`).toBeTruthy();
      // A stub here would satisfy Play's URL check and fail a human reading it.
      expect(page.html.length, `${slug} looks truncated`).toBeGreaterThan(2000);
      expect(page.html, `${slug} is not a whole document`).toContain("<!doctype html>");
    }
  });

  // -----------------------------------------------------------------------
  // Cross-document integrity. Each document was written by hand against the
  // code, so the risk is not a broken page — it is two pages quietly
  // disagreeing, or a link pointing at a slug that does not exist.
  // -----------------------------------------------------------------------

  it("gives every document its own title, matching its own heading", () => {
    // A page whose <title> was copied from a donor file keeps the right body
    // and the wrong label. That happened once here: all twelve new documents
    // shipped with "<title>Cookie Policy</title>" while their <h1> and every
    // cross-link were correct. gen-website.cjs and the cross-link nav both read
    // the <title>, so the mistake was invisible in the rendered body and wrong
    // everywhere it mattered.
    const titles = new Map<string, string>();
    for (const [slug, page] of Object.entries(LEGAL_PAGES)) {
      const title = (page.html.match(/<title>([^<]*)<\/title>/i) ?? [])[1];
      expect(title, `${slug} has no <title>`).toBeTruthy();

      const clash = titles.get(title!);
      expect(clash, `"${title}" is used by both ${clash} and ${slug}`).toBeUndefined();
      titles.set(title!, slug);

      // The visible heading is the page's own identity; the title should be the
      // same words plus the site suffix.
      const h1 = (page.html.match(/<h1>([^<]*)<\/h1>/i) ?? [])[1];
      expect(h1, `${slug} has no <h1>`).toBeTruthy();
      expect(
        title!.startsWith(h1!),
        `${slug} titles itself "${title}" but its heading is "${h1}"`
      ).toBe(true);
    }
  });

  it("only links to documents that exist", () => {
    const slugs = new Set(Object.keys(LEGAL_PAGES));

    for (const [slug, page] of Object.entries(LEGAL_PAGES)) {
      const hrefs = [...page.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

      for (const href of hrefs) {
        if (href.startsWith("mailto:")) continue;

        const [target] = href.split("#");
        // A bare "#id" is an in-page anchor.
        if (target === "") continue;

        expect(
          slugs.has(target),
          `${slug} links to "${href}", which is not a published document`
        ).toBe(true);
      }
    }
  });

  it("gives every page a route back to the others", () => {
    for (const [slug, page] of Object.entries(LEGAL_PAGES)) {
      const links = [...page.html.matchAll(/href="([a-z-]+)"/g)].map((m) => m[1]);

      // Each page reaches at least ten of the others, so no document is an
      // island that a reader can only find from one particular screen.
      expect(links.length, `${slug} links to too few other documents`).toBeGreaterThanOrEqual(10);
    }
  });

  it("cross-links privacy, terms and deletion from the rest of the set", () => {
    // Google Play reviews these three by hand, and the documents that explain
    // the app's behaviour need to reach them.
    for (const slug of EXPECTED_SLUGS) {
      if (slug === "privacy" || slug === "terms" || slug === "account-deletion") continue;
      const html = LEGAL_PAGES[slug].html;

      expect(html, `${slug} never links the privacy policy`).toContain('href="privacy"');
      expect(html, `${slug} never links the terms`).toContain('href="terms"');
    }
  });

  it("substitutes the operator details, leaving no tokens behind", () => {
    for (const [slug, page] of Object.entries(LEGAL_PAGES)) {
      expect(page.html, `${slug} has an unresolved token`).not.toMatch(/%%[A-Z0-9_]+%%/);

      const source = toLf(readFileSync(join(root, slugToSource[slug]), "utf8"));
      if (!source.includes("%%CONTACT_EMAIL%%")) continue;

      expect(page.html, `${slug} lost its contact address`).toContain(CONTACT_EMAIL);
      expect(page.html, `${slug} should link the contact as mailto`).toContain(
        `mailto:${CONTACT_EMAIL}`
      );
    }

    // Naming the controller is a requirement, not a nicety; the policy and the
    // terms both do it.
    expect(LEGAL_PAGES.privacy.html).toContain(OPERATOR_NAME);
    expect(LEGAL_PAGES.terms.html).toContain(OPERATOR_NAME);
  });

  it("keeps every page self-contained: no scripts, no third-party resources", () => {
    for (const [slug, page] of Object.entries(LEGAL_PAGES)) {
      expect(page.html, `${slug} runs code`).not.toMatch(/<script[\s>]/i);
      expect(page.html, `${slug} fetches from a third party`).not.toMatch(
        /(?:src|href)\s*=\s*["']https?:\/\//i
      );
    }
  });

  it("is exactly what the generator produces from legal/ today", () => {
    const out = join(workdir, "pages.generated.ts");
    execFileSync(process.execPath, [join(root, "scripts/gen-legal-pages.cjs"), out], {
      cwd: root,
      stdio: "pipe",
    });

    expect(
      toLf(readFileSync(out, "utf8")),
      "supabase/functions/legal/pages.generated.ts is stale — run `node scripts/gen-legal-pages.cjs`"
    ).toBe(toLf(readFileSync(GENERATED, "utf8")));
  });
});
