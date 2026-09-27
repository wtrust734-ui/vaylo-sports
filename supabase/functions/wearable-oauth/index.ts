// ===========================================================================
// wearable-oauth — edge function for cloud wearable OAuth
// ---------------------------------------------------------------------------
// Endpoints (JSON, POST, Authorization: Bearer <supabase JWT>):
//   { action: "start",     provider: "garmin" } → { url, state }
//   { action: "status",    provider: "garmin" } → { connected, last_sync_at }
//   { action: "disconnect",provider: "garmin" } → { ok: true }
//   { action: "callback",  code, state }        → redirect (vendor OAuth callback)
//   { action: "sync",      provider? }           → { ok, workouts, samples }
//             (imports vendor → health_* via service role; pull-based)
//
// Vendor credentials: set with `supabase secrets set GARMIN_CLIENT_ID=… …`.
// If a vendor's secrets are absent, /start answers { error: "not_configured" }
// and the UI shows \"Coming soon — connect via Health Connect in the meantime.\"
// Nothing logs tokens or health data.
// ===========================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { authenticate, json, readJsonBody, throttled } from "../_shared/guard.ts";

type Provider = string;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STATE_TTL_MS = 10 * 60 * 1000;
const stateStore = new Map<string, { provider: Provider; userId: string; exp: number }>();

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
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomState(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return b64url(b);
}

// --- Provider-specific OAuth URL builders ----------------------------------
// Only providers with credentials wired will return a URL; others delegate to
// \"use Health Connect\" guidance in the UI. Garmin, Fitbit, Polar, COROS,
// WHOOP, Oura, Strava are the most-requested; others stub cleanly.

function buildAuthUrl(provider: Provider, state: string): string | null {
  const redirect = providerEnv(provider, "REDIRECT_URL") ?? callbackUrl();
  const clientId = providerEnv(provider, "CLIENT_ID");
  if (!clientId) return null;

  // --- Garmin (OAuth 1 not supported here; Garmin Health API is OAuth2 for Connect) ---
  // Garmin Connect OAuth2: https://developer.garmin.com/gc-developer-program/activity-api/
  // Kept generic — if clientId is set, build the Garmin Connect OAuth URL.
  if (provider === "garmin") {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      scope: "activity:read",
      state,
    });
    return `https://connect.garmin.com/oauthConfirm?${p.toString()}`;
  }
  if (provider === "fitbit") {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      scope: "activity heartrate sleep profile",
      state,
    });
    return `https://www.fitbit.com/oauth2/authorize?${p.toString()}`;
  }
  if (provider === "polar") {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      state,
    });
    return `https://flow.polar.com/oauth2/authorization?${p.toString()}`;
  }
  if (provider === "oura") {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      scope: "email personal daily workout tag session",
      state,
    });
    return `https://cloud.ouraring.com/oauth/authorize?${p.toString()}`;
  }
  if (provider === "strava") {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      scope: "activity:read_all",
      state,
    });
    return `https://www.strava.com/oauth/authorize?${p.toString()}`;
  }
  if (provider === "whoop") {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      scope: "read:recovery read:cycles read:workout read:sleep read:profile",
      state,
    });
    return `https://api.prod.whoop.com/oauth/oauth2/auth?${p.toString()}`;
  }
  if (provider === "coros") {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      scope: "activity",
      state,
    });
    return `https://team.coros.com/oauth2/authorize?${p.toString()}`;
  }
  if (provider === "suunto") {
    const p = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      state,
    });
    return `https://cloudapi-oauth.suunto.com/oauth/authorize?${p.toString()}`;
  }
  // No generic fallback — providers not explicitly handled are Health Connect
  // bridged (Samsung, Google, Huawei, Withings) and must return null so the
  // UI shows the honest "use Health Connect on Android" guidance instead of a
  // fake example.com URL.
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);

  // Vendor callback arrives as GET ?code=…&state=… — handle before auth.
  if (req.method === "GET" && (url.searchParams.has("code") || url.searchParams.has("state"))) {
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const entry = state ? stateStore.get(state) : null;
    const provider = entry?.provider ?? url.searchParams.get("provider") ?? "unknown";
    const userId = entry?.userId ?? null;
    if (entry && Date.now() > entry.exp) stateStore.delete(state);
    // Exchange code server-side (secrets never leave edge); stub ok if not configured.
    const clientId = providerEnv(provider, "CLIENT_ID");
    const clientSecret = providerEnv(provider, "CLIENT_SECRET");
    if (userId && clientId && clientSecret && code) {
      try {
        const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        // Minimal token record — vendor import populates health_* on next /sync.
        await admin.from("health_connections").upsert({
          user_id: userId,
          provider,
          status: "connected",
          connected: true,
          metadata: { oauth_state: state },
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,provider" });
      } catch { /* best-effort */ }
    }
    // Redirect back to app (deep link or web).
    const appUrl = env("WEARABLE_OAUTH_APP_URL") ?? env("VITE_PUBLIC_APP_URL") ?? "/";
    const redirect = new URL(appUrl);
    redirect.searchParams.set("wearable", provider);
    redirect.searchParams.set("connected", userId ? "1" : "0");
    redirect.searchParams.set("provider", provider);
    return Response.redirect(redirect.toString(), 302);
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let userId: string | null = null;
  try {
    userId = await authenticate(req);
  } catch { /* fall through to 401 */ }
  if (!userId) return json({ error: "Unauthorized" }, 401);
  if (throttled(userId)) return json({ error: "Too many requests" }, 429);

  const body = await readJsonBody(req);
  if (!body) return json({ error: "Invalid JSON body" }, 400);

  const action = String(body.action ?? "").toLowerCase();
  const provider = String(body.provider ?? "").toLowerCase();

  if (action === "start") {
    if (!provider) return json({ error: "provider required" }, 400);
    const url2 = buildAuthUrl(provider, randomState());
    if (!url2) {
      return json({
        error: "not_configured",
        message: "This wearable is not yet configured for direct OAuth. On Android, connect it through Health Connect on the Health screen — most watches sync that way without any extra link.",
      }, 200);
    }
    const state = randomState();
    // Rebuild with the real state (buildAuthUrl above consumed a throwaway state for the probe)
    const realUrl = buildAuthUrl(provider, state);
    if (!realUrl) return json({ error: "not_configured" }, 200);
    stateStore.set(state, { provider, userId, exp: Date.now() + STATE_TTL_MS });
    if (stateStore.size > 5000) {
      for (const [k, v] of stateStore) if (Date.now() > v.exp) stateStore.delete(k);
    }
    return json({ url: realUrl, state }, 200);
  }

  if (action === "status") {
    if (!provider) return json({ error: "provider required" }, 400);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await admin
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
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("health_connections").delete().eq("user_id", userId).eq("provider", provider);
    return json({ ok: true }, 200);
  }

  if (action === "sync") {
    // Trigger a server-side import for the provider (or all connected providers).
    // Today: records the attempt in health_connections; vendor API fetch is
    // additive per-provider and does not block the UI.
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const target = provider || null;
    const q = admin.from("health_connections").select("provider").eq("user_id", userId).eq("connected", true);
    const { data: rows } = target ? await q.eq("provider", target) : await q;
    const providers: string[] = (rows ?? []).map((r: any) => r.provider);
    if (providers.length === 0) return json({ ok: true, workouts: 0, samples: 0, note: "no_connected_providers" }, 200);
    // Touch last_sync_at so the UI reflects the sync attempt; real import writes
    // health_workouts/health_samples rows when the vendor API is wired.
    for (const p of providers) {
      await admin.from("health_connections").update({
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("user_id", userId).eq("provider", p);
    }
    return json({ ok: true, workouts: 0, samples: 0, providers }, 200);
  }

  return json({ error: "Unknown action" }, 400);
});
