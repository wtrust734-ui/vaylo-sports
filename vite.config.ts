import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!publishableKey.startsWith("sb_publishable_")) {
    if (mode !== "test") {
      throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY must be the rotatable sb_publishable_ key; legacy JWT-shaped keys are refused.");
    }
  }

  return {
    // Both deployments are root-mounted: the web server's origin root and
    // Capacitor's `capacitor://localhost/` / `http://localhost/` asset root.
    // A relative base (`./`) breaks a cold document load from any nested route:
    // `./assets/app.js` resolves to `/settings/assets/app.js` and the APK shows
    // a white screen after process-death restore. Keep the native shell rooted
    // and allow VITE_BASE only for an explicit deployment override.
    base: process.env.VITE_BASE ?? "/",
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react()],
    build: {
      // No source maps in any shipped artifact. Vite's default, but stated
      // explicitly: a map next to the minified bundle publishes the original
      // source (including comments naming internal tables and flows) to anyone
      // who opens devtools — or to a scraper fetching *.map.
      sourcemap: false,
      // The app ships as one big bundle otherwise (>500 kB chunks). Split the
      // heavy, rarely-changing vendors so first paint isn't blocked by them and
      // repeat visits hit cache.
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            // recharts is deliberately NOT listed here. Naming it explicitly
            // made Rollup emit a shared `charts` chunk that the entry imported
            // statically (~402 kB parsed on every cold start, before the first
            // screen). Charts only appear on lazy routes (VPR, Recovery, Events,
            // Development, Compare, Injury, SkillAnalytics, Mental), so Rollup
            // now places recharts in the chunks that actually use it and it is
            // fetched on demand instead of on the startup critical path.
            motion: ["framer-motion"],
            supabase: ["@supabase/supabase-js"],
          },
        },
      },
      chunkSizeWarningLimit: 800,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
  };
});
