// ============================================================================
// NATIVE OAUTH
// ----------------------------------------------------------------------------
// In a browser, signInWithOAuth redirects the whole page to the provider and
// Supabase restores the session from the return URL. Inside a Capacitor shell
// that page-level redirect cannot work: the app is a WebView whose "URL" is
// capacitor://localhost (iOS) or http://localhost (Android), and Google/
// Microsoft/Apple refuse to return a user to a scheme like that without extra
// configuration. The reliable pattern is:
//
//   1. App asks GoTrue for a signed deep link (signInWithOAuth with
//      skipBrowserRedirect) containing a PKCE code.
//   2. App opens that link in the SYSTEM browser (not the WebView).
//   3. Provider authenticates, Supabase redirects to the app's custom scheme
//      (com.vaylosports.app://auth-callback#code=...&flow_state_id=...).
//   4. App receives the deep link, hands the code to
//      supabase.auth.exchangeCodeForSession(code, { flowId }) → session.
//
// On the web this module is a no-op: isNative() is false, so every helper
// reports "not native" and the existing redirect flow is used unchanged.
// ============================================================================

import { isNative, isNativeShell, loadPlugin } from "@/lib/platform";
import { authRedirectUrl } from "@/lib/share";
import { supabase } from "@/integrations/supabase/client";
import type { Provider } from "@supabase/supabase-js";

/** Deep-link scheme derived from the Capacitor appId (com.vaylosports.app). */
const SCHEME = "com.vaylosports.app";

/**
 * Path in the callback URL, and the value the provider's OAuth app must
 * redirect to. On Android it is matched by the VIEW/BROWSABLE intent-filter in
 * android/app/src/main/AndroidManifest.xml (which registers the scheme from
 * `custom_url_scheme`); on iOS the scheme has to be declared under
 * CFBundleURLTypes in Info.plist. Both must also appear in the project's
 * additional_redirect_urls allow-list, or GoTrue rejects the redirect.
 */
const CALLBACK_PATH = "auth-callback";

/** Web-only: where the browser flow should land (unchanged behaviour). */
export const webOAuthRedirectUrl = (): string => authRedirectUrl("/auth");

/**
 * True when this document is inside an iframe.
 *
 * The marketing site embeds the web build at /play/. A full-page OAuth redirect
 * cannot work there: supabase-js would navigate the *frame* to accounts.google.com,
 * and Google (correctly) refuses to render its consent page inside a frame — the
 * frame goes blank and the visitor is stranded with no way back. Same-origin
 * iframe and top level share localStorage, so a popup can finish the flow and
 * hand the session back to the frame that started it.
 */
const isFramed = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    // Accessing window.top throws when the parent is cross-origin. Either way
    // we are in someone else's frame, so treat it as framed.
    return true;
  }
};

/**
 * Hand a provider URL to the browser: a popup when we are inside the preview
 * iframe, a full-page navigation when we are not. Throws only when the browser
 * refused to give us a window, which is a readable failure rather than a button
 * that silently does nothing.
 */
const openProvider = (url: string): void => {
  if (!isFramed()) {
    window.location.assign(url);
    return;
  }
  // Named so a second tap reuses the window rather than stacking popups.
  const popup = window.open(url, "vaylo-oauth", "width=500,height=640");
  if (!popup) {
    throw new Error("Your browser blocked the sign-in window. Allow pop-ups for this site and try again.");
  }
  try { popup.focus(); } catch { /* focus is best-effort */ }
};

/**
 * Attach an OAuth identity to the session that is already signed in.
 *
 * On the web a visitor arrives as an anonymous guest with a real uuid and a
 * real (empty) account. Signing in normally from there replaces that session
 * with a second account, and everything the guest created under the first uuid
 * becomes unreachable — which reads as data loss even though nothing was
 * deleted. Linking instead keeps the same user id, so the guest simply becomes
 * a real account with a Google identity attached.
 *
 * Throws when the identity already belongs to another account (a Google address
 * that signed up separately); callers fall back to a plain sign-in from there.
 */
export async function linkGuestIdentity(
  provider: Provider,
  options: { scopes?: string; redirectPath?: string; queryParams?: Record<string, string> } = {},
): Promise<void> {
  const redirectTo = options.redirectPath
    ? authRedirectUrl(options.redirectPath)
    : webOAuthRedirectUrl();
  const skipBrowserRedirect = isFramed();
  await linkWithProvider(provider, { redirectTo, ...options }, skipBrowserRedirect);
}

/** Shared by linkGuestIdentity and startOAuth's guest branch. */
async function linkWithProvider(
  provider: Provider,
  shared: { redirectTo: string; scopes?: string; queryParams?: Record<string, string> },
  skipBrowserRedirect: boolean,
): Promise<void> {
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: {
      redirectTo: shared.redirectTo,
      ...(skipBrowserRedirect ? { skipBrowserRedirect: true } : {}),
      ...(shared.scopes ? { scopes: shared.scopes } : {}),
      ...(shared.queryParams ? { queryParams: shared.queryParams } : {}),
    },
  });
  if (error) throw error;
  if (skipBrowserRedirect) {
    if (!data?.url) throw new Error("The sign-in window could not be opened.");
    openProvider(data.url);
  }
}

/**
 * True when there is a session and it belongs to an anonymous guest.
 *
 * Never throws: no session, or a storage error, must not break sign-in — it
 * only changes which of the two paths (link, or sign in fresh) we take.
 */
async function sessionIsGuest(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.is_anonymous === true;
  } catch {
    return false;
  }
}

/**
 * Starts OAuth for the given provider.
 *
 * Native: returns the provider URL to open in the system browser; the caller
 * then listens for the deep link and calls completeNativeOAuth().
 * Web top-level: performs the classic full-page redirect and returns null.
 * Web inside an iframe: opens a popup and returns null (see isFramed).
 */
export async function startOAuth(
  provider: Provider,
  options: { scopes?: string; redirectPath?: string; queryParams?: Record<string, string> } = {},
): Promise<string | null> {
  // Capacitor's bridge can initialize after the first render; use the shell
  // detector as a second line so Android never falls into localhost redirects.
  if (!isNative() && !isNativeShell()) {
    const redirectTo = options.redirectPath
      ? authRedirectUrl(options.redirectPath)
      : webOAuthRedirectUrl();
    const shared = {
      redirectTo,
      ...(options.scopes ? { scopes: options.scopes } : {}),
      ...(options.queryParams ? { queryParams: options.queryParams } : {}),
    };

    // A visitor on the web is an anonymous guest. Authenticate them and the
    // guest session is replaced by a second account, stranding everything they
    // created under the first uuid — which reads as data loss. Linking keeps
    // the same user id, so the guest becomes a real account in place.
    //
    // Falls through on failure: if the identity already belongs to another
    // account, GoTrue refuses the link, and refusing to sign in at all would
    // leave the visitor with no working button instead of a recoverable choice.
    if (await sessionIsGuest()) {
      try {
        await linkWithProvider(provider, shared, isFramed());
        return null;
      } catch {
        // Already linked / already exists elsewhere — continue as a normal sign-in.
      }
    }

    // Framed: ask GoTrue for the provider URL instead of letting supabase-js
    // assign window.location, then open it as a top-level window. The call is
    // still inside the click handler, so window.open is not popup-blocked.
    if (isFramed()) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { ...shared, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("The sign-in window could not be opened.");
      openProvider(data.url);
      return null;
    }

    const { error } = await supabase.auth.signInWithOAuth({ provider, options: shared });
    if (error) throw error;
    return null;
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${SCHEME}://${CALLBACK_PATH}`,
      skipBrowserRedirect: true,
      ...(options.scopes ? { scopes: options.scopes } : {}),
      ...(options.queryParams ? { queryParams: options.queryParams } : {}),
    },
  });
  if (error) throw error;
  return data?.url ?? null;
}

/**
 * Native only: opens the provider URL in the system browser (falling back to
 * @capacitor/browser, then window.open) and waits for the deep link to come
 * back through appUrlOpen. Resolves with the PKCE code + flow id, or rejects
 * if the user closes the browser without completing sign-in.
 */
/**
 * True while an interactive OAuth flow is waiting for its callback. The global
 * deep-link dispatcher uses this to leave an awaited code to the one-shot
 * listener, but still complete a callback that arrives with NO flow waiting —
 * e.g. the athlete closed the app mid-sign-in and taps the link again.
 */
let oauthAwaiting = false;
export const isOAuthAwaiting = (): boolean => oauthAwaiting;

export async function awaitOAuthDeepLink(
  providerUrl: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<{ code: string; flowId: string | null }> {
  oauthAwaiting = true;
  const Browser = await loadPlugin<{ open: (o: { url: string }) => Promise<void>; close: () => Promise<void> }>("browser");
  // The browser may fail to open (no handler, user refuses); the flag must
  // never stay stuck true, or every later callback would be treated as awaited.
  if (Browser?.open) {
    try {
      await Browser.open({ url: providerUrl });
    } catch {
      oauthAwaiting = false;
      throw new Error("Couldn't open the sign-in window");
    }
  } else {
    oauthAwaiting = false;
    throw new Error("Couldn't open the sign-in window");
  }

  const link = await Promise.race([
    waitDeepLink(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Sign-in timed out")), timeoutMs),
    ),
  ]).finally(() => {
    oauthAwaiting = false;
  });

  if (Browser?.close) {
    try { await Browser.close(); } catch { /* already closed */ }
  }
  return link;
}

/**
 * A callback nobody is waiting for — the app was killed mid-sign-in. Exchange
 * it anyway: the PKCE code alone is useless without the verifier that lives in
 * this app's Supabase client, and exchangeCodeForSession is single-use, so a
 * replayed or forged link fails server-side. Returns true when a session was
 * restored (the caller then routes to the app), false when the link was not
 * a usable callback (stale/expired code — drop it silently).
 */
export async function completeOrphanOAuthCallback(url: string): Promise<boolean> {
  try {
    await completeNativeOAuth(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts the PKCE code + flow id from an auth-callback deep link and
 * exchanges them for a real session. Must be called from the appUrlOpen
 * handler before anything else touches the URL.
 */
export async function completeNativeOAuth(url: string): Promise<void> {
  const parsed = new URL(url.replace("#", "?"));
  const params = parsed.searchParams;
  const code = params.get("code");
  const flowId = params.get("flow_state_id");
  if (!code) return; // not an OAuth callback (e.g. password recovery) — ignore

  const { error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  if (error) throw error;
}

export interface RecoveryResult {
  /** A session was restored from the fragment. */
  restored: boolean;
  /** The link was a password-recovery link (athlete must set a new password). */
  recovery: boolean;
  /** Supabase's rejection, when the link is expired or already used. */
  error?: string;
}

/**
 * Native recovery / magic-link emails carry their token in the URL fragment,
 * but on the custom scheme the WebView never sees a location change — so
 * supabase-js's automatic hash detection never fires. The fragment is read
 * here and the session restored through the public setSession API (the server
 * validates the token pair; a forged or stale pair is rejected).
 */
export async function completeNativeRecoveryFragment(url: string): Promise<RecoveryResult> {
  const empty: RecoveryResult = { restored: false, recovery: false };
  const hash = new URL(url).hash.replace(/^#/, "");
  if (!/(access_token|refresh_token|error_description=)/i.test(hash)) return empty;

  const params = new URLSearchParams(hash);
  const errorDescription = params.get("error_description");
  if (errorDescription) return { restored: false, recovery: false, error: errorDescription };

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return empty;

  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) return { restored: false, recovery: false, error: error.message };

  return { restored: true, recovery: params.get("type") === "recovery" };
}

/** Native only: subscribes to deep links via the App plugin's appUrlOpen. */
async function waitDeepLink(): Promise<{ code: string; flowId: string | null }> {
  return new Promise((resolve) => {
    void (async () => {
      const App = await loadPlugin<{ addListener: (
        event: "appUrlOpen",
        cb: (data: { url: string }) => void,
      ) => Promise<{ remove: () => void }> }>("app");
      if (App?.addListener) {
        const sub = await App.addListener("appUrlOpen", ({ url }: { url: string }) => {
          void (async () => {
            sub.remove();
            const parsed = new URL(url.replace("#", "?"));
            resolve({
              code: parsed.searchParams.get("code") ?? "",
              flowId: parsed.searchParams.get("flow_state_id"),
            });
          })();
        });
      }
    })();
  });
}

/** Rebuilds the callback URL from awaited deep-link values, ready to complete. */
export function buildNativeCallbackUrl(code: string, flowId: string | null): string {
  return `${SCHEME}://${CALLBACK_PATH}#code=${code}${flowId ? `&flow_state_id=${flowId}` : ""}`;
}

/**
 * True when the current platform needs the system-browser OAuth dance instead
 * of a page redirect. Callers use this to pick a flow, not to branch UI.
 */
export const usesNativeOAuth = (): boolean => isNative() || isNativeShell();
