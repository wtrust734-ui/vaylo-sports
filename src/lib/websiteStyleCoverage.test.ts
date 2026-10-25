import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";

// ===========================================================================
// THE STYLESHEET ACTUALLY STYLES THE SITE
// ---------------------------------------------------------------------------
// site/theme.css once contained only the motion/polish layer, with the design
// tokens and the body background belonging to a base layer that was not there.
// Every rule below it reads its colours, font and metrics from var(--…), so
// the whole site rendered as browser defaults: white text on a white
// background, in Times New Roman. It looked broken in a way that no test
// noticed, because every test checked that a selector or a string was present
// — and they all were. The selectors were present. Nothing said they had to
// resolve to anything.
//
// These four assertions are the ones that would have failed:
//
//   1. Every var(--x) the stylesheet uses is defined somewhere in it.
//   2. There is a :root block at all.
//   3. The page paints a background, so the canvas is never the browser's.
//   4. Every class the generator emits has a rule in the stylesheet.
//
// (1)–(3) are read from site/theme.css. (4) is read from the generated output,
// because the class names live in the templates and the legal documents, not
// in the CSS. scripts/audit-css-coverage.cjs runs the same checks and prints a
// report; this is the version that fails a build.
// ===========================================================================

const ROOT = resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const CSS = read("site/theme.css");
const SITE_DIR = join(ROOT, "website");

/**
 * The app bundle's mount point inside website/, and the class-coverage scope.
 *
 * website/ is two trees. gen-website.cjs writes the marketing and legal pages
 * into it; scripts/deploy-web.cjs then builds the React app into play/, so the
 * preview ships in the same deploy. site/theme.css styles the first tree only.
 * The second is a Vite SPA plus the static pages it copies out of public/ —
 * public/health-rationale.html defines its own .lede and .mark in an inline
 * <style>, and is styled by that, not by site/theme.css. Demanding a rule in
 * site/theme.css for a class that belongs to another stylesheet is not a real
 * coverage gap, and without this filter the result of this file depends on
 * whether a deploy was ever run: gen-website.cjs rmSyncs website/, so play/ is
 * present only after deploy-web.cjs puts it back. gen-website.cjs draws the
 * same line — it lists /play/ and /play/auth in NON_PAGE_ROUTES as routes it
 * does not write — and src/lib/website.test.ts filters the bundle out of its
 * generated-page assertions for the same reason.
 */
const APP_BUNDLE = "play/";

/** True for a site-relative path belonging to the app bundle, not a site page. */
const isAppBundle = (siteRelative: string) => siteRelative.startsWith(APP_BUNDLE);

/** The site-relative, forward-slashed path of a file under website/. */
const siteRelative = (full: string) => relative(SITE_DIR, full).replace(/\\/g, "/");

/** Every .html file under a directory, recursively. */
function htmlFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(full, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

/** Every class named in a class="…" attribute. */
function classesIn(html: string): Set<string> {
  const found = new Set<string>();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const cls of m[1].split(/\s+/)) if (cls) found.add(cls);
  }
  return found;
}

// --------------------------------------------------------------- tokens --

describe("design tokens", () => {
  it("has a :root block to define them in", () => {
    expect(CSS).toMatch(/:root\s*\{/);
  });

  it("defines every custom property the stylesheet uses", () => {
    const defined = new Set([...CSS.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = [...new Set([...CSS.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].sort();

    // Guard the guard: if this is empty the test below would pass vacuously.
    expect(used.length, "no var(--…) found — did the stylesheet change shape?").toBeGreaterThan(10);

    const undefinedTokens = used.filter((t) => !defined.has(t));
    expect(
      undefinedTokens,
      "these tokens are read but never defined, so every use falls back to the browser default",
    ).toEqual([]);
  });

  it("defines a light scheme, because the markup advertises one", () => {
    // site/layout.mjs emits <meta name="color-scheme" content="dark light">
    // and the heading rules have prefers-color-scheme: light overrides. Both
    // are inert without a second :root, and they are the reason light-mode
    // users were served white-on-white.
    expect(CSS).toMatch(/@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*:root\s*\{/);
  });
});

// --------------------------------------------------------------- canvas --

describe("the page canvas", () => {
  it("paints a background rather than leaving it to the browser", () => {
    // body alone is not enough: html is the canvas, and an unpainted html
    // shows through on overscroll in several browsers.
    expect(CSS).toMatch(/html\s*\{[^}]*background\s*:/);
    expect(CSS).toMatch(/body\s*\{[^}]*background\s*:/);
  });

  it("sets a body text colour, so unstyled text is still legible", () => {
    expect(CSS).toMatch(/body\s*\{[^}]*[^-\w]color\s*:\s*var\(--text\)/);
  });

  it("sets a font stack, so the page never falls back to Times", () => {
    // The display face is Archivo, self-hosted and preloaded by site/layout.mjs;
    // the system stack stays behind it so a failed font request still renders
    // in a sans-serif rather than Times. Either form satisfies the guard.
    expect(CSS).toMatch(/--font\s*:\s*("Archivo",\s*)?system-ui/);
    expect(CSS).toMatch(/body\s*\{[^}]*font\s*:/);
  });

  it("sizes boxes with border-box, or padded full-width blocks overflow", () => {
    // .shell is `width: 100%` plus `padding-inline`. In the default
    // content-box sizing that is 40px wider than the viewport, and every page
    // scrolls sideways on a phone. Nothing else in the file catches it: the
    // page still renders, still passes the link and heading checks, and the
    // overflow is only visible with a finger on a real screen.
    expect(CSS).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing\s*:\s*border-box/);
  });
});

// -------------------------------------------------------------- coverage --

describe("class coverage", () => {
  // The generator deletes and rewrites website/ on every run, so this reads
  // the committed output. website.test.ts already asserts that output is
  // exactly what the generator produces today, which is what makes reading it
  // here legitimate rather than testing a stale copy.
  //
  // The app bundle is scoped out for the reason recorded on APP_BUNDLE above.
  const all = htmlFiles(SITE_DIR);
  const files = all.filter((f) => !isAppBundle(siteRelative(f)));

  it("has generated pages to check", () => {
    // The floor is deliberately loose: its job is "the generator produced a
    // site", not to pin the page count. It used to be 50, calibrated while the
    // deleted app-preview pages (the /app/ overview plus one page per screen)
    // were still generated — 40 pages is the honest count without them.
    expect(files.length, "website/ is empty — run npm run site:build first").toBeGreaterThan(35);
  });

  it("excludes only the app bundle from the scan", () => {
    // If the bundle is not present the exclusion is untested, and this file
    // starts asserting site/theme.css rules for the app's own classes the
    // moment someone runs a deploy build — which is how this first showed up.
    const bundle = all.filter((f) => isAppBundle(siteRelative(f)));
    if (bundle.length === 0) {
      // No build present (website/ is committed without one). playMount.test.ts
      // covers the bundle when it is built.
      expect(files).toEqual(all);
      return;
    }

    // htmlFiles() really did walk into play/ and the filter really did drop it,
    // so the exclusion cannot silently be a no-op.
    expect(bundle.length).toBeGreaterThan(0);
    expect(files).toEqual(all.filter((f) => !bundle.includes(f)));

    // And the concrete reason it is excluded: a bundle page carries its own
    // styles rather than relying on site/theme.css.
    const rationale = join(SITE_DIR, "play", "health-rationale.html");
    if (existsSync(rationale)) {
      expect(
        readFileSync(rationale, "utf8"),
        "the app page no longer carries its own stylesheet",
      ).toContain("<style");
    }
  });

  it("styles every class the generated pages emit", () => {
    const used = new Set<string>();
    for (const file of files) {
      for (const cls of classesIn(readFileSync(file, "utf8"))) used.add(cls);
    }

    // A class counts as styled if it is named in any selector, including one
    // inside a media query — that still styles the element on some device.
    const defined = new Set([...CSS.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

    const unstyled = [...used].filter((c) => !defined.has(c)).sort();
    expect(
      unstyled,
      "these classes are emitted by the templates but have no rule in site/theme.css, " +
        "so they render with browser defaults",
    ).toEqual([]);
  });

  it("hides the visually-hidden helper, or screen-reader-only text is shown", () => {
    // .visually-hidden is on every page (the nav toggle's "Menu" label). With
    // no rule it is an ordinary span and the word "Menu" appears on the page.
    const rule = CSS.match(/\.visually-hidden\s*\{([^}]*)\}/);
    expect(rule, ".visually-hidden has no rule in site/theme.css").not.toBeNull();
    expect(rule![1]).toMatch(/position\s*:\s*absolute/);
    // It must be clipped, not hidden with display:none — that would also drop
    // it out of the accessibility tree, which is the opposite of the point.
    expect(rule![1]).not.toMatch(/display\s*:\s*none/);
  });

  it("keeps the skip link off the page until it is focused", () => {
    const rule = CSS.match(/\.skip\s*\{([^}]*)\}/);
    expect(rule, ".skip has no rule in site/theme.css").not.toBeNull();
    expect(rule![1]).toMatch(/position\s*:\s*absolute/);
    expect(CSS).toMatch(/\.skip:focus\s*\{[^}]*left\s*:\s*0/);
  });
});