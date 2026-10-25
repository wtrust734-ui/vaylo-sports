#!/usr/bin/env node
// ============================================================================
// PUBLISH THE MARKETING SITE
// ----------------------------------------------------------------------------
// What this does
//
// One command, two steps, in this order:
//
//   1. node scripts/gen-website.cjs   → website/ (legal pages, marketing)
//   2. netlify deploy --dir=website   → one site, one deploy
//
// The live-app preview that used to be built into website/play/ and embedded on
// the /app/ page was deleted from the main website at the owner's request. The
// app itself is delivered separately as the downloadable web-app clone (see
// docs/WEB-CLONE.md and `npm run build:clone`), never through this site. The
// verification below therefore asserts the preview is ABSENT: a rebuild that
// resurrected website/play/ or website/app/ would publish it, and this is the
// check that stops the deploy before it can.
//
// Why generate-then-deploy in one command. gen-website.cjs does
// `rmSync(OUT_DIR)`, so deploying the output of an earlier `npm run site:build`
// can publish a stale site. Running the generator first means the bytes that
// get verified are the bytes that get uploaded.
//
// Usage
//   node scripts/deploy-web.cjs              → generate, verify, deploy to prod
//   node scripts/deploy-web.cjs --dry-run    → generate and verify, no deploy
//   node scripts/deploy-web.cjs --standalone → print the standalone app-site
//                                              deploy instructions too
// ============================================================================

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

/** Where the marketing site is published from. */
const SITE_DIR = path.join(root, "website");
/**
 * The mount prefix the deleted app preview used to live at.
 *
 * Kept exported because the router/build-side support for a sub-path mount
 * (build-web.cjs `VITE_BASE`, the app's basename handling) still exists and is
 * still tested — only the preview itself was removed.
 */
const PLAY_BASE = "/play/";
/**
 * The marketing site. The repo root is linked to it, which is why --dir is used.
 *
 * vaylo-sports-606, not vaylo-sports: the original project (388b0b24…) lives on
 * the gemmellj175/fraiche account, and Netlify refused every deploy to it with
 * "Account credit usage exceeded". The site was rebuilt and published under the
 * jamesgemmell140912 account instead, where the CLI is now authenticated and the
 * project is set to Public.
 *
 * If deploys start failing with a 404 on the site id, the CLI has been switched
 * back to an account that cannot see this project — run `netlify status` first.
 */
const MARKETING_SITE_ID = "598e5f2b-06d5-421c-a520-f8c27c614163";
/** The standalone app site, deployed only with --standalone. */
const APP_SITE_ID = "79d67cae-c1cd-4cdb-a72a-14e180145880";

/**
 * How to run the Netlify CLI.
 *
 * Returned as [command, ...args] for execFileSync. It is a JS entry point run
 * by the current node binary, never a .cmd: Node cannot spawn a Windows batch
 * shim without a shell and fails with EINVAL, which is what killed the deploy.
 * A local netlify-cli is used if present so a pinned version wins; otherwise
 * npm's npx-cli.js fetches it the way `npx netlify` does.
 */
function netlifyCommand() {
  const local = path.join(root, "node_modules", "netlify-cli", "bin", "run.js");
  if (fs.existsSync(local)) return [process.execPath, local];

  // npx ships inside the npm that came with the node running this script, but
  // the layout differs by platform: Windows installs npm beside node.exe
  // (<nodejs>/node_modules/npm/bin/npx-cli.js), while Linux and macOS put it
  // under the install prefix (<prefix>/lib/node_modules/npm/…, with the node
  // binary in <prefix>/bin/). GitHub's setup-node ships that Linux layout, so
  // a Windows-only sibling path made this throw on every CI run — and would
  // have broken the deploy on any Linux host too. Both layouts are tried,
  // before and after resolving a symlinked node (/usr/local/bin/node).
  const bases = [...new Set([path.dirname(process.execPath), path.dirname(fs.realpathSync(process.execPath))])];
  for (const base of bases) {
    for (const npx of [
      path.join(base, "node_modules", "npm", "bin", "npx-cli.js"),
      path.join(base, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
    ]) {
      if (fs.existsSync(npx)) return [process.execPath, npx, "--yes", "netlify"];
    }
  }

  throw new Error(
    "cannot find the Netlify CLI — install netlify-cli locally, or install Node " +
      "with npm so node_modules/npm/bin/npx-cli.js exists",
  );
}

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const STANDALONE = args.has("--standalone");

function step(message) {
  console.log(`\ndeploy-web: ${message}`);
}

function fail(message) {
  console.error(`\ndeploy-web: FAILED — ${message}`);
  process.exit(1);
}

/**
 * Run a script in this repo.
 *
 * stdio is inherited so the script's own output is visible: a deploy that
 * swallows its build log is a deploy that fails without saying why.
 */
function run(script, extraEnv) {
  execFileSync(process.execPath, [path.join(root, "scripts", script)], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
}

/**
 * Check that the thing about to be published contains the site — and none of
 * the removed app preview.
 *
 * Throws rather than calls fail(), so every check below is assertable from a
 * test. main() is the only place a failure should end the process, and it turns
 * the throw into a clean exit.
 *
 * `siteDir` is a parameter so this can be pointed at a fixture. It defaults to
 * the real output; nothing in main() passes anything else.
 */
function verify(siteDir = SITE_DIR) {
  // The app preview was deleted from the main website. Its two artefacts must
  // never come back: website/play/ (the embedded React bundle) and
  // website/app/ (the page that framed it).
  for (const dir of ["play", "app"]) {
    if (fs.existsSync(path.join(siteDir, dir))) {
      throw new Error(
        `website/${dir}/ exists — the removed app preview must not be published with the site`,
      );
    }
  }
  if (!fs.existsSync(path.join(siteDir, "index.html"))) {
    throw new Error("website/index.html is missing — the site was not generated");
  }

  const count = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).reduce(
      (n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1),
      0,
    );
  console.log(`\ndeploy-web: verified — ${count(siteDir)} files, no app preview present`);
}

function main() {
  step("1/2  generating the marketing site into website/");
  run("gen-website.cjs");

  // verify() throws; turn that into the same clean exit every other failure uses,
  // rather than letting an unhandled rejection print a stack and exit non-zero.
  try {
    verify();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return; // unreachable; fail() exits.
  }

  if (DRY_RUN) {
    console.log("\ndeploy-web: --dry-run — generated and verified, nothing deployed.");
    return;
  }

  step("2/2  deploying the marketing site to production");
  // --no-build: the site is pre-generated and the CLI's build detection prompts
  // on a terminal with no TTY, dying with ERR_USE_AFTER_CLOSE before uploading.
  // --dir + --site: the repo root is already linked to this site, but naming it
  // means a mis-linked checkout cannot publish something unintended.
  const netlify = netlifyCommand();
  execFileSync(
    netlify[0],
    [...netlify.slice(1), "deploy", "--no-build", "--prod", `--dir=${SITE_DIR}`, `--site=${MARKETING_SITE_ID}`],
    { cwd: root, stdio: "inherit" },
  );

  if (STANDALONE) {
    step("also notes the standalone app site");
    console.log(
      "deploy-web: note — the standalone site keeps its own root-mounted build, so it\n" +
        "  still needs `node scripts/build-web.cjs` first. Run that, then:\n" +
        `    cd dist-web && npx netlify deploy --no-build --prod --site=${APP_SITE_ID}` +
        "\n  The downloadable web-app clone is separate again: `npm run build:clone`\n" +
        "  (see docs/WEB-CLONE.md).",
    );
  }

  console.log("\ndeploy-web: live — the site was published.");
}

if (require.main === module) main();

module.exports = { SITE_DIR, PLAY_BASE, MARKETING_SITE_ID, APP_SITE_ID, verify, netlifyCommand };
