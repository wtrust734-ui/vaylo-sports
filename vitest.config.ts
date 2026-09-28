import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // `supabase/functions/**` is included deliberately: pure helpers that the
    // edge functions share live beside them (`_shared/coachVoice.test.ts`
    // states it relies on the include patterns), and src-side mirror tests
    // import those modules directly. They were silently never run before.
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/**/*.{test,spec}.{ts,tsx}",
    ],
    // A test that imports a module which reaches the Supabase client used to
    // pass on a developer machine and fail in CI, because only the machine had
    // a .env: `createClient` throws at import time without a URL, and the whole
    // file then reports as one collection error. Placeholders make the suite
    // depend on nothing outside the repository. Nothing here talks to Supabase —
    // a test that needs the network has to say so.
    env: {
      VITE_SUPABASE_URL: "https://placeholder.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "placeholder-publishable-key",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
