// ============================================================================
// PLATFORM
// ----------------------------------------------------------------------------
// The app runs on the web today and will later be wrapped in Capacitor. Nothing
// here requires Capacitor to be installed: every native capability is detected
// at runtime and degrades to the web behaviour, so this file is safe to ship now
// and starts working the moment the native shell exists.
// ============================================================================

export type AppPlatform = "web" | "ios" | "android";

interface CapacitorGlobal {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}

const capacitor = (): CapacitorGlobal | undefined =>
  (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;

export const getPlatform = (): AppPlatform => {
  const platform = capacitor()?.getPlatform?.();
  return platform === "ios" || platform === "android" ? platform : "web";
};

/** True inside the Capacitor native shell (iOS/Android), false in a browser. */
export const isNative = (): boolean => getPlatform() !== "web";

/**
 * Synchronous native-shell check for decisions that must be made *before*
 * React renders — the router is the main one, because a native bundle is served
 * from `capacitor://localhost` (iOS) or `http://localhost` (Android) with no
 * server-side rewrite, so deep links only survive a reload with hash routing.
 *
 * `window.Capacitor` is normally injected before the app scripts run, but the
 * check also covers the case where injection happens later, so the wrong router
 * is never chosen by accident.
 */
export const isNativeShell = (): boolean => {
  const bridge = capacitor();
  if (bridge?.isNativePlatform?.() || bridge?.getPlatform?.()) {
    return bridge.getPlatform?.() !== "web";
  }
  if (typeof window === "undefined") return false;
  if (window.location.protocol === "capacitor:") return true;
  // Android's Capacitor WebView serves the bundle over http://localhost.
  return (
    window.location.hostname === "localhost" &&
    /\bwv\b|Capacitor/i.test(navigator.userAgent)
  );
};

export const isIOS = (): boolean => getPlatform() === "ios";
export const isAndroid = (): boolean => getPlatform() === "android";

/**
 * Loads a Capacitor plugin without a static import, so the web build never
 * depends on (or fails to resolve) packages that are not installed yet.
 */
export async function loadPlugin<T = Record<string, unknown>>(name: string): Promise<T | null> {
  if (!isNative()) return null;
  try {
    const specifier = `@capacitor/${name}`;
    const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
    const pluginName = name
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
    return (mod[pluginName] as T) ?? (mod.default as T) ?? null;
  } catch {
    // Plugin not installed yet — the caller falls back to web behaviour.
    return null;
  }
}

/**
 * Opens a link outside the app. On web (and until @capacitor/browser is added)
 * this is a normal new tab; in a native shell it will use the in-app browser.
 */
export async function openExternal(url: string): Promise<void> {
  if (isNative()) {
    const Browser = await loadPlugin<{ open: (options: { url: string }) => Promise<void> }>("browser");
    if (Browser?.open) {
      try {
        await Browser.open({ url });
        return;
      } catch {
        // fall through to window.open
      }
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Convenience for components that need to branch on the shell. */
export const platformInfo = () => ({
  platform: getPlatform(),
  native: isNative(),
  ios: isIOS(),
  android: isAndroid(),
});
