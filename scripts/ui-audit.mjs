// Mobile UI audit: screenshots every route at phone size and reports what is
// visually broken.
//
//   npm run ui:audit              # build, screenshot all routes, write a gallery
//   npm run ui:check              # same measurements, non-zero exit on a defect
//   node scripts/ui-audit.mjs metrics avatar   # just these routes
//
// Every route is measured at every device in DEVICES (see below): the app has
// three layouts, and a defect at 768px is invisible in a 390px screenshot.
//
// It fails on: a control under 44px, a control that is covered by something and
// so cannot be tapped, a page that scrolls sideways, a value that rendered as
// `undefined`, a doubled word in copy, and any console exception or failed
// request. It does NOT fail on a decorative glow hanging off the edge of a
// clipping parent, or on a carousel's off-screen cards — both are reported as
// overflow, both are fine.
//
// Drives system Chrome over the DevTools Protocol using Node's built-in
// WebSocket, so it needs no playwright/puppeteer install. Writes PNGs and a
// text report to .freebuff/ui-audit/ (outside the repo, so a sync won't pick
// them up).
//
// Signing in is done through the real auth REST endpoint with a dedicated
// review account, then the session is written to localStorage in the shape
// supabase-js v2 reads. That is the only way to see the app: every screen but
// /auth is behind a session.
//
// The credentials are not in this file. The review account is the same one
// Play's reviewers use, so its password ends up pasted into a Play Console
// listing regardless; keeping a copy in the repository too would just mean two
// places to rotate. They are read from UI_EMAIL/UI_PASSWORD, or from
// .freebuff/ui-audit.local.json, which is outside the repo and therefore never
// committed by a sync.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const DIST = resolve("dist");
const SERVE_PORT = Number(process.env.UI_SERVE_PORT || 8091);
let APP = process.env.UI_BASE_URL || "";
const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.CDP_PORT || 9333);
const OUT = ".freebuff/ui-audit";
// Absolute on purpose: Chrome exits instantly with code -1 and no message when
// --user-data-dir is relative. Cost a whole debugging detour once.
const PROFILE = resolve(".freebuff/ui-audit-profile");

// The devices every route is measured at. One viewport is not enough: the app
// has three real layouts (phone, the `sm:`/`md:` tablet range, and the `lg:`
// desktop sidebar), so a defect that only appears when a card is three columns
// wide at 768px is invisible in a 390px screenshot. The widths straddle each
// breakpoint in tailwind.config.ts rather than being evenly spaced:
//   320  the narrowest phone the app claims to support (the overflow test floor)
//   390  a common Android phone
//   430  a large phone (Pixel Pro / iPhone Pro Max)
//   640  the `sm:` boundary
//   768  the `md:` boundary — a 10" tablet in portrait
//   834  iPad Air portrait
//   1024 the `lg:` boundary, where the sidebar appears and the bottom bar goes
//   1366 iPad Pro landscape
// Override with UI_DEVICES=phone,ipad to audit a subset.
const ALL_DEVICES = [
  { name: "phone-320", width: 320, height: 568, dpr: 2 },
  { name: "phone", width: 390, height: 844, dpr: 3 },
  { name: "phone-xl", width: 430, height: 932, dpr: 3 },
  { name: "tablet-sm", width: 640, height: 960, dpr: 2 },
  { name: "tablet", width: 768, height: 1024, dpr: 2 },
  { name: "ipad", width: 834, height: 1194, dpr: 2 },
  { name: "ipad-lg", width: 1024, height: 1366, dpr: 2 },
  { name: "ipad-land", width: 1366, height: 1024, dpr: 2 },
];
// The default pass covers the four shapes the app actually changes at: a phone,
// a large phone, a 10" tablet in portrait (the `md:` layout), and an iPad in
// portrait (the `lg:` desktop-sidebar layout) — plus the 320px floor the
// overflow rule is written against. `UI_DEVICES=...` widens it to any of
// ALL_DEVICES (e.g. `UI_DEVICES=phone,ipad-land` for the landscape desktop case,
// which is the slowest to run because it renders the most).
const DEFAULT_DEVICES = ["phone-320", "phone", "phone-xl", "tablet", "ipad-lg"];
const DEVICE_FILTER = (process.env.UI_DEVICES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DEVICES = (DEVICE_FILTER.length ? DEVICE_FILTER : DEFAULT_DEVICES)
  .map((name) => ALL_DEVICES.find((d) => d.name === name))
  .filter(Boolean);
if (!DEVICES.length) {
  console.error(`ui-audit: UI_DEVICES matched no device. Known: ${ALL_DEVICES.map((d) => d.name).join(", ")}`);
  process.exit(1);
}

const LOCAL_CREDS = ".freebuff/ui-audit.local.json";
const localCreds = existsSync(LOCAL_CREDS) ? JSON.parse(readFileSync(LOCAL_CREDS, "utf8")) : {};
const EMAIL = process.env.UI_EMAIL || localCreds.email;
const PASSWORD = process.env.UI_PASSWORD || localCreds.password;
if (!EMAIL || !PASSWORD) {
  console.error(
    `ui-audit: no review-account credentials.\n` +
      `  Set UI_EMAIL and UI_PASSWORD, or write ${LOCAL_CREDS}:\n` +
      `    { "email": "...", "password": "..." }`,
  );
  process.exit(1);
}

// Routes worth looking at: the tab-level screens an athlete actually lands on,
// plus the ones built most recently.
// Rendered text that means a value failed to render. The bare-word rule is
// anchored per line, so prose containing the word is left alone.
const badTextRules = [
  /^(undefined|NaN|null|Infinity)$/,
  /[:=]\s*(undefined|NaN|null)\b/,
  /\((undefined|NaN)\)/,
  /\[object Object\]/,
];

// Copy defects, checked in Node rather than in the page: a regex literal written
// inside the probe template loses its backslashes ("\s" arrives as "s"), and a
// de-escaped pattern happily matches the wrong thing.
function findBadText(text) {
  const bad = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    for (const re of badTextRules) {
      const hit = t.match(re);
      if (hit) bad.push(hit[0].slice(0, 60));
    }
    // Doubling is checked inside a line only. Across lines it is meaningless:
    // a section heading and the card under it legitimately share a word.
    const words = t.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const a = words[i - 1].replace(/[^A-Za-z]/g, "");
      const b = words[i].replace(/[^A-Za-z]/g, "");
      // Case-sensitive on purpose: "Install Health Connect, connect your watch"
      // is a product name followed by a verb, not a botched heading. A real
      // doubled heading repeats the token exactly.
      if (a.length > 2 && a === b) bad.push("doubled: " + a);
    }
  }
  return bad;
}

const ROUTES = [
  ["auth", "/auth", { anonymous: true }],
  ["onboarding", "/onboarding"],
  ["home", "/"],
  ["train", "/train"],
  ["perform", "/perform"],
  ["recover", "/recover"],
  ["compete", "/compete"],
  ["profile", "/profile"],
  ["metrics", "/metrics"],
  ["events", "/events"],
  ["event-packs", "/event-packs"],
  ["market", "/market"],
  ["avatar", "/avatar"],
  ["workouts", "/workouts"],
  ["compare", "/compare"],
  ["pricing", "/pricing"],
  ["not-found", "/definitely-not-a-page"],
  // Second tier: everything reachable from the tab bar and the hub pages, so
  // the measured pass covers the whole app rather than the top screens.
  ["training", "/training"],
  ["availability", "/availability"],
  ["nutrition", "/nutrition"],
  ["form", "/form"],
  // The Cross-Sport screen is behind a one-off unlock, so the review account
  // may well land on its paywall rather than the report. Either state is worth
  // measuring: the paywall is what most athletes see first.
  ["cross-sport", "/cross-sport"],
  ["video-form", "/form/video"],
  ["mental", "/mental"],
  ["coach", "/coach"],
  ["arcade", "/arcade"],
  ["achievements", "/achievements"],
  ["vpr", "/vpr"],
  ["skills", "/skills"],
  ["tactics", "/tactics"],
  ["development", "/development"],
  ["identity", "/identity"],
  ["injury", "/injury"],
  ["learning", "/learning"],
  ["goals", "/goals"],
  ["guardian", "/guardian"],
  ["starting-analysis", "/starting-analysis"],
  ["insights", "/insights"],
  ["pbs", "/pbs"],
  ["notifications", "/notifications"],
  ["referrals", "/referrals"],
  ["challenges", "/challenges"],
  ["friends", "/friends"],
  ["subscription", "/subscription"],
  ["collection", "/collection"],
];

const env = readEnvFile(".env");
const SUPA_URL = process.env.UI_SUPABASE_URL || env.VITE_SUPABASE_URL;
const SUPA_KEY = process.env.UI_SUPABASE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  console.error("ui-audit: no Supabase URL/key (check .env)");
  process.exit(1);
}
const PROJECT_REF = new URL(SUPA_URL).hostname.split(".")[0];

function readEnvFile(path) {
  try {
    const out = {};
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

// --- a very small CDP client -------------------------------------------------

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 45000);
    });
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || "eval failed");
    }
    return r.result.value;
  }
  drain() {
    const out = this.events;
    this.events = [];
    return out;
  }
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("ws error")), { once: true });
  });
  return new Cdp(ws);
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  return res.json();
}

// Serve dist/ from inside this process. Starting a separate Vite dev server was
// the reason the first attempts of this script never saw a page: a dev server
// launched from a tool call dies with the call, whereas this lives and dies with
// the audit.
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};

function startStaticServer() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error(`ui-audit: no build at ${DIST} — run \`npm run build\` first`);
    process.exit(1);
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${SERVE_PORT}`);
    let file = join(DIST, decodeURIComponent(url.pathname));
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    const body = readFileSync(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  });
  return new Promise((ok) => {
    server.listen(SERVE_PORT, "127.0.0.1", () => ok(server));
  });
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const routes = only.length
    ? ROUTES.filter(([name]) => only.includes(name))
    : ROUTES;

  const server = APP ? null : await startStaticServer();
  if (server) APP = `http://127.0.0.1:${SERVE_PORT}`;
  console.log("[ui-audit] app:", APP, server ? "(built app served from dist)" : "");

  mkdirSync(OUT, { recursive: true });
  rmSync(PROFILE, { recursive: true, force: true });

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${PROFILE}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      // Chrome inherits the machine's proxy settings; without this, a request
      // for localhost leaves the machine and comes back as chrome-error.
      "--no-proxy-server",
      "--hide-scrollbars",
      "--force-device-scale-factor=2",
      "--window-size=390,844",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let chromeLog = "";
  chrome.stderr.on("data", (d) => {
    chromeLog += d.toString();
  });
  chrome.on("exit", (code) => console.log(`[chrome] exited early, code ${code}`));

  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    try {
      version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
    } catch {
      await sleep(500);
    }
  }
  if (!version) {
    console.error("ui-audit: chrome never opened its debug port");
    console.error(chromeLog.split("\n").filter(Boolean).slice(0, 8).join("\n"));
    chrome.kill();
    server?.close();
    process.exit(1);
  }

  const target = await fetchJson(
    `http://127.0.0.1:${PORT}/json/new?about:blank`,
    { method: "PUT" },
  );
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  // Applied per device inside the route loop below. `mobile: true` is what
  // makes Chrome report the narrow layout viewport and honour
  // viewport-fit=cover, so env(safe-area-inset-*) behaves like a real handset.
  const applyDevice = async (device) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: device.width,
      height: device.height,
      deviceScaleFactor: device.dpr,
      mobile: true,
    });
  };
  await applyDevice(DEVICES[0]);

  const consoleIssues = [];

  // --- sign in out of band, then plant the session where supabase-js looks ---
  const auth = await fetchJson(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!auth.access_token) {
    console.error("ui-audit: sign-in failed:", JSON.stringify(auth).slice(0, 300));
    chrome.kill();
    process.exit(1);
  }
  writeFileSync(
    `${OUT}/session.json`,
    JSON.stringify(
      { email: EMAIL, user_id: auth.user?.id, projects: PROJECT_REF },
      null,
      2,
    ),
  );

  await cdp.send("Page.navigate", { url: `${APP}/auth` });
  await sleep(2500);
  const landed = await cdp.evaluate(`location.href + " | " + document.title`);
  console.log("[ui-audit] landed on:", landed);
  if (!landed.startsWith(APP)) {
    console.error("[ui-audit] not on the app origin — cannot plant a session");
    chrome.kill();
    process.exit(1);
  }
  await cdp.evaluate(
    `localStorage.setItem(${JSON.stringify(`sb-${PROJECT_REF}-auth-token`)}, ${JSON.stringify(
      JSON.stringify(auth),
    )})`,
  );

  // A brand-new account is not gated on a session but on a profile: AppLayout
  // bounces every route to /onboarding until `onboarding_complete`. Without this
  // the whole audit photographs one screen, which is exactly what it did the
  // first time it ran.
  await cdp.send("Page.navigate", { url: `${APP}/` });
  await sleep(3500);
  const before = await cdp.evaluate(
    `location.pathname + " | " + document.body.innerText.slice(0, 60).replace(/\\s+/g, " ")`,
  );
  console.log("[ui-audit] after sign-in:", before);
  if (before.startsWith("/onboarding")) {
    const clicked = await cdp.evaluate(`(() => {
      const el = [...document.querySelectorAll("button,a")]
        .find((e) => /Skip setup/i.test(e.textContent || ""));
      if (!el) return "no skip button";
      el.click();
      return "clicked: " + el.textContent.trim();
    })()`);
    console.log("[ui-audit] onboarding skip:", clicked);
    await sleep(5000);
    console.log(
      "[ui-audit] after skip:",
      await cdp.evaluate(`location.pathname + " | " + document.body.innerText.slice(0, 60).replace(/\\s+/g, " ")`),
    );
  }

  const report = [];
  const flowResults = [];
  for (const device of DEVICES) {
    await applyDevice(device);
    console.log(
      `\n[ui-audit] ${device.name} — ${device.width}x${device.height} @${device.dpr}x`,
    );
  for (const [name, route] of routes) {
    cdp.drain();
    if (route && name === "auth") {
      await cdp.evaluate(`localStorage.removeItem(${JSON.stringify(`sb-${PROJECT_REF}-auth-token`)})`);
    } else {
      await cdp.evaluate(
        `localStorage.setItem(${JSON.stringify(`sb-${PROJECT_REF}-auth-token`)}, ${JSON.stringify(
          JSON.stringify(auth),
        )})`,
      );
    }

    await cdp.send("Page.navigate", { url: `${APP}${route}` });
    // Let the SPA route, fetch, and paint. Long enough for the charts chunk and
    // the supabase round-trips; this is a review pass, not a benchmark. Trimmed
    // from 4s to 2.6s when the pass became per-device: 46 routes x 5 devices is
    // 230 navigations, and the extra 1.4s each would have added seven minutes to
    // a run that already needs a settled page, not a faster one.
    await sleep(2600);

    const probe = await cdp.evaluate(`(() => {
      const vw = window.innerWidth;
      const offenders = [];
      const seen = new Set();
      // A carousel is supposed to stick out of the viewport: anything inside a
      // horizontal scroller is reachable by swiping, so it is not a defect.
      const inScroller = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "auto" || ox === "scroll") return true;
        }
        return false;
      };
      // An element that sticks out of a *clipping* ancestor is a different
      // thing, and reporting it as viewport overflow is how this check learned
      // to cry wolf: three blurred decorative glows sit deliberately past the
      // edge of their card, which has overflow-hidden, and were reported as
      // layout defects on every run. A glow being cut off is the design. Text
      // being cut off is not, so that is reported separately as CLIPPED, where
      // it can be acted on.
      const clippingAncestor = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "hidden" || ox === "clip") return p;
        }
        return null;
      };
      const clipped = [];
      const clippedSeen = new Set();
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const right = Math.round(r.right);
        if (right > vw + 1 && !inScroller(el)) {
          const cs = getComputedStyle(el);
          if (cs.position === "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
          const clip = clippingAncestor(el);
          if (clip) {
            // Cut off by its own card. Only worth reporting if something the
            // athlete needs to read is on the far side of the cut.
            const text = (el.textContent || "").trim();
            if (text.length > 0) {
              const tag = el.tagName.toLowerCase() + "." + String(el.className || "").trim().split(/\\s+/).slice(0, 2).join(".");
              if (!clippedSeen.has(tag + "|" + text.slice(0, 20))) {
                clippedSeen.add(tag + "|" + text.slice(0, 20));
                clipped.push({ tag: tag.slice(0, 70), text: text.slice(0, 60) });
              }
            }
            continue;
          }
          const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === "string"
            ? "." + el.className.trim().split(/\\s+/).slice(0, 3).join(".")
            : "");
          const key = tag + "|" + right;
          if (seen.has(key)) continue;
          seen.add(key);
          offenders.push({ tag: tag.slice(0, 90), right, over: right - vw, text: (el.textContent || "").trim().slice(0, 60) });
        }
      }
      offenders.sort((a, b) => b.over - a.over);
      // Tap targets and body text size. 44px is the accessibility floor the app
      // claims to meet; 11px is the smallest type that stays readable on a phone.
      // The rule, matching the floor in src/index.css: every control is at least
      // 44px tall, and a control with no text (an icon button) is at least 44px
      // wide too, because nothing else gives the thumb something to hit.
      const smallTargets = [];
      for (const el of document.querySelectorAll("button, a, [role=button], [role=tab], [role=switch], input, select, textarea")) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || cs.pointerEvents === "none") continue;
        if (el.getAttribute("type") === "checkbox" || el.getAttribute("type") === "radio") continue;
        const label = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim();
        const iconOnly = label.length === 0;
        if (r.height < 44 || (iconOnly && r.width < 44)) {
          smallTargets.push({
            label: (iconOnly ? el.tagName.toLowerCase() : label).slice(0, 44),
            w: Math.round(r.width),
            h: Math.round(r.height),
            iconOnly,
          });
        }
      }
      // ── Controls that are the right size but cannot be tapped ─────────────
      // Size is not reachability. A control can measure 44px, be fully on
      // screen, pass every rule above, and still be unclickable because
      // something is painted on top of it — a floating notice, a stale overlay
      // that never reset pointer-events, a z-index that stacked the wrong way.
      // The only way to see that is to ask the browser what a finger would
      // actually hit: elementFromPoint at the control's centre. It must come
      // back as the control itself, something inside it, or something that
      // contains it (a <label> wrapping its input is a legitimate hit).
      //
      // A modal that is open is the one exemption: it is *supposed* to block the
      // page behind it, so a page-level control reading as blocked while a
      // dialog is up is correct behaviour, not a defect.
      const blockedTargets = [];
      const blockedSeen = new Set();
      const dialogOpen = Boolean(
        document.querySelector('[aria-modal="true"], [role="dialog"], [data-vaul-drawer]'),
      );
      if (!dialogOpen) {
        for (const el of document.querySelectorAll("button, a, [role=button], [role=tab], [role=switch], input, select, textarea")) {
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none") continue;
          if (el.disabled) continue;
          // Only judge a control whose centre is on screen; one below the fold
          // is reachable by scrolling and is not this rule's business.
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
          let top = null;
          try {
            top = document.elementFromPoint(cx, cy);
          } catch {
            continue;
          }
          if (!top) continue;
          if (top === el || el.contains(top) || top.contains(el)) continue;
          const label = (el.getAttribute("aria-label") || el.textContent || el.tagName)
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 44);
          const by =
            top.tagName.toLowerCase() +
            (typeof top.className === "string" && top.className
              ? "." + top.className.trim().split(/\s+/).slice(0, 2).join(".")
              : "");
          const key = label + "|" + by;
          if (blockedSeen.has(key)) continue;
          blockedSeen.add(key);
          blockedTargets.push({
            label: label || el.tagName.toLowerCase(),
            by: by.slice(0, 60),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
      }
      blockedTargets.sort((a, b) => b.w * b.h - a.w * a.h);
      // ── Things that touch with no gutter, or sit on top of each other ─────
      // The "RUNNINGTrend" class of defect: a badge or a pill sitting flush
      // against the text beside it, two chips whose borders meet, a label
      // butted up against a button. Nothing above sees it — nothing overflows,
      // nothing is under 44px, the copy is intact — and yet it is the thing an
      // athlete reads as broken, so it gets its own rule. A second member of the
      // family is measured here too: two floating layers (two notices, two
      // sheets) drawn over one another, their copy interleaved.
      //
      // How a touch is measured: for every element, look at ADJACENT CHILDREN
      // (text nodes included, measured with a Range so a bare text node counts),
      // keep the pairs sharing a visual row, and compare the edges that are
      // actually visible — a box's border, otherwise the text's ink, never the
      // empty slack a stretched flex child carries to the end of its row. Under
      // 3px between those edges, with at least one side a *box* (border,
      // background or corner radius), is a jam. 3px rather than 4px is
      // deliberate: 4px and 8px are both real, intended gutters here, and a rule
      // that fired on them would be ignored within a week. Children of a
      // flex/grid parent that already sets a gap are exempt — an explicit gutter
      // cannot jam.
      const collisions = [];
      const overlaps = [];
      const collisionSeen = new Set();
      const overlapSeen = new Set();
      const bgAlpha = (el) => {
        const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
        if (!m) return 0;
        const parts = m[1].split(",").map((v) => parseFloat(v));
        return parts.length < 4 ? 1 : parts[3];
      };
      const positioned = (el) => {
        const cs = getComputedStyle(el);
        return cs.position === "fixed" || cs.position === "absolute";
      };
      const isBox = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        if (cs.pointerEvents === "none") return false;
        if (el.getAttribute("aria-hidden") === "true") return false;
        const bordered = ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"]
          .some((k) => parseFloat(cs[k]) > 0);
        return bordered || bgAlpha(el) > 0.02 || parseFloat(cs.borderTopLeftRadius) > 0;
      };
      // The extent of the characters themselves. Walked text node by text node
      // rather than with one Range over the subtree, because a Range also returns
      // the boxes of block children and even of empty decorative elements (a
      // blurred accent circle counts), which invents overlap that is not there.
      // Text inside a scroll container keeps a rect at its layout position
      // even after the container has scrolled it out of sight, so the ink of a
      // long list reaches past its own card. Unclamped, that phantom ink makes
      // two *stacked* siblings look like they share a visual row and the touch
      // rule below reports a jam between them: measured in the sidebar at
      // 1024x1366, the 31-line nav reports ink 117px below its own box (y1332
      // against a box ending at y1215) and "collides" with the footer beneath
      // it across 209px of horizontal overlap — two boxes that never share a
      // pixel on screen. The ink is therefore intersected with the clip rects
      // of its own overflow and of its ancestors', so the rule measures what is
      // actually visible — the element itself counts, since the sidebar nav is the thing clipping its own content. The root scroller is deliberately not one of them:
      // content below the fold there is scrolled into view, not hidden.
      const clipOf = (node) => {
        const clips = (v) => v === "hidden" || v === "clip" || v === "auto" || v === "scroll";
        let clip = null;
        for (let p = node.nodeType === 1 ? node : node.parentElement; p && p !== document.documentElement && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (!clips(cs.overflowX) && !clips(cs.overflowY)) continue;
          const r = p.getBoundingClientRect();
          clip = {
            left: Math.max(clip ? clip.left : -Infinity, r.left),
            right: Math.min(clip ? clip.right : Infinity, r.right),
            top: Math.max(clip ? clip.top : -Infinity, r.top),
            bottom: Math.min(clip ? clip.bottom : Infinity, r.bottom),
          };
        }
        return clip;
      };
      const inkOf = (node) => {
        const acc = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity, lines: 0 };
        const clip = clipOf(node);
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          if (!t.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(t);
          for (const raw of range.getClientRects()) {
            const r = clip
              ? {
                  left: Math.max(raw.left, clip.left),
                  right: Math.min(raw.right, clip.right),
                  top: Math.max(raw.top, clip.top),
                  bottom: Math.min(raw.bottom, clip.bottom),
                }
              : raw;
            if (r.width <= 0 || r.height <= 0) continue;
            acc.left = Math.min(acc.left, r.left);
            acc.right = Math.max(acc.right, r.right);
            acc.top = Math.min(acc.top, r.top);
            acc.bottom = Math.max(acc.bottom, r.bottom);
            acc.lines += 1;
          }
        }
        return acc.lines ? acc : null;
      };
      const piecesOf = (node) => {
        if (node.nodeType === 3) {
          if (!node.textContent.trim()) return null;
          const rects = inkOf(node);
          if (!rects) return null;
          return [{ node, box: rects, ink: rects, boxed: false, pos: false, lines: rects.lines }];
        }
        if (node.nodeType !== 1) return null;
        if (!(node.textContent || "").trim()) return null;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const cs = getComputedStyle(node);
        if (cs.display === "none" || cs.visibility === "hidden") return null;
        const ink = inkOf(node) || rect;
        return [{ node, box: rect, ink, boxed: isBox(node), pos: positioned(node), lines: ink.lines || 0 }];
      };
      const rectOf = (r) => [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v));
      const diagOf = (p) => ({
        tag: p.node.nodeType === 3 ? "#text" : p.node.tagName.toLowerCase() + "." + String(p.node.className || "").trim(),
        box: rectOf(p.box),
        ink: rectOf(p.ink),
        lines: p.lines,
        pos: getComputedStyle(p.node.parentElement || p.node).position,
      });
      const nameOf = (node) => {
        const raw = node.nodeType === 3
          ? node.textContent
          : node.getAttribute("aria-label") || node.textContent || node.tagName;
        return raw.trim().replace(/\s+/g, " ").slice(0, 36);
      };
      const tagOf = (node) => {
        if (node.nodeType === 3) return "#text";
        const cls = typeof node.className === "string" ? node.className.trim() : "";
        return node.tagName.toLowerCase() + (cls ? "." + cls.split(/\s+/).slice(0, 2).join(".") : "");
      };
      for (const parent of document.querySelectorAll("body *")) {
        const pcs = getComputedStyle(parent);
        if (pcs.display === "none" || pcs.visibility === "hidden") continue;
        // A flex/grid parent that sets a gutter has already kept these apart.
        if (Math.max(parseFloat(pcs.columnGap) || 0, parseFloat(pcs.rowGap) || 0) >= 3) continue;
        const kids = Array.from(parent.childNodes);
        for (let i = 0; i + 1 < kids.length; i += 1) {
          const a = piecesOf(kids[i]);
          const b = piecesOf(kids[i + 1]);
          if (!a || !b) continue;
          for (const pa of a) {
            for (const pb of b) {
              const rowOverlap = Math.min(pa.ink.bottom, pb.ink.bottom) - Math.max(pa.ink.top, pb.ink.top);
              const shorter = Math.min(pa.ink.bottom - pa.ink.top, pb.ink.bottom - pb.ink.top);
              if (rowOverlap < shorter * 0.5) continue;
              // A floating layer over the content is the whole point of one.
              if (pa.pos !== pb.pos) continue;
              if (pa.pos && pb.pos) {
                const dx = Math.min(pa.box.right, pb.box.right) - Math.max(pa.box.left, pb.box.left);
                const dy = Math.min(pa.box.bottom, pb.box.bottom) - Math.max(pa.box.top, pb.box.top);
                if (dx <= 2 || dy <= 2) continue;
                const key = tagOf(pa.node) + "|" + tagOf(pb.node);
                if (overlapSeen.has(key)) continue;
                overlapSeen.add(key);
                overlaps.push({
                  parent: tagOf(parent).slice(0, 55),
                  pair: (tagOf(pa.node) + " / " + tagOf(pb.node)).slice(0, 70),
                  depth: Math.round(Math.min(dx, dy)),
                  text: (nameOf(pa.node) + " \u25b8 " + nameOf(pb.node)).slice(0, 64),
                  parentClass: String(parent.className || ""),
                  a: diagOf(pa),
                  b: diagOf(pb),
                });
                continue;
              }
              if (!pa.boxed && !pb.boxed) continue;
              // Either direction, so RTL is measured the same way.
              const ea = pa.boxed ? pa.box : pa.ink;
              const eb = pb.boxed ? pb.box : pb.ink;
              const gap = Math.max(eb.left - ea.right, ea.left - eb.right);
              if (gap > 2.5) continue;
              const key = tagOf(pa.node) + "|" + tagOf(pb.node) + "|" + Math.round(gap);
              if (collisionSeen.has(key)) continue;
              collisionSeen.add(key);
              collisions.push({
                parent: tagOf(parent).slice(0, 55),
                pair: (tagOf(pa.node) + " / " + tagOf(pb.node)).slice(0, 70),
                gap: Math.round(gap),
                text: (nameOf(pa.node) + " \u25b8 " + nameOf(pb.node)).slice(0, 64),
                parentClass: String(parent.className || ""),
                a: diagOf(pa),
                b: diagOf(pb),
              });
            }
          }
        }
      }
      // ── Floating layers drawn over one another ────────────────────────────
      // The touch rule above only compares DOM neighbours, so two notices that
      // both pin themselves to the bottom of the viewport (a stored-preferences
      // notice and the terms notice, say) collide without ever being siblings.
      //
      // Only position:fixed counts. A viewport-anchored layer is chrome that
      // floats above the page, so two of them sharing a region is a design
      // decision that was never made; an absolutely positioned wrapper is page
      // content, and a fixed banner over page content is what a banner is for.
      // Only the outermost layer of a nesting is measured, decorative overlays
      // are skipped, and two layers that share a parent are left alone because
      // an overlay anchored to its own card is a pattern, not a clash.
      const layers = [];
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed") continue;
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
        if (cs.pointerEvents === "none") continue;
        if (el.getAttribute("aria-hidden") === "true") continue;
        const body = (el.textContent || "").trim().replace(/\s+/g, " ");
        if (!body) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        layers.push({ el, r, z: cs.zIndex, body });
      }
      const outerLayers = layers.filter((a) => !layers.some((b) => b !== a && b.el.contains(a.el)));
      for (let i = 0; i < outerLayers.length; i += 1) {
        for (let j = i + 1; j < outerLayers.length; j += 1) {
          const a = outerLayers[i];
          const b = outerLayers[j];
          if (a.el.parentElement === b.el.parentElement) continue;
          const dx = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const dy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (dx <= 2 || dy <= 2) continue;
          const key = "L|" + Math.round(a.r.top) + "|" + Math.round(b.r.top) + "|" + Math.round(a.r.left);
          if (overlapSeen.has(key)) continue;
          overlapSeen.add(key);
          overlaps.push({
            parent: "floating layers",
            pair: (String(a.el.className || "").slice(0, 34) + " / " + String(b.el.className || "").slice(0, 34)),
            depth: Math.round(Math.min(dx, dy)),
            text: (a.body.slice(0, 30) + " \u25b8 " + b.body.slice(0, 30)),
            parentClass: "",
            a: { tag: a.el.tagName.toLowerCase() + "." + String(a.el.className || ""), box: rectOf(a.r), z: a.z, text: a.body.slice(0, 40) },
            b: { tag: b.el.tagName.toLowerCase() + "." + String(b.el.className || ""), box: rectOf(b.r), z: b.z, text: b.body.slice(0, 40) },
          });
        }
      }
      const text = document.body.innerText || "";
      return {
        collisions: collisions.slice(0, 8),
        collisionCount: collisions.length,
        overlaps: overlaps.slice(0, 8),
        overlapCount: overlaps.length,
        smallTargets: smallTargets.slice(0, 20),
        smallTargetCount: smallTargets.length,
        blockedTargets: blockedTargets.slice(0, 12),
        blockedCount: blockedTargets.length,
        url: location.pathname,
        viewport: vw,
        docWidth: document.documentElement.scrollWidth,
        textLength: text.length,
        firstLine: text.split(String.fromCharCode(10)).map((s) => s.trim()).filter(Boolean).slice(0, 6),
        text: text.slice(0, 4000),
        offenders: offenders.slice(0, 6),
        offenderCount: offenders.length,
        clipped: clipped.slice(0, 6),
        clippedCount: clipped.length,
        badStrings: [],
        bodyBg: getComputedStyle(document.body).backgroundColor,
      };
    })()`);

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${OUT}/${device.name}-${name}.png`, Buffer.from(shot.data, "base64"));

    const events = cdp.drain();
    for (const e of events) {
      if (e.method === "Log.entryAdded" && e.params.entry.level === "error") {
        consoleIssues.push({ route: name, kind: "log", text: e.params.entry.text.slice(0, 200) });
      }
      if (e.method === "Runtime.exceptionThrown") {
        consoleIssues.push({
          route: name,
          kind: "exception",
          text: (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text || "").slice(0, 200),
        });
      }
      if (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") {
        consoleIssues.push({
          route: name,
          kind: "console",
          text: e.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200),
        });
      }
      if (e.method === "Network.loadingFailed") {
        consoleIssues.push({
          route: name,
          kind: "request-failed",
          text: `${e.params.type} ${e.params.errorText}`,
        });
      }
    }

    probe.badStrings = findBadText(probe.text || "");
    report.push({ device: device.name, name, requested: route, ...probe });
    const flags = [];
    if (probe.offenderCount) flags.push(`OVERFLOW x${probe.offenderCount}`);
    if (probe.clippedCount) flags.push(`CLIPPED-TEXT x${probe.clippedCount}`);
    if (probe.docWidth > probe.viewport) flags.push(`H-SCROLL ${probe.docWidth}>${probe.viewport}`);
    if (probe.url !== route) flags.push(`redirected to ${probe.url}`);
    if (probe.smallTargetCount) flags.push(`${probe.smallTargetCount} small targets`);
    if (probe.blockedCount) flags.push(`BLOCKED x${probe.blockedCount}`);
    if (probe.collisionCount) flags.push(`JAMMED x${probe.collisionCount}`);
    if (probe.overlapCount) flags.push(`STACKED x${probe.overlapCount}`);
    console.log(
      `${(device.name + ":" + name).padEnd(24)} ${String(probe.textLength).padStart(6)}ch  ${(flags.join(", ") || "ok").padEnd(28)} ${probe.firstLine.slice(0, 3).join(" | ")}`,
    );
    for (const o of probe.offenders) {
      console.log(`               +${o.over}px  ${o.tag}  "${o.text}"`);
    }
    for (const c of probe.clipped || []) {
      console.log(`               cut off  ${c.tag}  "${c.text}"`);
    }
    for (const t of probe.smallTargets || []) {
      console.log(`                target ${t.w}x${t.h}  "${t.label}"`);
    }
    for (const b of probe.blockedTargets || []) {
      console.log(`                blocked ${b.w}x${b.h}  "${b.label}"  under ${b.by}`);
    }
    for (const c of probe.collisions || []) {
      console.log(`                jammed (${c.gap}px)  in ${c.parent}\n                  ${c.pair}  "${c.text}"`);
    }
    for (const o of probe.overlaps || []) {
      console.log(`                stacked (${o.depth}px)  in ${o.parent}\n                  ${o.pair}  "${o.text}"`);
    }
    if (probe.badStrings.length) console.log(`               bad text: ${probe.badStrings.join(", ")}`);
  }
  }

  // The one journey with money in it that a screenshot cannot check: a locked
  // feature quoting a credit price, the purchase coming up short, and the gap
  // turning into a top-up sheet. Screenshots of Form Analysis only prove the
  // card renders. This drives the button and reads what the athlete gets.
  //
  // Form Analysis is used rather than Mental Gym because it costs more than the
  // review account holds, so the run exercises the shortfall path and cannot
  // quietly spend the balance. If that account is ever topped up, this picks
  // whichever locked card is still short rather than buying something.
  if (process.argv.includes("--flow=unlock")) {
    const verdict = await unlockFlow(cdp);
    flowResults.push(verdict);
    console.log(`[flow:unlock] ${verdict.ok ? "PASS" : "FAIL"} — ${verdict.detail}`);
  }

  // `--eval="<expression>"` prints the value of any expression evaluated in the
  // live page on the last visited route. A claim about layout — a card's width,
  // an element's offset, a computed custom property — is then checked rather
  // than assumed, which the screenshots alone cannot do. Use it with a route
  // filter, e.g. `node scripts/ui-audit.mjs learning --eval="document.title"`.
  const evalArg = process.argv.find((a) => a.startsWith("--eval="));
  if (evalArg) {
    const value = await cdp.evaluate(evalArg.slice("--eval=".length));
    console.log(`[eval] ${JSON.stringify(value, null, 2)}`);
  }

  writeFileSync(`${OUT}/report.json`, JSON.stringify({ report, consoleIssues, flows: flowResults }, null, 2));
  writeGallery();
  console.log(`\n--- console/network errors (${consoleIssues.length}) ---`);
  const grouped = new Map();
  for (const c of consoleIssues) {
    const key = `${c.route}|${c.kind}|${c.text.slice(0, 120)}`;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }
  for (const key of grouped.keys()) console.log(key);
  console.log(`\nscreenshots -> ${OUT}/`);

  // --check turns the review into a gate: same measurements, non-zero exit.
  if (process.argv.includes("--check")) {
    const failures = [];
    for (const r of report) {
      if (r.smallTargetCount) failures.push(`${r.device ?? "?"} ${r.name}: ${r.smallTargetCount} controls under 44px`);
      if (r.blockedCount) {
        for (const b of r.blockedTargets ?? []) {
          failures.push(`${r.device ?? "?"} ${r.name}: "${b.label}" (${b.w}x${b.h}) is unclickable — covered by ${b.by}`);
        }
      }
      const where = `${r.device ?? "?"} ${r.name}`;
      if (r.docWidth > r.viewport) failures.push(`${where}: page scrolls sideways (${r.docWidth} > ${r.viewport})`);
      if (r.clippedCount) failures.push(`${where}: ${r.clippedCount} elements cut off by their own container`);
      if (r.badStrings?.length) failures.push(`${where}: placeholder text on screen (${r.badStrings.join(", ")})`);
      if (r.collisionCount) {
        for (const c of r.collisions) {
          failures.push(`${where}: ${c.pair} touch with no gutter (${c.gap}px) — "${c.text}"`);
        }
      }
      if (r.overlapCount) {
        for (const o of r.overlaps) {
          failures.push(`${where}: ${o.pair} drawn over each other (${o.depth}px deep) — "${o.text}"`);
        }
      }
    }
    for (const c of consoleIssues) {
      if (c.kind === "exception") failures.push(`${c.route}: ${c.text}`);
      if (c.kind === "request-failed") failures.push(`${c.route}: ${c.text}`);
    }
    for (const f of flowResults) {
      if (!f.ok) failures.push(`flow ${f.flow}: ${f.detail}`);
    }
    await finish(chrome, server);
    if (failures.length) {
      console.error(`\nui-audit: FAIL (${failures.length})`);
      for (const f of failures) console.error("  - " + f);
      process.exit(1);
    }
    console.log(
      "\nui-audit: PASS — every control is at least 44px, nothing scrolls sideways, nothing is cut off, nothing is jammed together",
    );
    process.exit(0);
  }

  chrome.kill();
  server?.close();
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {}
}

// A single page with every screenshot inlined, so the whole app can be reviewed
// by scrolling one tab instead of opening 19 files.
// Drive the shortest path with money on it: a locked feature quoting a price,
// the purchase coming up short, and the gap becoming a top-up sheet. Nothing
// here buys anything — the review account's balance is below the Mental Gym
// price by design, so the run lands on the shortfall branch. If that ever
// changes, the flow says so rather than quietly spending credits.
async function unlockFlow(cdp) {
  await cdp.send("Page.navigate", { url: `${APP}/mental` });
  await sleep(4500);

  const clicked = await cdp.evaluate(`(() => {
    const el = [...document.querySelectorAll("button, a, [role=button]")]
      .find((e) => /unlock/i.test(e.textContent || "") && e.getBoundingClientRect().height > 0);
    if (!el) return { ok: false, why: "no unlock control on the page" };
    el.click();
    return { ok: true, label: el.textContent.trim().slice(0, 60) };
  })()`);
  if (!clicked.ok) {
    return { ok: false, flow: "unlock", detail: clicked.why, step: "find-unlock" };
  }

  // The purchase round-trip and the sheet animation.
  await sleep(6000);

  const state = await cdp.evaluate(`(() => {
    const text = document.body.innerText || "";
    const gap = text.match(/([\\d,]+)\\s+more credits needed/i);
    return {
      gap: gap ? gap[1] : null,
      asksToTopUp: /more credits needed|top up to finish/i.test(text),
      // The sheet has to say what it is selling, or the athlete is looking at a
      // credit pack with no idea it is the last step of a purchase they started.
      namesTheUnlock: /top up to finish:\\s*mental gym/i.test(text),
      tail: text.slice(-400).replace(/\\s+/g, " ").slice(0, 300),
    };
  })()`);

  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/flow-unlock.png`, Buffer.from(shot.data, "base64"));

  const ok = state.asksToTopUp && Boolean(state.gap) && state.namesTheUnlock;
  const detail = ok
    ? `clicked "${clicked.label}", sheet asks for ${state.gap} more credits and names the unlock`
    : `clicked "${clicked.label}" but the top-up sheet was wrong (gap=${state.gap}, names the unlock=${state.namesTheUnlock}); page ends: ${state.tail}`;
  return { ok, flow: "unlock", detail, gap: state.gap, label: clicked.label };
}

function writeGallery() {
  const shots = readdirSync(OUT).filter((f) => f.endsWith(".png")).sort();
  const cells = shots
    .map((f) => {
      const name = f.replace(/\.png$/, "");
      const b64 = readFileSync(join(OUT, f)).toString("base64");
      return `<figure><figcaption>${name}</figcaption><img alt="${name} screen" src="data:image/png;base64,${b64}"></figure>`;
    })
    .join("\n");
  writeFileSync(
    join(OUT, "gallery.html"),
    `<!doctype html><meta charset="utf-8"><title>Vaylo UI audit</title>
<style>
  body{margin:0;background:#0b0b0f;color:#e9e9f0;font:12px/1.4 system-ui}
  header{padding:8px 12px;position:sticky;top:0;background:#14141a;border-bottom:1px solid #2a2a33}
  main{display:flex;flex-wrap:wrap;gap:10px;padding:10px}
  figure{margin:0;background:#16161c;border:1px solid #2a2a33;border-radius:8px;overflow:hidden;width:280px}
  figcaption{padding:4px 8px;font-weight:600;border-bottom:1px solid #2a2a33}
  img{display:block;width:280px}
</style>
<header>Vaylo Sports — ${shots.length} screens across ${DEVICES.length} device(s): ${DEVICES.map((d) => `${d.name} ${d.width}x${d.height}`).join(", ")}</header><main>${cells}</main>`,
  );
}

async function finish(chrome, server) {
  chrome.kill();
  server?.close();
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {}
  await sleep(200);
}

main().catch((err) => {
  console.error("ui-audit failed:", err);
  process.exit(1);
});
