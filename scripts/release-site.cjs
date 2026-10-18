#!/usr/bin/env node
"use strict";

const { execFileSync, spawnFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SITE = path.join(ROOT, "website");
const VERCEL_JSON = path.join(ROOT, "vercel.json");

function step(msg) {
  console.log("\nrelease-site: " + msg);
}

function fail(msg) {
  console.error("\nrelease-site: FAILED — " + msg);
  process.exit(1);
}

function sh(cmd, args, opts) {
  const result = spawnFileSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    ...opts,
  });
  if (result.status !== 0) {
    fail("command failed: " + [cmd, ...args].join(" "));
  }
  return result;
}

function verifySite() {
  step("1/2  verifying the generated site");
  const names = ["index.html", "_redirects", "robots.txt", "studio.inline.html"];
  const existing = fs.readdirSync(SITE);
  const missing = names.filter((n) => !existing.includes(n));
  if (missing.length) {
    fail("site is missing: " + missing.join(", "));
  }

  const index = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  const studio = fs.readFileSync(path.join(SITE, "studio.inline.html"), "utf8");
  if (!index.includes('<title>Vaylo Sports — Make ads for your app</title>')) {
    fail("index.html has the wrong title");
  }
  if (!studio.includes('<title>Vaylo Sports — Ad Studio</title>')) {
    fail("studio.inline.html has the wrong title");
  }
  if (!studio.includes("BRAND BRAIN") || !studio.includes("Script Writer")) {
    fail("studio.inline.html looks incomplete");
  }

  console.log("release-site: verified — index + studio + redirects + robots in place");
}

function deployVercel() {
  step("2/2  deploying with Vercel CLI");

  if (!fs.existsSync(VERCEL_JSON)) {
    fail("vercel.json is missing at the repo root");
  }

  const vercel = path.join(ROOT, "node_modules", ".bin", "vercel");
  const vercelCmd =
    process.platform === "win32" ? "cmd" : vercel;
  const vercelArgs =
    process.platform === "win32"
      ? ["/c", vercel, "--prod", "--confirm", "--cwd", SITE]
      : ["--prod", "--confirm", "--cwd", SITE];

  try {
    sh(vercelCmd, vercelArgs, { env: { ...process.env, CI: "1" } });
  } catch (err) {
    // If a local vercel shim is missing, fall back to npx and keep the output visible.
    console.warn(
      "\nrelease-site: local vercel shim not usable — trying npx vercel",
    );
    try {
      sh("npx", ["vercel", "--prod", "--confirm", "--cwd", SITE], {
        env: { ...process.env, CI: "1" },
      });
    } catch (err2) {
      fail("vercel deploy failed — install the vercel CLI or fix the local shim");
    }
  }

  console.log("release-site: deployed — the site should now be live on Vercel");
}

function main() {
  if (!fs.existsSync(SITE) || !fs.existsSync(path.join(SITE, "gen-site.cjs"))) {
    // The site generator is expected at scripts/gen-site.cjs, and it writes into website/.
    fail(
      "cannot release: website/ or scripts/gen-site.cjs is missing — run the site generator first",
    );
  }

  // Regenerate the site first so verification always tests the bytes that get published.
  sh(process.execPath, [path.join(ROOT, "scripts", "gen-site.cjs")]);

  verifySite();

  const args = new Set(process.argv.slice(2));
  if (args.has("--dry-run")) {
    console.log("\nrelease-site: --dry-run — generated and verified, not deployed");
    return;
  }

  deployVercel();
}

if (require.main === module) {
  main();
} else {
  module.exports = { verifySite, deployVercel };
}
