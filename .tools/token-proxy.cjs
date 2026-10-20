#!/usr/bin/env node
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const AD_DIR = path.resolve(ROOT, "vaylo ad web app");
const TOKEN_FILE = path.resolve(AD_DIR, "0.7.html.token");

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:41902");

  if (u.pathname === "/token") {
    try {
      const tok = fs.readFileSync(TOKEN_FILE, "utf8").trim();
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(tok);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("token read error: " + e.message);
    }
    return;
  }

  // Static serve from AD_DIR. Reject path traversal.
  let file = u.pathname === "/" ? "/0.7.html" : u.pathname;
  if (file.includes("..") || file.startsWith("/") === false && !file.startsWith("\\")) {
    // normalize: remove leading slash for resolve
  }
  const fp = path.resolve(AD_DIR, file);
  // safety: ensure resolved path is under AD_DIR
  if (!fp.startsWith(AD_DIR)) {
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

server.listen(41902, () => {
  console.log("token-proxy listening on :41902 (static from " + AD_DIR + ")");
});
