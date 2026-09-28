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

import { isNative, loadPlugin } from "@/lib/platform";
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
export const webOAuthRedirectUrl = (): string => `${window.location.origin}/auth`;

/**
 * Starts OAuth for the given provider.
 *
 * Native: returns the provider URL to open in the system browser; the caller
 * then listens for the deep link and calls completeNativeOAuth().
 * Web: performs the classic full-page redirect and returns null.
 */
export async function startOAuth(
  provider: Provider,
  options: { scopes?: string } = {},
): Promise<string | null> {
  if (!isNative()) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: webOAuthRedirectUrl(),
        ...(options.scopes ? { scopes: options.scopes } : {}),
      },
    });
    if (error) throw error;
    return null;
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${SCHEME}://${CALLBACK_PATH}`,
      skipBrowserRedirect: true,
      ...(options.scopes ? { scopes: options.scopes } : {}),
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
export async function awaitOAuthDeepLink(
  providerUrl: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<{ code: string; flowId: string | null }> {
  const Browser = await loadPlugin<{ open: (o: { url: string }) => Promise<void>; close: () => Promise<void> }>("browser");
  if (Browser?.open) await Browser.open({ url: providerUrl });

  const link = await Promise.race([
    waitDeepLink(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Sign-in timed out")), timeoutMs),
    ),
  ]);

  if (Browser?.close) {
    try { await Browser.close(); } catch { /* already closed */ }
  }
  return link;
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
export const usesNativeOAuth = (): boolean => isNative();
