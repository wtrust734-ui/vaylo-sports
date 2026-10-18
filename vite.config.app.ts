import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

/**
 * Vaylo web app Vite configuration.
 *
 * One entry point for the app itself. Other configs in the repo
 * (site generation, tooling, snippets) should not reuse this file's
 * name or path so their concerns stay separate.
 */

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-app",
    sourcemap: false,
  },
  preview: {
    port: 4273,
    strictPort: true,
  },
});
