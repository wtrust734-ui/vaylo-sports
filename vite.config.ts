import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // The web build is served from the domain root. `npm run build:native`
  // (mode=native) emits relative asset paths for the Capacitor bundle, and
  // VITE_BASE can override either way.
  base: process.env.VITE_BASE ?? (mode === "native" ? "./" : "/"),
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  build: {
    // The app ships as one big bundle otherwise (>500 kB chunks). Split the
    // heavy, rarely-changing vendors so first paint isn't blocked by them and
    // repeat visits hit cache.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
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
}));
