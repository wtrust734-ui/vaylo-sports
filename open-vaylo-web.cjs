#!/usr/bin/env node
// ============================================================================
// Open the Vaylo Sports 1.1 web app in your browser
// ----------------------------------------------------------------------------
// The web build uses absolute /assets/ module scripts, which browsers refuse
// to load from a file:// address. This starts a tiny local server for
// webapp-clone/ (no dependencies) and opens it in your default browser.
// Close the window or press Ctrl+C to stop the server.
// ============================================================================

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");

const ROOT = path.join(__dirname, "webapp-clone");
const PORT = Number(process.env.PORT) || 8086;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  // Unknown routes fall back to index.html so the app's own router handles them.
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const indexPath = path.join(ROOT, "index.html");
    const isAsset = path.extname(urlPath) !== "";
    if (isAsset && !fs.existsSync(path.join(ROOT, urlPath))) {
      res.writeHead(404).end("Not found");
      return;
    }
    filePath = fs.existsSync(path.join(filePath, "index.html"))
      ? path.join(filePath, "index.html")
      : indexPath;
  }
  const type = TYPES[path.extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`Vaylo Sports 1.1 is running at ${url}`);
  console.log("Close this window or press Ctrl+C to stop.");
  const opener =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(opener, () => {});
});
