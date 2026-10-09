#!/usr/bin/env node
// ============================================================================
// BUILD THE DOWNLOADABLE WEB-APP CLONE
// ----------------------------------------------------------------------------
// Produces webapp-clone/ — a static, keyless copy of the same React app the
// APK ships — and packs it into VayloSports-WebApp.zip at the repo root, the
// file to attach to AI chatbots or hand to anyone.
//
// What makes it a CLONE and not a fork: it builds the SAME source as the APK,
// with two build-time differences only:
//
//   VITE_DEMO_MODE=true            local guest + free purchases (lib/demoMode)
//   VITE_SUPABASE_* = placeholders no API key is read or embedded; the
//                     placeholder host is a reserved .invalid name, so every
//                     backend call fails fast instead of reaching a project
//
// Native plugins (Health Connect, haptics, status bar, Play Billing) are web
// code paths that simply do not run — they stay in the source untouched.
//
// THE STANDING SYNC RULE (docs/WEB-CLONE.md): whenever the APK is updated,
// run this script too and re-share the zip, so the web app tracks the APK.
//
// Steps: build → write README → verify (keys absent, demo seams present,
// Apple hidden as in the APK) → zip with POSIX entry names.
// Any verification failure exits non-zero; a zip is only written from a
// verified build.
// ============================================================================

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const OUT_DIR = path.join(root, "webapp-clone");
const ZIP = path.join(root, "VayloSports-WebApp.zip");
/**
 * The only key-shaped string allowed in the bundle. vite.config.ts refuses to
 * build without an `sb_publishable_` prefix, so the clone carries this inert
 * placeholder — and the verification below rejects any OTHER such key.
 */
const PLACEHOLDER_KEY = "sb_publishable_demo_clone_placeholder";

function fail(message) {
  console.error(`build-clone: FAILED — ${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`\nbuild-clone: ${message}`);
}

/** CRC-32 (IEEE 802.3), the checksum every ZIP entry carries. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** An mtime as the packed DOS date/time pair MS-DOS ZIP entries use. */
function dosStamp(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff,
    date: (((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff,
  };
}

/** Every file under dir, recursively — the zip needs assets, fonts and all. */
function listAllFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listAllFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Pack a directory into a ZIP with no dependency.
 *
 * This exists because PowerShell's Compress-Archive stores Windows separators
 * (`assets\index.js`). Windows unzips that back to a folder, but macOS, Linux
 * and the sandboxes chatbots use extract a flat file literally named
 * `assets\index.js` — so every /assets/ URL in index.html 404s and the clone
 * looks broken. Entry names here are always POSIX, and the archive is portable
 * to anywhere the recipient opens it.
 */
function zipDirectory(srcDir, zipPath) {
  const files = listAllFiles(srcDir).sort();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = path.relative(srcDir, file).split(path.sep).join("/");
    const nameBuf = Buffer.from(name, "utf8");
    const raw = fs.readFileSync(file);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    // Incompressible files (images, fonts) stay stored rather than growing
    // by a few bytes of deflate framing.
    const store = deflated.length >= raw.length;
    const data = store ? raw : deflated;
    const method = store ? 0 : 8;
    const crc = crc32(raw);
    const stamp = dosStamp(fs.statSync(file).mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 entry names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    chunks.push(local, nameBuf, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); // central directory header
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(stamp.time, 12);
    entry.writeUInt16LE(stamp.date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt16LE(0, 30); // extra field length
    entry.writeUInt16LE(0, 32); // comment length
    entry.writeUInt16LE(0, 34); // disk number
    entry.writeUInt16LE(0, 36); // internal attributes
    entry.writeUInt32LE(0x81a40000, 38); // external attributes: regular file, 0644
    entry.writeUInt32LE(offset, 42); // offset of the local header

    central.push(entry, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  fs.writeFileSync(zipPath, Buffer.concat([...chunks, centralBuf, end]));
  return files.length;
}

/** Every emitted .js/.html/.css file in the clone, for the assertions. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(js|html|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function main() {
  // ---- 1. build -----------------------------------------------------------
  step("building the clone (demo mode, placeholder keys) into webapp-clone/");
  const env = {
    ...process.env,
    VITE_DEMO_MODE: "true",
    // Process env beats .env files in Vite, so a real key in .env cannot leak:
    // these two placeholders replace whatever the file carries.
    VITE_SUPABASE_URL: "https://vaylo-demo.invalid",
    VITE_SUPABASE_PUBLISHABLE_KEY: PLACEHOLDER_KEY,
    WEB_OUT_DIR: "webapp-clone",
  };
  delete env.VITE_BASE; // root-mounted, like the APK's own bundle
  execFileSync(process.execPath, [path.join(root, "scripts", "build-web.cjs")], {
    cwd: root,
    stdio: "inherit",
    env,
  });
  if (!fs.existsSync(path.join(OUT_DIR, "index.html"))) fail("no index.html in webapp-clone/");

  // ---- 2. README ----------------------------------------------------------
  const readme = `VAYLO SPORTS — WEB APP CLONE
============================
A static, downloadable copy of the Vaylo Sports app (the same source as the
APK), rebuilt by \`npm run build:clone\`. It is completely separate from the
vaylo sports marketing website.

HOW TO VIEW IT
  This is a web app, so it needs a static file server rather than a double
  click (browsers block module scripts over file://):
    npx http-server .
    python -m http.server 8080
  then open http://localhost:8080 . Any static host works; the included
  _redirects / netlify.toml provide the SPA fallback where they are read.

WHAT WORKS
  - Every screen, route and piece of copy, identical to the APK build
  - A local guest session, created in your browser (nothing is uploaded)
  - Purchases: FREE and granted instantly — no payment, no server
  - Feature unlocks (Mental Gym, Form Analysis, ...) open after you "buy" them

WHAT DOES NOT (no backend by design)
  - All server data: profiles, training history, community, AI features
  - Credits and coins: balances stay at zero — they are non-functional
  - Native-only features: Health Connect, haptics, status bar, store billing
  - Sign-in with Google/Apple/email — there is no auth server to talk to

PRIVACY
  No API keys are embedded in this bundle. Every network URL is a reserved
  placeholder that cannot resolve. Nothing you do in it leaves your machine
  except ordinary page loads of the static files themselves.

REBUILDING
  Source of truth: docs/WEB-CLONE.md. \`npm run build:clone\` regenerates this
  folder and the zip; do that after every APK update so the two stay in step.
`;
  fs.writeFileSync(path.join(OUT_DIR, "README.txt"), readme);

  // ---- 3. verify ----------------------------------------------------------
  step("verifying the build");
  const files = walk(OUT_DIR);
  const all = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const problems = [];

  // (a) no real key material
  // `*.supabase.co` legitimately appears as a HOSTNAME STRING in link-safety
  // logic (src/lib/share.ts) and in the CSP headers — those never connect
  // anywhere. A real project endpoint looks like `<ref>.supabase.co`, so any
  // bare (non-wildcard) subdomain is what gets rejected here, together with
  // the literal .env values checked below.
  const projectHosts = [
    ...new Set(all.match(/\b[a-z0-9][a-z0-9-]{4,}\.supabase\.co\b/g) ?? []),
  ];
  if (projectHosts.length) problems.push(`a supabase project host is embedded: ${projectHosts[0]}`);
  const keys = all.match(/sb_publishable_[A-Za-z0-9_-]+/g) ?? [];
  const stray = [...new Set(keys)].filter((k) => k !== PLACEHOLDER_KEY);
  if (stray.length) problems.push(`a publishable key other than the placeholder is embedded: ${stray[0]}`);
  const envPath = path.join(root, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^VITE_(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY)=(.+)$/.exec(line.trim());
      const value = m && m[2].trim();
      if (value && value.length > 8 && all.includes(value)) {
        problems.push(`the .env value of ${m[1]} is embedded`);
      }
    }
  }

  // (b) demo seams made it in (proof VITE_DEMO_MODE reached the compile)
  if (!all.includes("vaylo:demo:guest-id")) problems.push("demo guest seam missing — demo mode did not compile in");
  if (!all.includes("demo_free")) problems.push("free-purchase seam missing — demo mode did not compile in");

  // (c) same as the APK: Apple is hidden behind the flag, not absent-by-luck
  if (!/\"iphone\"/.test(all)) problems.push("the iphone flag reads are missing");
  if (/Samsung, Apple/.test(all)) problems.push("unguarded Apple hub copy found (flag not applied)");

  if (problems.length) fail(problems.join("; "));
  console.log(
    `build-clone: verified — ${files.length} files, no API keys, demo seams present, Apple gated`,
  );

  // ---- 4. zip -------------------------------------------------------------
  step("zipping VayloSports-WebApp.zip");
  fs.rmSync(ZIP, { force: true });
  const packed = zipDirectory(OUT_DIR, ZIP);
  console.log(`build-clone: packed ${packed} files with POSIX entry names`);
  const size = fs.statSync(ZIP).size;
  console.log(`build-clone: done — ${path.relative(root, ZIP)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}

main();
