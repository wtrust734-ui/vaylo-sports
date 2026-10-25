// ============================================================================
// SITE LAYOUT — the shell every page is wrapped in
// ----------------------------------------------------------------------------
// One header, one footer, one set of navigation links, rendered identically on
// every page so that the Legal Centre is never three clicks from anywhere.
//
// Accessibility decisions that are structural rather than cosmetic:
//
//   * A skip link is the first focusable element on every page.
//   * <header>, <nav>, <main>, <footer> are real landmarks, so a screen reader
//     user can jump between regions.
//   * Exactly one <h1> per page, supplied by the page itself.
//   * The current page is marked with aria-current="page", not just a colour.
//   * The mobile drawer uses the `hidden` attribute rather than opacity, so it
//     leaves the tab order when closed instead of trapping focus.
//   * The nav toggle reports its state with aria-expanded and aria-controls.
// ============================================================================

import { NAV, FOOTER, SITE } from "./data/site.mjs";

/**
 * Cache-busting query strings for the static assets.
 *
 * Injected by scripts/gen-website.cjs as `globalThis.__VAYLO_ASSET_VERSION__`
 * before this module is used, so a changed stylesheet or script gets a new URL
 * and browsers cannot serve a stale copy from a previous deploy. The fallback
 * keeps this module usable standalone.
 */
const ASSET_VERSION = globalThis.__VAYLO_ASSET_VERSION__ ?? { theme: "", js: "", config: "" };

const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** True when `href` is the page currently being rendered. */
function isCurrent(href, current) {
  if (href === current) return true;
  // A section link stays current on its own sub-pages, but only when the
  // current page is actually inside that section.
  return current.startsWith(href) && href !== "/";
}

function navLinks(current, className) {
  return NAV.map(
    (item) =>
      `<a href="${item.href}"${
        isCurrent(item.href, current) ? ' aria-current="page"' : ""
      }${className ? ` class="${className}"` : ""}>${esc(item.label)}</a>`
  ).join("\n          ");
}

/**
 * Structured data for one page.
 *
 * Every page carries the Organization node, and a page may add its own nodes via
 * `jsonLd` (the FAQPage on /faq/, the SoftwareApplication on the homepage). The
 * Organization node is repeated on every page rather than only the homepage
 * because the generator has no way to know which page a crawler will enter
 * through, it is about 180 bytes, and gzip collapses the repetition to almost
 * nothing.
 *
 * INLINE IS SAFE HERE, and that was checked rather than assumed. A `<script>`
 * whose type is not JavaScript is a data block, not script, so the site's
 * `script-src 'self'` CSP does not apply to it. That was verified against the
 * real policy: with the meta CSP copied from netlify.toml, both JSON-LD blocks
 * stayed present in the DOM and only the executable inline script was refused.
 * The alternative — loading the data from an external `/assets/*.js` — does not
 * work, because the consumers of JSON-LD do not follow a `src`.
 *
 * `<` is escaped so that a value in the data can never close the script element
 * early. Nothing in the data is user-supplied today, but an escaper that is only
 * correct while that holds is a bug waiting for its first exception.
 */
function jsonLd(operator, page, origin) {
  const nodes = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: operator.name,
      email: operator.email,
      ...(origin ? { url: origin, logo: `${origin}/assets/logo.png` } : {}),
    },
    ...(Array.isArray(page.jsonLd) ? page.jsonLd : []),
  ];

  return nodes
    .map(
      (node) =>
        `  <script type="application/ld+json">${JSON.stringify(node).replace(/</g, "\\u003c")}</script>`
    )
    .join("\n");
}

function header(current) {
  return `  <a class="skip" href="#main">Skip to content</a>

  <header class="site-header">
    <div class="shell header-inner">
      <a class="brand" href="/"${isCurrent("/", current) ? ' aria-current="page"' : ""}>
        <img
          class="brand-mark"
          src="/assets/logo.png"
          alt=""
          width="34"
          height="34"
          decoding="async"
        />
        <span>Vaylo Sports</span>
      </a>

      <button
        type="button"
        class="nav-toggle"
        aria-expanded="false"
        aria-controls="mobile-nav"
        data-nav-toggle
      >
        <span class="visually-hidden">Menu</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" aria-hidden="true" focusable="false">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      <nav class="site-nav" aria-label="Main">
          ${navLinks(current)}
      </nav>

      <a class="nav-cta" href="/waitlist/"${isCurrent("/waitlist/", current) ? ' aria-current="page"' : ""}>
        Join the waiting list
      </a>
    </div>

    <div class="mobile-nav" id="mobile-nav" hidden>
      <div class="shell">
        <ul>
          ${NAV.map(
            (item) =>
              `<li><a href="${item.href}"${
                isCurrent(item.href, current) ? ' aria-current="page"' : ""
              }>${esc(item.label)}</a></li>`
          ).join("\n          ")}
          <li><a href="/delete-account/"${
            isCurrent("/delete-account/", current) ? ' aria-current="page"' : ""
          }>Delete your account</a></li>
        </ul>
      </div>
    </div>
  </header>`;
}

function footer(operatorName, contactEmail, current) {
  const columns = FOOTER.map(
    (col) => `      <div class="footer-col">
        <h2>${esc(col.heading)}</h2>
        <ul>
${col.links
  .map(
    (l) =>
      `          <li><a href="${l.href}"${
        isCurrent(l.href, current) ? ' aria-current="page"' : ""
      }>${esc(l.label)}</a></li>`
  )
  .join("\n")}
        </ul>
      </div>`
  ).join("\n");

  return `  <footer class="site-footer">
    <div class="shell">
      <div class="footer-grid">
        <div class="footer-col"><a class="brand" href="/">
            <img
              class="brand-mark"
              src="/assets/logo.png"
              alt=""
              width="34"
              height="34"
              decoding="async"
            />
            <span>Vaylo Sports</span>
          </a>
          <p style="margin-top: 1rem; font-size: 0.92rem">
            A training log and analysis tool for athletes across many sports. Not a
            doctor, not a coach, and not a substitute for either.
          </p>
          <p style="font-size: 0.92rem">
            <a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a>
          </p>
        </div>
${columns}
      </div>

      <div class="footer-base">
        <p style="margin:0">
          &copy; ${SITE.copyrightYear} ${esc(operatorName)}.
        </p>
        <p style="margin:0">
          Android. <a href="/legal/">All legal documents</a> &middot;
          <a href="/privacy/">Privacy &amp; data</a> &middot;
          <a href="/safety/">Safety</a>
        </p>
      </div>

      <div class="footer-base" style="margin-top: 1rem; border-top: 0; padding-top: 0">
        <p style="margin:0; max-width: 70ch">
          Vaylo Sports does not claim to prevent injury, guarantee performance, or
          provide medical care. Nothing on this website is medical advice.
        </p>
      </div>
    </div>
  </footer>`;
}

/**
 * Wrap page content in the site shell.
 *
 * @param {object} page
 * @param {string} page.title      full <title>, no site suffix
 * @param {string} page.description meta description
 * @param {string} page.path       the path being rendered, for aria-current
 * @param {string} page.body       already-escaped HTML
 * @param {object} opts
 * @param {boolean} [opts.noindex]  true for thin or utility pages
 */
export function shell(page, opts, operator) {
  const { name: siteName } = SITE;
  const origin = SITE.url ? SITE.url.replace(/\/+$/, "") : "";
  const canonical = origin ? `${origin}${page.path}` : null;

  // Absolute when the build knows its own origin, relative when it does not.
  // Most platforms resolve a relative og:image against the page URL, but a
  // canonical origin is what the crawlers that matter expect, and SITE_URL is
  // what every other absolute URL on the site already hangs off.
  const ogImage = `${origin}${page.ogImage || SITE.ogImage}`;

  // Entrance animation: every page is wrapped here, so the hero, section
  // wrappers and cards animate in once with a stagger, and the hero lifts on
  // load. The classes are added at paint time, not authored per-page, so a
  // template that forgets to add a reveal never leaves a half-animated page.
  const applyReveal = (html) => {
    let out = html;

    // The hero entrance lives in the template, not here: site/pages/home.mjs
    // already writes `hero-lift` on the hero grid and the stylesheet animates
    // it once on load.
    //
    // Two regexes used to try to inject that wrapper here instead, and neither
    // could ever match. The first looked for `<div class="shell hero-grid">`
    // while the template writes `hero-grid hero-lift`; the second looked for
    // two nested hero-grid shells, which no page has ever contained. Both were
    // dead, and the second would have emitted an unclosed <div> on the day it
    // did match. Deleted rather than left in place with a comment.
    //
    // Sections, cards, pills and buttons mark themselves `reveal` so the
    // stylesheet can fade them up as they enter the viewport. The patterns
    // allow whitespace between the tag and the class attribute so they match
    // both the generator's inline style and the templates' block form.
    // The capture is `[^"]*`, not `[^>]*`. `[^>]*` also matches a quote, so
    // on `<section class="section section-tight" id="enquiry">` it swallowed
    // `section-tight" id="enquiry` as part of the class and emitted
    // `id="enquiry reveal"` — silently breaking the anchor AND the element.
    // Nothing had put an `id` on a section whose class list had more than one
    // entry, so the flaw sat unnoticed until /sponsors/ did exactly that.
    // Requiring `"` or whitespace straight after the class name keeps the
    // boundary, so `section-head` and `btn-row` are still left alone.
    out = out.replace(/\s*<section\s+class="section(\s[^"]*)?"/g, '<section class="section$1 reveal"');
    out = out.replace(/\s*<div\s+class="card(\s[^"]*)?"/g, '<div class="card$1 reveal"');
    out = out.replace(/\s*<div\s+class="pill(\s[^"]*)?"/g, '<div class="pill$1 reveal"');
    out = out.replace(/\s*<div\s+class="btn(\s[^"]*)?"/g, '<div class="btn$1 reveal"');

    return out;
  };

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(page.title)} | ${esc(siteName)}</title>
<meta name="description" content="${esc(page.description)}" />
<meta name="theme-color" content="#07080c" />
<meta name="color-scheme" content="dark light" />
${opts.noindex ? '<meta name="robots" content="noindex, follow" />' : ""}
${canonical ? `<link rel="canonical" href="${esc(canonical)}" />` : ""}

<meta property="og:type" content="website" />
<meta property="og:site_name" content="${esc(siteName)}" />
<meta property="og:title" content="${esc(page.title)} | ${esc(siteName)}" />
<meta property="og:description" content="${esc(page.description)}" />
${canonical ? `<meta property="og:url" content="${esc(canonical)}" />` : ""}
<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${esc(page.ogImageAlt || SITE.ogImageAlt)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${esc(ogImage)}" />
<meta name="twitter:image:alt" content="${esc(page.ogImageAlt || SITE.ogImageAlt)}" />
<link rel="icon" href="/assets/logo.png" type="image/png" />
<link rel="apple-touch-icon" href="/assets/logo.png" />
<!-- The one webfont, preloaded. Without the preload it is discovered only
     after the stylesheet has parsed, which is exactly the half-second in which
     the headline renders in the fallback and then reflows. crossorigin is
     required on a font request even when it is same-origin. -->
<link
  rel="preload"
  href="/assets/fonts/archivo-latin.woff2"
  as="font"
  type="font/woff2"
  crossorigin
/>
<link rel="stylesheet" href="/assets/theme.css${ASSET_VERSION.theme}" />
${jsonLd(operator, page, origin)}
</head>
<body>
  <!-- Reading progress. Decorative, hidden from the accessibility tree, and
       driven by one transform in site.js rather than by a width change. -->
  <div class="scroll-progress" aria-hidden="true">
    <span data-scroll-progress></span>
  </div>
${header(page.path)}
  <main id="main">
${applyReveal(page.body)}
  </main>
${footer(operator.name, operator.email, page.path)}

<!-- ----------------------------------------------------------------
     Cookie and storage notice.

     Rendered on every page but left hidden in the markup, and revealed by
     initCookieNotice() in site.js only when this device has not already
     acknowledged it. That order matters: a reader whose browser blocks
     scripts never sees a notice with an Accept button that cannot do
     anything, and one whose browser blocks storage sees it every visit
     rather than being told a preference was saved.

     It reports a fact rather than asking permission, because there is
     nothing here to consent to: the site sets no cookie at all, and the
     preferences it keeps are on the reader's own device. The full list is in
     the Cookie Policy, which is what the link is for.
     ---------------------------------------------------------------- -->
  <div
    class="cookie-notice"
    data-cookie-notice
    role="region"
    aria-label="Cookies and stored preferences"
    hidden
  >
    <div class="shell cookie-notice-inner">
      <p class="cookie-notice-text">
        <strong>No tracking cookies.</strong> No advertising or analytics cookies, and
        no third-party tracker &mdash; only preferences kept on this device.
        <a href="/legal/cookies/">Cookie Policy</a>
      </p>
      <button
        type="button"
        class="btn btn-primary cookie-notice-accept"
        data-cookie-accept
      >Accept</button>
    </div>
  </div>

<!-- config.js MUST come before site.js. Both are deferred, and deferred
     scripts execute in document order before DOMContentLoaded — so with the
     reverse order, site.js ran first, found no config, and disabled every form
     on the site with "not available yet". -->
<script src="/assets/config.js${ASSET_VERSION.config}" defer></script>
<script src="/assets/site.js${ASSET_VERSION.js}" defer></script>
</body>
</html>
`;
}