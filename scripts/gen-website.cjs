// ============================================================================
// GENERATES THE VAYLO SPORTS WEBSITE
// ----------------------------------------------------------------------------
// The website is a static site: no framework, no runtime, no client-side
// routing, nothing to go wrong on a phone with a bad connection. It is built
// from site/ and written to website/, which any static host — or Supabase — can
// serve as-is.
//
// Why generate it rather than hand-write the HTML:
//
//   * The 14 legal documents are embedded from legal/*.html, the same files the
//     edge function serves. The website and the Google Play listing therefore
//     publish the *same policy*, not two copies that drift apart.
//   * The footer, header and navigation are defined once in site/, so a link
//     cannot exist on the homepage and be missing from the footer.
//   * Every page is checked before it is written. A link to a page that was
//     never generated, an unresolved token, a placeholder rendered as a real
//     value — all of them fail the build rather than shipping.
//
//   node scripts/gen-website.cjs
//
// Output: website/
// ============================================================================

const fs = require("fs");
const path = require("path");
// Used only to minify the stylesheet. Required rather than declared for the same
// reason scripts/gen-event-packs-sql.cjs requires it: esbuild ships as a hard
// dependency of vite, which this project already builds with, so it resolves.
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const SITE_DIR = path.join(root, "site");
const LEGAL_DIR = path.join(root, "legal");
// Overridable so the test suite can regenerate into a temp directory and prove
// the committed output is reproducible, rather than asserting on a stale copy.
// Only a bare directory argument is an output override. A flag such as --help
// must not be swallowed as a path: doing so writes a whole generated site into
// a directory literally named "--help" and reports success.
const OUT_ARG = process.argv.slice(2).find((a) => !a.startsWith("-"));
const OUT_DIR = OUT_ARG ? path.resolve(root, OUT_ARG) : path.join(root, "website");

function fail(message) {
  console.error(`gen-website: ${message}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ io -- */

function writeFile(relative, contents) {
  const target = path.join(OUT_DIR, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return contents.length;
}

function readJson(file, label) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) fail(`missing ${file}`);
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (e) {
    fail(`${label} is not valid JSON: ${e.message}`);
  }
}

/**
 * Minify the stylesheet for the deploy.
 *
 * theme.css is the render-blocking request on all ~40 pages, and its comments
 * plus deliberate indentation are more than half the file. None of that reaches
 * the reader, so the copy written to website/ is minified.
 *
 * esbuild rather than a hand-rolled regex: this stylesheet uses calc(), custom
 * properties, :has(), color-mix(), nested media queries and @supports, and a
 * line-based "minifier" gets one of those wrong on one component in one browser
 * — which is exactly the class of bug nobody finds before a release.
 */
function minifyCss(source) {
  return esbuild.transformSync(source, {
    loader: "css",
    minify: true,
    legalComments: "none",
  }).code;
}

/**
 * Dynamic import() needs a URL, and on Windows a bare absolute path arrives as
 * a "c:" URL scheme, which Node refuses. pathToFileURL is the supported way
 * across platforms; on POSIX it is a no-op equivalent.
 */
const { pathToFileURL } = require("node:url");
function toModuleUrl(absolutePath) {
  return pathToFileURL(absolutePath).href;
}

/**
 * Load the handful of build variables this site needs from .env / .env.local.
 *
 * Vite does this for the app; without it `npm run site:build` would silently
 * produce a site whose forms are all switched off, because the operator
 * reasonably expects the same project config to apply. Only the values below
 * are read, and only non-secret ones — the Supabase project URL is publishable
 * by design and already ships in the client bundle.
 */
function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  }
}

/* -------------------------------------------------------------- inputs -- */

// Operator details come from the same file the legal documents use, so the
// website can never disagree with the published privacy policy about who runs
// the product or where to write.
const operator = readJson("legal/operator.json", "legal/operator.json");
for (const key of ["operatorName", "contactEmail"]) {
  if (typeof operator[key] !== "string" || !operator[key].trim()) {
    fail(`legal/operator.json needs a non-empty "${key}"`);
  }
}
const OPERATOR = {
  name: operator.operatorName.trim(),
  email: operator.contactEmail.trim(),
};

const manifest = readJson("legal/pages.json", "legal/pages.json");
const LEGAL_PAGES = manifest.pages;

/* ------------------------------------------------------- legal document -- */

/**
 * Turn a standalone legal document into a fragment of a website page.
 *
 * The document's own <head>, <style>, brand lockup and cross-link navigation are
 * stripped: the site supplies the header and footer, so keeping the document's
 * would give every legal page two competing navigations and a second, subtly
 * different copy of the design tokens.
 *
 * Internal document links are rewritten from bare slugs to the site's routes:
 * the documents link each other as `href="privacy"`, which is an edge-function
 * route. On the website that would resolve to /legal-page-relative-path and
 * 404. Same documents, same cross-links, different base path.
 */
function legalBody(slug) {
  const file = LEGAL_PAGES[slug];
  if (!file) fail(`legal/pages.json has no entry for "${slug}"`);

  const source = path.join(LEGAL_DIR, file);
  if (!fs.existsSync(source)) fail(`legal/${file} is missing (declared for "${slug}")`);

  let html = fs.readFileSync(source, "utf8");

  // Tokens are substituted here exactly as the edge function does.
  html = html
    .replace(/%%OPERATOR_NAME%%/g, OPERATOR.name)
    .replace(/%%CONTACT_EMAIL%%/g, OPERATOR.email);

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) fail(`legal/${file} has no <body>`);
  let body = bodyMatch[1];

  // Remove the parts the site chrome replaces.
  body = body.replace(/<div class="brand">[\s\S]*?<\/div>\s*(?=<h1>)/i, "");
  body = body.replace(/<nav class="nav"[\s\S]*?<\/nav>/gi, "");
  // Any stray inline <style> would fight the site stylesheet.
  body = body.replace(/<style>[\s\S]*?<\/style>/gi, "");

  // Rewrite the document's internal cross-links onto the website's routes.
  body = body.replace(/href="([a-z][a-z0-9-]*)(#[a-z0-9-]*)?"/gi, (match, slugRef, hash) => {
    if (!LEGAL_PAGES[slugRef]) return match;
    return `href="/legal/${slugRef}/${hash || ""}"`;
  });

  // Tables in the documents are wide (a feature/cost pair, a provider table).
  // Left bare they force the whole page to scroll sideways on a phone, which
  // makes every other line on the page hard to read. Wrapping them lets the
  // table scroll inside its own box.
  body = body.replace(/<table>/gi, '<div class="table-wrap"><table>');
  body = body.replace(/<\/table>/gi, "</table></div>");

  // The document's own <style> supplied .meta and .brand, and was stripped with
  // the head. Re-create the version line's styling here so "Version 1.1 ·
  // Effective ..." still reads as metadata rather than as body copy.
  body = body.replace(
    /<p class="meta">/gi,
    '<p class="doc-meta">'
  );

  return `
    <div class="shell">
      <a class="back-link" href="/legal/">&larr; All legal documents</a>
      <article class="doc-body">
${body.trim()}
      </article>
    </div>`;
}

/** Title of a legal document, with the " — Vaylo Sports" suffix removed. */
/**
 * A document's title, as plain text.
 *
 * Decoded before it goes any further, because the title is lifted out of HTML:
 * "Child &amp; Young Athlete Safety" would otherwise be escaped a second time by
 * the layout and published as `&amp;amp;` in the meta tags, with a literal
 * "&amp;" printed in the browser tab. Same reason as titleOf() in
 * gen-legal-pages.cjs — both read the same source, so both decode it.
 */
const TITLE_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

const decodeTitleEntities = (text) =>
  text.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (match) => TITLE_ENTITIES[match] ?? match);

function legalTitle(slug) {
  const file = LEGAL_PAGES[slug];
  const html = fs.readFileSync(path.join(LEGAL_DIR, file), "utf8");
  const match = html.match(/<title>([^<]*)<\/title>/i);
  if (!match) fail(`legal/${file} has no <title>`);
  return decodeTitleEntities(match[1]).split("\u2014")[0].split(" - ")[0].trim();
}

/* ---------------------------------------------------------------- pages -- */

/**
 * Pages are authored as ES modules under site/pages. They are loaded with a
 * dynamic import rather than require() because the project is `"type":
 * "module"` and these files use ESM syntax.
 */
const PAGE_MODULES = [
  "home.mjs",
  "features.mjs",
  "safety.mjs",
  "legal.mjs",
  "privacy.mjs",
  "delete-account.mjs",
  "support.mjs",
  "about.mjs",
  "contact.mjs",
  "waitlist.mjs",
  "faq.mjs",
  "whats-new.mjs",
  "accessibility.mjs",
  "sponsors.mjs",
  // Coach accounts. Generated, noindex, and linked from nothing: the page has to
  // EXIST for the app's coach studio to link to it, and it must not be findable
  // until the marketplace is switched on. See site/pages/coaches.mjs.
  "coaches.mjs",
];

/* ----------------------------------------------------------- validation -- */

/** Every internal href in the rendered HTML, for the link check. */
function internalHrefs(html) {
  return [...html.matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)].map((m) => m[1]);
}

/**
 * Resolve a site route to the file that will exist for it.
 *
 * Every page is a directory with an index.html, so `/safety/` is
 * `website/safety/index.html`. A route with no trailing slash is still valid
 * on most hosts, but every link the site emits carries the slash, and a missing
 * trailing slash is the classic source of a site that 404s on refresh.
 */
function routeToFile(route) {
  return route.endsWith("/") ? `${route}index.html` : route.replace(/^\//, "");
}

/**
 * Routes that are not generated pages but are still legitimately linkable.
 *
 * Empty on purpose: the live-app preview that used to be mounted at /play/ was
 * removed from the main website, and with it the only legitimate non-page links
 * (the /app/ overview page and its sign-in/coach-signup routes). Every internal
 * href now has to resolve to a file this generator writes — which is the whole
 * point of the check, so no exception is kept "just in case". A future need for
 * one belongs here, named and documented, not as a wildcard.
 */
const NON_PAGE_ROUTES = new Set([]);

/**
 * Reject links to pages that were not generated. This is the check that makes
 * "test every navigation link" true by construction rather than by a manual
 * click-through.
 */
function verifyLinks(pages, label) {
  const known = new Set(pages.map((p) => p.path));

  for (const page of pages) {
    for (const href of internalHrefs(page.rendered)) {
      if (href.startsWith("/assets/")) {
        // Strip the cache-busting query before checking the file exists.
        const file = href.split("?")[0].slice(1);
        if (!fs.existsSync(path.join(OUT_DIR, file))) {
          fail(`${page.path} links to ${href}, which was not written`);
        }
        continue;
      }
      if (NON_PAGE_ROUTES.has(href)) continue;
      if (!known.has(href)) {
        fail(`${page.path} links to ${href}, which is not a generated page`);
      }
    }
  }
}

/* --------------------------------------------------------------- assets -- */

/**
 * config.js carries the one thing that cannot be baked into a static page:
 * where the forms submit. It is generated so the endpoint can change without
 * editing every page, and so that an absent endpoint produces a site that
 * disables its own forms and says so — rather than a form that pretends.
 */
function siteConfig() {
  const endpoint = process.env.VITE_SUPABASE_URL
    ? `${process.env.VITE_SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/support-request`
    : null;
  // The waiting list posts to its own function rather than to support-request.
  // Same origin, same CORS story, different promise: a signup is not a support
  // message, and the two have different validation, different rate limits and
  // different reasons for not telling a caller what it already knows.
  const waitlistEndpoint = process.env.VITE_SUPABASE_URL
    ? `${process.env.VITE_SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/waitlist-signup`
    : null;
  // The sponsorship questionnaire posts to its own function, for the same
  // reason the waiting list does: a brand enquiry is not a support message. It
  // has its own validation, its own rate limit, its own closed set of interest
  // answers, and it is the only form on the site that records a terms
  // acceptance — folding it into support-request would have meant guessing
  // which of the two a given payload was.
  const sponsorEndpoint = process.env.VITE_SUPABASE_URL
    ? `${process.env.VITE_SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/sponsor-enquiry`
    : null;

  return `// GENERATED FILE — written by scripts/gen-website.cjs. Do not edit by hand.
//
// Read by site/assets/site.js. The support endpoint is null when no Supabase URL
// is configured at build time, which switches every form on the site into an
// explicit "not available, email us instead" state.
window.VAYLO_SITE_CONFIG = {
  supportEndpoint: ${endpoint ? JSON.stringify(endpoint) : "null"},
  waitlistEndpoint: ${waitlistEndpoint ? JSON.stringify(waitlistEndpoint) : "null"},
  sponsorEndpoint: ${sponsorEndpoint ? JSON.stringify(sponsorEndpoint) : "null"},
  contactEmail: ${JSON.stringify(OPERATOR.email)},
};
`;
}

/* ---------------------------------------------------------------- build -- */

async function build() {
  loadEnv();

  // Asset URLs carry a content hash. Without it a browser that cached
  // theme.css on the previous deploy keeps serving it after the file on disk has
  // changed — which during development hides fixes that were never applied,
  // and in production ships a stale stylesheet to everybody who visited once.
  const crypto = require("node:crypto");
  const hash = (contents) =>
    crypto.createHash("sha256").update(contents).digest("hex").slice(0, 8);

  const cssSource = fs.readFileSync(path.join(SITE_DIR, "theme.css"), "utf8");
  const jsSource = fs.readFileSync(path.join(SITE_DIR, "assets", "site.js"), "utf8");

  // The stylesheet ships minified (see minifyCss), and the cache-busting hash is
  // taken over the bytes that are actually written rather than over the source.
  // Hashing the source would leave the URL unchanged when an edit only removed
  // whitespace or a comment, and every browser that had cached the old minified
  // copy would keep serving it.
  //
  // site.js is deliberately left alone. It is deferred, so it is not on the
  // render path, and src/lib/website.test.ts reads it as readable source to
  // assert what the client does with a response — the success copy must be
  // reachable only from the 2xx branch, and so on. Minifying it renamed a
  // shadowed local and turned those into assertions about esbuild's output
  // formatting instead, which is a worse test for a few kilobytes off a request
  // the reader never waits on.
  const cssOut = minifyCss(cssSource);
  globalThis.__VAYLO_ASSET_VERSION__ = {
    theme: `?v=${hash(cssOut)}`,
    js: `?v=${hash(jsSource)}`,
    config: `?v=${hash(OPERATOR.email)}`,
  };

  const { shell } = await import(toModuleUrl(path.join(SITE_DIR, "layout.mjs")));
  const { SITE, LEGAL_DOCUMENTS } = await import(toModuleUrl(path.join(SITE_DIR, "data", "site.mjs")));

  fs.rmSync(OUT_DIR, { recursive: true, force: true });

  const pages = [];
  let bytes = 0;

  /* --- the nine authored pages --- */
  for (const file of PAGE_MODULES) {
    const mod = await import(toModuleUrl(path.join(SITE_DIR, "pages", file)));
    const page = mod.default;
    if (!page) fail(`site/pages/${file} has no default export`);
    if (!page || !page.path || !page.body) fail(`site/pages/${file} exports no page object`);

    pages.push({ ...page, kind: "site" });
  }

  /* --- the 14 legal documents, in the site's chrome --- */
  for (const slug of Object.keys(LEGAL_PAGES)) {
    const doc = LEGAL_DOCUMENTS.find((d) => d.slug === slug);
    pages.push({
      path: `/legal/${slug}/`,
      kind: "legal-doc",
      slug,
      title: `${legalTitle(slug)} — full text`,
      description: doc ? doc.summary : `The full text of the Vaylo Sports ${legalTitle(slug)}.`,
      body: legalBody(slug),
      back: `/legal/${slug === "privacy" ? "" : ""}`,
    });
  }

  /* --- substitute the contact placeholder, render, write --- */
  const rendered = pages.map((page) => {
    // Pages cannot import operator.json, so they mark the contact address with a
    // placeholder and it is resolved here — one substitution, one source of
    // truth, and an assertion below that none survived.
    //
    // The replacement is the bare address, NOT a full mailto: link. The pages
    // already write `href="mailto:CONTACT_EMAIL_PLACEHOLDER"`, and substituting
    // a complete `mailto:` here produced `href="mailto:mailto:..."` — a link
    // that looks fine in the markup and opens nothing when clicked.
    const body = String(page.body).replace(
      /CONTACT_EMAIL_PLACEHOLDER/g,
      OPERATOR.email
    );
    if (body.includes("CONTACT_EMAIL_PLACEHOLDER")) {
      fail(`${page.path} still contains an unsubstituted contact placeholder`);
    }
    // A page can ask not to be indexed (site/pages/coaches.mjs does, because it
    // is generated before the feature it describes is switched on). Passing the
    // flag through here rather than hard-coding it in the shell means a page's
    // visibility is a property of the page, and the sitemap below agrees with it.
    return {
      ...page,
      body,
      rendered: shell({ ...page, body }, { noindex: page.noindex === true }, OPERATOR),
    };
  });

  for (const page of rendered) {
    bytes += writeFile(routeToFile(page.path), page.rendered);
  }

  /* --- assets --- */
  bytes += writeFile("assets/theme.css", cssOut);
  bytes += writeFile("assets/site.js", jsSource);
  bytes += writeFile("assets/config.js", siteConfig());

  // The real brand mark, shown top-left in the header and footer. Copied rather
  // than inlined so the same bytes are cached once for every page instead of
  // being repeated in 66 documents.
  //
  // It is a transparent PNG derived from the supplied JPEG: the source is a
  // 500x500 JPEG with a pure black background, which would render as a black
  // square against the site's dark header and as a black blob in the light
  // theme. The matte was removed and the result kept at 128px, which is ~3.7x
  // the 34px display size.
  //
  // It is also the favicon, referenced as <link rel="icon" href="/assets/logo.png">
  // in site/layout.mjs. One file for both means the tab icon cannot drift from
  // the mark in the header — the zigzag SVG this replaced did exactly that.
  const logoSrc = path.join(SITE_DIR, "assets", "logo.png");
  if (!fs.existsSync(logoSrc)) {
    fail(`missing ${path.relative(root, logoSrc)} — the header logo it uses has gone`);
  }
  fs.copyFileSync(logoSrc, path.join(OUT_DIR, "assets", "logo.png"));
  bytes += fs.statSync(logoSrc).size;

  // The 1200x630 social card that every page shares as og:image. Copied, not
  // drawn: it is rasterised once by scripts/gen-og-image.cjs into the source
  // tree and committed, so a build machine — including CI, which has no
  // browser — produces the site without rendering anything. See that script's
  // header for why the card is HTML in the first place.
  const ogSrc = path.join(SITE_DIR, "assets", "og.png");
  if (!fs.existsSync(ogSrc)) {
    fail(
      `missing ${path.relative(root, ogSrc)} — every page's og:image points at it. ` +
        "Run `node scripts/gen-og-image.cjs` to rebuild it from site/assets/og-card.html."
    );
  }
  fs.copyFileSync(ogSrc, path.join(OUT_DIR, "assets", "og.png"));
  bytes += fs.statSync(ogSrc).size;

  /* --- robots + sitemap --- */
  bytes += writeFile(
    "robots.txt",
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url ? SITE.url.replace(/\/+$/, "") + "/sitemap.xml" : "/sitemap.xml"}\n`
  );

  // A noindex page is left out of the sitemap. Listing a URL while telling
  // crawlers not to index it is a contradiction, and the sitemap is the stronger
  // signal of the two — a page that is "hidden" but listed in sitemap.xml gets
  // crawled, which is the opposite of what noindex was asked for.
  // One entry per indexable page, each with the date its content last changed.
  //
  // A page may declare its own `updated`; anything that does not falls back to
  // SITE.contentUpdated, which is a hand-maintained constant and NOT a build
  // timestamp. Two reasons, and both matter: a clock in the output would make
  // two generations of the same source disagree, which src/lib/website.test.ts
  // reports as staleness on every run; and <lastmod> means "the content
  // changed", not "a deploy happened". A build stamp would tell a crawler that
  // all 38 pages changed every time anything was deployed, which is the fastest
  // way to have the whole field ignored.
  //
  // The date is validated rather than passed through, so a typo produces a build
  // failure instead of a sitemap that a crawler silently discards.
  const urls = rendered
    .filter((p) => p.noindex !== true)
    .map((p) => {
      const updated = p.updated || SITE.contentUpdated;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
        fail(`${p.path} has an invalid sitemap date: ${JSON.stringify(updated)}`);
      }
      return { path: p.path, updated };
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  bytes += writeFile(
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ path: u, updated }) =>
      `  <url><loc>${SITE.url ? SITE.url.replace(/\/+$/, "") + u : u}</loc><lastmod>${updated}</lastmod></url>`
  )
  .join("\n")}
</urlset>
`
  );

  /* --- Vercel host config --- */
  // Copied from site/vercel.json, not authored here, so there is one source for
  // the headers. This is written by the generator deliberately: gen-website does
  // rmSync(OUT_DIR) first, so anything placed in website/ by hand — including
  // this file — is destroyed on the next rebuild, and the deploy that follows
  // would publish stale headers, with no build error to say so.
  bytes += writeFile(
    "vercel.json",
    fs.readFileSync(path.join(root, "site", "vercel.json"), "utf8")
  );

  /* --- 404 --- */
  bytes += writeFile(
    "404.html",
    shell(
      {
        path: "/404.html",
        title: "Page not found",
        description: "That page does not exist on vaylosports.com.",
        body: `
    <div class="shell">
      <div style="padding-top:4rem;max-width:40rem">
        <h1>That page does not exist</h1>
        <p class="lead" style="margin-top:1rem">
          It may have moved, or the link that brought you here may be out of date.
          Nothing is wrong with your account.
        </p>
        <div class="btn-row">
          <a class="btn btn-primary" href="/">Home</a>
          <a class="btn btn-secondary" href="/support/">Support</a>
          <a class="btn btn-secondary" href="/legal/">Legal Centre</a>
        </div>
      </div>
    </div>`,
      },
      { noindex: true },
      OPERATOR
    )
  );

  /* --- validate --- */
  verifyLinks(rendered, "site");

  // Cross-check: the footer must offer every link the brief requires, on
  // every page. Checked against the rendered HTML, not the data module, so a
  // footer that failed to render is caught too.
  const REQUIRED_FOOTER_LINKS = [
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
  for (const page of rendered) {
    for (const href of REQUIRED_FOOTER_LINKS) {
      if (!page.rendered.includes(`href="${href}"`)) {
        fail(`${page.path} is missing a required footer link to ${href}`);
      }
    }
  }

  console.log(
    `gen-website: wrote ${rendered.length + 4} files to ${path.relative(root, OUT_DIR)} — ` +
      `${bytes} bytes, ${urls.length} URLs` +
      (SITE.url ? "" : "\n  NOTE: SITE_URL is not set. Canonicals, sitemap and robots fall back to relative paths.")
  );
}

build().catch((e) => fail(e && e.stack ? e.stack : String(e)));