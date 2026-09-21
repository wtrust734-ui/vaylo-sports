// ============================================================================
// SHARING, PUBLIC LINKS AND AUTH REDIRECTS
// ----------------------------------------------------------------------------
// Two mobile problems this solves:
//
//  1. `window.location.origin` inside a Capacitor shell is `capacitor://localhost`
//     (iOS) or `http://localhost` (Android) — a shared link built from it is
//     useless to the person receiving it. Shared URLs are built from
//     `VITE_PUBLIC_APP_URL` when it is configured, and fall back to the real
//     browser origin on the web.
//  2. `navigator.share` does not exist in Android's WebView, so invite/milestone
//     buttons silently did nothing on native. Here the native Share plugin is
//     used when present, then the Web Share API, then clipboard, and the caller
//     is told which one happened so it can show the right confirmation.
//
// Safe on the web today: with no Capacitor plugin installed this behaves exactly
// like the previous `navigator.share` + clipboard code, and `authRedirectUrl()`
// resolves to the same origin the app already used.
// ============================================================================

import { isNativeShell, loadPlugin } from "@/lib/platform";

export type ShareResult = "shared" | "copied" | "unsupported";

interface SharePlugin {
  share: (options: {
    title?: string;
    text?: string;
    url?: string;
    dialogTitle?: string;
  }) => Promise<unknown>;
}

/** Configured public site, e.g. "https://vaylosports.com". Trailing slash trimmed. */
const configuredBase = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();

const isShellOrigin = () => {
  const { protocol, hostname } = window.location;
  return protocol === "capacitor:" || (protocol.startsWith("http") && hostname === "localhost" && isNativeShell());
};

/**
 * Absolute URL for something that may be shared outside the app.
 * Returns an empty string when there is no honest public address to point at
 * (native shell, no VITE_PUBLIC_APP_URL) — callers share without a link instead
 * of sharing a broken one.
 */
export function publicAppUrl(path = ""): string {
  const base = configuredBase || (isShellOrigin() ? "" : window.location.origin);
  if (!base) return "";
  const suffix = path && !path.startsWith("/") ? `/${path}` : path;
  return `${base.replace(/\/$/, "")}${suffix}`;
}

/**
 * Where Supabase should send users back to for auth emails and OAuth sign-in.
 *
 * On the web this is the current origin, unchanged. Inside a native shell it
 * prefers the configured public site, because `capacitor://localhost` cannot be
 * registered as a redirect URL with Supabase — completing sign-in on the live
 * site is the behaviour that works today; returning into the app needs a custom
 * URL scheme and is listed in CAPACITOR.md §4.
 */
export function authRedirectUrl(path = ""): string {
  return publicAppUrl(path) || `${window.location.origin}${path}`;
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
  const link = url || undefined;

  if (isNativeShell()) {
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
