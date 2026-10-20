/* ------------------------------------------------------------------
   Single-user session — you are the only account.

   No sign-up, no email flow. The local server injects a bootstrap
   session on first load; the page keeps it in localStorage, refreshes
   it before it expires, and retries a request once on 401. A stale
   token therefore can never surface to you as "HTTP 401".
   ------------------------------------------------------------------ */
const SESSION_KEY = "vaylo.studio.session.v1";
const USER_EMAIL = "preview-bot@vaylo-preview.local";

let session = null;
let refreshing = null;
let sessionListener = () => {};
let chatSessionId = null;

function jwtExp(t) {
  try {
    const p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "===".slice((p.length + 3) % 4))).exp || 0;
  } catch (e) { return 0; }
}

function normalizeSession(j) {
  if (!j || !j.access_token) return null;
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token || null,
    expires_at: j.expires_at || jwtExp(j.access_token),
    user: j.user && j.user.email ? j.user : { email: USER_EMAIL },
  };
}

function storeSession(j) {
  session = normalizeSession(j);
  if (!session) return null;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* private mode */ }
  try { sessionListener(session); } catch (e) { /* listener must never break auth */ }
  return session;
}

function readSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (s && s.access_token) return s;
  } catch (e) { /* corrupt entry, fall through */ }
  if (window.__VAYLO_SESSION__ && window.__VAYLO_SESSION__.access_token) return window.__VAYLO_SESSION__;
  return null;
}

function sessionFresh(s, skewSeconds = 90) {
  return !!s && !!s.access_token && jwtExp(s.access_token) - skewSeconds > Math.floor(Date.now() / 1000);
}

async function refreshSession(opts) {
  const force = !!(opts && opts.force);
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const cur = session || readSession();
    if (!force && sessionFresh(cur)) return storeSession(cur);

    /* 1. the browser can refresh by itself */
    if (cur && cur.refresh_token && !(opts && opts.skipBrowser)) {
      try {
        const r = await fetch(SB_URL + "/auth/v1/token?grant_type=refresh_token", {
          method: "POST",
          headers: { apikey: SB_ANON, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: cur.refresh_token }),
        });
        if (r.ok) {
          const j = await r.json();
          const s = storeSession(j);
          if (s) return s;
        }
      } catch (e) { /* fall through to the local server */ }
    }

    /* 2. the local server owns the durable session and can always re-auth */
    try {
      const r = await fetch("/__session", { cache: "no-store" });
      if (r.ok) {
        const s = storeSession(await r.json());
        if (s) return s;
      }
    } catch (e) { /* offline: nothing else to try */ }

    const err = new Error("Session expired");
    err.code = "SESSION_EXPIRED";
    throw err;
  })();
  try { return await refreshing; } finally { refreshing = null; }
}

async function ensureSession() {
  const cur = session || readSession();
  if (sessionFresh(cur)) return storeSession(cur);
  return refreshSession({ force: true });
}

async function token() {
  const s = await ensureSession();
  return s.access_token;
}

function authOn() { return true; }

/** Every network call goes through here so 401 is retried, never shown raw. */
async function authedFetch(path, opts, alreadyRetried) {
  const o = opts || {};
  const s = await ensureSession();
  const headers = Object.assign({ apikey: SB_ANON, Authorization: "Bearer " + s.access_token }, o.headers || {});
  if (o.body !== undefined && o.body !== null && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const r = await fetch(SB_URL + path, { method: o.method || "GET", headers, body: o.body === undefined || o.body === null ? undefined : o.body });
  if (r.status === 401 && !alreadyRetried) {
    await refreshSession({ force: true });
    return authedFetch(path, o, true);
  }
  return r;
}

function prettyError(status, bodyText, json) {
  const msg = (json && (json.error || json.message || json.msg)) || (bodyText || "").replace(/\s+/g, " ").slice(0, 200);
  if (status === 401) return "Session expired (401) — reconnecting. If this repeats, press Reconnect.";
  if (status === 403) return "Not allowed for this account (403)" + (msg ? " · " + msg : "");
  if (status === 429) return "Rate limited (429) — wait a moment and retry.";
  if (status >= 500) return "Server error (" + status + ")" + (msg ? " · " + msg : "");
  return "HTTP " + status + (msg ? " · " + msg : "");
}

async function parseResponse(r) {
  const text = await r.text().catch(() => "");
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* plain text */ }
  if (!r.ok) throw new Error(prettyError(r.status, text, json));
  return json;
}

async function fnCall(slug, body, method) {
  const opts = { method: method || "POST" };
  if (body !== null && body !== undefined) opts.body = JSON.stringify(body);
  const r = await authedFetch("/functions/v1/" + slug, opts);
  return parseResponse(r);
}

async function restGet(table, query) {
  const r = await authedFetch("/rest/v1/" + table + (query || ""));
  return (await parseResponse(r)) || [];
}

async function restInsert(table, row) {
  const r = await authedFetch("/rest/v1/" + table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  const j = await parseResponse(r);
  return Array.isArray(j) ? j[0] : j;
}
