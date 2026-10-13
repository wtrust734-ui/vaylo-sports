// ===========================================================================
// VAYLO HEALTH — cloud wearable OAuth (generic)
// ---------------------------------------------------------------------------
// Cloud providers (Garmin, Fitbit, Polar, COROS, WHOOP, Oura, Strava, …)
// authenticate via an edge function that holds the client secrets server-side.
// Tokens never touch the browser's localStorage and never leave the edge
// function's Vault-backed storage.
//
// Flow:
//   1. App calls oauthStart(provider) → { url } (edge mints a state + PKCE).
//   2. App opens url in system browser / in-app browser (via platform.openExternal).
//   3. Vendor redirects to supabase edge callback → edge exchanges code for
//      tokens → writes health_connections row → redirects back to app deep link.
//   4. App refresh hook picks up the new row.
//
// Nothing here logs tokens or health data.
// ===========================================================================

import { supabase } from "@/integrations/supabase/client";
import type { WearableProviderId } from "./providers";

const CLOUD_FN = "wearable-oauth";

export interface OAuthStartResult {
  url: string;
  state: string;
}

export async function oauthStart(
  provider: WearableProviderId
): Promise<OAuthStartResult> {
  const { data, error } = await supabase.functions.invoke(CLOUD_FN, {
    body: { action: "start", provider },
  });
  if (error) throw new Error(error.message);
  if (!data?.url) throw new Error(data?.error ?? "oauth_unavailable");
  return data as OAuthStartResult;
}

export async function oauthDisconnect(provider: WearableProviderId): Promise<void> {
  const { error } = await supabase.functions.invoke(CLOUD_FN, {
    body: { action: "disconnect", provider },
  });
  if (error) throw new Error(error.message);
}

export async function oauthStatus(
  provider: WearableProviderId
): Promise<{ connected: boolean; last_sync_at: string | null }> {
  const { data, error } = await supabase.functions.invoke(CLOUD_FN, {
    body: { action: "status", provider },
  });
  if (error) return { connected: false, last_sync_at: null };
  return data ?? { connected: false, last_sync_at: null };
}

/**
 * Where the edge callback's payload can live, depending on the shell:
 *   web   — the real query:   /profile?wearable=garmin&connected=1
 *   native — HashRouter keeps the query INSIDE the fragment:
 *           http://localhost/index.html#/profile?wearable=garmin&connected=1
 * URL.searchParams only sees the first shape, so on Android the second one has
 * to be read out of the hash — otherwise the connection succeeds server-side
 * and the page stays silent.
 */
function redirectParams(url: string): URLSearchParams {
  const u = new URL(url, window.location.origin);
  if (u.searchParams.get("wearable") || u.searchParams.get("provider")) return u.searchParams;
  const hash = u.hash.replace(/^#/, "");
  const queryAt = hash.indexOf("?");
  return queryAt >= 0 ? new URLSearchParams(hash.slice(queryAt + 1)) : u.searchParams;
}

/**
 * Parses a deep-link or redirect URL that carries `?wearable=garmin&connected=1`
 * (set by the edge callback) so the Profile screen can toast and refresh
 * without polling. Reads both locations (see redirectParams).
 */
export function parseWearableRedirect(url: string): {
  provider: WearableProviderId | null;
  connected: boolean;
} {
  try {
    const params = redirectParams(url);
    const p = (params.get("wearable") ?? params.get("provider") ?? "") as WearableProviderId;
    const ok = params.get("connected") === "1" || params.get("status") === "connected";
    return { provider: p || null, connected: ok };
  } catch {
    return { provider: null, connected: false };
  }
}

/**
 * Removes the callback params after they have been handled, in either shape
 * (real query or inside the hash), so a refresh does not re-toast a
 * connection that was already announced.
 */
export function stripWearableRedirect(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    const clean = (params: URLSearchParams) => {
      for (const key of ["wearable", "provider", "connected", "status", "reason"]) {
        params.delete(key);
      }
      return params;
    };
    if (u.searchParams.get("wearable") || u.searchParams.get("provider")) {
      u.search = clean(u.searchParams).toString();
    } else {
      const hash = u.hash.replace(/^#/, "");
      const queryAt = hash.indexOf("?");
      if (queryAt >= 0) {
        const qs = clean(new URLSearchParams(hash.slice(queryAt + 1))).toString();
        u.hash = `#${hash.slice(0, queryAt)}${qs ? `?${qs}` : ""}`;
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}
