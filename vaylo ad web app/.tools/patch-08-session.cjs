#!/usr/bin/env node
/**
 * One-shot patch: replace the static-token auth stub in 0.8.html with a real
 * single-user session manager, and make boot session-aware.
 * Idempotent: running twice is a no-op.
 */
const fs = require("fs");
const path = require("path");

const DIR = path.resolve(__dirname, "..");
const HTML = path.join(DIR, "0.8.html");
const BLOCK = fs.readFileSync(path.join(__dirname, "auth-block.js"), "utf8");

let src = fs.readFileSync(HTML, "utf8");
const before = src;

const START = "const REAL_ACCESS_TOKEN";
const END_MARK = "/* ============ auth UI ============ */";
const startAt = src.indexOf(START);
const endAt = src.indexOf(END_MARK);
if (startAt !== -1 && endAt !== -1 && endAt > startAt) {
  src = src.slice(0, startAt) + BLOCK + "\n" + src.slice(endAt);
}

const OLD_UI = `function renderAuth() {
  $("#core-sub").textContent = "signed in as you";
}
async function bootAfterAuth() {
  homeLoad(); loadCompetitors(); loadVoiceStyles(); loadIntegrations(); checkFunctions();
  addBubble("bot", "Ready. Vaylo Sports is live — ask it anything and I'll route it through the real Vaylo Sports Ads pipelines.");
}`;

const NEW_UI = `/* ============ session UI ============ */
function mountSessionPill() {
  if ($("#session-pill")) return;
  const el = document.createElement("button");
  el.id = "session-pill";
  el.type = "button";
  el.title = "Click to refresh the session";
  el.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:60;display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(18,14,28,.92);color:#e9e4f5;font-size:12px;cursor:pointer";
  el.innerHTML = '<span id="session-dot" style="width:8px;height:8px;border-radius:50%;background:#7a7a8c"></span><span id="session-label">connecting…</span>';
  el.addEventListener("click", async () => {
    setSessionPill("refreshing", "reconnecting…");
    try {
      await refreshSession({ force: true, skipBrowser: true });
      toast("Session refreshed — everything is live again.");
      bootAfterAuth();
    } catch (e) {
      setSessionPill("expired", "reconnect failed — press to retry");
      toast("Reconnect failed: " + e.message);
    }
  });
  document.body.appendChild(el);
}
function setSessionPill(state, label) {
  const dot = $("#session-dot");
  const lab = $("#session-label");
  if (!dot || !lab) return;
  const colors = { live: "#4ade80", refreshing: "#fbbf24", expired: "#f87171", offline: "#94a3b8" };
  dot.style.background = colors[state] || colors.offline;
  lab.textContent = label;
}
function displayName(s) {
  return ((s && s.user && s.user.email) || USER_EMAIL);
}
function renderAuth() {
  mountSessionPill();
  const s = session || readSession();
  if (s) {
    $("#core-sub").textContent = displayName(s);
    setSessionPill("live", "live · " + displayName(s).split("@")[0]);
  } else {
    setSessionPill("refreshing", "connecting…");
  }
}
sessionListener = (s) => {
  if (!s) { setSessionPill("expired", "session expired — press to reconnect"); return; }
  setSessionPill("live", "live · " + displayName(s).split("@")[0]);
};

async function bootAfterAuth() {
  renderAuth();
  setSessionPill("refreshing", "checking session…");
  let s;
  try {
    s = await ensureSession();
  } catch (e) {
    setSessionPill("expired", "session expired — press to reconnect");
    $("#core-sub").textContent = "not signed in";
    $("#orbit-status").innerHTML = "<b>Session expired.</b> Press the status pill at the bottom left to reconnect — no email, no sign-up.";
    return;
  }
  setSessionPill("live", "live · " + displayName(s).split("@")[0]);
  $("#core-sub").textContent = displayName(s);
  homeLoad(); loadCompetitors(); loadVoiceStyles(); loadIntegrations(); checkFunctions();
  addBubble("bot", "Ready. Vaylo Sports is live — ask it anything and I'll route it through the real Vaylo Sports Ads pipelines.");
}`;

if (src.includes(OLD_UI)) src = src.replace(OLD_UI, NEW_UI);

if (src === before) {
  console.log("no changes (already patched)");
} else {
  fs.writeFileSync(HTML, src);
  console.log("patched 0.8.html -> " + HTML);
}
