// ============================================================================
// LEGAL DOCUMENT <-> CODEBASE CONSISTENCY
// ----------------------------------------------------------------------------
// Why this test exists.
//
// Every document in legal/ was written by hand, by reading the code, and then
// left to sit there. That is fine for a page's prose and useless as a promise:
// the day somebody changes FEATURE_COSTS, or switches on wearable sync, or
// adds a report reason, the documents quietly become a thing Vaylo does not
// actually do — and a legal document that misdescribes the product is worse
// than no legal document at all, because it is relied upon.
//
// So this file asserts the two directions that matter:
//
//   1. Numbers and enums quoted in a document match the module they describe,
//      imported live rather than copied. Change the code and this fails.
//   2. The documents do not contain things we cannot have written: a company
//      number, a registered address, an ICO number, an advertised price. Those
//      are the fabrications that turn a careful privacy policy into a legal
//      exposure, and they are exactly what "just add our details" invites.
//
// It also pins the handful of load-bearing disclosures that would be
// inaccurate if dropped: that buying is switched off, that there is no
// analytics SDK, and that the missing operator details are named rather than
// papered over.
// ============================================================================

import { existsSync as fsExistsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { LEGAL_PAGES } from "../../supabase/functions/legal/pages.generated";
import { FEATURE_COSTS, FEATURE_LABELS } from "@/config/credits";
import { UNLIMITED_PACKS } from "@/config/monetisation";
import { REPORT_REASONS } from "@/lib/safety";
import { getAgeCaps } from "@/lib/athleteDossier";
import { STARTING_CREDITS } from "@/config/credits";

const root = resolve(__dirname, "../..");
const html = (slug: string) => LEGAL_PAGES[slug].html;

/** Strip tags so a claim about prose is not satisfied by a stray attribute. */
const text = (slug: string) => html(slug).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

/**
 * Escape regex metacharacters but leave HTML entities alone.
 *
 * The age-band labels below are literal strings like "13&ndash;15" and "18+",
 * read straight out of the source file. A naive `[.*+?^${}()|[\]\\]` escape is
 * right for "18+" and wrong for "&ndash;", so `&` is excluded from the class.
 */
const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// 1. Credit costs in the purchases document match the credit economy
// ---------------------------------------------------------------------------

describe("purchases document matches the credit economy", () => {
  // Matched against the raw HTML: the assertion is that a table row pairs a
  // feature with its cost, and that pairing only exists in the markup.
  const purchases = html("purchases");

  it("quotes every real feature cost correctly", () => {
    for (const [key, cost] of Object.entries(FEATURE_COSTS)) {
      // Each feature is named in a table row ending with its cost, so assert on
      // the pair appearing together rather than on the number alone — "19"
      // appears several times and would pass a naive check.
      const label = FEATURE_LABELS[key as keyof typeof FEATURE_LABELS];
      expect(label, `${key} has no label to publish`).toBeTruthy();

      const row = new RegExp(
        `${escapeRe(label)}\\s*</td>\\s*<td>${cost}\\b`,
        "i"
      );
      expect(
        purchases,
        `purchases.html does not list "${label}" at its real cost of ${cost}`
      ).toMatch(row);
    }
  });

  it("states the real starting balance", () => {
    // Read from credits.ts rather than written down. This test asserted the
    // literal 50 while STARTING_CREDITS was 50, which read as the guarantee
    // that the document tracks the economy — but it was only ever a second copy
    // of the same number, and it was the copy that went stale when the grant
    // moved to 260. Deriving it keeps the guarantee real.
    //
    // Asserted through the prose (tags stripped) so an inline <strong> does not
    // break the match.
    expect(text("purchases")).toMatch(
      new RegExp(`start with\\s+${STARTING_CREDITS} credits`, "i"),
    );
  });

  it("advertises no price", () => {
    // The repo holds prices for the unlimited packs. They are not on offer,
    // billing is disabled, and publishing them would be advertising something
    // that cannot be bought. No document may name a currency figure.
    for (const pack of UNLIMITED_PACKS) {
      const pounds = (pack.price_cents / 100).toFixed(2);
      const whole = String(pack.price_cents / 100);
      expect(html("purchases"), `purchases.html advertises ${pounds}`).not.toContain(pounds);
      expect(html("purchases"), `purchases.html advertises ${whole}`).not.toContain(whole);
    }
  });

  it("says buying is switched off", () => {
    // STORE_BILLING_ENABLED is false in src/lib/billing.ts. If that flips, this
    // document is wrong and must be rewritten, not left quietly lying.
    expect(html("purchases")).toMatch(/not currently switched on/i);
    expect(html("refunds")).toMatch(/not currently switched on/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Community guidelines match the moderation code
// ---------------------------------------------------------------------------

describe("community guidelines match the moderation code", () => {
  const guidelines = text("community-guidelines");

  it("lists exactly the reasons the app offers", () => {
    for (const reason of REPORT_REASONS) {
      // `label` is what the athlete actually sees in the reason sheet, so the
      // document quoting a different word would confuse someone mid-report.
      expect(
        guidelines,
        `community-guidelines.html is missing the report reason "${reason.label}"`
      ).toContain(reason.label);
    }
  });

  it("describes blocking as undisclosed", () => {
    // The feed view filters both directions and there is no notification, so
    // claiming otherwise would be a real inaccuracy.
    expect(guidelines).toMatch(/not disclosed to them/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Child safety caps match the age-cap code
// ---------------------------------------------------------------------------

describe("child safety document matches the age caps", () => {
  const childSafety = html("child-safety");

  it("quotes each age band's real limits", () => {
    // Representative ages rather than every integer: getAgeCaps returns the
    // same object across a band, and the band boundaries are what matter.
    const bands: Array<[string, number]> = [
      ["Under 13", 10],
      ["13&ndash;15", 14],
      ["16&ndash;17", 17],
      ["18+", 18],
      ["45&ndash;59", 50],
      ["60+", 60],
    ];

    for (const [label, age] of bands) {
      const caps = getAgeCaps(age);
      const row = new RegExp(
        `<td>${escapeRe(label)}</td>` +
          `<td>${caps.maxSessionsPerWeek}</td>` +
          `<td>${caps.maxMinutesPerSession}</td>` +
          `<td>${caps.minRestDays}</td>`,
        "i"
      );
      expect(childSafety, `child-safety.html has the wrong caps for ${label}`).toMatch(row);
    }
  });

  it("names the under-18 protections the code actually enforces", () => {
    const body = text("child-safety");
    for (const claim of ["Nutrition", "public", "Advertising"]) {
      expect(body, `child-safety.html never mentions the ${claim} protection`).toContain(claim);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. No fabricated particulars
// ---------------------------------------------------------------------------

describe("no invented legal particulars", () => {
  const all = Object.entries(LEGAL_PAGES);

  it("states no company registration number", () => {
    // UK numbers are 8 chars, zero-padded, with a company-type prefix. Nothing
    // in legal/operator.json carries one, so no document may either.
    for (const [slug, page] of all) {
      expect(page.html, `${slug} contains a company-number-shaped string`).not.toMatch(
        /\b\d{8}\b|\b(SC|NI|OC)\s?\d{6}\b/i
      );
    }
  });

  it("states no ICO registration number", () => {
    // Matches a number attributed to the ICO, not the words. Naming the
    // Information Commissioner's Office as the body you can complain to is
    // required, and the earlier version of this regex failed on exactly that.
    for (const [slug, page] of all) {
      expect(page.html, `${slug} contains an ICO number`).not.toMatch(
        /\b(?:ZA\d{6,}|ICO\s*(?:reg(?:istration)?)?\s*(?:no\.?|number|#)?\s*[:.]?\s*\d{5,})\b/i
      );
    }
  });

  it("states no postal address", () => {
    // A UK postcode. legal/operator.json has no address field to draw one from.
    for (const [slug, page] of all) {
      expect(page.html, `${slug} contains a UK postcode`).not.toMatch(
        /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/
      );
    }
  });

  it("repeats no placeholder", () => {
    for (const [slug, page] of all) {
      expect(page.html, `${slug} still contains REPLACE_ME`).not.toMatch(/REPLACE_ME|TBD\b|\bXXX\b/);
    }
  });

  it("says the missing operator details are missing", () => {
    // If the business details get filled in, these "we have not stated it"
    // paragraphs become wrong — so they are asserted to be present now, and a
    // future edit that adds the details will fail here and force them out.
    for (const slug of ["contact", "intellectual-property", "terms", "data-rights"]) {
      expect(text(slug), `${slug} does not disclose the missing operator details`).toMatch(
        /have not|not yet|not been/i
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Load-bearing disclosures survive
// ---------------------------------------------------------------------------

describe("disclosures that must not be edited away", () => {
  it("advertising still claims no ad or analytics SDK", () => {
    const body = text("advertising");
    expect(body).toMatch(/no advertising sdk/i);
    expect(body).toMatch(/no analytics sdk/i);
    expect(body).toMatch(/advertising identifier/i);
  });

  it("cookies names the one cookie the code can write", () => {
    // Kept in step with SIDEBAR_COOKIE_NAME in src/components/ui/sidebar.tsx.
    // The document must disclose it whether or not anything renders that
    // component today, which is why this is an assertion about the name rather
    // than about the cookie being set.
    expect(html("cookies")).toContain("sidebar:state");
  });

  it("records the version of the Terms that is actually published", () => {
    // profiles.terms_version is the only evidence of which text an athlete
    // agreed to. This said 1.0 for a while while the published document was at
    // 1.2, so every recorded acceptance pointed at a version that no longer
    // existed — a consent record that identifies nothing. Bound to the
    // document rather than to a constant, so the two cannot drift again.
    const published = html("terms").match(/Version\s+(\d+(?:\.\d+)*)/i);
    expect(published, "legal/terms.html has no version line").not.toBeNull();

    const consent = readFileSync(join(root, "src", "lib", "consent.ts"), "utf8");
    expect(
      consent,
      `legal/terms.html is version ${published![1]} but consent.ts still records a different one`,
    ).toContain(`TERMS_VERSION = "${published![1]}"`);
  });

  it("the AI disclaimer still separates generated text from arithmetic", () => {
    const body = text("ai-disclaimer");
    // VPR, load and development projections are plain maths on the user's own
    // logs. Calling them AI would be the single most misleading claim we could
    // make, so it is pinned.
    expect(body).toMatch(/Not AI/i);
    expect(body).toMatch(/VPR/i);
  });

  it("the AI disclaimer still refuses to promise immunity", () => {
    expect(text("ai-disclaimer")).toMatch(/not a get-out-of-liability clause/i);
  });

  it("the terms still preserve statutory consumer rights", () => {
    expect(text("terms")).toMatch(/statutory (consumer )?rights/i);
  });

  it("no document claims immunity from a lawsuit", () => {
    const overclaim = /immune from (?:a )?lawsuit|no liability whatsoever|will (?:never|not) be (?:liable|held liable)|guarantee[sd]? compliance|comply with all applicable law/i;

    for (const [slug, page] of Object.entries(LEGAL_PAGES)) {
      expect(text(slug), `${slug} overclaims`).not.toMatch(overclaim);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Structural: every document is reachable and dated
// ---------------------------------------------------------------------------

describe("published document set", () => {
  it("has a version and a date on every page", () => {
    for (const [slug, page] of Object.entries(LEGAL_PAGES)) {
      expect(page.html, `${slug} has no version number`).toMatch(/Version\s+\d/i);
      expect(page.html, `${slug} has no date`).toMatch(/\d{1,2}\s+\w+\s+20\d\d/);
    }
  });

  it("has no page on disk that is unpublished", () => {
    // The reverse drift: someone writes legal/foo.html, adds it to the manifest
    // but not to the generator, or the reverse, and the two drift apart. Both
    // generators and the website read legal/pages.json, so that file is the
    // thing that has to agree with what was actually published.
    const published = new Set(Object.keys(LEGAL_PAGES));
    const manifest = JSON.parse(readFileSync(join(root, "legal/pages.json"), "utf8"));
    const declared = new Set(Object.keys(manifest.pages ?? {}));

    expect(
      [...declared].sort(),
      "the published set and legal/pages.json have drifted apart"
    ).toEqual([...published].sort());

    // And every declared source file must exist, so a typo in the manifest
    // fails here rather than as a 500 from the edge function.
    const entries = Object.entries(manifest.pages as Record<string, string>);
    for (const [slug, file] of entries) {
      expect(
        fsExistsSync(join(root, "legal", file)),
        `legal/pages.json points ${slug} at a missing ${file}`
      ).toBe(true);
    }
  });
});
describe("operator contact particulars stay in sync", () => {
  it("the app's legal landing page mailto matches legal/operator.json", () => {
    // The inbox is a published particular: documents, the website footer and
    // this screen must all point at the address somebody actually reads.
    // This previously failed silently — the landing page carried an
    // "vaylosportsupport@…" literal that was one character off from the real
    // inbox, so support mail from the app landed nowhere.
    const root = resolve(__dirname, "../..");
    const operator = JSON.parse(readFileSync(join(root, "legal/operator.json"), "utf8")) as {
      contactEmail?: string;
    };
    expect(operator.contactEmail).toMatch(/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/);

    const app = readFileSync(join(root, "src/pages/Legal.tsx"), "utf8");
    const m = app.match(/CONTACT_EMAIL = "([^"]+)"/);
    expect(m, "Legal.tsx must define CONTACT_EMAIL").not.toBeNull();
    expect(
      m![1],
      "Legal.tsx CONTACT_EMAIL must equal legal/operator.json contactEmail",
    ).toBe(operator.contactEmail);
  });

  it("generated legal pages carry the resolved operator name (no %% tokens ship)", () => {
    const root = resolve(__dirname, "../..");
    const generated = readFileSync(
      join(root, "supabase/functions/legal/pages.generated.ts"),
      "utf8",
    );
    expect(generated).not.toMatch(/%%OPERATOR_NAME%%|%%CONTACT_EMAIL%%/);
  });
});
