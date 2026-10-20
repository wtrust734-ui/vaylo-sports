#!/usr/bin/env node
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const AD_DIR = path.resolve(process.cwd(), "vaylo ad web app");
const HTML_FILE = path.resolve(AD_DIR, "0.7.html");
const TOKEN_FILE = path.resolve(AD_DIR, "0.7.html.token");

const PLACEHOLDER = "const REAL_ACCESS_TOKEN = \"REFRESH_NEEDED\";";

let html = "";
let token = "";
let ready = false;

function load() {
  try {
    html = fs.readFileSync(HTML_FILE, "utf8");
  } catch (e) {
    html = "<!doctype html><html><head><title>serve-07: missing 0.7.html</title></head><body>missing 0.7.html</body>";
  }
  try {
    token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch (e) {
    token = "";
  }
  // Inject the real token in place of the placeholder, in memory only.
  if (token && html.includes(PLACEHOLDER)) {
    html = html.split(PLACEHOLDER).join('const REAL_ACCESS_TOKEN = "' + token + '";');
  }
  ready = true;
}
load();

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:41903");
  // Reload token on each request so a refreshed token file is picked up.
  if (!ready) load();
  if (u.pathname === "/" || u.pathname === "/0.7.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  // Serve other files from vaylo ad web app/ (css/js/assets) if present.
  const file = u.pathname.startsWith("/") ? u.pathname.slice(1) : u.pathname;
  const fp = path.resolve(AD_DIR, file);
  if (!fp.startsWith(AD_DIR + path.sep) && fp !== AD_DIR) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("forbidden");
    return;
  }
  fs.readFile(fp, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found: " + file);
      return;
    }
    const ext = path.extname(fp).toLowerCase();
    const ct = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    } [ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": ct });
    res.end(buf);
  });
});

server.listen(41903, () => {
  console.log("serve-07 listening on :41903 (0.7.html with token injected in memory)");
  console.log("  html placeholder present:", html.includes(PLACEHOLDER) ? "yes (not injected)" : "no (injected)");
  console.log("  token file present:", token ? "yes" : "no");
});
