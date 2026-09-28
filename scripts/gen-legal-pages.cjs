// Generates the legal pages served by supabase/functions/legal.
//
// Why this exists at all: Google Play will not publish a store listing without a
// reachable privacy policy URL, and there is no public web host for this project
// yet (the domain the code defaults to, vaylosports.com, does not resolve). The
// project already has infrastructure that can serve a page over HTTPS today, so
// the policy is published from an edge function.
//
// The HTML lives in legal/ as ordinary files — readable in a review, and usable
// verbatim if this is later hosted on a real domain — and this script embeds it
// into the function. That is the same shape as scripts/gen-event-packs-sql.cjs,
// for the same reason: one source of truth, with the shipping copy generated
// rather than hand-maintained.
//
//   node scripts/gen-legal-pages.cjs
//
// Run after editing legal/*.html or legal/operator.json, then redeploy the
// function. src/lib/legalPages.test.ts fails if the emitted file and these
// sources disagree, so a forgotten run is caught before it reaches production.
//
// The operator details come from legal/operator.json rather than being typed
// into three separate documents, because a privacy policy that names the wrong
// company — or an inbox nobody reads — is a worse outcome than no policy at all.
// The function refuses to serve pages while those values are still placeholders,
// so a half-configured policy cannot be published by accident.
//
// The assertions below are each a way the page could silently be wrong:
//
//   * a <script>, external stylesheet, font or image — these pages are opened in
//     the app as well as on the web, and a privacy policy that phones a third
//     party to render is both a bad look and broken offline
//   * a token left unresolved because operator.json was edited to a bad shape
//   * a page that lost its contact line entirely
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const LEGAL_DIR = path.join(root, "legal");
const OPERATOR_FILE = path.join(LEGAL_DIR, "operator.json");
// Overridable so the mirror test can regenerate into a temp file and prove the
// committed output is reproducible, rather than asserting on a stale copy.
const DEFAULT_TARGET = path.join(root, "supabase", "functions", "legal", "pages.generated.ts");
const TARGET = process.argv[2] ? path.resolve(root, process.argv[2]) : DEFAULT_TARGET;

/** slug -> source file. The slug is the URL path segment. */
const PAGES = {
  privacy: "privacy.html",
  terms: "terms.html",
  "account-deletion": "account-deletion.html",
};

/** Tokens the operator details are substituted into. */
const REQUIRED_TOKENS = ["%%OPERATOR_NAME%%", "%%CONTACT_EMAIL%%"];

/** Any %%SOMETHING%% so an unexpected token is reported rather than shipped. */
const TOKEN_RE = /%%[A-Z0-9_]+%%/g;

function fail(message) {
  console.error(`gen-legal-pages: ${message}`);
  process.exit(1);
}

function loadOperator() {
  if (!fs.existsSync(OPERATOR_FILE)) fail(`missing ${path.relative(root, OPERATOR_FILE)}`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(OPERATOR_FILE, "utf8"));
  } catch (e) {
    fail(`${path.relative(root, OPERATOR_FILE)} is not valid JSON: ${e.message}`);
  }
  for (const key of ["operatorName", "contactEmail"]) {
    const value = raw[key];
    if (typeof value !== "string" || value.trim() === "") {
      fail(`${path.relative(root, OPERATOR_FILE)} needs a non-empty "${key}"`);
    }
  }
  return { operatorName: raw.operatorName.trim(), contactEmail: raw.contactEmail.trim() };
}

function titleOf(html, file) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  if (!match) fail(`${file} has no <title>`);
  // "Privacy Policy — Vaylo Sports" reads as "Privacy Policy" in a nav list.
  return match[1].split("\u2014")[0].split(" - ")[0].trim();
}

function assertSelfContained(html, file) {
  const scripts = html.match(/<script[\s>]/gi);
  if (scripts) fail(`${file} contains ${scripts.length} <script> tag(s); these pages must not run code`);

  // Any absolute http(s) reference means the page depends on a third party to
  // render. Internal anchors (#id) and mailto: are fine.
  const external = html.match(/(?:src|href)\s*=\s*["']https?:\/\//gi);
  if (external) {
    fail(`${file} references an external resource (${external[0]}); these pages must be self-contained`);
  }
}

function escapeForTemplateLiteral(text) {
  // The page is embedded in a JS template literal, so these three sequences
  // would otherwise end the literal or interpolate.
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

const operator = loadOperator();
const tokenValues = {
  "%%OPERATOR_NAME%%": operator.operatorName,
  "%%CONTACT_EMAIL%%": operator.contactEmail,
};
const placeholder = Object.values(operator).some((value) => value.includes("REPLACE_ME"));

const entries = [];
const seenTokens = new Set();

for (const [slug, file] of Object.entries(PAGES)) {
  const full = path.join(LEGAL_DIR, file);
  if (!fs.existsSync(full)) fail(`missing ${path.relative(root, full)}`);

  const source = fs.readFileSync(full, "utf8");
  assertSelfContained(source, file);

  for (const token of source.match(TOKEN_RE) ?? []) {
    seenTokens.add(token);
    if (!REQUIRED_TOKENS.includes(token)) fail(`${file} contains an unexpected token ${token}`);
  }

  const html = source.replace(TOKEN_RE, (token) => tokenValues[token]);
  // A fresh regex: TOKEN_RE is global, so reusing it here would test from
  // wherever the last match left off.
  if (/%%[A-Z0-9_]+%%/.test(html)) {
    fail(`${file} still has an unresolved token after substitution`);
  }

  entries.push({ slug, title: titleOf(html, file), html });
}

for (const token of REQUIRED_TOKENS) {
  if (!seenTokens.has(token)) {
    fail(
      `no page uses ${token}. Every legal page must carry the contact details, so a stale ` +
        `token here would publish a policy with no way to reach anyone.`
    );
  }
}

const body = entries
  .map(
    (page) =>
      `  "${page.slug}": {\n` +
      `    title: ${JSON.stringify(page.title)},\n` +
      `    html: \`${escapeForTemplateLiteral(page.html)}\`,\n` +
      `  },`
  )
  .join("\n");

const output = `// GENERATED FILE — do not edit by hand.
//
// Produced by scripts/gen-legal-pages.cjs from the HTML in legal/ and the
// operator details in legal/operator.json. Edit the sources there and re-run
// the script; src/lib/legalPages.test.ts fails if this file and those sources
// disagree, so a forgotten run is caught in CI rather than in production.

export interface LegalPage {
  title: string;
  html: string;
}

/**
 * True while legal/operator.json still holds its REPLACE_ME placeholders.
 * index.ts refuses to serve anything in that state, so a policy naming the
 * wrong company or a dead inbox cannot be published or reviewed.
 */
export const OPERATOR_DETAILS_UNSET = ${placeholder};

export const OPERATOR_NAME = ${JSON.stringify(operator.operatorName)};
export const CONTACT_EMAIL = ${JSON.stringify(operator.contactEmail)};

export const LEGAL_PAGES: Record<string, LegalPage> = {
${body}
};
`;

fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, output);

const bytes = entries.reduce((sum, page) => sum + page.html.length, 0);
console.log(
  `gen-legal-pages: wrote ${path.relative(root, TARGET)} — ` +
    `${entries.length} pages (${entries.map((p) => p.slug).join(", ")}), ${bytes} bytes` +
    (placeholder
      ? "\n  NOTE: legal/operator.json still holds REPLACE_ME placeholders. The function will\n" +
        "  answer 503 until the real operator name and a working support email are set."
      : "")
);
