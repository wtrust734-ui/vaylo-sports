// ============================================================================
// WEBSITE TESTS
// ----------------------------------------------------------------------------
// What this guards, and why each thing is a test rather than a checklist item.
//
// The brief for this site was not "make a nice page". It was "make a page that
// does not lie" — no invented company details, no fake store links, no forms
// that appear to work and do not, no legal document that contradicts the app.
// Every one of those is exactly the kind of failure that is invisible in a
// review and expensive in production, so each one has an assertion here.
//
// The structural tests matter for the same reason. A site with one <h1>, real
// landmarks and a working skip link is accessible; a site that "looks fine" in a
// screenshot frequently has two <h1>s and no skip link, and nobody notices until
// a screen reader user cannot find the navigation.
//
// The suite regenerates the site into a temp directory and compares it with the
// committed output, so an un-regenerated website/ fails here rather than
// shipping stale content — the same pattern the legal pages use.
// ============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const OUT = join(root, "website");
const GENERATOR = join(root, "scripts/gen-website.cjs");

const toLf = (text: string) => text.replace(/\r\n?/g, "\n");

/** Every generated file, as repo-relative POSIX paths. */
function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

const workdir = mkdtempSync(join(tmpdir(), "vaylo-site-"));
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

/**
 * Deliberately NO regeneration of website/ here.
 *
 * This file used to run the generator with no output argument, which does
 * `rmSync(website)` and rewrites it. Two things were wrong with that, and they
 * hid each other:
 *
 *   1. The staleness test below compares website/ against a fresh generation in
 *      a temp directory. If website/ had just been regenerated, it was comparing
 *      the generator against itself — so it passed for a stale committed tree,
 *      which is the only thing it exists to catch.
 *
 *   2. vitest runs files in parallel. Emptying website/ for the length of a
 *      build raced every other file that reads it. legalHostLayout.test.ts read
 *      website/ and saw ENOENT for files that plainly existed; appPreview.test.ts
 *      hit the same thing and worked around it with a private output directory.
 *      A test must not mutate the tree other tests read.
 *
 * So website/ is read exactly as committed, and the freshness comparison below
 * is real. If a committed file is stale, this file fails and says to run
 * `node scripts/gen-website.cjs` — which is the message it already carried.
 */
/**
 * The app bundle's mount point inside website/.
 *
 * website/ is two trees. gen-website.cjs writes the marketing and legal pages;
 * scripts/deploy-web.cjs then builds the React app into play/ so the preview
 * ships in the same deploy. This file is about the first. The second is a Vite
 * SPA shell plus hashed chunks — it has no header, no footer, no meta
 * description and no h1 in the served HTML, by design, and asserting otherwise
 * would be asserting that a React app is a static page.
 *
 * Asserted in src/lib/playMount.test.ts instead, against what actually matters
 * for a bundle: prefixed asset URLs, the mount prefix in the entry chunk, the
 * SPA redirect order, and the embed on /app/.
 */
const APP_BUNDLE = "play/";

/** True for a path belonging to the app bundle rather than a generated page. */
const isAppBundle = (file: string) => file.startsWith(APP_BUNDLE);

// Every assertion in this file runs over the generated pages only, so the
// bundle is filtered out once here rather than at each of the dozen use sites —
// and so a new assertion cannot accidentally start covering the app shell.
/**
 * Files a deploy tool leaves in website/, rather than site output.
 *
 * `vercel link` writes `.vercel/` (project linkage) and `.env.local`; the
 * generator knows nothing about either. Without this filter, deploying the site
 * makes the staleness test below report "the committed website/ does not match a
 * fresh generation" on that machine and nowhere else — a failure that punishes
 * having deployed, and would train the next person to regenerate blindly.
 */
const isDeployArtifact = (file: string) =>
  file.startsWith(".vercel/") || file === ".env.local" || file === ".gitignore";

const files = walk(OUT).filter((f) => !isAppBundle(f) && !isDeployArtifact(f));
const htmlFiles = files.filter((f) => f.endsWith(".html"));
const read = (file: string) => toLf(readFileSync(join(OUT, file), "utf8"));

/** Strip tags, for asserting on prose rather than markup. */
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

/**
 * The Supabase URL the committed tree was generated with, read back out of the
 * committed config.js rather than hard-coded. If someone regenerates the site
 * against a different project, the matched-environment comparison follows
 * automatically instead of failing on a value nobody updated.
 */
const COMMITTED_SUPABASE_URL =
  /supportEndpoint: "([^"]+)"/.exec(read("assets/config.js"))?.[1]?.replace(
    /\/functions\/v1\/support-request$/,
    "",
  ) ?? "https://placeholder.supabase.co";

/**
 * Which generated files depend on the build environment.
 *
 * Computed by generating the site twice under two different VITE_SUPABASE_URL
 * values and diffing. Everything that differs is environment-dependent by
 * definition, so this cannot be wrong about a file it has not seen — and the
 * companion test asserts the resulting set against a reviewed list, so it also
 * cannot grow unnoticed.
 */
const envDependent = new Set<string>();
{
  const a = join(workdir, "env-a");
  const b = join(workdir, "env-b");
  execFileSync(process.execPath, [GENERATOR, a], {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, VITE_SUPABASE_URL: "https://env-a.supabase.co" },
  });
  execFileSync(process.execPath, [GENERATOR, b], {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, VITE_SUPABASE_URL: "https://env-b.supabase.co" },
  });
  for (const file of walk(a)) {
    if (readFileSync(join(a, file), "utf8") !== readFileSync(join(b, file), "utf8")) {
      envDependent.add(file);
    }
  }
}

/**
 * The reviewed list, in two parts.
 *
 * ALWAYS_ENV_DEPENDENT is unconditional: config.js embeds the Supabase
 * functions URL, so it changes with VITE_SUPABASE_URL whether or not the site
 * has a domain.
 *
 * SITE_URL_ENV_DEPENDENT only applies when the generator has an origin to embed.
 * With SITE_URL unset the generator falls back to relative canonicals, relative
 * sitemap entries and a relative robots.txt sitemap line — so on such a build
 * none of them move, and claiming otherwise would make this test demand files
 * the generator deliberately does not vary. Deriving the expectation from
 * whether SITE_URL is set is the honest version of the same check; either way a
 * NEW environment-dependent file still shows up as a diff.
 */
const ALWAYS_ENV_DEPENDENT = ["assets/config.js"];
const SITE_URL_ENV_DEPENDENT = ["robots.txt", "sitemap.xml"];
const EXPECTED_ENV_DEPENDENT = [
  ...ALWAYS_ENV_DEPENDENT,
  ...(process.env.SITE_URL?.trim() ? SITE_URL_ENV_DEPENDENT : []),
];

// ---------------------------------------------------------------------------
// 1. The generator is reproducible
// ---------------------------------------------------------------------------

describe("generated website", () => {
  // 60s, not the 5s default. Two full generations (one here, one under a
  // matched environment) plus an all-files comparison is slower than the
  // default even though nothing large is written any more: the device
  // screenshots went with the app preview on 2026-10-08, so website/ is about
  // 1 MB of HTML and one logo. A timeout here would read as "the generator is
  // broken", which is the opposite of what a slow test means.
  it("is exactly what the generator produces today", { timeout: 60_000 }, () => {
    const out = join(workdir, "website");
    execFileSync(process.execPath, [GENERATOR, out], { cwd: root, stdio: "pipe" });

    // The app bundle is compared separately and only when it is present, so
    // neither side of this comparison includes it: the generator never emits
    // play/, and comparing 300 hashed chunks against a marketing page list
    // would say nothing about staleness.
    const fresh = walk(out).filter((f) => !isAppBundle(f)).sort();
    expect(fresh, "the committed website/ does not match a fresh generation").toEqual(
      files.slice().sort()
    );

    for (const file of fresh) {
      // An environment-dependent file cannot be compared against a generation
      // made with a different environment — not a staleness signal, just a
      // different build. Which files those are is computed below rather than
      // listed, so a new one cannot slip in unexamined.
      if (envDependent.has(file)) continue;
      expect(
        toLf(readFileSync(join(out, file), "utf8")),
        `website/${file} is stale — run \`node scripts/gen-website.cjs\``
      ).toBe(read(file));
    }
  });

  it("compares the environment-dependent files under a matched environment", { timeout: 60_000 }, () => {
    // Regenerate using the values the committed tree was built from, then compare
    // those files exactly too. Without this they would go unchecked entirely.
    const out = join(workdir, "matched");
    execFileSync(process.execPath, [GENERATOR, out], {
      cwd: root,
      stdio: "pipe",
      env: { ...process.env, VITE_SUPABASE_URL: COMMITTED_SUPABASE_URL },
    });

    for (const file of envDependent) {
      expect(
        toLf(readFileSync(join(out, file), "utf8")),
        `website/${file} is stale — run \`node scripts/gen-website.cjs\``
      ).toBe(read(file));
    }
  });

  it("knows exactly which generated files depend on the build environment", () => {
    // Derived, not declared: two generations differing only in the environment
    // must differ in exactly these files, no more and no fewer.
    expect([...envDependent].sort()).toEqual([...EXPECTED_ENV_DEPENDENT].sort());
    // And nothing outside the two reviewed sets may appear in it, whatever the
    // environment. A growing set means a new file has picked up an
    // environment-dependent value, which is a deliberate decision to make
    // rather than a silent exclusion.
    for (const file of envDependent) {
      expect(
        file.endsWith(".html") ||
          ALWAYS_ENV_DEPENDENT.includes(file) ||
          SITE_URL_ENV_DEPENDENT.includes(file),
        `website/${file} now depends on the build environment; add it to a reviewed set on purpose`,
      ).toBe(true);
    }
  });

  it("excludes only the app bundle from the generated-page assertions", () => {
    // If the bundle is not there, the exclusion is untested — and the marketing
    // assertions would start passing on the app shell, or failing on it,
    // depending on what a build happened to leave behind.
    const bundle = walk(OUT).filter((f) => f.startsWith("play/"));
    if (bundle.length === 0) {
      // No build present (website/ is committed without one). Nothing to scope
      // out; playMount.test.ts covers the bundle when it is built.
      expect(htmlFiles.some((f) => f.startsWith("play/"))).toBe(false);
      return;
    }

    expect(
      htmlFiles.filter((f) => f.startsWith("play/")),
      "the app bundle is being treated as a generated marketing page",
    ).toEqual([]);
    // The bundle is a real SPA, so its shell is HTML but has no <h1> in the
    // served document. That is the concrete reason the exclusion exists, and it
    // is worth stating as a fact that can change rather than a belief.
    const shell = join(OUT, "play", "index.html");
    if (existsSync(shell)) {
      expect(readFileSync(shell, "utf8"), "the bundle shell is no longer an SPA shell").not.toContain(
        "<footer",
      );
    }
  });

  it("publishes every page the site needs", () => {
    for (const route of [
      "index.html",
      "features/index.html",
      "safety/index.html",
      "legal/index.html",
      "privacy/index.html",
      "delete-account/index.html",
      "support/index.html",
      "about/index.html",
      "contact/index.html",
      "404.html",
      "assets/theme.css",
      "assets/site.js",
      "assets/config.js",
      "assets/logo.png",
      "robots.txt",
      "sitemap.xml",
    ]) {
      expect(files, `website/${route} is missing`).toContain(route);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Every link resolves
// ---------------------------------------------------------------------------

/**
 * Routes that are legitimately not generated pages, read from the generator so
 * the two cannot drift apart.
 *
 * Empty since the live-app preview (the /play/ mount and the /app/ pages that
 * embedded it) was deleted from the main website: every internal href must now
 * resolve to a file the generator writes. The parse stays because an exception
 * added to the generator must be visible here too — the list is read from one
 * place rather than duplicated.
 */
const NON_PAGE_ROUTES: string[] = Array.from(
  (
    readFileSync(join(root, "scripts", "gen-website.cjs"), "utf8").match(
      /const NON_PAGE_ROUTES = new Set\(\[([\s\S]*?)\]\)/,
    )?.[1] ?? ""
  ).matchAll(/"([^"]+)"/g),
  (m) => m[1],
);

describe("links", () => {
  it("reads the generator's list of non-page routes rather than duplicating it", () => {
    // Parses, and is empty: the app preview that needed an exception is gone.
    expect(
      NON_PAGE_ROUTES,
      "could not parse NON_PAGE_ROUTES out of gen-website.cjs",
    ).toEqual([]);
  });

  it("has no internal link to a page that does not exist", () => {
    for (const file of htmlFiles) {
      const html = read(file);
      const hrefs = [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);

      for (const href of hrefs) {
        const [route] = href.split("#");
        const [path] = route.split("?");
        if (path === "") continue;
        if (NON_PAGE_ROUTES.includes(path)) continue;

        const target = path.endsWith("/")
          ? `${path.slice(1)}index.html`
          : path.slice(1);

        expect(
          files,
          `${file} links to ${path}, which was not generated`
        ).toContain(target);
      }
    }
  });

  it("resolves every in-page anchor to an element on that page", () => {
    for (const file of htmlFiles) {
      const html = read(file);
      const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
      const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);

      for (const anchor of anchors) {
        expect(ids, `${file} links to #${anchor}, which does not exist on the page`).toContain(
          anchor
        );
      }
    }
  });

  it("uses only the one real contact address", () => {
    const operator = JSON.parse(readFileSync(join(root, "legal/operator.json"), "utf8"));
    const allowed = new Set([operator.contactEmail]);

    for (const file of htmlFiles) {
      const emails = [...read(file).matchAll(/mailto:([^"?]+)/g)].map((m) => m[1]);
      for (const email of emails) {
        expect(allowed, `${file} links a mailto for ${email}, which is not the operator inbox`).toContain(
          email
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Accessibility structure
// ---------------------------------------------------------------------------

describe("accessibility", () => {
  it("gives every page exactly one h1, a title and a description", () => {
    for (const file of htmlFiles) {
      const html = read(file);
      const h1s = (html.match(/<h1[\s>]/g) ?? []).length;

      expect(h1s, `${file} has ${h1s} <h1> elements — screen readers need exactly one`).toBe(1);
      expect(html, `${file} has no <title>`).toMatch(/<title>[^<]+<\/title>/);
      expect(html, `${file} has no meta description`).toMatch(
        /<meta name="description" content="[^"]{20,}"/i
      );
      expect(html, `${file} does not declare a language`).toMatch(/<html lang="[a-z-]+"/i);
    }
  });

  it("gives every page the landmarks and a skip link", () => {
    for (const file of htmlFiles) {
      const html = read(file);
      for (const landmark of ["<header", "<main", "<footer", "<nav"]) {
        expect(html, `${file} has no ${landmark} landmark`).toContain(landmark);
      }
      // The skip link must be the first focusable thing on the page.
      expect(html, `${file} has no skip link`).toMatch(/class="skip" href="#main"/);
      expect(html, `${file} has no main target for the skip link`).toContain('id="main"');
    }
  });

  it("gives every image an alt attribute", () => {
    for (const file of htmlFiles) {
      for (const img of read(file).match(/<img\b[^>]*>/g) ?? []) {
        expect(img, `${file} has an <img> with no alt attribute`).toMatch(/\salt="[^"]*"/);
      }
    }
  });

  it("labels every form control", () => {
    for (const file of htmlFiles) {
      const html = read(file);
      const ids = new Set([...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));
      const labelled = new Set(
        [...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((m) => m[1])
      );

      for (const id of ids) {
        expect(labelled, `${file} has a form control #${id} with no <label for>`).toContain(id);
      }
    }
  });

  /**
   * Pages that are deliberately in no navigation item.
   *
   * `aria-current="page"` marks WHICH nav link you are on, so a page that is in
   * no nav item has nothing to mark — the assertion would be asking it to point
   * at a link that does not exist, and the only ways to satisfy it would be to
   * add the page to the nav (unhiding it) or to mark an unrelated link (a lie).
   *
   *   404.html    Not a destination. Nothing links to it on purpose.
   *   coaches/    The coach marketplace page, which is noindex, out of the sitemap
   *               and named by no nav or footer link until the marketplace is
   *               switched on (site/pages/coaches.mjs, docs/COACH-MARKETPLACE.md
   *               §6). Its absence from the nav is the feature, not an oversight.
   *
   * The exemption is narrow and it is not a hole: every assertion that makes the
   * coach page hidden — noindex, absent from sitemap.xml, named by no nav or
   * footer link — lives in src/lib/coachMarketplace.test.ts. Any page that IS in
   * the navigation still has to mark itself, because for those the missing marker
   * is exactly the failure this test exists to catch.
   */
  const NOT_IN_NAV = new Set(["404.html", "coaches/index.html"]);

  it("states the current page in the navigation", () => {
    for (const file of htmlFiles.filter((f) => !NOT_IN_NAV.has(f))) {
      expect(read(file), `${file} never marks the current page`).toContain('aria-current="page"');
    }
  });

  it("never removes focus styling", () => {
    const css = readFileSync(join(OUT, "assets/theme.css"), "utf8");
    expect(css, "the stylesheet removes the focus outline").not.toMatch(/outline:\s*(none|0)\s*;/);
    expect(css, "the stylesheet has no visible focus style").toContain(":focus-visible");
  });

  it("respects reduced-motion preferences", () => {
    const css = readFileSync(join(OUT, "assets/theme.css"), "utf8");
    expect(css).toContain("prefers-reduced-motion");
  });
});

// ---------------------------------------------------------------------------
// 4. The footer the brief requires
// ---------------------------------------------------------------------------

describe("footer", () => {
  const REQUIRED = [
    "/legal/privacy/",
    "/legal/terms/",
    "/safety/",
    "/legal/child-safety/",
    "/legal/community-guidelines/",
    "/legal/cookies/",
    "/legal/purchases/",
    "/legal/refunds/",
    "/delete-account/",
    "/support/",
    "/contact/",
    "/about/",
  ];

  it("appears on every page with every required link", () => {
    for (const file of htmlFiles) {
      const html = read(file);
      expect(html, `${file} has no footer`).toContain("<footer");

      for (const href of REQUIRED) {
        expect(html, `${file} is missing a footer link to ${href}`).toContain(`href="${href}"`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Forms are real or explicitly unavailable — never fake
// ---------------------------------------------------------------------------

describe("forms", () => {
  it("never renders a form that submits nowhere", () => {
    for (const file of htmlFiles) {
      const html = read(file);
      if (!html.includes("data-vaylo-form")) continue;

      // Every form must either declare the honeypot and a submit button and a
      // status region (the shape site.js expects), or be marked unavailable.
      expect(html, `${file} has a form with no status region`).toContain("data-status");
      expect(html, `${file} has a form with no submit button`).toContain('type="submit"');
      expect(html, `${file} has a form with no honeypot`).toContain('name="company_website"');
      expect(html, `${file} has a form with no aria-live status`).toContain('aria-live="polite"');
    }
  });

  it("never claims success without a server response", () => {
    const js = readFileSync(join(OUT, "assets/site.js"), "utf8");

    // The success copy must be reachable only from the 2xx branch.
    expect(js, "the client shows success text but never checks the response").toContain(
      "if (!result.ok)"
    );
    expect(js).toContain('status.className = "form-status" + (kind ? " is-" + kind : "")');
    expect(js, "the client never restores the submit button after an error").toContain(
      "submit.textContent = originalText"
    );
    expect(js, "the client does not handle a network failure").toContain(".catch(");
  });

  it("disables the forms and says so when no endpoint is configured", () => {
    const js = readFileSync(join(OUT, "assets/site.js"), "utf8");
    expect(js, "the client does not check for a missing endpoint").toContain("if (!endpoint)");
    expect(js, "the client does not disable the button when unavailable").toContain(
      "submit.disabled = true"
    );
    expect(js).toContain("The online form is not available yet");
  });
});

// ---------------------------------------------------------------------------
// 6. No fabricated facts
// ---------------------------------------------------------------------------

describe("no invented information", () => {
  const all = htmlFiles.map(read);
  const allText = all.map(text).join(" ");

  it("states no company registration number", () => {
    for (const html of all) {
      expect(html).not.toMatch(/\b\d{8}\b|\b(SC|NI|OC)\s?\d{6}\b/i);
    }
  });

  it("states no postal address", () => {
    for (const html of all) {
      expect(html).not.toMatch(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/);
    }
  });

  it("states no ICO registration number", () => {
    expect(allText).not.toMatch(/\b(?:ZA\d{6,}|ICO\s*(?:reg(?:istration)?)?\s*(?:no\.?|number|#)?\s*[:.]?\s*\d{5,})\b/i);
  });

  it("links no Play Store listing, because there is not one", () => {
    for (const html of all) {
      expect(html).not.toMatch(/play\.google\.com\/store\/apps/i);
      expect(html).not.toMatch(/[?&]id=com\./);
    }
  });

  it("publishes no phone number that does not exist", () => {
    // The only numbers on the site are real, public UK helplines (NSPCC, Childline)
    // which are correct, useful and must not be treated as contact routes for Vaylo.
    const REAL_HELPLINES = ["08088000111", "08001111"];
    for (const chunk of allText.match(/[\d()\s-]{10,}/g) ?? []) {
      const digits = chunk.replace(/\D/g, "");
      if (digits.length < 10) continue;
      expect(
        REAL_HELPLINES,
        `a phone number on the site is not a known real helpline: ${digits}`
      ).toContain(digits);
    }
  });

  it("contains no leftover placeholder", () => {
    for (const file of htmlFiles) {
      const html = read(file);
      expect(html, `${file} still contains a placeholder`).not.toMatch(
        /CONTACT_EMAIL_PLACEHOLDER|%%[A-Z_]+%%|REPLACE_ME|\bTODO\b/
      );
    }
  });

  it("makes no claim that is not true of the app", () => {
    // Each of these is a claim a sports app makes routinely and Vaylo cannot.
    // The patterns target *affirmative* constructions only. An earlier version
    // matched "guarantee performance" and failed on the site's own footer,
    // which says Vaylo does NOT claim to guarantee performance — a test that
    // punishes the disclaimer for being there is a test that gets deleted.
    const forbidden: Array<[string, RegExp]> = [
      ["world's best", /world'?s (best|leading|number one)/i],
      ["we guarantee results", /\b(?:we|vaylo)\s+guarantee/i],
      ["a guaranteed outcome", /guarantee[sd]?\s+that\s+you/i],
      ["injury prevention", /prevent(s|ing)?\s+injuries/i],
      ["medically approved", /medically approved|clinically validated|doctor approved/i],
      ["certified by a body", /certified by|accredited by|approved by (FIFA|IOC|UEFA)/i],
      ["immunity from liability", /immune from|no liability whatsoever|free from all liability/i],
      ["guaranteed compliance", /guarantee[sd]? compliance|complies with all applicable law/i],
      ["press quote or rating", /rated .{0,20}(stars|out of 5)|best app award/i],
      ["user count", /\d[\d,.]*\+?\s*(users|athletes|downloads)/i],
    ];

    for (const [label, pattern] of forbidden) {
      expect(allText, `the site makes a ${label} claim`).not.toMatch(pattern);
    }
  });

  it("carries the disclaimer rather than relying on it", () => {
    // The point of writing the disclaimer is that it appears where the claims
    // are. Asserted on every page so it cannot be quietly dropped from the
    // footer, which is the only place some visitors will see it.
    for (const file of htmlFiles) {
      expect(
        read(file),
        `${file} has no standing disclaimer`
      ).toMatch(/does not claim to prevent injury|not medical advice/i);
    }
  });

  it("publishes no app screenshot, because the app preview was removed", () => {
    // The homepage used to carry one device capture of the Training screen in a
    // phone mockup, under the caption "Real screen from the app". It was removed
    // on 2026-10-08 at the owner's request, along with the generator step that
    // copied the file out of .freebuff/.
    //
    // This is asserted across every page rather than just the homepage, and
    // against the assets directory as well as the markup: the failure this
    // catches is the file being reintroduced on a page (or left behind in the
    // output) by a later edit, and a single-screen capture is the one image a
    // site like this publishes that looks like a product tour without being one.
    expect(
      files.filter((f) => f.startsWith("assets/screenshots")),
      "the site is publishing app screenshots again — the app preview was removed",
    ).toEqual([]);
    for (const file of htmlFiles) {
      expect(read(file), `${file} still references an app screenshot`).not.toContain(
        "/assets/screenshots/"
      );
      expect(read(file), `${file} still carries a phone mockup`).not.toContain('class="phone"');
    }
  });
});

// ---------------------------------------------------------------------------
// 7. The legal centre publishes every document
// ---------------------------------------------------------------------------

describe("legal centre", () => {
  const manifest = JSON.parse(readFileSync(join(root, "legal/pages.json"), "utf8"));
  const slugs = Object.keys(manifest.pages) as string[];

  it("publishes every document in the manifest", () => {
    for (const slug of slugs) {
      expect(files, `legal/${slug} is not published on the site`).toContain(
        `legal/${slug}/index.html`
      );
    }
  });

  it("lists every document on the index", () => {
    const index = read("legal/index.html");
    for (const slug of slugs) {
      expect(index, `the Legal Centre does not link ${slug}`).toContain(`href="/legal/${slug}/"`);
    }
  });

  it("publishes documents with operator details substituted", () => {
    const operator = JSON.parse(readFileSync(join(root, "legal/operator.json"), "utf8"));
    for (const slug of slugs) {
      const html = read(`legal/${slug}/index.html`);
      expect(html, `legal/${slug} has an unresolved token`).not.toMatch(/%%[A-Z_]+%%/);
      expect(html, `legal/${slug} does not name the operator`).toContain(operator.operatorName);
    }
  });

  it("routes a document's internal cross-links onto website paths", () => {
    for (const slug of slugs) {
      const html = read(`legal/${slug}/index.html`);
      // A bare `href="privacy"` would resolve relative to /legal/x/ and 404.
      expect(html, `legal/${slug} has a document-relative link that will 404`).not.toMatch(
        /href="(?!#|mailto:|https?:|\/)[a-z][a-z0-9-]*"/i
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 8. The site matches the app
// ---------------------------------------------------------------------------

describe("consistency with the app", () => {
  it("describes the sports the app actually offers", async () => {
    const { SPORTS } = await import("../../site/data/site.mjs");
    const home = read("index.html");
    for (const sport of ["Running", "Cycling", "Swimming", "Football", "Basketball", "Tennis"]) {
      expect(home, `the site does not mention ${sport}`).toContain(sport);
    }
    expect(SPORTS.length).toBeGreaterThan(15);
  });

  it("marks the AI features as not yet switched on", () => {
    const features = read("features/index.html");
    const t = text(features);
    expect(t).toMatch(/Built, not yet switched on/i);
    expect(t).toMatch(/Deliberately off/i);
  });

  it("does not advertise the disabled integrations as working", () => {
    const t = text(read("features/index.html"));
    expect(t).toMatch(/Wearable and health sync[\s\S]{0,220}?(not switched|switched off|no data moves|disabled)/i);
  });
});

// ---------------------------------------------------------------------------
// 6. The brand logo
// ---------------------------------------------------------------------------

const layoutSource = () => readFileSync(join(root, "site/layout.mjs"), "utf8");

describe("brand logo", () => {
  it("publishes the logo asset", () => {
    expect(files).toContain("assets/logo.png");
  });

  it("is a PNG with an alpha channel, not a JPEG", () => {
    // A JPEG cannot carry transparency. The supplied source was a 500x500 JPEG
    // on a pure black background, which would render as a black square on the
    // dark header and as a black blob in the light theme, so the asset must be
    // an RGBA PNG.
    const bytes = readFileSync(join(OUT, "assets/logo.png"));
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes[25]).toBe(6); // 6 = RGBA
  });

  it("is sized for a 34px mark rather than shipped at 500px", () => {
    // 128px is roughly 3.7x the CSS display size, which is enough for HiDPI
    // without carrying a 14 KB JPEG for a 34px image.
    const bytes = readFileSync(join(OUT, "assets/logo.png"));
    const width = bytes.readUInt32BE(16);
    expect(width).toBeGreaterThanOrEqual(96);
    expect(width).toBeLessThanOrEqual(256);
  });

  it("appears in the header and footer of every generated page", () => {
    const missing = htmlFiles.filter((f) => !read(f).includes("/assets/logo.png"));
    expect(missing).toEqual([]);
  });

  it("no longer renders the old CSS-drawn brand square", () => {
    // The mark used to be an empty span filled with a gradient. Left in place it
    // would draw a square behind the logo.
    expect(layoutSource()).not.toMatch(/<span class="brand-mark"/);
  });

  it("is decorative, because the wordmark beside it carries the name", () => {
    // alt="" is correct: the adjacent "Vaylo Sports" text is the accessible
    // name, so alt="Vaylo Sports" would make a screen reader say it twice.
    const layout = layoutSource();
    const tags = layout.match(/<img[\s\S]*?class="brand-mark"[\s\S]*?\/>/g) || [];
    expect(tags).toHaveLength(2);
    for (const tag of tags) expect(tag).toMatch(/alt=""/);
  });

  it("gives the image intrinsic size, so it does not shift the header on load", () => {
    for (const tag of layoutSource().match(
      /<img[\s\S]*?class="brand-mark"[\s\S]*?\/>/g,
    ) || []) {
      expect(tag).toMatch(/width="34"/);
      expect(tag).toMatch(/height="34"/);
    }
  });
});

// ---------------------------------------------------------------------------
// Host config
// ---------------------------------------------------------------------------

describe("website — Vercel host config", () => {
  it("is generated, so a rebuild cannot silently drop it", () => {
    // gen-website does rmSync(website) before it writes. vercel.json carries the
    // security headers, and a deploy without it ships the origin without them
    // with no build error to say so — which is exactly what happened once.
    // Generating it from site/vercel.json, rather than placing it in website/ by
    // hand, is the fix.
    expect(
      existsSync(join(OUT, "vercel.json")),
      "website/vercel.json is missing — run `node scripts/gen-website.cjs`"
    ).toBe(true);
  });

  it("matches site/vercel.json exactly", () => {
    expect(read("vercel.json")).toBe(
      toLf(readFileSync(join(root, "site/vercel.json"), "utf8"))
    );
  });

  it("keeps the security headers and no longer carries the removed preview rewrite", () => {
    const cfg = JSON.parse(read("vercel.json")) as {
      rewrites?: { source: string; destination: string }[];
      headers?: { source: string; headers: { key: string; value: string }[] }[];
    };
    // The /play/ mount was deleted from the main website with the app preview;
    // a rewrite pointing at it would serve nothing.
    expect(cfg.rewrites ?? []).toEqual([]);
    const all = (cfg.headers ?? []).flatMap((h) => h.headers.map((x) => `${x.key}:${x.value}`));
    expect(all).toContain("X-Content-Type-Options:nosniff");
    expect(all).toContain("X-Frame-Options:SAMEORIGIN");
  });
});
