// ===========================================================================
// wearable-oauth — edge function for cloud wearable OAuth
// ---------------------------------------------------------------------------
// Endpoints (JSON, POST, Authorization: Bearer <supabase JWT>):
//   { action: "start",     provider: "garmin" } → { url, state }
//   { action: "status",    provider: "garmin" } → { connected, last_sync_at }
//   { action: "disconnect",provider: "garmin" } → { ok: true }
//   { action: "callback",  code, state }        → redirect (vendor OAuth callback)
//   { action: "sync",      provider? }          → { ok, workouts, samples, providers }
//   { action: "history",   provider, since|months }
//                                               → { ok, imported, pages, capped }
//
// `history` is the historical import: where `sync` reads the newest 50 records
// past a stored cursor, this walks a provider's feed back to an explicit lower
// bound, page by page, which is what turns "connected" into "my training is in
// Vaylo Sports". It is bounded (MAX_HISTORY_PAGES) and idempotent — the rows it
// writes are upserted on (user, source, source_record_id), so running it again
// updates rather than duplicates.
//
// Vendor credentials: set with `supabase secrets set GARMIN_CLIENT_ID=… …`
// (see providers.ts for the exact per-vendor names). If a vendor's secrets are
// absent, /start answers { error: "not_configured" } and the UI shows
// "Coming soon — connect via Health Connect in the meantime."
//
// Why this function changed (2026-10-05)
// ---------------------------------------
// Two failure modes made "connected" fiction on any real deployment:
//
//   1. STATE WAS IN MEMORY. The authorization `state` lived in an in-process
//      Map. The vendor's callback GET can land on a different edge instance
//      (or a cold one) where the Map is empty — so userId resolved to null,
//      the connection row was never written, and the athlete saw a redirect
//      into the app that reported failure for a flow they had just approved.
//      State now lives in `wearable_auth_states` (service-role only, 10-minute
//      TTL, consumed on read — single use, on any instance).
//
//   2. NO TOKEN WAS EVER EXCHANGED. The callback validated nothing and stored
//      nothing, and /sync just touched last_sync_at while returning zero rows.
//      The code is now exchanged for real at the callback, tokens are stored
//      in `health_connection_tokens` (service-role only — never in
//      `health_connections.metadata`, which the athlete's own client can
//      read), and /sync performs a genuine import for providers whose mapper
//      is implemented (strava, fitbit, oura). A provider without one answers
//      `import_not_implemented` — an honest note, not a fake success.
//
// Tokens are never logged and never leave the server. The only provider
// values that reach a log line are the provider id and an HTTP status.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { authenticate, json, readJsonBody, throttled } from "../_shared/guard.ts";
import {
  ACTIVITY_MAPPERS,
  IMPORTABLE_PROVIDERS,
  OAUTH_PROVIDERS,
  buildAuthUrl,
  parseTokenResponse,
  tokenRequest,
  type ParsedToken,
  type WorkoutRow,
} from "./providers.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** State TTL. Long enough for a human to read a consent screen, short enough to be meaningless afterwards. */
const STATE_TTL_MS = 10 * 60 * 1000;

/** How far back the first import looks when there is no stored cursor. */
const INITIAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function env(name: string): string | null {
  const v = Deno.env.get(name);
  return v && v.trim() ? v.trim() : null;
}

function providerEnv(provider: string, key: "CLIENT_ID" | "CLIENT_SECRET" | "REDIRECT_URL"): string | null {
  const p = provider.toUpperCase();
  return env(`${p}_${key}`) ?? env(`WEARABLE_${p}_${key}`);
}

function callbackUrl(): string {
  return env("WEARABLE_OAUTH_CALLBACK_URL")
    ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/wearable-oauth`;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomState(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return b64url(b);
}

/** Service-role client. The ONLY client this function uses for state/tokens. */
const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ---------------------------------------------------------------------------
// State persistence — cross-instance, single-use
// ---------------------------------------------------------------------------

/**
 * Writes the authorization state to the DB. Opportunistically sweeps expired
 * rows first (indexed delete, one round trip) so the table cannot grow without
 * a cron. Returns false when the write fails — /start must NOT hand out a URL
 * whose state cannot be proven later; better to fail loudly than to strand the
 * athlete on the vendor's success screen with nowhere to land.
 */
async function persistState(state: string, userId: string, provider: string): Promise<boolean> {
  const db = admin();
  await db.from("wearable_auth_states").delete().lt("expires_at", new Date().toISOString());
  const { error } = await db.from("wearable_auth_states").insert({
    state,
    user_id: userId,
    provider,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  return !error;
}

/**
 * Reads-and-deletes in one statement: `.delete().select()` returns the deleted
 * row, so consumption is atomic — two callbacks racing the same state (or a
 * replayed one) resolve the row exactly once. Expired rows are consumed and
 * discarded, never honored.
 */
async function consumeState(
  state: string,
): Promise<{ userId: string; provider: string } | null> {
  const { data } = await admin()
    .from("wearable_auth_states")
    .delete()
    .eq("state", state)
    .select("user_id, provider, expires_at")
    .maybeSingle();
  if (!data) return null;
  if (Date.parse(data.expires_at) < Date.now()) return null;
  return { userId: data.user_id as string, provider: data.provider as string };
}

// ---------------------------------------------------------------------------
// Token exchange, storage, refresh
// ---------------------------------------------------------------------------

async function exchangeCode(
  provider: string,
  code: string,
  redirectUri: string,
): Promise<ParsedToken | null> {
  const cfg = OAUTH_PROVIDERS[provider];
  const clientId = providerEnv(provider, "CLIENT_ID");
  const clientSecret = providerEnv(provider, "CLIENT_SECRET");
  if (!cfg || !clientId || !clientSecret) return null;
  const req = tokenRequest(provider, { clientId, clientSecret }, { type: "authorization_code", code }, redirectUri);
  if (!req) return null;
  try {
    const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
    if (!res.ok) {
      // Provider id + status only: the body can echo request metadata and the
      // header carries credentials. Never read either on the error path.
      console.warn("wearable-oauth exchange refused", provider, res.status);
      return null;
    }
    return parseTokenResponse(await res.json(), Date.now());
  } catch {
    console.warn("wearable-oauth exchange unreachable", provider);
    return null;
  }
}

async function refreshTokens(
  provider: string,
  current: { refreshToken: string; accessToken: string },
): Promise<ParsedToken | null> {
  const cfg = OAUTH_PROVIDERS[provider];
  const clientId = providerEnv(provider, "CLIENT_ID");
  const clientSecret = providerEnv(provider, "CLIENT_SECRET");
  if (!cfg || !clientId || !clientSecret) return null;
  const req = tokenRequest(
    provider,
    { clientId, clientSecret },
    { type: "refresh_token", refreshToken: current.refreshToken },
    callbackUrl(),
  );
  if (!req) return null;
  try {
    const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
    if (!res.ok) {
      console.warn("wearable-oauth refresh refused", provider, res.status);
      return null;
    }
    const fresh = parseTokenResponse(await res.json(), Date.now());
    // Some vendors rotate refresh tokens but omit them when unchanged is
    // meant to hold; keep the old one in that case rather than losing it.
    if (fresh && !fresh.refreshToken) fresh.refreshToken = current.refreshToken;
    return fresh;
  } catch {
    console.warn("wearable-oauth refresh unreachable", provider);
    return null;
  }
}

async function storeTokens(userId: string, provider: string, t: ParsedToken): Promise<void> {
  await admin().from("health_connection_tokens").upsert(
    {
      user_id: userId,
      provider,
      access_token: t.accessToken,
      refresh_token: t.refreshToken,
      expires_at: t.expiresAt ? new Date(t.expiresAt).toISOString() : null,
      scope: t.scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  );
}

interface StoredTokens extends ParsedToken {
  expiresAt: number | null;
}

async function loadTokens(userId: string, provider: string): Promise<StoredTokens | null> {
  const { data } = await admin()
    .from("health_connection_tokens")
    .select("access_token, refresh_token, expires_at, scope")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (!data) return null;
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string | null) ?? null,
    expiresAt: data.expires_at ? Date.parse(data.expires_at as string) : null,
    scope: (data.scope as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Import — one real fetch per importable provider
// ---------------------------------------------------------------------------

interface SyncNote {
  imported: number;
  note: string;
}

/** Newest end_time across imported rows — the next sync's lower bound. */
function nextCursor(rows: { end_time: string }[], prev: string | null): string | null {
  let newest = prev ? Date.parse(prev) : 0;
  for (const r of rows) {
    const t = Date.parse(r.end_time);
    if (t > newest) newest = t;
  }
  return newest > 0 ? new Date(newest).toISOString() : prev;
}

/**
 * One page of a provider's activity feed.
 *
 * `page` matters only for the vendors that paginate. Oura answers a whole date
 * range in one response, so anything past page 1 is an empty payload — which the
 * deep walk below reads as "no more", exactly as it reads a short page from the
 * paginating vendors. Returning empty rather than null keeps `null` meaning one
 * thing only: the request failed.
 */
async function fetchActivitiesPage(
  provider: string,
  accessToken: string,
  sinceMs: number,
  page: number,
  perPage: number,
): Promise<unknown | null> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  try {
    if (provider === "strava") {
      const url =
        `https://www.strava.com/api/v3/athlete/activities?after=${Math.floor(sinceMs / 1000)}` +
        `&per_page=${perPage}&page=${page}`;
      const res = await fetch(url, { headers: auth });
      if (!res.ok) {
        console.warn("wearable-oauth import refused", provider, res.status);
        return null;
      }
      return await res.json();
    }
    if (provider === "fitbit") {
      const offset = (page - 1) * perPage;
      const url =
        `https://api.fitbit.com/1/user/-/activities/list.json?afterDate=${iso(sinceMs)}` +
        `&sort=asc&offset=${offset}&limit=${perPage}`;
      const res = await fetch(url, { headers: auth });
      if (!res.ok) {
        console.warn("wearable-oauth import refused", provider, res.status);
        return null;
      }
      return await res.json();
    }
    if (provider === "oura") {
      if (page > 1) return { data: [] };
      const url =
        `https://api.ouraring.com/v2/usercollection/workout?start_date=${iso(sinceMs)}` +
        `&end_date=${iso(Date.now())}`;
      const res = await fetch(url, { headers: auth });
      if (!res.ok) {
        console.warn("wearable-oauth import refused", provider, res.status);
        return null;
      }
      return await res.json();
    }
    return null;
  } catch {
    console.warn("wearable-oauth import unreachable", provider);
    return null;
  }
}

/** The incremental sync's single page: unchanged behaviour, newest 50. */
function fetchActivities(
  provider: string,
  accessToken: string,
  lastCursor: string | null,
): Promise<unknown | null> {
  const since = lastCursor ? Date.parse(lastCursor) : Date.now() - INITIAL_WINDOW_MS;
  return fetchActivitiesPage(provider, accessToken, since, 1, 50);
}

/** Pages one deep history pull may read, and the page size it reads them at. */
const MAX_HISTORY_PAGES = 25;
const HISTORY_PAGE_SIZE = 200;

interface DeepResult {
  rows: WorkoutRow[];
  pages: number;
  /** True when the provider had more than this pull could carry. */
  capped: boolean;
}

/**
 * Walks a provider's history back to `sinceMs`, page by page.
 *
 * This is the difference between "connected" and "my history is here". The
 * incremental sync reads the newest 50 records past a cursor; an import has to
 * read months. Pages stop when a short page arrives, and the walk is bounded, so
 * a provider that ignores the page parameter cannot turn one tap into an
 * unbounded pull against a metered API.
 *
 * A failure on the FIRST page is a failure (null). A failure later keeps what
 * already arrived and reports `capped`, because half a history is worth more
 * than none and the athlete can run it again.
 */
async function fetchDeepHistory(
  provider: string,
  accessToken: string,
  sinceMs: number,
): Promise<DeepResult | null> {
  const mapper = ACTIVITY_MAPPERS[provider];
  if (!mapper) return null;

  const byId = new Map<string, WorkoutRow>();
  let pages = 0;
  let capped = false;

  for (let page = 1; page <= MAX_HISTORY_PAGES; page++) {
    const payload = await fetchActivitiesPage(provider, accessToken, sinceMs, page, HISTORY_PAGE_SIZE);
    if (payload === null) {
      if (page === 1) return null;
      capped = true;
      break;
    }
    pages = page;
    const mapped = mapper(payload);
    // Overlapping pages are a real provider behaviour; the id is the identity.
    for (const row of mapped) byId.set(row.source_record_id, row);
    if (mapped.length < HISTORY_PAGE_SIZE) break;
    if (page === MAX_HISTORY_PAGES) capped = true;
  }

  return { rows: [...byId.values()], pages, capped };
}

/**
 * One provider's sync. Honest in every branch: a provider without a mapper
 * says so; an expired token says so; a fetch failure says so. The only "ok"
 * path writes rows that a mapper produced and the schema will accept.
 */
async function syncProvider(
  userId: string,
  provider: string,
  lastCursor: string | null,
): Promise<SyncNote> {
  if (!IMPORTABLE_PROVIDERS.has(provider)) {
    return { imported: 0, note: "import_not_implemented" };
  }

  let tokens = await loadTokens(userId, provider);
  if (!tokens) return { imported: 0, note: "not_authorized" };

  const nearExpiry = tokens.expiresAt !== null && tokens.expiresAt < Date.now() + 60_000;
  if (nearExpiry) {
    if (!tokens.refreshToken) {
      await markTokenExpired(userId, provider);
      return { imported: 0, note: "token_expired" };
    }
    const fresh = await refreshTokens(provider, {
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
    });
    if (!fresh) {
      await markTokenExpired(userId, provider);
      return { imported: 0, note: "token_expired" };
    }
    await storeTokens(userId, provider, fresh);
    tokens = fresh;
  }

  const mapper = ACTIVITY_MAPPERS[provider];
  if (!mapper) return { imported: 0, note: "import_not_implemented" };

  const payload = await fetchActivities(provider, tokens.accessToken, lastCursor);
  if (payload === null) return { imported: 0, note: "fetch_failed" };

  const rows = mapper(payload);
  const db = admin();
  if (rows.length) {
    const records = rows.map((r) => ({
      user_id: userId,
      source: provider,
      deleted: false,
      ...r,
    }));
    const { error } = await db
      .from("health_workouts")
      .upsert(records, { onConflict: "user_id,source,source_record_id" });
    if (error) {
      console.warn("wearable-oauth import upload failed", provider);
      return { imported: 0, note: "upload_failed" };
    }
  }

  await db
    .from("health_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      last_cursor: nextCursor(rows, lastCursor),
      status: "connected",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", provider);

  return { imported: rows.length, note: "ok" };
}

async function markTokenExpired(userId: string, provider: string): Promise<void> {
  await admin()
    .from("health_connections")
    .update({ status: "token_expired", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", provider);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);

  // Vendor callback arrives as GET ?code=…&state=… — handle before auth
  // (the vendor redirects a browser here; there is no Supabase JWT in it).
  if (req.method === "GET" && (url.searchParams.has("code") || url.searchParams.has("state"))) {
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const vendorError = url.searchParams.get("error");

    // Single-use, cross-instance: consumes the row or resolves nothing.
    const entry = state ? await consumeState(state) : null;
    const provider = entry?.provider ?? url.searchParams.get("provider") ?? "unknown";

    let connected = false;
    let reason = !entry ? (vendorError ? "vendor_denied" : "state_unusable") : "exchange_failed";

    if (entry && code && !vendorError) {
      const redirect = providerEnv(entry.provider, "REDIRECT_URL") ?? callbackUrl();
      const tokens = await exchangeCode(entry.provider, code, redirect);
      if (tokens) {
        const db = admin();
        await storeTokens(entry.userId, entry.provider, tokens);
        // Connection row: state only. Tokens live in their own service-role
        // table — never here, because this table's RLS lets the athlete read
        // their own row back into the browser.
        await db.from("health_connections").upsert(
          {
            user_id: entry.userId,
            provider: entry.provider,
            status: "connected",
            connected: true,
            metadata: { linked_at: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,provider" },
        );
        connected = true;
        reason = "";
      }
    }

    // Redirect back to the app. Order matters, and each branch exists because
    // the previous default (`?? "/"`) fed `new URL("/")`, which has no base
    // and THROWS — every callback answered 500, on top of reading a
    // `VITE_PUBLIC_APP_URL` secret that was never set:
    //   1. WEARABLE_OAUTH_APP_URL — explicit operator override, used verbatim
    //      (they own the full path when they set it).
    //   2. Android user agent → the app's own scheme, so the return link lands
    //      INSIDE the app: the custom tab follows the Location through the
    //      manifest intent-filter, appUrlOpen fires, and parseDeepLink routes
    //      `?wearable=` to /profile.
    //   3. PUBLIC_APP_URL (the secret link-preview and waitlist-campaigns
    //      already use) + /profile, so web lands on the Health Connect row.
    // Whatever happens, the fallback is this request's own origin — a target
    // that is unusable must never crash the callback again.
    const isAndroidCallback = /Android/i.test(req.headers.get("user-agent") ?? "");
    const configured = env("WEARABLE_OAUTH_APP_URL");
    const deepLink = "com.vaylosports.app://auth-callback";
    const webBase = (env("PUBLIC_APP_URL") ?? env("VITE_PUBLIC_APP_URL") ?? "").replace(/\/+$/, "");
    const appTarget = configured ?? (isAndroidCallback ? deepLink : webBase ? `${webBase}/profile` : null);

    let redirect: URL;
    try {
      redirect = new URL(appTarget ?? url.origin);
    } catch {
      redirect = new URL(url.origin);
    }
    redirect.searchParams.set("wearable", provider);
    redirect.searchParams.set("connected", connected ? "1" : "0");
    redirect.searchParams.set("provider", provider);
    if (reason) redirect.searchParams.set("reason", reason);
    // A manual 302 rather than Response.redirect(): per spec (and Deno
    // enforces it) Response.redirect() only accepts http/https Location
    // values — the native return link is a custom scheme and would throw.
    return new Response(null, { status: 302, headers: { Location: redirect.toString() } });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let userId: string | null = null;
  try {
    userId = await authenticate(req);
  } catch { /* fall through to 401 */ }
  if (!userId) return json({ error: "Unauthorized" }, 401);
  if (throttled(userId)) return json({ error: "Too many requests" }, 429);

  const body = await readJsonBody(req);
  if (!body) return json({ error: "Invalid JSON" }, 400);

  const action = String(body.action ?? "").toLowerCase();
  const provider = String(body.provider ?? "").toLowerCase();

  if (action === "start") {
    if (!provider) return json({ error: "provider required" }, 400);
    const clientId = providerEnv(provider, "CLIENT_ID");
    const cfg = OAUTH_PROVIDERS[provider];
    if (!cfg || !clientId) {
      return json({
        error: "not_configured",
        message: "This wearable is not yet configured for direct OAuth. On Android, connect it through Health Connect on the Health screen — most watches sync that way without any extra link.",
      }, 200);
    }
    const state = randomState();
    const redirect = providerEnv(provider, "REDIRECT_URL") ?? callbackUrl();
    const authorizeUrl = buildAuthUrl(provider, clientId, redirect, state);
    if (!authorizeUrl) return json({ error: "not_configured" }, 200);
    // No URL without a durable state: a state that exists only in this
    // instance's memory is the bug this function just fixed.
    if (!(await persistState(state, userId, provider))) {
      return json({ error: "state_store_unavailable" }, 503);
    }
    return json({ url: authorizeUrl, state }, 200);
  }

  if (action === "status") {
    if (!provider) return json({ error: "provider required" }, 400);
    const { data } = await admin()
      .from("health_connections")
      .select("connected, last_sync_at, status")
      .eq("user_id", userId)
      .eq("provider", provider)
      .maybeSingle();
    return json({
      connected: !!data?.connected,
      last_sync_at: data?.last_sync_at ?? null,
      status: data?.status ?? (data?.connected ? "connected" : "not_connected"),
    }, 200);
  }

  if (action === "disconnect") {
    if (!provider) return json({ error: "provider required" }, 400);
    const db = admin();
    // Validate against the constraint list, not just any string.
    const { data: conn } = await db
      .from("health_connections")
      .select("provider")
      .eq("user_id", userId)
      .eq("provider", provider)
      .maybeSingle();
    if (!conn) {
      // Idempotent: disconnecting an unlinked provider is still a success.
      return json({ ok: true, note: "was_not_connected" }, 200);
    }
    // Connection row first (it is the authority /sync reads), then the tokens:
    // a disconnected provider must stop being refreshable. Imported data is
    // NOT auto-deleted — that is the separate, explicit "delete imported data"
    // control on the Health screen.
    await db.from("health_connections").delete().eq("user_id", userId).eq("provider", provider);
    await db.from("health_connection_tokens").delete().eq("user_id", userId).eq("provider", provider);
    return json({ ok: true }, 200);
  }

  if (action === "history") {
    const target = String(body.provider ?? provider).toLowerCase();
    if (!target) return json({ error: "provider required" }, 400);
    if (!IMPORTABLE_PROVIDERS.has(target)) {
      return json({ ok: false, error: "import_not_implemented", provider: target }, 200);
    }
    const clientId = providerEnv(target, "CLIENT_ID");
    if (!OAUTH_PROVIDERS[target] || !clientId) {
      // Not a failure to hide: the athlete is told the source is not switched on
      // yet, and pointed at Health Connect in the meantime.
      return json({ ok: false, error: "not_configured", provider: target }, 200);
    }

    let tokens = await loadTokens(userId, target);
    if (!tokens) return json({ ok: false, error: "not_connected", provider: target }, 200);

    const nearExpiry = tokens.expiresAt !== null && tokens.expiresAt < Date.now() + 60_000;
    if (nearExpiry) {
      if (!tokens.refreshToken) {
        await markTokenExpired(userId, target);
        return json({ ok: false, error: "token_expired", provider: target }, 200);
      }
      const fresh = await refreshTokens(target, {
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
      });
      if (!fresh) {
        await markTokenExpired(userId, target);
        return json({ ok: false, error: "token_expired", provider: target }, 200);
      }
      await storeTokens(userId, target, fresh);
      tokens = fresh;
    }

    // The client computes the window in the athlete's own calendar and sends the
    // instant it resolved to; `months` is only a fallback for a caller that has
    // no opinion. Either way the lower bound is explicit.
    const sinceParam = typeof body.since === "string" ? Date.parse(body.since) : Number.NaN;
    const months = Number(body.months);
    const sinceMs = Number.isFinite(sinceParam)
      ? sinceParam
      : Number.isFinite(months) && months > 0
        ? Date.now() - months * 30 * 24 * 60 * 60 * 1000
        : Date.now() - INITIAL_WINDOW_MS;

    const deep = await fetchDeepHistory(target, tokens.accessToken, sinceMs);
    if (!deep) {
      console.warn("wearable-oauth history fetch failed", target);
      return json({ ok: false, error: "fetch_failed", provider: target }, 200);
    }

    const db = admin();
    if (deep.rows.length) {
      const records = deep.rows.map((r) => ({
        user_id: userId,
        source: target,
        deleted: false,
        ...r,
      }));
      for (let i = 0; i < records.length; i += 100) {
        const { error } = await db
          .from("health_workouts")
          .upsert(records.slice(i, i + 100), { onConflict: "user_id,source,source_record_id" });
        if (error) {
          console.warn("wearable-oauth history upload failed", target);
          return json({ ok: false, error: "upload_failed", provider: target }, 200);
        }
      }
    }

    await db
      .from("health_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_cursor: nextCursor(deep.rows, null),
        status: "connected",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("provider", target);

    return json(
      {
        ok: true,
        provider: target,
        imported: deep.rows.length,
        pages: deep.pages,
        capped: deep.capped,
        since: new Date(sinceMs).toISOString(),
        note: null,
      },
      200,
    );
  }

  if (action === "sync") {
    const db = admin();
    const target = provider || null;
    const query = db
      .from("health_connections")
      .select("provider, last_cursor")
      .eq("user_id", userId)
      .eq("connected", true);
    const { data: rows } = target ? await query.eq("provider", target) : await query;
    const targets = (rows ?? []).filter((r) => r.provider !== "health_connect");
    if (targets.length === 0) {
      return json({ ok: true, workouts: 0, samples: 0, note: "no_connected_providers" }, 200);
    }
    const providers: Record<string, SyncNote> = {};
    let total = 0;
    for (const t of targets) {
      const note = await syncProvider(userId, t.provider, (t.last_cursor as string | null) ?? null);
      providers[t.provider] = note;
      total += note.imported;
    }
    return json({ ok: true, workouts: total, samples: 0, providers }, 200);
  }

  return json({ error: "Unknown action" }, 400);
});
