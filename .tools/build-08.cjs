#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const WEB_APP = path.resolve(ROOT, "vaylo ad web app");
const SRC = path.resolve(WEB_APP, "0.7.html");
const OUT_08 = path.resolve(WEB_APP, "0.8.html");
const OUT_SERVE = path.resolve(ROOT, ".tools", "serve-08.cjs");

// Read the source 0.7.html (pristine).
const src = fs.readFileSync(SRC, "utf8");

// --- VERSION UPDATE: 0.7 -> 0.8 ---
let out = src
  .replace(/<title>Vaylo Sports Brain — Live Studio 0\.7<\/title>/g,
          "<title>Vaylo Sports Brain — Live Studio 0.8</title>")
  .replace(/Vaylo Sports Studio 0\.7 — real backend/g,
          "Vaylo Sports Studio 0.8 — real backend · live for you")
  .replace(/\bStudio 0\.7\b/g, "Studio 0.8")
  .replace(/\bLive Studio 0\.7\b/g, "Live Studio 0.8");

// NOTE: do NOT touch the REAL_ACCESS_TOKEN placeholder line itself.
// The placeholder is "const REAL_ACCESS_TOKEN = \"REFRESH_NEEDED\";"
// and it gets injected by serve-08 from the token file at serve time.

// --- PERSONALIZATION: for YOU (preview-bot@vaylo-preview.local / sub 82b96b82-...) ---
// SESSION_STUB email: you@VayloSports.app -> your real email
out = out.replace(/"you@VayloSports\.app"/g, '"preview-bot@vaylo-preview.local"');
// the 'you' label in the core
out = out.replace(
  /<span class="rd" id="core-sub">you<\/span>/g,
  '<span class="rd" id="core-sub">preview-bot@vaylo-preview.local</span>'
);

// --- TOKEN PLACEHOLDER WORDING: update for 0.8 ---
// The multi-line token instruction block.
out = out
  .replace(
    /To make the 0\.7 preview call Supabase as you, refresh the session once and paste/g,
    "To make the 0.8 preview call Supabase as you, refresh the session once and paste"
  )
  .replace(
    /    vaylo ad web app\/0\.7\.html\.token/g,
    "    vaylo ad web app/0.8.html.token"
  )
  .replace(
    /Then copy that value into the REAL_ACCESS_TOKEN string above, save 0\.7\.html, and/g,
    "Then copy that value into the REAL_ACCESS_TOKEN string above, save 0.8.html, and"
  )
  .replace(
    /\/\* refresh: run `node \.freebuff\\.refresh-07-token\.cjs` from the project root, then paste 0\.7\.html\.token into the quotes above and reload the preview \*\//,
    "/* refresh: run `node .freebuff/.refresh-08-token.cjs` from the project root (or paste a fresh access_token into 0.8.html.token), then reload the preview */"
  );

// --- FIX DEAD INSTRUCTIONS: 0.7 -> 0.8 in any remaining instruction text ---
out = out.replace(/0\.7\.html\.token/g, "0.8.html.token");
// Do NOT blanket-replace "0.7.html" everywhere (some may be legitimate historical references),
// but the token file path references should all be 0.8 now.

// --- SAVE 0.8.html to the CORRECT FOLDER (vaylo ad web app/) ---
fs.writeFileSync(OUT_08, out, "utf8");
console.log("Wrote 0.8.html -> " + OUT_08);
console.log("  size:", out.length, "bytes");
console.log("  source 0.7.html unchanged -> " + SRC);

// --- WRITE serve-08.cjs (serves 0.8.html with token injected IN MEMORY) ---
const serveCJS = `#!/usr/bin/env node
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const WEB_APP = path.resolve(process.cwd(), "vaylo ad web app");
const HTML_FILE = path.resolve(WEB_APP, "0.8.html");
const TOKEN_FILE = path.resolve(WEB_APP, "0.8.html.token");

const PLACEHOLDER = "const REAL_ACCESS_TOKEN = \\"REFRESH_NEEDED\\";";

let html = "";
let token = "";
let ready = false;

function load() {
  try { html = fs.readFileSync(HTML_FILE, "utf8"); }
  catch (e) { html = "<!doctype html><html><head><title>serve-08: missing 0.8.html</title></head><body>missing 0.8.html</body>"; }
  try { token = fs.readFileSync(TOKEN_FILE, "utf8").trim(); }
  catch (e) { token = ""; }
  if (token && html.indexOf(PLACEHOLDER) !== -1) {
    html = html.split(PLACEHOLDER).join('const REAL_ACCESS_TOKEN = "' + token + '";');
  }
  ready = true;
}
load();

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:41904");
  if (!ready) load();
  if (u.pathname === "/" || u.pathname === "/0.8.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  const file = u.pathname.startsWith("/") ? u.pathname.slice(1) : u.pathname;
  const fp = path.resolve(WEB_APP, file);
  if (!fp.startsWith(WEB_APP + path.sep) && fp !== WEB_APP) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("forbidden");
    return;
  }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found: " + file); return; }
    const ext = path.extname(fp).toLowerCase();
    const ct = {
      ".html":"text/html; charset=utf-8",
      ".css":"text/css; charset=utf-8",
      ".js":"application/javascript; charset=utf-8",
      ".json":"application/json; charset=utf-8",
      ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
      ".svg":"image/svg+xml",".ico":"image/x-icon"
    } [ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": ct });
    res.end(buf);
  });
});
server.listen(41904, () => {
  console.log("serve-08 listening on :41904 (0.8.html with token injected in memory)");
  console.log("  html:", HTML_FILE, "present:", fs.existsSync(HTML_FILE));
  console.log("  token:", TOKEN_FILE, "present:", fs.existsSync(TOKEN_FILE));
});
`;

fs.writeFileSync(OUT_SERVE, serveCJS, "utf8");
console.log("Wrote serve-08.cjs -> " + OUT_SERVE);
console.log("  size:", serveCJS.length, "bytes");
console.log("DONE.");
