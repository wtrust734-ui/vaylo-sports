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
      // LIGHT means light *content* — i.e. white clock, battery and signal
      // icons. The previous value was DARK, which asks Android for dark icons
      // on a #05070f background: the clock and battery were effectively
      // invisible. This is the single most-cited visual bug in the app and it
      // was one word in this file.
      style: "LIGHT",
      backgroundColor: "#05070f",
      // Edge-to-edge, deliberately, to match `viewport-fit=cover` in index.html
      // and the `env(safe-area-inset-*)` padding the CSS now applies once at
      // the root. The previous `false` claimed the WebView would start below
      // the status bar; on Android 15+ (targetSdk 35+) the system enforces
      // edge-to-edge regardless, so the setting was not describing the
      // behaviour — it was describing the one case where the CSS was wrong.
      // Being explicit keeps the shell and the CSS telling the same story.
      overlaysWebView: true,
    },
    Keyboard: {
      // "native" resizes the WebView itself, so the visual viewport shrinks and
      // fixed elements (the bottom tab bar) move with it. "body" resizes the
      // body element instead, which leaves fixed elements where they were and
      // opens a gap between them and the keyboard — the "layout jumps and
      // leaves a blank strip" report. Forms now stay reachable because the
      // viewport itself is smaller, and `scrollFocusedInputIntoView` in
      // src/lib/keyboard.ts handles the focus case where a field is still
      // under the keyboard.
      resize: "native",
      // Same reasoning as StatusBar: light content on a dark keyboard.
      style: "LIGHT",
    },
  },
};

export default config;
