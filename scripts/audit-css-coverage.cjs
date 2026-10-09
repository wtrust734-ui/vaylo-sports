// ===========================================================================
// CLASS COVERAGE AUDIT
// ---------------------------------------------------------------------------
// Which classes does the generated site actually use, and which of them does
// theme.css have no rule for? Every unstyled class is a piece of the design
// that silently fell back to the browser default — which is how the site ended
// up as Times New Roman on a white page.
//
//   node scripts/audit-css-coverage.mjs
// ===========================================================================

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const SITE = path.join(root, "website");
const CSS = fs.readFileSync(path.join(root, "site", "theme.css"), "utf8");

/** Every HTML file in website/. */
function htmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(full, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

/** A file's path relative to website/, forward-slashed. */
function siteRelative(full) {
  return path.relative(SITE, full).replace(/\\/g, "/");
}

// website/ is two trees. gen-website.cjs writes the marketing and legal pages;
// deploy-web.cjs then builds the React app into play/, which carries its own
// stylesheet (public/health-rationale.html even defines its own classes in an
// inline <style>). theme.css styles the first tree only, so a class from the
// bundle is not an unstyled site class. Without this the report also depends on
// whether a deploy was ever run, since gen-website.cjs rmSyncs website/.
const APP_BUNDLE = "play/";

// ---------------------------------------------------------------- used --

const used = new Map(); // class -> Set(page path)

for (const file of htmlFiles(SITE)) {
  const siteRel = siteRelative(file);
  if (siteRel.startsWith(APP_BUNDLE)) continue; // the app bundle styles itself
  const html = fs.readFileSync(file, "utf8");
  const rel = "/" + siteRel;

  // class="a b c"  (the only form the generator emits)
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const cls of m[1].split(/\s+/)) {
      if (!cls) continue;
      if (!used.has(cls)) used.set(cls, new Set());
      used.get(cls).add(rel);
    }
  }
}

// --------------------------------------------------------------- defined --

// A class counts as styled if it appears as a selector anywhere in the CSS.
// Media-query and @keyframes bodies count too: a rule inside a media query is
// still styling the element on some device.
const defined = new Set();
for (const m of CSS.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);

// ---------------------------------------------------------- unstyled -----

const unstyled = [...used.keys()].filter((c) => !defined.has(c)).sort();

console.log(`classes used in website/: ${used.size}`);
console.log(`classes referenced in theme.css: ${defined.size}`);
console.log(`\nused but with NO rule in theme.css: ${unstyled.length}\n`);

for (const cls of unstyled) {
  const pages = [...used.get(cls)];
  const where =
    pages.length > 4
      ? `${pages.length} pages (e.g. ${pages[0]})`
      : pages.join(", ");
  console.log(`  .${cls.padEnd(20)} ${where}`);
}

// ---------------------------------------------------------------- tokens --

const tokenDefs = new Set(
  [...CSS.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1])
);
const tokenUses = [...new Set([...CSS.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].sort();
const undefTokens = tokenUses.filter((t) => !tokenDefs.has(t));

console.log(`\nCSS custom properties used: ${tokenUses.length}`);
console.log(`CSS custom properties defined: ${tokenDefs.size}`);
if (undefTokens.length) {
  console.log(`\nUNDEFINED tokens (every use resolves to nothing): ${undefTokens.length}`);
  for (const t of undefTokens) console.log(`  ${t}`);
} else {
  console.log("\nAll tokens are defined.");
}

// ----------------------------------------------------- structural checks --

const needsBodyBg = !/body\s*\{[^}]*background/.test(CSS);
const needsBodyColor = !/body\s*\{[^}]*[^-\w]color:/.test(CSS);
const needsRoot = !/:root/.test(CSS);

console.log("\nstructural:");
console.log(`  :root block present:        ${needsRoot ? "NO" : "yes"}`);
console.log(`  body background painted:     ${needsBodyBg ? "NO" : "yes"}`);
console.log(`  body text colour set:        ${needsBodyColor ? "NO" : "yes"}`);

// A padded full-width block measured in content-box is wider than the viewport,
// so every page scrolls sideways on a phone. Cheap to check, invisible in a
// screenshot on a desktop.
const needsBorderBox = !/box-sizing\s*:\s*border-box/.test(CSS);
console.log(`  border-box sizing:           ${needsBorderBox ? "NO" : "yes"}`);

// Exit non-zero so `npm run site:audit` can gate a build. The test suite asserts
// the same things; this is the version that prints why.
const problems = [];
if (unstyled.length) problems.push(`${unstyled.length} unstyled class(es)`);
if (undefTokens.length) problems.push(`${undefTokens.length} undefined token(s)`);
if (needsRoot) problems.push("no :root block");
if (needsBodyBg) problems.push("body paints no background");
if (needsBodyColor) problems.push("body sets no text colour");
if (needsBorderBox) problems.push("no border-box sizing");

if (problems.length) {
  console.log(`\nFAIL: ${problems.join("; ")}`);
  process.exitCode = 1;
} else {
  console.log("\nOK: every token is defined and every emitted class is styled.");
}