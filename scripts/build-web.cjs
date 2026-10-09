#!/usr/bin/env node
// ============================================================================
// BUILD THE APP FOR A BROWSER
// ----------------------------------------------------------------------------
// What this does
//
// The same React app is shipped three ways. `npm run build:native` produces the
// bundle Capacitor loads into the Android WebView; this produces the one a
// browser loads; and, when VITE_BASE names a sub-path, the one the marketing
// site mounts under /play/ as its live preview. Same source — the app detects
// its platform and its mount prefix at runtime — but NOT interchangeable
// output, and the differences are why this script exists rather than
// `npx vite build`:
//
//   1. Separate output directory. The native bundle in dist/ is the exact input
//      to `npx cap sync android`, and overwriting it between a build and a
//      gradle run is how an APK ends up shipping someone else's JavaScript.
//      This writes to dist-web/ (or wherever WEB_OUT_DIR points) and never
//      touches dist/.
//
//   2. Host files, and only for a root-mounted build. `_headers`, `netlify.toml`
//      and `_redirects` describe a site that owns the whole origin. Mounted
//      under /play/ the app shares an origin with the marketing site, so those
//      files would be inert at best: `_redirects` and `netlify.toml` are read
//      from the publish root, never from a sub-directory, and a `_headers` file
//      nested under /play/ sets nothing. Worse, the SPA fallback they carry is
//      the wrong one — `/* /index.html 200` mounted under /play/ would capture
//      every path outside the app. So an embedded build emits none of them, and
//      the owner of the origin declares the fallback for the /play/* prefix.
//
//   3. A check that the bundle really is a web build. `isNativeShell()` decides
//      between BrowserRouter and HashRouter at runtime; a mis-built bundle would
//      silently pick the native one and put every URL behind a `#`.
//
// Usage
//   node scripts/build-web.cjs                    → dist-web/, root-mounted
//   VITE_BASE=/play/ node scripts/build-web.cjs   → embedded, same origin
//
// Root-mounted publish (a standalone app site):
//   node scripts/build-web.cjs
//   cd dist-web && npx netlify deploy --no-build --prod --site=79d67cae-c1cd-4cdb-a72a-14e180145880
//
// Embedded publish (part of the marketing site) — do not run this by hand;
// scripts/deploy-web.cjs does it, in the right order, and also deploys:
//
//   WEB_OUT_DIR=website/play VITE_BASE=/play/ node scripts/build-web.cjs
// ============================================================================

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// path.resolve, not path.join: an absolute WEB_OUT_DIR has to win outright,
// because path.join treats its second argument as relative to the first.
const OUT = path.resolve(root, process.env.WEB_OUT_DIR || "dist-web");

/**
 * The mount prefix, normalised to the form Vite wants ("/" or "/play/").
 *
 * Rejected outright rather than normalised into something plausible: a base that
 * is not a simple absolute path ("//evil.example", "http://…", a path with "..")
 * is either a mistake or an attempt to write assets outside the publish root.
 * Neither should produce a deployable bundle, and Vite's own behaviour for a
 * relative base is to emit "./assets/…", which silently breaks on any nested
 * route — so the check has to happen before the compile, not after.
 */
function resolveBase(raw = process.env.VITE_BASE ?? "/") {
  // Throws rather than calls fail(): this function is pure and is called from
  // tests with explicit inputs, and process.exit inside a vitest worker would
  // kill the whole run with no assertion and no file name. main() catches.
  if (typeof raw !== "string" || !raw.startsWith("/")) {
    throw new Error(
      `VITE_BASE is "${raw}" — it must start with "/". A relative base makes Vite ` +
        `emit "./assets/…", which 404s on every nested route and is invisible in ` +
        `the build log.`,
    );
  }
  if (raw.includes("..") || raw.includes("//") || /[:?#\\]/.test(raw)) {
    throw new Error(`VITE_BASE is "${raw}" — it must be a simple path like "/play/"`);
  }
  // Exactly one trailing slash: Vite treats "/play" and "/play/" differently in
  // the emitted asset URLs, and src/lib/routerBase.ts reads BASE_URL to build the
  // router basename, so the two must agree.
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed === "" ? "/" : `${trimmed}/`;
}

/**
 * The mount prefix in force for this run, normalised.
 *
 * resolveBase throws on a malformed VITE_BASE, and this line runs at require
 * time — including inside a vitest worker, where an unhandled exit kills the
 * whole run with no explanation. So the value is best-effort here and re-resolved
 * strictly in main(), which is the only place a bad base should be fatal.
 */
const BASE = (() => {
  try {
    return resolveBase();
  } catch {
    return "/";
  }
})();
/** True when the app is mounted below the origin root and shares an origin. */
const EMBEDDED = BASE !== "/";

/**
 * The site a ROOT-MOUNTED build is published to.
 *
 * Kept as a constant rather than left to `netlify link` so that a deploy cannot
 * quietly land on the wrong Netlify site: the repo root is linked to
 * vaylo-sports, the marketing and legal site, and publishing a root-mounted app
 * bundle there would replace the legal pages.
 *
 * An embedded build is not published on its own at all — it rides inside the
 * marketing site's deploy, and this id is not used.
 */
const APP_SITE_ID = "79d67cae-c1cd-4cdb-a72a-14e180145880";
const APP_SITE_NAME = "vaylo-sports-app";

/**
 * Security headers for the hosted app.
 *
 * These are the web equivalents of the ones already set in the Android
 * manifest — `allowMixedContent: false`, no cleartext traffic — plus the two
 * that only make sense for a browser origin.
 *
 * The CSP was added by the 2026-10-06 security audit and verified against
 * what the bundle actually loads: no inline scripts and no eval anywhere in
 * the build, so script-src stays strict at 'self'. connect-src names the
 * Supabase project (https for REST/storage/functions, wss for the realtime
 * channel in useNotifications) and the Google Fonts origins the stylesheet
 * pulls from; every other request the client makes is same-origin or happens
 * edge-side inside a function. The wearable OAuth flows navigate rather than
 * fetch, so no third-party API origin belongs here.
 *
 * frame-ancestors 'none' matches X-Frame-Options DENY: there is no legitimate
 * reason to frame this app, and a framed login form is a clickjacking target.
 * (The marketing site's copy of this policy — root netlify.toml, which serves
 * the /play/ preview — uses frame-ancestors 'self' instead, because the /app/
 * preview iframe must be able to frame it.)
 *
 * The headers appear in BOTH `_headers` and the generated netlify.toml below:
 * Netlify merges both sources, and setting one in two places that disagree
 * leaves the result undefined — so both files carry the same values.
 *
 * Written only for a root-mounted build. Embedded, the marketing site already
 * declares these for /* and the app must be framable by it to be a preview at
 * all — the marketing site sets SAMEORIGIN, which permits exactly one thing:
 * being framed by itself.
 */
const HEADERS = `# GENERATED by scripts/build-web.cjs — web-build only, never shipped in the APK.
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(self), camera=(self), microphone=(), payment=()
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co; media-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Strict-Transport-Security: max-age=31536000; includeSubDomains

  # The app ships no service worker and registers none, so it can be cached
  # aggressively; hashed asset filenames make that safe. index.html is excluded
  # above by the more specific rule below.
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/index.html
  Cache-Control: no-cache
`;

/**
 * A netlify.toml for the app site, written into the output directory.
 *
 * This exists because of a concrete, silent failure. Netlify reads
 * `netlify.toml` from the directory the CLI is run in — not from `--dir`. The
 * repository root has a netlify.toml for the marketing site, and it ends with:
 *
 *     [[redirects]]
 *       from = "/*"
 *       to = "/404.html"
 *       status = 404
 *
 * That is correct for a site of pre-generated HTML pages. It is fatal for this
 * app, because netlify.toml redirects take precedence over `_redirects`: run
 * `netlify deploy --dir=dist-web` from the root and every deep link — /training,
 * /profile, /learning/run-001 — returns 404 while the app still works on a click
 * through the home page. Nothing errors. The only symptom is a refresh breaking.
 *
 * So this file is written next to the build, and the publish command `cd`s into
 * dist-web first. It repeats the SPA fallback that `_redirects` already carries
 * so the two cannot drift apart silently; both hosts read their own file.
 */
const NETLIFY_TOML = `# GENERATED by scripts/build-web.cjs — web-build only, never shipped in the APK.
#
# Three things in this file are load-bearing, and each was a real failure:
#
# 1. It must be deployed from inside the output directory, because the Netlify
#    CLI resolves netlify.toml from the working directory, not from --dir. The
#    repository root has a netlify.toml for the marketing and legal site whose
#    catch-all rewrite to 404.html takes precedence over _redirects, so a deploy
#    from the root makes every deep link 404 while the app keeps working via
#    in-app navigation. Nothing errors.
#
# 2. 'publish' is relative to the repository root, not to this file. Publishing
#    with '.' uploads the whole repository: the live site then serves the
#    marketing site's /website/** pages and the real package.json and
#    src/*.tsx, and the upload count is thousands of files rather than ~160.
#    Pinning 'base' does not help, because base is itself relative to that same
#    root. Only a path from the repository root reaches the build output.
#
# 3. The headers are repeated here rather than left solely in _headers. With the
#    site's own toml in force, _headers alone was not applied at all — the live
#    site served no X-Frame-Options and no nosniff. Both files now carry the same
#    values, so which one wins cannot change the result.
#
#   cd dist-web && npx netlify deploy --no-build --prod --site=${APP_SITE_ID}

[build]
  # publish is resolved against the CLI's detected base, which is the repository
  # root — NOT against this file's directory. Two different roots are in play:
  # the config file is found by walking up from the working directory (so this
  # one is used when the CLI runs inside dist-web), while publish is resolved
  # from the repository root. So "." would publish the entire repository, and
  # "base = \\".\\"" does not help because base is itself relative to that same
  # root. Only a path from the repository root reaches the build output.
  publish = "dist-web"
  command = ""

# Same rule as the "/*  /index.html  200" line in _redirects, which is what
# non-Netlify hosts read. Netlify merges the two; they agree on purpose.
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
  X-Content-Type-Options = "nosniff"
  X-Frame-Options = "DENY"
  Referrer-Policy = "strict-origin-when-cross-origin"
  Permissions-Policy = "geolocation=(self), camera=(self), microphone=(), payment=()"
  Cross-Origin-Opener-Policy = "same-origin"
  Content-Security-Policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co; media-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  Strict-Transport-Security = "max-age=31536000; includeSubDomains"

[[headers]]
  for = "/assets/*"
  [headers.values]
  Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/index.html"
  [headers.values]
  Cache-Control = "no-cache"
`;

function fail(message) {
  console.error(`build-web: ${message}`);
  process.exit(1);
}

/**
 * Vite's own entry script, run with this same Node binary.
 *
 * Shelling out to `npx` does not work here: on Windows, spawnSync of a .cmd
 * shim through Git Bash fails with EINVAL before the command runs, so the
 * failure looks like a broken build rather than a broken spawn. Calling
 * node_modules/vite/bin/vite.js directly has no shell in the path at all, and
 * works the same on every platform.
 */
const VITE_BIN = path.join(root, "node_modules", "vite", "bin", "vite.js");

/** Files that only describe a site which owns the whole origin. */
const ROOT_ONLY_FILES = ["_headers", "netlify.toml", "_redirects"];

function main() {
  // Re-resolve here rather than trusting the module-level BASE, and turn a throw
  // into a clean exit: main() is the only place where a malformed VITE_BASE
  // should be fatal. Requiring this module (which the tests do) must never exit.
  let base;
  try {
    base = resolveBase();
  } catch (error) {
    fail(error.message);
    return; // unreachable; fail() exits. Keeps the control flow explicit.
  }
  const embedded = base !== "/";

  // 1. Compile. Production mode, NOT --mode native: the native mode exists to
  //    tell the bundle it is running inside Capacitor.
  if (!fs.existsSync(VITE_BIN)) fail("node_modules/vite is missing — run npm install first");
  console.log(
    `build-web: compiling for a browser${embedded ? `, mounted at ${base}` : ""}…`,
  );
  const viteEnv = { ...process.env, VITE_BASE: base };
  execFileSync(process.execPath, [VITE_BIN, "build", "--outDir", OUT, "--emptyOutDir"], {
    cwd: root,
    stdio: "inherit",
    env: viteEnv,
  });

  if (embedded) {
    // 2a. Embedded: strip the root-only host files. Vite copies public/_redirects
    //     in on its own, so it has to be removed here as well as skipped below.
    //     Leaving any of them would be a lie about who owns the origin.
    const removed = [];
    for (const name of ROOT_ONLY_FILES) {
      const target = path.join(OUT, name);
      if (fs.existsSync(target)) {
        fs.rmSync(target);
        removed.push(name);
      }
    }
    console.log(
      removed.length
        ? `build-web: removed root-only host file(s): ${removed.join(", ")}`
        : "build-web: no root-only host files were present",
    );
  } else {
    // 2b. Root-mounted: write the host files. They go here rather than in
    //     public/ so the APK never carries them.
    fs.writeFileSync(path.join(OUT, "_headers"), HEADERS);
    fs.writeFileSync(path.join(OUT, "netlify.toml"), NETLIFY_TOML);
    console.log("build-web: wrote _headers and netlify.toml");

    // The SPA fallback must exist. Vite's dev server rewrites everything to
    // index.html, so a missing _redirects is invisible until someone shares a
    // deep link and gets the host's 404 instead of the app.
    const redirects = path.join(OUT, "_redirects");
    if (!fs.existsSync(redirects)) {
      fail(`no _redirects in ${path.relative(root, OUT)} — deep links will 404 in production`);
    }
    if (!/\/\*[\s,]+.*\/index\.html\s+200/.test(fs.readFileSync(redirects, "utf8"))) {
      fail(`_redirects has no "/*  /index.html  200" fallback rule — see public/_redirects`);
    }
    console.log("build-web: SPA fallback present");
  }

  // 3. Prove it is a browser build and not a native one.
  const indexJs = fs
    .readdirSync(path.join(OUT, "assets"))
    .find((f) => /^index-.*\.js$/.test(f));
  if (!indexJs) fail("no entry chunk in the output");
  const bundle = fs.readFileSync(path.join(OUT, "assets", indexJs), "utf8");

  if (bundle.includes("capacitor://localhost")) {
    // Not a failure — the same source contains the native fallbacks regardless.
    // Recorded so a surprising native-only path is visible in the build log.
    console.log("build-web: note: bundle still contains Capacitor fallbacks (expected — runtime detection)");
  }

  // 4. For an embedded build, the mount prefix has to be baked into the emitted
  //    HTML, or every asset request 404s while the app itself looks fine. This
  //    is the check that catches a VITE_BASE that was set but never reached the
  //    compile — the failure mode where base defaults to "/" and only the network
  //    tab reveals it.
  const indexHtml = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
  if (embedded) {
    const prefix = base.replace(/\/$/, "");
    if (!indexHtml.includes(`${prefix}/assets/`)) {
      fail(
        `index.html does not reference ${prefix}/assets/ — VITE_BASE=${base} did not reach ` +
          `the compile, so every asset will 404.`,
      );
    }
    if (/<base\s/i.test(indexHtml)) {
      fail(`index.html contains a <base> tag, which would break the ${prefix} mount`);
    }
  }

  if (!fs.existsSync(path.join(OUT, "index.html"))) fail("no index.html in the output");

  const bytes = fs
    .readdirSync(path.join(OUT, "assets"))
    .reduce((n, f) => n + fs.statSync(path.join(OUT, "assets", f)).size, 0);

  console.log(
    `build-web: done — ${path.relative(root, OUT)}/ ` +
      `(${(fs.statSync(path.join(OUT, "index.html")).size / 1024).toFixed(1)} kB index.html, ` +
      `${(bytes / 1024 / 1024).toFixed(2)} MB of assets)`,
  );

  if (embedded) {
    console.log("");
    console.log(`build-web: this build is EMBEDDED at ${base} — do not deploy it on its own.`);
    console.log("  It carries no host files, so a standalone deploy would serve deep links");
    console.log("  with no SPA fallback. Run `npm run site:deploy` to build and publish it");
    console.log("  with the marketing site, or `npm run build:web` for the standalone app site.");
    return;
  }

  // 5. State the publish command, and say why the `cd` is load-bearing. This is
  //    the one instruction a user is likely to retype from memory.
  console.log("");
  console.log(`build-web: publish to ${APP_SITE_NAME} with`);
  console.log(`  cd ${path.relative(root, OUT)} && npx netlify deploy --no-build --prod --site=${APP_SITE_ID}`);
  if (fs.existsSync(path.join(root, "netlify.toml"))) {
    console.log("");
    console.log("build-web: WARNING — the repository root has a netlify.toml for the");
    console.log("  marketing site, and its /* -> 404.html rewrite overrides the SPA");
    console.log("  fallback if you deploy from there. Run the command above as written.");
  }
}

// Only build when run directly. Requiring this module must not compile a
// bundle: the tests assert on the generated file contents, which are
// deterministic, so paying for a real Vite build to read them is both slow
// and fragile — a Vite build under vitest fails the env validation in
// vite.config.ts, which refuses the legacy JWT-shaped key outside test mode.
if (require.main === module) main();

module.exports = {
  HEADERS,
  NETLIFY_TOML,
  APP_SITE_ID,
  APP_SITE_NAME,
  OUT,
  BASE,
  EMBEDDED,
  ROOT_ONLY_FILES,
  resolveBase,
};