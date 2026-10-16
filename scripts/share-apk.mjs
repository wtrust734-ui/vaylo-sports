#!/usr/bin/env node
// ==============================================================================
// Publish the newest release APK to the Pixel 9 download folder + page.
// ==============================================================================
// What it does:
//   1. Finds the newest apk/vaylo-sports-*-release.apk (what build-apk.sh
//      publishes on every successful release build).
//   2. Copies it to public-apk/app-release.apk — the STABLE URL your Pixel 9
//      already has bookmarked, so the link never changes.
//   3. Regenerates public-apk/index.html with the real version label, SHA256,
//      size and date, plus QR / WhatsApp / SMS share / Phone Link steps.
//
// Usage:
//   node scripts/share-apk.mjs
//
// After running this, redeploy the preview site so the Pixel sees the new
// build (the agent does that with sites_deploy). The page + APK stay under
// the 10 MiB asset limit because only ONE apk is published.
// ==============================================================================

import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const APK_DIR = resolve(ROOT, "apk");
const PUB_DIR = resolve(ROOT, "public-apk");
const STABLE_NAME = "app-release.apk";
const PAGE_URL = "https://site-36d8f24b9cf04dc3a72c09f2a69f8d82.freebuff.page/";

// --- Find the newest versioned release APK ------------------------------------
let entries;
try {
  entries = readdirSync(APK_DIR);
} catch {
  console.error("share-apk: FAIL apk/ directory not found at", APK_DIR);
  process.exit(1);
}
const candidates = entries
  .filter((f) => /^vaylo-sports-.*-release\.apk$/.test(f))
  .map((f) => ({ f, mtime: statSync(resolve(APK_DIR, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (candidates.length === 0) {
  console.error("share-apk: FAIL no vaylo-sports-*-release.apk in", APK_DIR);
  process.exit(1);
}
const newest = candidates[0].f;
const versionMatch = newest.match(/vaylo-sports-([0-9.]+)-([0-9]+)-release\.apk/);
const versionLabel = versionMatch ? `${versionMatch[1]} (code ${versionMatch[2]})` : newest;

// --- Copy to the stable Pixel URL ---------------------------------------------
const src = resolve(APK_DIR, newest);
const dest = resolve(PUB_DIR, STABLE_NAME);
copyFileSync(src, dest);

const buf = readFileSync(dest);
const sha256 = createHash("sha256").update(buf).digest("hex");
const sizeMB = (buf.length / 1024 / 1024).toFixed(1);
const sizeBytes = buf.length.toLocaleString("en-US");
const date = new Date().toISOString().replace("T", " ").slice(0, 16);
const encodedPage = encodeURIComponent(PAGE_URL);

// --- Regenerate the download page ----------------------------------------------
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Vaylo Sports APK download</title>
<style>
body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;line-height:1.5}
.btn{display:inline-block;padding:14px 22px;background:#16a34a;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;margin:8px 8px 8px 0}
.btn2{background:#25D366}.btn3{background:#0ea5e9}
code{background:#f1f5f9;padding:2px 6px;border-radius:6px;font-size:13px;word-break:break-all}
.small{color:#64748b;font-size:13px}
.row{margin:12px 0}
img.qr{width:200px;height:200px;border:1px solid #e2e8f0;border-radius:12px}
ol{padding-left:20px}
</style>
</head>
<body>
<h1>Vaylo Sports APK</h1>
<p>Latest build: <b>${versionLabel}</b> — published ${date} UTC.</p>
<p>Tap below on your Pixel 9 to download. This link never changes; it always serves the newest build.</p>
<a class="btn" href="/${STABLE_NAME}" download>Download ${STABLE_NAME} (${sizeMB} MB)</a>
<div class="row">
<img class="qr" alt="QR to this page" src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodedPage}" />
<p class="small">Point your Pixel camera at the QR to open this page.</p>
</div>
<div class="row">
<a class="btn btn2" href="https://wa.me/?text=Vaylo%20APK%20${encodeURIComponent(versionLabel)}%3A%20${encodedPage}">Share via WhatsApp</a>
<a class="btn btn3" href="sms:?&body=Vaylo%20APK%20${encodeURIComponent(versionLabel)}%3A%20${encodedPage}">Share via SMS</a>
</div>
<h2>Windows → Pixel 9 (free, no new account)</h2>
<ol>
<li>Open this page on Windows and download <code>${STABLE_NAME}</code>.</li>
<li>Open <b>Phone Link</b> (aka.ms/linktowindows) on Windows and link your Pixel 9 once — or use Quick Share for Windows.</li>
<li>Copy the file to the phone via Phone Link / Quick Share, or drop it in Google Drive and open it on the phone.</li>
<li>On the Pixel, open the file in Files and tap to install. Allow "Install unknown apps" for Files when asked; Play Protect warnings are normal for your own build.</li>
</ol>
<p>Verify the download (source file <code>${newest}</code>):</p>
<p>SHA256:<br/><code>${sha256}</code></p>
<p class="small">Size ${sizeBytes} bytes. Private preview link — say the word and it gets unpublished.</p>
</body>
</html>
`;
writeFileSync(resolve(PUB_DIR, "index.html"), html);

console.log("share-apk: published", newest, "->", `public-apk/${STABLE_NAME}`);
console.log("share-apk: version", versionLabel);
console.log("share-apk: sha256", sha256);
console.log("share-apk: size MB", sizeMB);
console.log("share-apk: page", PAGE_URL);
console.log("share-apk: NEXT — redeploy the preview site (sites_deploy) so the Pixel sees it.");
