#!/usr/bin/env node
"use strict";
/**
 * Local server for Vaylo Sports Studio 0.8.
 *
 * Holds the single-user Supabase session server-side and injects a bootstrap
 * copy into the page. The page refreshes in the browser; if that fails it asks
 * this server for a fresh session at /__session, so a stale token can never
 * turn every button into "HTTP 401".
 *
 * The password is never sent to the browser and never written into 0.8.html.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const WEB_APP = path.resolve(process.cwd(), "vaylo ad web app");
const HTML_FILE = path.resolve(WEB_APP, "0.8.html");
const SESSION_FILE = path.resolve(WEB_APP, ".freebuff", "session.json");
const CREDS_FILE = path.resolve(WEB_APP, ".freebuff", ".studio-login.json");

const SB_URL = "https://vvwhausdjzdmsyxekrcl.supabase.co";
const SB_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2d2hhdXNkanpkbXN5eGVrcmNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4NzUzMjcsImV4cCI6MjEwNTQ1MTMyN30.qZHdYwyP9WsQPclJmqMTAUb2gYlz2OUdBCWagWILS9M";

const PORT = Number(process.env.VAYLO_PORT || process.env.PORT) || 41904;
const REFRESH_SKEW = 120; // seconds

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
};
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
};
const jwtExp = (t) => {
  try {
    const p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(p, "base64").toString()).exp || 0;
  } catch (e) { return 0; }
};

let inflight = null;

async function authPost(pathname, body) {
  const r = await fetch(SB_URL + pathname, {
    method: "POST",
    headers: { apikey: SB_ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* ignore */ }
  return { ok: r.ok, status: r.status, json, text };
}

function toSession(j) {
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || jwtExp(j.access_token),
    expires_in: j.expires_in,
    token_type: j.token_type || "bearer",
    user: j.user ? { id: j.user.id, email: j.user.email } : undefined,
  };
}

async function passwordLogin() {
  const c = readJson(CREDS_FILE);
  if (!c || !c.password) throw new Error("missing .freebuff/.studio-login.json");
  const r = await authPost("/auth/v1/token?grant_type=password", { email: c.email, password: c.password });
  if (!r.json || !r.json.access_token) throw new Error("login failed " + r.status + " " + (r.text || "").slice(0, 160));
  return toSession(r.json);
}

async function serverSession(force) {
  if (inflight) return inflight;
  inflight = (async () => {
    let s = readJson(SESSION_FILE);
    const now = Math.floor(Date.now() / 1000);
    if (!force && s && s.access_token && jwtExp(s.access_token) - REFRESH_SKEW > now) return s;

    if (s && s.refresh_token) {
      const r = await authPost("/auth/v1/token?grant_type=refresh_token", { refresh_token: s.refresh_token });
      if (r.json && r.json.access_token) {
        s = toSession(r.json);
        writeJson(SESSION_FILE, s);
        return s;
      }
    }
    s = await passwordLogin();
    writeJson(SESSION_FILE, s);
    return s;
  })();
  try { return await inflight; } finally { inflight = null; }
}

function inject(html, session) {
  const boot = "<script>window.__VAYLO_SESSION__ = " + JSON.stringify(session).replace(/</g, "\\u003c") + ";</script>\n";
  if (html.includes("<!--VAYLO_BOOTSTRAP-->")) return html.replace("<!--VAYLO_BOOTSTRAP-->", boot);
  return html.replace("</head>", boot + "</head>");
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost:" + PORT);

  if (u.pathname === "/__health") {
    const s = readJson(SESSION_FILE);
    return json(res, 200, {
      ok: !!(s && s.access_token),
      email: s && s.user && s.user.email,
      expires_at: s && s.expires_at,
      expires_in: s ? s.expires_at - Math.floor(Date.now() / 1000) : null,
      html: fs.existsSync(HTML_FILE),
    });
  }

  if (u.pathname === "/__session") {
    try {
      const s = await serverSession(true);
      return json(res, 200, s);
    } catch (e) {
      return json(res, 503, { error: e.message });
    }
  }

  if (u.pathname === "/" || u.pathname === "/0.8.html") {
    let html;
    try { html = fs.readFileSync(HTML_FILE, "utf8"); }
    catch (e) { res.writeHead(500, { "Content-Type": "text/plain" }); return res.end("0.8.html missing"); }
    let session = null;
    try { session = await serverSession(false); } catch (e) { console.error("session unavailable:", e.message); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(session ? inject(html, session) : html);
  }

  const file = u.pathname.startsWith("/") ? u.pathname.slice(1) : u.pathname;
  const fp = path.resolve(WEB_APP, file);
  if (!fp.startsWith(WEB_APP + path.sep) && fp !== WEB_APP) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("forbidden");
  }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found: " + file); return; }
    const ext = path.extname(fp).toLowerCase();
    const ct = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml", ".ico": "image/x-icon",
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": ct });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log("serve-08 listening on :" + PORT);
  console.log("  html:", HTML_FILE, "present:", fs.existsSync(HTML_FILE));
  console.log("  session:", SESSION_FILE, "present:", fs.existsSync(SESSION_FILE));
  console.log("  creds:", CREDS_FILE, "present:", fs.existsSync(CREDS_FILE));
});
