// Mobile UI audit: screenshots every route at phone size and reports what is
// visually broken.
//
//   npm run ui:audit              # build, screenshot all routes, write a gallery
//   npm run ui:check              # same measurements, non-zero exit on a defect
//   node scripts/ui-audit.mjs metrics avatar   # just these routes
//
// It fails on: a control under 44px, a page that scrolls sideways, a value that
// rendered as `undefined`, a doubled word in copy, and any console exception or
// failed request. It does NOT fail on a decorative glow hanging off the edge of
// a clipping parent, or on a carousel's off-screen cards — both are reported as
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
  ["leaderboard", "/leaderboard"],
  ["friends", "/friends"],
  ["routines", "/routines"],
  ["compare", "/compare"],
  ["pricing", "/pricing"],
  ["not-found", "/definitely-not-a-page"],
  // Second tier: everything reachable from the tab bar and the hub pages, so
  // the measured pass covers the whole app rather than the top screens.
  ["training", "/training"],
  ["workouts", "/workouts"],
  ["nutrition", "/nutrition"],
  ["form", "/form"],
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
  ["cross-training", "/cross-training"],
  ["learning", "/learning"],
  ["goals", "/goals"],
  ["feed", "/feed"],
  ["pbs", "/pbs"],
  ["opponents", "/opponents"],
  ["notifications", "/notifications"],
  ["referrals", "/referrals"],
  ["communities", "/communities"],
  ["challenges", "/challenges"],
  ["health-sync", "/health-sync"],
  ["subscription", "/subscription"],
  ["collection", "/collection"],
];

const env = readEnvFile(".env");
const SUPA_URL = process.env.UI_SUPABASE_URL || env.VITE_SUPABASE_URL;
const SUPA_KEY =
  process.env.UI_SUPABASE_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  env.VITE_SUPABASE_PUBLISHABLE_KEY;

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
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });

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
    // the supabase round-trips; this is a review pass, not a benchmark.
    await sleep(4000);

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
      const text = document.body.innerText || "";
      return {
        smallTargets: smallTargets.slice(0, 20),
        smallTargetCount: smallTargets.length,
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
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.data, "base64"));

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
    report.push({ name, requested: route, ...probe });
    const flags = [];
    if (probe.offenderCount) flags.push(`OVERFLOW x${probe.offenderCount}`);
    if (probe.clippedCount) flags.push(`CLIPPED-TEXT x${probe.clippedCount}`);
    if (probe.docWidth > probe.viewport) flags.push(`H-SCROLL ${probe.docWidth}>${probe.viewport}`);
    if (probe.url !== route) flags.push(`redirected to ${probe.url}`);
    if (probe.smallTargetCount) flags.push(`${probe.smallTargetCount} small targets`);
    console.log(
      `${name.padEnd(13)} ${String(probe.textLength).padStart(6)}ch  ${(flags.join(", ") || "ok").padEnd(28)} ${probe.firstLine.slice(0, 3).join(" | ")}`,
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
    if (probe.badStrings.length) console.log(`               bad text: ${probe.badStrings.join(", ")}`);
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
      if (r.smallTargetCount) failures.push(`${r.name}: ${r.smallTargetCount} controls under 44px`);
      if (r.docWidth > r.viewport) failures.push(`${r.name}: page scrolls sideways (${r.docWidth} > ${r.viewport})`);
      if (r.clippedCount) failures.push(`${r.name}: ${r.clippedCount} elements cut off by their own container`);
      if (r.badStrings?.length) failures.push(`${r.name}: placeholder text on screen (${r.badStrings.join(", ")})`);
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
    console.log("\nui-audit: PASS — every control is at least 44px, nothing scrolls sideways, nothing is cut off");
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
// here buys anything — the review account's balance is below the Form Analysis
// price by design, so the run lands on the shortfall branch. If that ever
// changes, the flow says so rather than quietly spending credits.
async function unlockFlow(cdp) {
  await cdp.send("Page.navigate", { url: `${APP}/form` });
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
      namesTheUnlock: /top up to finish:\\s*form analysis/i.test(text),
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
<header>Vaylo Sports — ${shots.length} screens at 390x844</header><main>${cells}</main>`,
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
