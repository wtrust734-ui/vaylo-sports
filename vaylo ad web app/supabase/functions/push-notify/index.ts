// ============================================================================
// push-notify — the server half of push delivery
// ----------------------------------------------------------------------------
// The client half (src/lib/push.ts) registers a device token. Nothing is
// delivered until something sends. This is that something.
//
// It is NOT callable by the app to notify itself of anything: the only
// permission gate is "authenticated", and a caller may only ever target
// THEMSELVES. Anything outward-facing (challenge deadline, friend activity,
// streak about to break) belongs in a scheduled server-side job that calls this
// with the service role, not in a request a phone can make.
//
// FCM HTTP v1 rather than the legacy server key: the legacy key is retired,
// and v1 authenticates with a short-lived OAuth2 token minted from a service
// account held in function secrets.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** FCM caps a multicast at 500 registration tokens per request. */
const FCM_BATCH = 500;
/** Body cap, same reason the other functions use readJsonBody: a request body is not a place to accept an essay. */
const MAX_BODY_BYTES = 4_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Which preference column governs which notification type.
 *
 * A type with no column here is not sendable. Adding a type means adding a
 * toggle for it, because "we added streak pings" with no switch is exactly how
 * an app starts getting uninstalled.
 */
const PREF_FOR_TYPE: Record<string, string> = {
  friend_activity: "friend_activity",
  challenge_deadline: "challenge_deadlines",
  challenge_deadlines: "challenge_deadlines",
  streak: "streak_alerts",
  streak_alert: "streak_alerts",
  reengagement: "reengagement",
  workout_reminder: "workout_reminders",
};

/** Base64url without padding, for the OAuth2 JWT. */
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  let bin = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RSASSA-PKCS1-v1_5 SHA-256, the only algorithm FCM accepts. */
async function sign(input: string, privateKeyPem: string): Promise<string> {
  const pem = privateKeyPem.replace(/\\n/g, "\n");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [A-Z ]+-----/g, "").replace(/-----END [A-Z ]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Minted once per cold start and reused; it is valid for an hour. */
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const clientEmail = Deno.env.get("FCM_CLIENT_EMAIL");
  // The service-account key. Never in the client bundle, never in the app.
  const privateKey = Deno.env.get("FCM_PRIVATE_KEY");
  const tokenUri = Deno.env.get("FCM_TOKEN_URI") ?? "https://oauth2.googleapis.com/token";
  if (!clientEmail || !privateKey) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: clientEmail,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const assertion = `${header}.${claims}.${await sign(`${header}.${claims}`, privateKey)}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json?.access_token) return null;
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** Strips anything that is not a plausible FCM registration token. */
const looksLikeToken = (t: unknown): t is string =>
  typeof t === "string" && t.length > 20 && /^[A-Za-z0-9_:.-]+$/.test(t);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();

    // The caller's own client, for identity only.
    const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user } } = await anon.auth.getUser(token);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const isServiceRole = authHeader.includes(serviceKey);

    const raw = (await req.text()).slice(0, MAX_BODY_BYTES);
    let body: { type?: string; title?: string; body?: string; data?: Record<string, string>; user_ids?: string[] };
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const type = body.type ?? "";
    const title = (body.title ?? "").trim();
    const text = (body.body ?? "").trim();
    if (!title || !text) return json({ error: "title and body are required" }, 400);
    if (title.length > 120 || text.length > 400) return json({ error: "Message too long" }, 400);

    const prefColumn = PREF_FOR_TYPE[type];
    if (!prefColumn) return json({ error: `unknown notification type "${type}"` }, 400);

    // Recipients. A signed-in caller may only reach themselves — otherwise any
    // athlete could spam any other athlete from their own phone.
    let targets: string[];
    if (isServiceRole && Array.isArray(body.user_ids) && body.user_ids.length > 0) {
      targets = body.user_ids.filter((id): id is string => typeof id === "string" && UUID_RE.test(id));
      if (targets.length > 5_000) return json({ error: "Too many recipients" }, 400);
    } else {
      targets = [user.id];
    }

    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Honour the preference. Absence of a row means "default on" (the columns
    // all default true), which is what the existing prefs screen assumes.
    //
    // The column list is written out in full rather than interpolated from
    // `prefColumn`: supabase-js types .select() as a template literal, and
    // building the string dynamically makes the whole row untyped (and, on
    // strict builds, an outright error). One explicit list, one typed read.
    const { data: prefs } = await sb
      .from("notification_prefs")
      .select(
        "user_id, workout_reminders, friend_activity, streak_alerts, challenge_deadlines, reengagement, quiet_start, quiet_end",
      )
      .in("user_id", targets);
    const allowed = new Map<string, { on: boolean; quietStart: string | null; quietEnd: string | null }>();
    for (const id of targets) {
      const row = prefs?.find((p) => p.user_id === id);
      const columnValue = row
        ? (row as unknown as Record<string, unknown>)[prefColumn]
        : undefined;
      allowed.set(id, {
        // No row at all is "on": notification_prefs is only created the first
        // time an athlete touches a toggle, so demanding a row would silence
        // every push for everyone who never opened the screen.
        on: columnValue === undefined ? true : columnValue !== false,
        quietStart: row?.quiet_start ?? null,
        quietEnd: row?.quiet_end ?? null,
      });
    }

    const optedIn = targets.filter((id) => allowed.get(id)?.on);
    if (optedIn.length === 0) {
      return json({ sent: 0, skipped: targets.length, reason: "preference" });
    }

    const quietNow = optedIn.filter((id) => inQuietHours(allowed.get(id)!));
    const toSend = optedIn.filter((id) => !inQuietHours(allowed.get(id)!));

    const { data: registrations } = await sb
      .from("push_tokens")
      .select("id, token, user_id")
      .in("user_id", toSend);
    const live = (registrations ?? []).filter((r) => looksLikeToken(r.token));
    if (live.length === 0) {
      return json({ sent: 0, skipped: toSend.length, reason: "no registration" });
    }

    const access = await accessToken();
    if (!access) {
      // Not "failed" as far as the athlete is concerned — but the caller needs
      // to know the difference between "nobody is registered" and "this
      // deployment cannot send", which is a configuration problem.
      return json({ error: "FCM not configured on this deployment" }, 503);
    }

    const projectId = Deno.env.get("FCM_PROJECT_ID");
    if (!projectId) return json({ error: "FCM_PROJECT_ID missing" }, 503);

    let sent = 0;
    const expired: string[] = [];
    for (let i = 0; i < live.length; i += FCM_BATCH) {
      const batch = live.slice(i, i + FCM_BATCH);
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            // Data-only: the notification is built natively in
            // VayloMessagingService so it appears even when the app is closed,
            // and so the channel routing in src/lib/push.ts applies.
            data: { title, body, type, ...(body.data ?? {}) },
            tokens: batch.map((r) => r.token),
          },
        }),
      });

      if (res.ok) {
        sent += batch.length;
        continue;
      }

      const detail = await res.text();
      // SENT per-token results arrive inside a 200 response body; a request-level
      // failure applies to the whole batch.
      if (res.status === 404 || res.status === 400) {
        for (const r of batch) expired.push(r.id);
      } else {
        console.error("fcm batch failed", res.status, detail.slice(0, 300));
      }
    }

    // FCM keeps accepting a token for a while after an app is uninstalled, and
    // the send "succeeds" while nothing arrives. Dropping the rows here is the
    // only way the table stays honest over time.
    if (expired.length > 0) {
      await sb.from("push_tokens").delete().in("id", expired);
    }

    // The in-app record, so the notification also exists for someone who opens
    // the app later.
    await sb.from("notifications").insert(
      toSend.map((user_id) => ({
        user_id,
        type,
        title,
        body: text,
        link: typeof body.data?.link === "string" ? body.data.link : null,
      })),
    );

    return json({ sent, quiet: quietNow.length, skipped: targets.length - toSend.length, expired: expired.length });
  } catch (e) {
    console.error("push-notify failed", e instanceof Error ? e.message : "unknown");
    return json({ error: "Failed to send" }, 500);
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Quiet hours are the athlete's own, in their own local time as stored.
 *
 * Wrap-around is the point: a 22:00-07:00 window spans midnight, and the naive
 * comparison silently treats it as empty, which is how a "do not disturb me"
 * setting ends up being ignored every single night.
 */
function inQuietHours(prefs: { quietStart: string | null; quietEnd: string | null }): boolean {
  const { quietStart, quietEnd } = prefs;
  if (!quietStart || !quietEnd) return false;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parse = (v: string): number | null => {
    const m = v.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };
  const start = parse(quietStart);
  const end = parse(quietEnd);
  if (start === null || end === null) return false;
  if (start === end) return false; // an empty window, not an always-on one
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}