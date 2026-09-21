import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration — ready, not enabled.
 *
 * The app is still a pure web app: nothing imports Capacitor, `@capacitor/cli`
 * is not a dependency, and this file is inert until you follow CAPACITOR.md.
 * Keeping it here means the shell settings (identity, web dir, dark status bar,
 * keyboard behaviour) are decided and reviewed *before* the conversion, which is
 * the part that is easy to get wrong under time pressure.
 *
 * `webDir` points at Vite's default output. If you build with VITE_BASE=./ for
 * the native bundle, keep this as-is.
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
