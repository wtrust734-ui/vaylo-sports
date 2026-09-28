import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration — the shell this app actually ships in.
 *
 * The Android project is real and generated: `android/` is tracked, the debug
 * APK is built from it in CI, and `@capacitor/android` / `@capacitor/core` /
 * `@capacitor/cli` are all dependencies. The non-negotiable part is `webDir`
 * plus the appId/appName pair — changing appId invalidates every vendor OAuth
 * redirect and breaks the deep-link scheme in nativeOAuth.ts.
 *
 * The `plugins` block below only takes effect for plugins that are actually
 * installed — they are added to the native build by `npx cap sync android`,
 * which the seven `@capacitor/*` packages in package.json all are. Note that
 * configuration alone does not make a plugin reachable from JS: `loadPlugin` in
 * src/lib/platform.ts holds the static import registry that does.
 *
 * The native bundle is built with `npm run build:native` (Vite `--mode native`,
 * which sets base './' so the WebView can load assets relatively). See
 * CAPACITOR.md.
 */
const config: CapacitorConfig = {
  appId: "com.vaylosports.app",
  appName: "VAYLO Sports",
  webDir: "dist",

  ios: {
    // Let the WebView respect the device safe areas (notch, home indicator).
    contentInset: "always",
  },

  android: {
    allowMixedContent: false,
  },

  plugins: {
    // Dark navy foundation, matching the brand. Values mirror index.html.
    SplashScreen: {
      backgroundColor: "#05070f",
      showSpinner: false,
      launchAutoHide: true,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#05070f",
      overlaysWebView: false,
    },
    Keyboard: {
      // Resize the web view so form inputs are never hidden behind the keyboard.
      resize: "body",
      style: "DARK",
    },
  },
};

export default config;
