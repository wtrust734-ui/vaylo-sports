#!/usr/bin/env node
/**
 * Route crawler for the app shell, driven over the Chrome DevTools Protocol.
 *
 * Why not vitest + jsdom: every defect this is built to catch is a layout or
 * runtime fault that only exists in a real engine with a real viewport. jsdom
 * has no layout, so `scrollWidth > clientWidth`, an element sitting under the
 * notch, and a tab bar painting over a modal are all invisible to it. CDP
 * gives us the same engine the phone runs, driven headlessly and repeatably.
 *
 * What it checks per route:
 *   - uncaught exceptions and console errors (not warnings: the baseline is 58
 *     lint warnings and React logs noise in dev)
 *   - failed/4xx/5xx network responses
 *   - horizontal overflow, and which element causes it when it does
 *   - content under the simulated notch / home indicator
 *   - anything fixed to the bottom that the floating tab bar covers
 *   - an empty render (a route that mounts but paints nothing)
 *
 * The safe-area insets are injected before any document script runs, because
 * Capacitor's SystemBars plugin injects them the same way — and the CSS
 * resolves them once, in :root, so a plain custom property is enough to
 * reproduce a notched device.
 *
 * Usage:  node scripts/qa-crawl.mjs [--url http://localhost:8080] [--width 390]
 *                                 [--height 844] [--inset-top 47] [--inset-bottom 34]
 *                                 [--routes /,/train,...]
 * Exit code is 0 only when no route produced a finding.
 *
 * On Git Bash, pass MSYS_NO_PATHCONV=1 before the command: MSYS rewrites a
 * `/`-leading argument into a Windows path before Node ever sees it.
 *
 * Authenticated routes need a signed-in session. Point --session at a JSON file
 * of localStorage entries to have them seeded before the first document runs;
 * without it every route redirects to /auth and the sweep only covers the
 * sign-in screen. The format is the raw key/value pairs, values as strings:
 *
 *   { "sb-<project-ref>-auth-token": "<the session JSON, verbatim>" }
 *
 * Get it from a browser already signed in to the dev server. Treat that file as
 * a credential: it grants a live session, so keep it out of the repo and delete
 * it when the sweep is done.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const BASE = arg("url", "http://localhost:8080");
const WIDTH = Number(arg("width", 390));
const HEIGHT = Number(arg("height", 844));
const INSET_TOP = Number(arg("inset-top", 47));
const INSET_BOTTOM = Number(arg("inset-bottom", 34));
const SETTLE = Number(arg("settle", 1400));
const PORT = Number(arg("port", 9333));
const SESSION_FILE = arg("session", ".qa/session.json");
const session = existsSync(SESSION_FILE) ? readFileSync(SESSION_FILE, "utf8") : null;

const DEFAULT_ROUTES = [
  "/", "/train", "/perform", "/profile", "/availability", "/training",
  "/metrics", "/stats", "/vpr", "/recovery", "/mental", "/nutrition", "/injury",
  "/form", "/form/video", "/health-sync", "/coach", "/market", "/pricing",
  "/subscription", "/avatar", "/collection", "/identity", "/workouts",
  "/challenges", "/competition", "/events", "/pbs",
  "/compare", "/tactics",
  "/skills", "/goals", "/guardian", "/starting-analysis", "/insights", "/achievements", "/trophies", "/learning", "/notifications",
  "/referrals", "/referral-leaderboard", "/event-packs", "/marketplace", "/arcade",
  "/discord", "/compete", "/settings/delete-account", "/auth",
];

const ROUTES = arg("routes", null)
  ? arg("routes", "").split(",").filter(Boolean)
  : DEFAULT_ROUTES;


const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error("qa-crawl: no Chrome/Chromium found; pass a path in CHROME_CANDIDATES");
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), "vaylo-qa-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=${WIDTH},${HEIGHT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let ws;
let msgId = 0;
const pending = new Map();
const listeners = [];

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 30000);
  });

const on = (fn) => listeners.push(fn);

const connect = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome DevTools page target never came up");
};

/** The probe runs inside the page. Returns one plain object per route. */
const PROBE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const vh = window.innerHeight;
  const main = document.querySelector('main') || document.body;
  const r = (el) => el.getBoundingClientRect();
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.tagName)
    .replace(/\\s+/g, ' ').trim().slice(0, 42);

  // An element only counts if it is actually painted and hit-testable: an
  // AnimatePresence scrim left in the DOM at opacity 0, or anything inside a
  // hidden ancestor, would otherwise flood the report with phantoms.
  const visible = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity) < 0.05) return false;
      if (cs.pointerEvents === 'none') return false;
      const b = r(n);
      if (b.width < 8 || b.height < 8) return false;
    }
    return true;
  };

  // Who is overflowing horizontally, if anyone.
  let widest = null;
  for (const el of document.querySelectorAll('body *')) {
    const b = r(el);
    if (b.width === 0) continue;
    if (b.right > vw + 1 || b.left < -1) {
      const over = Math.max(b.right - vw, -b.left);
      if (!widest || over > widest.over) widest = { over: Math.round(over), el: label(el), cls: String(el.className).slice(0, 70) };
    }
  }

  // Anything interactive sitting under the notch or the home indicator.
  //
  // Only pinned chrome counts. Ordinary content in a scrolling page is allowed
  // to be anywhere on screen — it moves when the athlete scrolls — so flagging
  // it buries the real defects in noise. A fixed or sticky ancestor is chrome
  // that can never move itself out from under the inset.
  const pinned = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed' || cs.position === 'sticky') return true;
    }
    return false;
  };
  const underTop = [], underBottom = [];
  for (const el of document.querySelectorAll('button, a, input, select, textarea, [role=button]')) {
    const b = r(el);
    if (!visible(el) || !pinned(el)) continue;
    if (b.top < ${INSET_TOP} - 2 && b.bottom > 4) underTop.push({ el: label(el), top: Math.round(b.top), h: Math.round(b.height) });
    if (b.bottom > vh - ${INSET_BOTTOM} + 2 && b.top < vh - 4) underBottom.push({ el: label(el), bottom: Math.round(vh - b.bottom) });
  }

  // The floating tab bar is the one *fixed* nav with a real box. Picking
  // querySelector('nav[aria-label]') grabs the sidebar's nav, which is
  // display:none on a phone and reports a zero rect.
  const navs = [...document.querySelectorAll('nav')].filter((n) => {
    const cs = getComputedStyle(n);
    const b = r(n);
    return cs.position === 'fixed' && b.width > 100 && b.height > 10;
  });
  const nav = navs[0];
  let occluded = null;
  if (nav) {
    const nb = r(nav);
    const cx = nb.left + nb.width / 2, cy = nb.top + nb.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !hit.closest('nav') && !hit.closest('[aria-label]')) {
      occluded = { by: label(hit), navTop: Math.round(nb.top) };
    }
  }

  const openOverlays = [...document.querySelectorAll('body *')]
    .filter(el => {
      const cs = getComputedStyle(el);
      return cs.position === 'fixed' && visible(el) && r(el).width > 100 && r(el).height > 100;
    })
    .map(el => ({ z: getComputedStyle(el).zIndex, cls: String(el.className).slice(0, 44) }));

  const text = main.innerText.replace(/\\s+/g, ' ').trim();
  return {
    heading: (main.querySelector('h1,h2')?.textContent || '').trim().slice(0, 48),
    chars: text.length,
    errorText: /something went wrong|unexpected error|an error occurred|cannot read propert|is not a function|failed to fetch dynamically imported/i.test(text),
    overflow: de.scrollWidth - vw,
    widest,
    underTop: underTop.slice(0, 4),
    underBottom: underBottom.slice(0, 4),
    occluded,
    overlays: openOverlays.slice(-5),
  };
})()`;

const findings = [];
const rows = [];

try {
  const wsUrl = await connect();
  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      return;
    }
    for (const fn of listeners) fn(msg);
  };

  const call = send;

  // Per-route buckets, keyed by the route we are currently on.
  let bucket = { errors: [], net: [] };
  const push = (kind, text) => {
    if (kind === "error") bucket.errors.push(text);
    else bucket.net.push(text);
  };

  on((msg) => {
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      const frames = (d.stackTrace?.callFrames || [])
        .slice(0, 3)
        .map((f) => `${f.functionName || "<anon>"}@${String(f.url).split("/").pop()}:${f.lineNumber + 1}`)
        .join(" <- ");
      push("error", `${(d.exception?.description || d.text || "exception").split("\n")[0]} [${frames}]`.slice(0, 320));
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      push("error", msg.params.args.map((a) => a.description || a.value || a.type).join(" ").slice(0, 180));
    }
    if (msg.method === "Log.entryAdded" && ["error", "warning"].includes(msg.params.entry.level)) {
      const t = msg.params.entry.text || "";
      // Vite's HMR chatter and favicon noise are not app defects.
      if (/favicon|\[vite\]|Download the React DevTools/i.test(t)) return;
      push("error", t.slice(0, 180));
    }
    if (msg.method === "Network.loadingFailed") {
      push("net", `loadingFailed ${msg.params.errorText} ${msg.params.type}`);
    }
    if (msg.method === "Network.responseReceived") {
      const { status, url } = msg.params.response;
      if (status >= 400) push("net", `HTTP ${status} ${url.slice(0, 110)}`);
    }
  });

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Log.enable");
  await call("Network.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 3, mobile: true,
  });
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  // Reproduce the notch before any app script runs, the way SystemBars does.
  // Guarded: at document-start `document.documentElement` can still be null,
  // and an unguarded write here throws a TypeError that the crawler would then
  // report as an app defect.
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      (() => {
        const set = () => {
          const root = document.documentElement;
          if (!root || !root.style) return;
          root.style.setProperty('--safe-area-inset-top', '${INSET_TOP}px');
          root.style.setProperty('--safe-area-inset-bottom', '${INSET_BOTTOM}px');
          root.style.setProperty('--safe-area-inset-left', '0px');
          root.style.setProperty('--safe-area-inset-right', '0px');
        };
        set();
        document.addEventListener('readystatechange', set);
        document.addEventListener('DOMContentLoaded', set);
      })();
    `,
  });

  // Seed the session before the app boots, so protected routes render.
  if (session) {
    await call("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        (() => {
          const seed = ${session};
          try {
            for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
          } catch (e) { /* storage blocked on this origin */ }
        })();
      `,
    });
  }

  for (const route of ROUTES) {
    bucket = { errors: [], net: [] };
    const url = BASE + route;
    await call("Page.navigate", { url });
    await sleep(SETTLE);

    const probe = await call("Runtime.evaluate", {
      expression: PROBE,
      returnByValue: true,
      awaitPromise: true,
    });
    const r = probe.result?.value;
    if (!r) {
      findings.push({ route, kind: "probe", detail: "probe returned nothing (page did not settle)" });
      rows.push({ route, heading: "—", chars: 0, notes: ["probe failed"] });
      continue;
    }

    const notes = [];
    if (r.errorText) notes.push("error text rendered in the page");
    if (r.overflow > 1) notes.push(`horizontal overflow ${r.overflow}px via ${r.widest?.el} (${r.widest?.cls})`);
    if (r.underTop.length) notes.push(`under the notch: ${r.underTop.map((u) => `${u.el}@${u.top}px (h${u.h})`).join(", ")}`);
    if (r.underBottom.length) notes.push(`under the home indicator: ${r.underBottom.map((u) => `${u.el}@${u.bottom}px`).join(", ")}`);
    if (r.overlays?.length > 1) notes.push(`${r.overlays.length} fixed overlays: ${r.overlays.map((o) => `z${o.z}`).join(",")}`);
    if (r.occluded) notes.push(`tab bar covered by ${r.occluded.by}`);
    if (r.chars < 40 && route !== "/auth") notes.push(`rendered only ${r.chars} chars`);

    const errs = [...new Set(bucket.errors)].filter((e) => !/ResizeObserver loop/i.test(e));
    const net = [...new Set(bucket.net)].filter((n) => !/favicon/i.test(n));
    if (errs.length) notes.push(`console: ${errs.slice(0, 2).join(" | ")}`);
    if (net.length) notes.push(`network: ${net.slice(0, 2).join(" | ")}`);

    rows.push({ route, heading: r.heading, chars: r.chars, notes });
    for (const n of notes) findings.push({ route, kind: "route", detail: n });
  }

  console.log(`\nqa-crawl: ${WIDTH}x${HEIGHT}, insets ${INSET_TOP}/${INSET_BOTTOM}, ${ROUTES.length} routes, session=${session ? "seeded" : "none"}\n`);
  for (const row of rows) {
    const mark = row.notes.length ? "FAIL" : " ok ";
    console.log(`[${mark}] ${row.route.padEnd(28)} ${String(row.chars).padStart(6)}ch  ${row.heading}`);
    for (const n of row.notes) console.log(`         - ${n}`);
  }
  console.log(`\nqa-crawl: ${findings.length} finding(s) across ${rows.length} routes`);
} catch (err) {
  console.error("qa-crawl failed:", err.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

if (findings.length) process.exitCode = 1;
