// ============================================================================
// DEEP LINKS — one dispatcher for the Capacitor shell
// ----------------------------------------------------------------------------
// In the native shell a URL can arrive three ways:
//   • warm start: the App plugin fires appUrlOpen while the app is running
//   • cold start: Android launched the app via an intent (a notification, a
//     link tapped from a browser, an OAuth return) — appUrlOpen only fires
//     if we ask for the launching intent explicitly
//   • a re-tap while the app is already on the target screen
//
// Before this module only the interactive OAuth flow listened for links, so a
// cold-start callback was dropped (the app opened signed-out with no error)
// and non-OAuth links — password recovery, share links, challenges — were
// ignored entirely.
//
// Security posture: a deep link is a *navigation hint*, never a credential.
// Nothing here grants access to another user's data; routes that show private
// data are still gated by AppLayout (session + onboarding) and every table's
// RLS. IDs are validated structurally; a link that carries a foreign user id
// reaches at most that user's already-public profile page — exactly what
// typing the URL on the web would do.
// ============================================================================

import { isNativeShell, loadPlugin } from "@/lib/platform";
import { completeNativeRecoveryFragment, completeOrphanOAuthCallback, isOAuthAwaiting } from "@/lib/nativeOAuth";

/** Only the app's own custom scheme, matching the manifest intent-filter. */
const APP_SCHEME = "com.vaylosports.app";

/** Hosts/paths we understand on the custom scheme. Anything else is ignored. */
const KNOWN_PATHS = ["auth-callback", "auth", "reset-password", "c", "profile", "packs", "event-packs"] as const;

export interface ParsedDeepLink {
  /** Router path to navigate to, or null when the link is not actionable. */
  path: string | null;
  /** True for the OAuth/PKCE callback, which Auth's own listener consumes. */
  isAuthCallback: boolean;
  /** True when the link restores a session (recovery / magic link / OAuth). */
  isSessionRestore?: boolean;
}

/** Android Studio's uuid-parser is stricter than `new URL().pathname`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Structural validation for a deep-link payload: an id-shaped string only.
 * A malformed or hostile value (path traversal, script, oversized blob)
 * yields null and the link is dropped — not sanitized, dropped.
 */
export function deepLinkId(value: string | null): string | null {
  if (!value) return null;
  const id = value.split("/")[0].trim();
  return UUID_RE.test(id) ? id : null;
}

/**
 * Validates and maps a deep link to an internal router path.
 *
 * `hash` links (Supabase sends `#access_token=…`, `#error=…`,
 * `#error_description=…`) are carried onto /auth so the existing session /
 * recovery / error handling there sees them unchanged. Unknown paths and
 * invalid ids return `path: null` — ignored, never fatal.
 */
export function parseDeepLink(rawUrl: string): ParsedDeepLink {
  const fallback: ParsedDeepLink = { path: null, isAuthCallback: false };
  if (typeof rawUrl !== "string" || rawUrl.length > 2048) return fallback;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fallback;
  }

  // The custom scheme comes through as host ("com.vaylosports.app://c/<id>"
  // parses with host = scheme's authority). https links to the public site
  // are also accepted so universal links behave identically.
  const isAppScheme = url.protocol === `${APP_SCHEME}:`;
  const isHttps = url.protocol === "https:";
  if (!isAppScheme && !isHttps) return fallback;

  // Wearable OAuth return (vendor → edge function → app): the payload is in
  // the QUERY (`com.vaylosports.app://auth-callback?wearable=garmin&connected=1`),
  // not the hash. It has to be read before the path table below, because the
  // link's host is `auth-callback` — without this branch the athlete would be
  // dropped on /auth having just approved a connection, and the app would
  // report nothing at all. Values are shape-validated like every other deep
  // link; unknown or malformed params are dropped rather than forwarded.
  const wearable = url.searchParams.get("wearable") ?? url.searchParams.get("provider");
  if (wearable) {
    if (!/^[a-z0-9_]{1,32}$/.test(wearable)) return fallback;
    const params = new URLSearchParams({ wearable });
    for (const key of ["provider", "connected", "status", "reason"]) {
      const value = url.searchParams.get(key);
      if (value && /^[a-z0-9_:]{0,64}$/.test(value)) params.set(key, value);
    }
    return { path: `/health-sync?${params.toString()}`, isAuthCallback: false };
  }

  const hash = url.hash.replace(/^#/, "");
  // Any Supabase auth payload — tokens, recovery links, errors — routes to
  // /auth, which already handles each case (session restore, PASSWORD_RECOVERY,
  // user-facing error). The OAuth callback is additionally consumed by
  // completeNativeOAuth via its own one-shot listener.
  if (/(access_token|refresh_token|code=|error=|error_description=)/i.test(hash)) {
    return { path: "/auth", isAuthCallback: hash.includes("code="), isSessionRestore: true };
  }

  // WHATWG URL parsing puts the first segment of a custom-scheme URL —
  // "scheme://c/<id>" — in the HOST position (the scheme's authority), not the
  // pathname. https links keep the whole route in the pathname as usual. The
  // duplicated-host shape ("scheme://scheme/c/<id>", which some link builders
  // emit) is accepted too.
  const segments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  let head: string;
  let rest: string[];
  if (isAppScheme) {
    if (url.hostname.toLowerCase() === APP_SCHEME) {
      head = segments[0] ?? "";
      rest = segments.slice(1);
    } else {
      head = url.hostname.toLowerCase();
      rest = segments;
    }
  } else {
    head = segments[0] ?? "";
    rest = segments.slice(1);
  }

  if (!KNOWN_PATHS.includes(head as (typeof KNOWN_PATHS)[number])) return fallback;

  switch (head) {
    case "auth-callback":
      // Without a PKCE code there is nothing to exchange; Auth will show the
      // normal sign-in screen.
      return { path: "/auth", isAuthCallback: false };
    case "auth":
    case "reset-password":
      return { path: "/auth", isAuthCallback: false };
    case "c": {
      const id = deepLinkId(rest[0] ?? null);
      return { path: id ? `/c/${id}` : null, isAuthCallback: false };
    }
    case "profile": {
      // Public profiles are keyed by username, not uuid — validate shape only.
      const username = (rest[0] ?? "").split("/")[0];
      if (!username || username.length > 39 || !/^[A-Za-z0-9_.-]+$/.test(username)) {
        return fallback;
      }
      return { path: `/profile/${username}`, isAuthCallback: false };
    }
    case "packs": {
      const id = deepLinkId(rest[0] ?? null);
      return { path: id ? `/packs/${id}` : null, isAuthCallback: false };
    }
    case "event-packs":
      return { path: "/event-packs", isAuthCallback: false };
    default:
      return fallback;
  }
}

/**
 * Installs the app-wide listener (native shell only). Returns the cleanup
 * function, or null on the web where the OS never delivers links this way.
 *
 * Public, shareable links navigate directly — signed-out athletes see the
 * public surface (e.g. ChallengeInvite) and are offered sign-up there. Links
 * that resolve to authenticated screens simply land on /auth via AppLayout.
 */
export async function installDeepLinkHandler(onLink: (parsed: ParsedDeepLink, rawUrl: string) => void): Promise<(() => void) | null> {
  if (!isNativeShell()) return null;

  const App = await loadPlugin<{
    addListener: (
      event: "appUrlOpen",
      cb: (data: { url: string }) => void,
    ) => Promise<{ remove: () => void }>;
    getLaunchUrl?: () => Promise<{ url?: string }>;
  }>("app");
  if (!App?.addListener) return null;

  const handle = async (rawUrl: string | undefined) => {
    if (!rawUrl) return;
    const parsed = parseDeepLink(rawUrl);
    if (parsed.isAuthCallback) {
      // While an interactive OAuth flow is waiting, its one-shot listener in
      // nativeOAuth.ts owns the callback. With NO flow waiting this is an
      // orphan — the app was killed mid-sign-in — so complete the exchange
      // here (PKCE makes a code without the local verifier worthless, so this
      // is safe) and route into the app on success.
      if (isOAuthAwaiting()) return;
      const restored = await completeOrphanOAuthCallback(rawUrl);
      if (restored) onLink({ path: "/", isAuthCallback: false, isSessionRestore: true }, rawUrl);
      return;
    }
    // Recovery / magic-link fragments can't rely on the WebView's location
    // change, so restore the session before routing. Recovery links land on
    // /auth, whose PASSWORD_RECOVERY listener shows the set-new-password form.
    if (parsed.isSessionRestore) {
      const result = await completeNativeRecoveryFragment(rawUrl);
      if (result.error) {
        onLink({ path: "/auth", isAuthCallback: false }, rawUrl);
        return;
      }
    }
    onLink(parsed, rawUrl);
  };

  const subscription = await App.addListener("appUrlOpen", ({ url }: { url: string }) => {
    void handle(url);
  });

  // Cold start: if the app was launched BY a deep link the listener above
  // never saw it — ask for the launch intent once.
  try {
    const launch = await App.getLaunchUrl?.();
    void handle(launch?.url);
  } catch {
    /* no launch URL — plain app-icon start */
  }

  return () => {
    void subscription?.remove?.();
  };
}
