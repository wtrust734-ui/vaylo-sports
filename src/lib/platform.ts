// ============================================================================
// PLATFORM
// ----------------------------------------------------------------------------
// The same bundle runs on the web and inside the Capacitor shell. Every native
// capability is detected at runtime and degrades to the web behaviour, so a
// missing plugin is a soft failure rather than a crash.
// ============================================================================

import { registerPlugin } from "@capacitor/core";

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

/** `status-bar` -> `StatusBar`, matching every Capacitor package's named export. */
const pascalCase = (name: string): string =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

/**
 * Official plugins, keyed by the short name callers pass to `loadPlugin`.
 *
 * These imports must be static. The previous implementation built the
 * `@capacitor/<name>` specifier at runtime behind Vite's `@vite-ignore` escape
 * hatch, which no bundler can resolve — so in the WebView the dynamic import
 * rejected for a bare specifier and `loadPlugin` answered `null` for *every*
 * plugin. Native back handling, in-app browser, share sheet and haptics were
 * all silently running their web fallbacks inside the app shell.
 */
const officialPlugins: Record<string, () => Promise<Record<string, unknown>>> = {
  app: () => import("@capacitor/app"),
  browser: () => import("@capacitor/browser"),
  haptics: () => import("@capacitor/haptics"),
  keyboard: () => import("@capacitor/keyboard"),
  "splash-screen": () => import("@capacitor/splash-screen"),
  share: () => import("@capacitor/share"),
  "status-bar": () => import("@capacitor/status-bar"),
};

/**
 * Custom native plugins, which have no npm package to import.
 *
 * `MainActivity.registerPlugin` only makes the bridge aware of the Kotlin
 * class; the JS-side proxy still has to exist, and in a normal Capacitor plugin
 * the npm package is nothing more than a wrapper around `registerPlugin`. So
 * this map *is* the wrapper for `HealthConnectPlugin`. `@capacitor/core` is
 * safe to bundle for the web: the proxy only throws when a method is actually
 * called, and every caller checks `isNative()`/`isAndroid()` first.
 */
let healthConnectProxy: unknown;
const customPlugins: Record<string, () => unknown> = {
  // Registered once and shared: the proxy is stateless, and `registerPlugin`
  // warns if the same name is registered twice.
  VayloHealthConnect: () =>
    (healthConnectProxy ??= registerPlugin<Record<string, unknown>>("VayloHealthConnect")),
};

/**
 * Removes thenability from a plugin proxy before it leaves an async function.
 *
 * A Capacitor plugin is a `Proxy` whose `get` trap manufactures a method for
 * *any* property name — including `then`. Because `loadPlugin` is async, its
 * return value is treated as a thenable and JS calls `proxy.then(resolve,
 * reject)`. That manufactures a `then` method no plugin implements, whose
 * rejection lands on a promise nobody awaits: `resolve` is never called, so
 * `await loadPlugin(...)` **never settles at all**. The plugin is fine, only the
 * async return value is, so it is handed over with `then` masked to `undefined`.
 */
const settle = <T>(plugin: T): T =>
  new Proxy(plugin as object, {
    get: (target, property, receiver) =>
      property === "then" ? undefined : Reflect.get(target, property, receiver),
  }) as T;

/**
 * Loads a Capacitor plugin by its short name (`"app"`, `"haptics"`, …).
 *
 * Returns `null` when the plugin is unknown or genuinely unavailable, so
 * callers fall back to web behaviour instead of throwing.
 */
export async function loadPlugin<T = Record<string, unknown>>(name: string): Promise<T | null> {
  if (!isNative()) return null;

  const custom = customPlugins[name];
  if (custom) {
    try {
      return settle(custom() as T);
    } catch {
      return null;
    }
  }

  const load = officialPlugins[name];
  if (!load) return null;

  try {
    const mod = await load();
    const plugin = (mod[pascalCase(name)] as T) ?? (mod.default as T) ?? null;
    return plugin ? settle(plugin) : null;
  } catch {
    // Plugin not bundled into this build — the caller falls back to web.
    return null;
  }
}

/**
 * Opens a link outside the app: the in-app browser inside the native shell, a
 * normal new tab on the web.
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
