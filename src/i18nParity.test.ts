import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// BUNDLE PARITY — every language must carry the same key set as English.
// A key missing in one language silently falls back to English at runtime
// (never a raw key), but drift adds up. This test makes drift loud at
// build time instead of quiet at runtime.
// ============================================================================

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, "i18n", "locales");

type Flat = Map<string, string>;

function flatten(obj: Record<string, unknown>, prefix = "", out: Flat = new Map()): Flat {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      flatten(value as Record<string, unknown>, path, out);
    } else {
      out.set(path, String(value));
    }
  }
  return out;
}

function loadBundle(code: string): Flat {
  const raw = JSON.parse(readFileSync(join(localesDir, code, "index.json"), "utf8"));
  return flatten(raw);
}

const codes = readdirSync(localesDir).filter((f) => f.length === 2);

const en = loadBundle("en");

describe("i18n bundle parity", () => {
  it("has at least the 12 supported languages on disk", () => {
    expect(codes.length).toBeGreaterThanOrEqual(12);
    for (const required of ["en", "es", "fr", "de", "pt", "it", "nl", "ar", "zh", "ja", "ko", "hi"]) {
      expect(codes, `missing language folder: ${required}`).toContain(required);
    }
  });

  it("every bundle has exactly the English key set", () => {
    for (const code of codes) {
      if (code === "en") continue;
      const bundle = loadBundle(code);
      const missing = [...en.keys()].filter((k) => !bundle.has(k));
      const extra = [...bundle.keys()].filter((k) => !en.has(k));
      expect(missing, `${code}: keys missing vs en`).toEqual([]);
      expect(extra, `${code}: keys not present in en`).toEqual([]);
    }
  });

  it("no translation is empty (empty strings fall back to English at runtime)", () => {
    for (const code of codes) {
      const bundle = loadBundle(code);
      for (const [key, value] of bundle) {
        expect(value.trim().length, `${code}:${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("interpolation placeholders match English", () => {
    const placeholder = /\{\{(\w+)\}\}/g;
    for (const code of codes) {
      if (code === "en") continue;
      const bundle = loadBundle(code);
      for (const [key, enValue] of en) {
        const enVars = [...(enValue.match(placeholder) ?? [])].sort();
        const locVars = [...((bundle.get(key) ?? "").match(placeholder) ?? [])].sort();
        expect(locVars, `${code}:${key} placeholders differ from en`).toEqual(enVars);
      }
    }
  });

  it("registry, lazy loaders and disk agree", async () => {
    const { LANGUAGES } = await import("./i18n/languages");
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(codes.sort());
  });
});
