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

const slugToSource: Record<string, string> = {
  privacy: "legal/privacy.html",
  terms: "legal/terms.html",
  "account-deletion": "legal/account-deletion.html",
};

const workdir = mkdtempSync(join(tmpdir(), "legal-pages-"));
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

describe("generated legal pages", () => {
  it("covers every document Play asks for", () => {
    expect(Object.keys(LEGAL_PAGES).sort()).toEqual(["account-deletion", "privacy", "terms"]);
    for (const [slug, page] of Object.entries(LEGAL_PAGES)) {
      expect(page.title, `${slug} needs a title`).toBeTruthy();
      // A stub here would satisfy Play's URL check and fail a human reading it.
      expect(page.html.length, `${slug} looks truncated`).toBeGreaterThan(2000);
      expect(page.html, `${slug} is not a whole document`).toContain("<!doctype html>");
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
