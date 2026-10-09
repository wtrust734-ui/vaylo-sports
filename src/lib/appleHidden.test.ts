// ============================================================================
// APPLE / iPHONE — the surfaces that must stay hidden
// ----------------------------------------------------------------------------
// The request was: hide everything to do with Apple, and unhide it later on
// instruction. Two different mechanisms do that hiding, and both are asserted
// here, because they fail in different ways:
//
//   1. THE FLAG. Every Apple surface inside the app is behind
//      `isFlagOn("iphone")`. If someone removes one of those guards the surface
//      does not come back subtly — it comes back in a build nobody reviewed, on
//      a screen that still claims the app runs on a phone it does not run on.
//
//   2. THE COPY. The legal documents and the website are edited rather than
//      toggled (a published privacy policy cannot be behind a feature flag), so
//      those are asserted as text that must not reappear.
//
// The argument that the HealthKit copy inside `ProviderCard` is unreachable:
// the only call site is `{isFlagOn("iphone") && <ProviderCard id="healthkit" />}`,
// so with the flag off the component is never created and no branch inside it
// can render. That is why the assertions below check the call site rather than
// every line of the card.
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isFlagOn } from "@/config/featureFlags";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n?/g, "\n");

/** Every locale file, so a new language added later is covered by construction. */
const LOCALES = readdirSync(join(root, "src", "i18n", "locales")).map((dir) =>
  join("src", "i18n", "locales", dir, "index.json"),
);

describe("the flag", () => {
  it("ships with every iPhone surface off", () => {
    expect(isFlagOn("iphone"), "the iPhone build does not exist yet").toBe(false);
  });
});

describe("app surfaces", () => {
  it("gates the HealthKit card", () => {
    // The single call site. Everything Apple-ish in HealthSync hangs off this
    // component, so gating the call site gates all of it.
    const page = read("src/pages/HealthSync.tsx");
    expect(page).toContain('{isFlagOn("iphone") && <ProviderCard id="healthkit" />}');
    // Exactly one render site, and it is the guarded one — an unguarded second
    // call elsewhere on the screen would otherwise slip through.
    const sites = page.split("\n").filter((l) => l.includes('<ProviderCard id="healthkit" />'));
    expect(sites).toHaveLength(1);
    expect(sites[0]).toContain('isFlagOn("iphone")');
  });

  it("gates the iPhone copy that sits outside the card", () => {
    const page = read("src/pages/HealthSync.tsx");
    // Three strings promise the app exists on iPhone. Each must carry the flag
    // on its own line so a reviewer cannot miss it in a diff.
    for (const needle of [
      "on iPhone, use Apple Health below",
      "Samsung{isFlagOn(\"iphone\") ? \", Apple\" : \"\"}",
      "on iPhone, Apple Watch syncs via HealthKit automatically",
    ]) {
      const line = page.split("\n").find((l) => l.includes(needle));
      expect(line, `no line containing: ${needle}`).toBeDefined();
      expect(line, `unguarded Apple copy: ${needle}`).toContain('isFlagOn("iphone")');
    }
  });

  it("gates Apple sign-in", () => {
    const page = read("src/pages/Auth.tsx");
    expect(page).toContain('{isFlagOn("iphone") && methods!.providers.includes("apple") && (');
    expect(page).not.toMatch(/\{methods!\.providers\.includes\("apple"\) && \(/);
  });

  it("keeps Apple out of the wearable provider copy that does render", () => {
    // The Strava card is on screen with the flag off, so its description is not
    // something the flag can hide — the word simply does not belong there.
    const providers = read("src/lib/health/providers.ts");
    const strava = providers.slice(providers.indexOf("strava:"), providers.indexOf("strava:") + 700);
    expect(strava).not.toMatch(/Apple/i);
    // The healthkit spec itself stays as data for a card that does not render.
    expect(providers).toContain('label: "Apple Health"');
  });

  it("keeps Apple out of every locale's hub copy", () => {
    expect(LOCALES.length).toBeGreaterThanOrEqual(12);
    for (const file of LOCALES) {
      expect(read(file), `${file} mentions Apple`).not.toMatch(/Apple|iPhone/);
    }
  });
});

describe("website and legal copy", () => {
  it("says nothing about Apple on the website", () => {
    // site/data/app-preview.mjs used to be on this list; the whole app-preview
    // subsystem (the /app/ pages it fed) was deleted from the main website,
    // so the live privacy page is the copy that matters now.
    expect(read("site/pages/privacy.mjs")).not.toMatch(/Apple|iPhone|IDFA/);
    // The README is the project's front door; it no longer claims Apple OAuth.
    expect(read("README.md")).not.toMatch(/Google & Apple OAuth/);
  });

  it("publishes legal documents that name no Apple", () => {
    // `-apple-system` is a font stack that appears on every legal page and must
    // stay: removing it changes typography for a word no user ever sees.
    const legalDir = join(root, "legal");
    const pages = readdirSync(legalDir).filter((f) => f.endsWith(".html"));
    expect(pages.length).toBeGreaterThanOrEqual(20);
    for (const file of pages) {
      const body = readFileSync(join(legalDir, file), "utf8")
        .replace(/-apple-system/gi, "")
        .replace(/apple-touch-icon/gi, "");
      expect(body, `${file} mentions Apple`).not.toMatch(/Apple|iPhone|IDFA/);
    }
    // The embedded copy served by the legal function must match those sources.
    expect(read("supabase/functions/legal/pages.generated.ts")).not.toMatch(/\bApple\b/);
  });

  it("still carries the disclosure those documents must not lose", () => {
    // Removing "Apple" from advertising.html must not become an excuse to
    // soften the claim the document exists to make.
    const body = read("legal/advertising.html");
    expect(body).toMatch(/No advertising identifiers/i);
    expect(body).toMatch(/Google's Advertising ID/);
  });
});
