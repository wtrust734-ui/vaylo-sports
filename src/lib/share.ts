// ============================================================================
// SHARING, PUBLIC LINKS AND AUTH REDIRECTS
// ----------------------------------------------------------------------------
// Two mobile problems this solves:
//
//  1. `window.location.origin` inside a Capacitor shell is `capacitor://localhost`
//     (iOS) or `http://localhost` (Android) — neither is an honest public link.
//     Native shares stay linkless until an owned canonical domain is configured;
//     web links require that explicit origin. Preview hosts are rejected.
//  2. `navigator.share` does not exist in Android's WebView, so invite/milestone
//     buttons silently did nothing on native. Here the native Share plugin is
//     used when present, then the Web Share API, then clipboard, and the caller
//     is told which one happened so it can show the right confirmation.
//
// Safe on the web today: native and preview hosts never become public URLs;
// owned web links are shared only when an explicit canonical origin is set.
// ============================================================================

import { isNativeShell, loadPlugin } from "@/lib/platform";
import { appHref } from "@/lib/routerBase";
import { readFailed } from "@/lib/dbRead";
import { supabase } from "@/integrations/supabase/client";

export type ShareResult = "shared" | "copied" | "unsupported";

interface SharePlugin {
  share: (options: {
    title?: string;
    text?: string;
    url?: string;
    dialogTitle?: string;
  }) => Promise<unknown>;
}

/** Owned public site, e.g. "https://vaylosports.com". Trailing slash trimmed. */
const configuredBase = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
const NATIVE_CALLBACK = "com.vaylosports.app://auth-callback";
const NATIVE_RECOVERY = "com.vaylosports.app://auth";
const PREVIEW_SUFFIXES = [
  ".lovable.app",
  ".vercel.app",
  ".netlify.app",
  ".pages.dev",
  ".web.app",
  ".firebaseapp.com",
  ".github.io",
  ".onrender.com",
];

export const isPreviewHost = (hostname: string) => {
  const normalized = hostname.toLowerCase();
  return normalized === "lovable.app" || PREVIEW_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
};

/** Public canonical URLs are never used inside the native shell. */
const configuredPublicBase = () => {
  if (!configuredBase) return "";
  try {
    const parsed = new URL(configuredBase);
    const hostname = parsed.hostname.toLowerCase();
    const isLocal = hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname.includes(":");
    const isSupabaseProject = hostname === "supabase.co" || hostname.endsWith(".supabase.co");
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !hostname ||
      isLocal ||
      isSupabaseProject ||
      isPreviewHost(hostname)
    ) return "";
    return configuredBase.replace(/\/$/, "");
  } catch {
    return "";
  }
};

/** Only first-party app URLs and this project's invite-preview endpoint are shareable. */
const shareableUrl = (candidate?: string): string | undefined => {
  if (!candidate || isNativeShell()) return undefined;
  const appBase = publicAppUrl();
  if (!appBase) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || isPreviewHost(url.hostname)) return undefined;
    if (url.username || url.password || url.hash) return undefined;
    const appHost = new URL(appBase).hostname;
    const supabaseUrl = new URL(import.meta.env.VITE_SUPABASE_URL as string);
    if (url.hostname === appHost) return url.toString();
    if (url.origin === supabaseUrl.origin && url.pathname === "/functions/v1/link-preview") return url.toString();
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Absolute URL for something that may be shared outside the app.
 * Returns an empty string when there is no explicitly configured owned public
 * address (native shell, previews and local development included).
 */
export function publicAppUrl(path = ""): string {
  // Do not publish a local/test address as though it were Vaylo's public home.
  if (isNativeShell()) return "";
  const configured = configuredPublicBase();
  if (!configured || typeof window === "undefined" || isPreviewHost(window.location.hostname)) return "";
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1") return "";
  const suffix = path && !path.startsWith("/") ? `/${path}` : path;
  return `${configured}${suffix}`;
}

/**
 * Origins GoTrue will actually return an OAuth flow to.
 *
 * This mirrors Supabase Auth's **Redirect URLs** (`uri_allow_list`), which is the
 * allowlist the callback is checked against — not a stylistic choice. Getting it
 * wrong is not a cosmetic bug: too permissive and any site on a shared host
 * could receive a provider's authorization code; too tight and the button is
 * inert, which is what it was before this existed (every OAuth button on a
 * preview host threw "Web auth links are disabled" and did nothing).
 *
 *   - `https://*.netlify.app` — the marketing site and the /play/ preview both
 *     live on one netlify.app origin, and that is what the dashboard has.
 *   - localhost/127.0.0.1 on the two ports listed — local development.
 *
 * Deliberately NOT matching every preview suffix in PREVIEW_SUFFIXES: a
 * `.github.io` or `.vercel.app` deploy is a preview as far as sharing is
 * concerned, and it is not on the auth allowlist, so it must keep throwing
 * rather than sending a flow somewhere the callback will refuse.
 *
 * Keep in step with the dashboard: adding an origin here without adding it to
 * Supabase Auth → Redirect URLs produces a sign-in that dies at the last step.
 */
const AUTH_RETURN_ORIGINS = [
  /^https:\/\/[a-z0-9-]+\.netlify\.app$/i,
  /^http:\/\/localhost:(?:8080|5173)$/,
  /^http:\/\/127\.0\.0\.1:(?:8080|5173)$/,
] as const;

/** True when the current origin is on the auth allowlist, and so can sign in. */
export function authReturnOriginAllowed(origin: string): boolean {
  return AUTH_RETURN_ORIGINS.some((pattern) => pattern.test(origin));
}

/**
 * Where Supabase should send users back to for auth emails and OAuth sign-in.
 *
 * On the web this requires an explicitly configured owned public origin. In the
 * native shell it uses the app's registered custom URL scheme so password
 * recovery and magic links return to the device without an unowned web host.
 *
 * Third: a preview origin that is on the auth allowlist. Preview hosts are
 * refused for *sharing* (publicAppUrl, below) because a netlify.app link must
 * never be published as though it were Vaylo's home. That reasoning does not
 * apply to an OAuth return trip, which has its own allowlist and its own threat
 * model — so refusing here only produced inert buttons. Both must still agree:
 * the origin has to pass AUTH_RETURN_ORIGINS, and GoTrue will refuse the
 * callback otherwise.
 */
export function authRedirectUrl(path = ""): string {
  if (isNativeShell()) {
    // Supabase email redirects return to a validated app deep link. OAuth uses
    // the PKCE system-browser flow in nativeOAuth.ts; no preview host or
    // localhost origin enters the auth redirect allowlist.
    return /delete-account/.test(path) ? NATIVE_CALLBACK : NATIVE_RECOVERY;
  }
  const redirect = publicAppUrl(path);
  if (redirect) return redirect;

  if (typeof window !== "undefined" && authReturnOriginAllowed(window.location.origin)) {
    // appHref, not a hand-joined path: the preview is mounted at /play/ and a
    // bare /auth would be answered by the marketing site's 404 page, so the
    // flow would land on a 404 with a code in the query string.
    return `${window.location.origin}${appHref(path)}`;
  }

  throw new Error("Web auth links are disabled until an owned Vaylo domain is configured.");
}

/**
 * Shares text/link using whatever this device actually supports.
 * Never throws — the caller branches on the result to give feedback.
 */
export async function shareContent(payload: {
  title?: string;
  text?: string;
  url?: string;
}): Promise<ShareResult> {
  const { title, text, url } = payload;
  const native = isNativeShell();
  const link = native ? undefined : shareableUrl(url);

  if (native) {
    const plugin = await loadPlugin<SharePlugin>("share");
    if (plugin?.share) {
      try {
        await plugin.share({ title, text, url: link, dialogTitle: title ?? "Share" });
        return "shared";
      } catch {
        // Cancelled or failed — fall through to the next option.
      }
    }
  }

  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, text, ...(link ? { url: link } : {}) });
      return "shared";
    } catch {
      // Dismissed — treat as handled, not an error.
      if (typeof navigator.canShare === "function") return "shared";
    }
  }

  const clipboardText = [text, link].filter(Boolean).join(link && text ? " " : "");
  try {
    if (clipboardText && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(clipboardText);
      return "copied";
    }
  } catch {
    // Clipboard blocked (insecure context, permissions).
  }

  return "unsupported";
}

// ---------------------------------------------------------------------------
// Invite-aware sharing — every share doubles as a referral
// ---------------------------------------------------------------------------

let cachedReferralCode: string | null = null;

/**
 * The signed-in athlete's referral code, or null when logged out / offline.
 * Cached for the session — a user has exactly one code.
 */
export async function myInviteLink(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    if (cachedReferralCode) return inviteUrl(cachedReferralCode, user.id);
    const { data, error } = await supabase.from("referral_codes").select("code").eq("user_id", user.id).maybeSingle();
    // Null means "no code yet"; a failed read means the invite link is missing
    // from a share the athlete has already started.
    readFailed(error, "your referral code", { quiet: true });
    if (!data?.code) return null;
    cachedReferralCode = data.code;
    return inviteUrl(data.code, user.id);
  } catch {
    return null;
  }
}

/**
 * Invite links point at the link-preview edge function, not the app origin:
 * it serves crawler-facing og:* tags (rendered card from og-image) and then
 * redirects the human to /auth?ref=CODE. This is only used on the web; native
 * shares are deliberately linkless until Vaylo configures an owned domain.
 */
function inviteUrl(code: string, userId: string): string | null {
  if (isNativeShell()) return null;
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
  if (!base || !publicAppUrl()) return null;
  return `${base}/functions/v1/link-preview?kind=profile&id=${userId}&ref=${encodeURIComponent(code)}`;
}

/**
 * shareContent + the athlete's referral link. Native remains linkless until an
 * owned public domain exists; the web referral link uses its real origin.
 */
export async function shareWithInvite(payload: {
  title?: string;
  text?: string;
  url?: string;
}): Promise<ShareResult> {
  if (isNativeShell()) return shareContent(payload);
  if (payload.url) return shareContent(payload);
  const invite = await myInviteLink();
  if (!invite) return shareContent(payload);
  const appUrl = publicAppUrl();
  if (!appUrl) return shareContent(payload);
  return shareContent({ ...payload, url: invite });
}
