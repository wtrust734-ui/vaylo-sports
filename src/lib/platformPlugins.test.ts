import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Every native capability in the app is reached through `loadPlugin(name)`, and
// its failure mode is silent: it answers `null` and the caller quietly falls
// back to web behaviour. That is precisely what shipped. The loader built
// `` `@capacitor/${name}` `` at runtime behind `@vite-ignore`, which no bundler
// can resolve, so inside the WebView the dynamic import rejected on a bare
// specifier and *every* plugin was null — native back handling, the in-app
// browser OAuth needs, the share sheet and haptics were all dead, with nothing
// logged.
//
// So these tests load each plugin the app actually asks for against a fake of
// what the Android bridge injects, and fail if any comes back null.
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, "../..");

/** Windows checkouts are CRLF (`core.autocrlf=true`); normalize before matching. */
const toLf = (src: string): string => src.replace(/\r\n?/g, "\n");

/** Names passed to `loadPlugin` anywhere in the app, excluding tests. */
function collectedPluginNames(): Set<string> {
  const names = new Set<string>();
  const re = /loadPlugin\s*(?:<[^>]*>)?\s*\(\s*"([^"]+)"/g;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = resolve(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      const src = toLf(readFileSync(path, "utf8"));
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) names.add(m[1]);
    }
  };

  walk(resolve(ROOT, "src"));
  return names;
}

/**
 * Plugins the app asks for that are deliberately unresolved.
 *
 * `in-app-purchases` is a Google Play Billing plugin that has never existed in
 * this build — no Kotlin class, no npm package. `billing.ts` checks
 * `STORE_BILLING_ENABLED` (currently false) before calling, and reports "Store
 * billing plugin is not installed in this build" if it ever does, which is the
 * honest answer while the Play service-account secrets are missing.
 */
const INTENTIONALLY_UNRESOLVED: Record<string, string> = {
  "in-app-purchases": "no native Play Billing plugin exists in this build yet",
};

/** Every non-core Capacitor package `package.json` declares. */
function declaredCapacitorDeps(): string[] {
  const pkg = JSON.parse(toLf(readFileSync(resolve(ROOT, "package.json"), "utf8")));
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter((name) => /^@capacitor\//.test(name) && !/\/(cli|core|android|ios)$/.test(name))
    .map((name) => name.replace("@capacitor/", ""));
}

/**
 * What `JSExport.getPluginJS` writes into `window.Capacitor.PluginHeaders`:
 * `[{ name, methods: [{ name, rtype }] }]`, one entry per plugin the bridge
 * found natively — including the custom one MainActivity registers. Methods are
 * listed only so `createPluginMethod` can hand back a real function; nothing
 * here is ever invoked, which would need `nativePromise`.
 */
const PLUGIN_HEADERS = [
  { name: "App", methods: ["getInfo", "getState", "minimizeApp"] },
  { name: "Browser", methods: ["open", "close", "prefetch"] },
  { name: "Haptics", methods: ["impact", "vibrate", "selectionStart", "selectionEnd"] },
  { name: "Keyboard", methods: ["show", "hide", "setResizeMode", "setStyle"] },
  { name: "Share", methods: ["canShare", "share"] },
  { name: "SplashScreen", methods: ["show", "hide"] },
  { name: "StatusBar", methods: ["setStyle", "getInfo", "show", "hide"] },
  {
    name: "VayloHealthConnect",
    methods: [
      "isAvailable",
      "checkPermissionsStatus",
      "requestPermissionsStatus",
      "openHealthConnectSettings",
      "syncPull",
    ],
  },
].map(({ name, methods }) => ({
  name,
  methods: methods.map((method) => ({ name: method, rtype: "promise" })),
}));

interface BridgeGlobal {
  Capacitor?: { PluginHeaders?: unknown; getPlatform?: () => string };
  androidBridge?: unknown;
}

const bridgeGlobal = () => globalThis as BridgeGlobal;

/**
 * One Capacitor global for the whole file, installed at module scope so it is
 * present the first time anything imports `platform` — which is the order the
 * WebView guarantees, since the bridge injects it before the app bundle runs.
 *
 * It has to be the *same* object every time: `@capacitor/core` lives in
 * node_modules, so Vitest does not re-evaluate it between tests, and it captures
 * `window.Capacitor` once. Replacing the object would leave core augmenting a
 * stale one and `getPlatform()` would silently answer "web".
 */
bridgeGlobal().Capacitor = { PluginHeaders: PLUGIN_HEADERS };

/** An Android WebView: the injected Capacitor plus the native bridge marker. */
const installAndroidBridge = (): void => {
  bridgeGlobal().androidBridge = {};
};

/** A browser: a Capacitor global with no native bridge behind it. */
const installWebBridge = (): void => {
  delete bridgeGlobal().androidBridge;
};

/** A fresh `platform` module, so no earlier import can leak state in. */
async function freshPlatform() {
  vi.resetModules();
  return await import("./platform");
}

afterEach(() => {
  delete bridgeGlobal().androidBridge;
});

describe("loadPlugin", () => {
  it("resolves every plugin the app asks for", async () => {
    installAndroidBridge();
    const { loadPlugin } = await freshPlatform();
    const unresolved: string[] = [];

    for (const name of collectedPluginNames()) {
      if (INTENTIONALLY_UNRESOLVED[name]) continue;
      if (!(await loadPlugin(name))) unresolved.push(name);
    }

    expect(unresolved).toEqual([]);
  });

  it("settles instead of hanging on the plugin's own `then`", async () => {
    // A Capacitor plugin proxy manufactures a method for *any* property,
    // `then` included. Returning it bare from an async function makes JS treat
    // it as a thenable, call `then(resolve, reject)`, and the rejection lands on
    // a promise nobody awaits — so `await loadPlugin("app")` never settles at
    // all and the back button is silently never wired.
    installAndroidBridge();
    const { loadPlugin } = await freshPlatform();

    const settled = await Promise.race([
      loadPlugin("app").then(() => "settled" as const),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 250)),
    ]);

    expect(settled).toBe("settled");
  });

  it("exposes usable methods, not just a non-null object", async () => {
    installAndroidBridge();
    const { loadPlugin } = await freshPlatform();

    const App = await loadPlugin<{ addListener?: unknown; getInfo?: unknown }>("app");
    expect(typeof App?.addListener).toBe("function");
    expect(typeof App?.getInfo).toBe("function");

    const Browser = await loadPlugin<{ open?: unknown }>("browser");
    expect(typeof Browser?.open).toBe("function");

    const Haptics = await loadPlugin<{ impact?: unknown }>("haptics");
    expect(typeof Haptics?.impact).toBe("function");
  });

  it("registers a JS proxy for the custom native plugin", async () => {
    // `MainActivity.registerPlugin` only makes the bridge aware of the Kotlin
    // class; the JS proxy still has to exist, and in a published Capacitor
    // plugin the npm package is nothing but a wrapper around `registerPlugin`.
    // Without one, Health Connect sync can never work.
    installAndroidBridge();
    const { loadPlugin } = await freshPlatform();

    const bridge = await loadPlugin<{ isAvailable?: unknown; syncPull?: unknown }>(
      "VayloHealthConnect",
    );
    expect(typeof bridge?.isAvailable).toBe("function");
    expect(typeof bridge?.syncPull).toBe("function");
  });

  it("still degrades to null on the web", async () => {
    // The same bundle ships to the browser, where every caller must be handed
    // null so it can use the web fallback.
    installWebBridge();
    const { loadPlugin, isNative } = await freshPlatform();

    expect(isNative()).toBe(false);
    expect(await loadPlugin("app")).toBeNull();
    expect(await loadPlugin("VayloHealthConnect")).toBeNull();
    expect(await loadPlugin("nope")).toBeNull();
  });

  it("leaves an unknown plugin unresolved instead of throwing", async () => {
    installAndroidBridge();
    const { loadPlugin } = await freshPlatform();

    expect(await loadPlugin("in-app-purchases")).toBeNull();
    expect(await loadPlugin("not-a-plugin")).toBeNull();
  });

  it("imports every declared Capacitor dependency statically", () => {
    // The registry must line up with package.json in both directions: an
    // unimported dependency is dead weight, and a plugin reached through a
    // computed specifier is the original bug — no bundler can follow it, so the
    // import rejects at runtime and the capability dies silently.
    const src = toLf(readFileSync(resolve(ROOT, "src/lib/platform.ts"), "utf8"));
    const declared = declaredCapacitorDeps();
    expect(declared.length).toBeGreaterThanOrEqual(7);

    const missing = declared.filter((name) => !src.includes(`import("@capacitor/${name}")`));
    expect(missing).toEqual([]);

    const calls = src.match(/import\s*\([^)]*\)/g) ?? [];
    const notLiteral = calls.filter((call) => !/^import\s*\(\s*"[^"]+"\s*\)$/.test(call));
    expect(notLiteral).toEqual([]);
  });
});
