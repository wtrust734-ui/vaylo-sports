import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";


const read = (file: string) =>
  readFileSync(path.resolve(__dirname, "../..", file), "utf8").replace(/\r\n?/g, "\n");

/**
 * `.env` and `.env.local` are git-ignored local files: CI and fresh clones do
 * not have them, and a test that threw on their absence would fail every CI
 * run for a fact about the checkout rather than about the build. The
 * build-time enforcement is asserted against vite.config.ts above; these
 * checks are the local belt-and-braces, so they run when the file is there.
 */
const readIfPresent = (file: string): string | null => {
  try {
    return read(file);
  } catch {
    return null;
  }
};

const vite = read("vite.config.ts");
const share = read("src/lib/share.ts");
const example = read(".env.example");
const ignore = read(".gitignore");

describe("native release hardening", () => {
  it("builds the native bundle with a root-absolute asset base", () => {
    expect(vite).toMatch(/base:\s*process\.env\.VITE_BASE\s*\?\?\s*["']\/["']/);
    expect(vite).not.toMatch(/mode\s*===\s*["']native["']\s*\?\s*["']\.\/["']/);
  });

  it("requires the rotatable publishable key for all non-test builds", () => {
    expect(vite).toContain("publishableKey.startsWith(\"sb_publishable_\")");
    expect(vite).toContain("mode !== \"test\"");
    expect(example).toContain("VITE_SUPABASE_PUBLISHABLE_KEY=");
    // Guarded on the variable's presence, not the file's: a local .env may
    // legitimately omit the key (loadEnv falls through to .env.local), and CI
    // has no .env at all. Whenever it IS configured here, it must be the
    // rotatable shape.
    const envFile = readIfPresent(".env");
    if (envFile?.includes("VITE_SUPABASE_PUBLISHABLE_KEY=")) {
      expect(envFile).toContain("VITE_SUPABASE_PUBLISHABLE_KEY=\"sb_publishable_");
      expect(envFile).not.toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY=["']?eyJ/);
    }
  });

  it("does not configure a preview host as a canonical URL", () => {
    expect(example).not.toMatch(/VITE_PUBLIC_APP_URL\s*=\s*https?:\/\/[^\s]*lovable\.app/i);
    const envLocal = readIfPresent(".env.local");
    if (envLocal !== null) expect(envLocal).not.toMatch(/^VITE_PUBLIC_APP_URL=/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
  });

  it("fails closed instead of emitting preview-host public links", () => {
    // Public URLs are gated by a deny-list of preview hosts, not one hard-coded check.
    expect(share).toMatch(/const PREVIEW_SUFFIXES = \[[\s\S]*"\.lovable\.app"[\s\S]*\];/);
    expect(share).toContain("if (isNativeShell()) return \"\";");
    expect(share).toMatch(/isPreviewHost\(window\.location\.hostname\)\) return "";/);
  });

  it("disables preview-domain links and referral fallbacks", () => {
    const referrals = read("src/pages/Referrals.tsx");
    expect(share).toContain("export const isPreviewHost");
    expect(share).toMatch(/if \(!configured \|\|[^)]*isPreviewHost\(window\.location\.hostname\)\) return "";/);
    expect(referrals).toContain("const canShareLink = !isNativeShell() && !isPreviewHost(window.location.hostname)");
    expect(referrals).not.toContain("window.location.origin}/auth?ref=");
    expect(referrals).toContain("Referral code: ${code}");
  });
});
