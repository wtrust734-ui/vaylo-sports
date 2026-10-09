import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";


const read = (file: string) =>
  readFileSync(path.resolve(__dirname, "../..", file), "utf8").replace(/\r\n?/g, "\n");

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
    // Local secrets are optional in source checkouts. Validate them if present;
    // Vite's build guard above is required regardless of local configuration.
    if (existsSync(path.resolve(__dirname, "../../.env"))) {
      expect(read(".env")).not.toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY=["']?eyJ/);
    }
  });

  it("does not configure a preview host as a canonical URL", () => {
    expect(example).not.toMatch(/VITE_PUBLIC_APP_URL\s*=\s*https?:\/\/[^\s]*lovable\.app/i);
    if (existsSync(path.resolve(__dirname, "../../.env.local"))) {
      expect(read(".env.local")).not.toMatch(/VITE_PUBLIC_APP_URL\s*=\s*https?:\/\/[^\s]*lovable\.app/i);
    }
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
