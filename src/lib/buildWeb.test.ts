import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// scripts/build-web.cjs is CommonJS and guards its build behind require.main,
// so importing it reads the generated file templates without compiling a bundle.
// That matters: a real Vite build under vitest fails vite.config.ts's own env
// validation, which refuses the legacy JWT-shaped key outside test mode — so a
// test that shelled out to the build would fail for reasons unrelated to what it
// is asserting.
const require = createRequire(import.meta.url);
const buildWeb = require(resolve(__dirname, "..", "..", "scripts", "build-web.cjs")) as {
  HEADERS: string;
  NETLIFY_TOML: string;
  APP_SITE_ID: string;
  OUT: string;
};

const ROOT = resolve(__dirname, "..", "..");
const MARKETING_SITE_ID = "388b0b24-27ee-472b-9197-aa8eb2782493";

// _headers writes "Name: value"; netlify.toml writes 'Name = "value"'. Both are
// matched here, allowing whitespace either side of the separator, because the
// point is that both files declare the same header — not which syntax each uses.
const header = (name: string, value: string) =>
  new RegExp(name + "\\s*[:=]\\s*\"?" + value + "\"?");

/**
 * These assertions exist because of a failure that was silent, public, and
 * survived a deploy that reported "Deploy is live!".
 *
 * `publish = "."` in the generated netlify.toml does not mean the build output.
 * The Netlify CLI finds the config file by walking up from the working
 * directory, but resolves `publish` against the CLI's detected base — the
 * repository root. The result was a live site serving the marketing pages, the
 * real package.json and src/*.tsx, discovered only by reading the deployed file
 * list. Pinning `base = "."` does not help, because base is itself measured from
 * that same root.
 */
describe("generated web host files", () => {
  it("publishes the build output, not the repository", () => {
    expect(buildWeb.NETLIFY_TOML).toMatch(/^\s*publish\s*=\s*"dist-web"\s*$/m);
    // The dangerous form is publish = "." with no path segment.
    expect(buildWeb.NETLIFY_TOML).not.toMatch(/^\s*publish\s*=\s*"\."\s*$/m);
  });

  it("keeps the SPA fallback in both host files", () => {
    expect(buildWeb.NETLIFY_TOML).toMatch(/status\s*=\s*200/);
    // _redirects is copied from public/ by the build; assert the source of truth.
    const redirects = readFileSync(resolve(ROOT, "public", "_redirects"), "utf8");
    expect(redirects).toMatch(/\/\*[\s,]+.*\/index\.html\s+200/);
  });

  it("sets the security headers in both files, with the same values", () => {
    // netlify.toml is what Netlify reads when deployed from the output directory;
    // _headers is what Cloudflare Pages reads. When only the site's own toml was
    // in force, _headers was not applied at all and the live site served no
    // X-Frame-Options and no nosniff.
    for (const file of [buildWeb.NETLIFY_TOML, buildWeb.HEADERS]) {
      expect(file).toMatch(header("X-Frame-Options", "DENY"));
      expect(file).toMatch(header("X-Content-Type-Options", "nosniff"));
      expect(file).toMatch(header("Referrer-Policy", "strict-origin-when-cross-origin"));
    }
  });

  it("never emits the marketing site's SAMEORIGIN framing policy", () => {
    // The repository root netlify.toml uses SAMEORIGIN. If the app deploy ever
    // picks that file up, the clickjacking protection silently weakens.
    expect(buildWeb.NETLIFY_TOML).not.toMatch(/SAMEORIGIN/);
    expect(buildWeb.HEADERS).not.toMatch(/SAMEORIGIN/);
  });

  it("pins hashed assets immutable and the shell revalidated", () => {
    expect(buildWeb.NETLIFY_TOML).toMatch(/max-age=31536000,\s*immutable/);
    expect(buildWeb.NETLIFY_TOML).toMatch(/Cache-Control\s*=\s*"no-cache"/);
  });

  it("names a site id that is not the marketing site", () => {
    expect(buildWeb.APP_SITE_ID).toMatch(/^[a-f0-9-]{36}$/);
    // The repository root is linked to the marketing and legal site; publishing
    // the app bundle there would replace the 26 legal pages.
    expect(buildWeb.APP_SITE_ID).not.toBe(MARKETING_SITE_ID);
  });

  it("prints a publish command that does not build", () => {
    const script = readFileSync(resolve(ROOT, "scripts", "build-web.cjs"), "utf8");
    // Without --no-build the CLI runs build-command detection, which prompts on a
    // terminal with no TTY and dies with ERR_USE_AFTER_CLOSE before uploading.
    expect(script).toMatch(/netlify deploy --no-build --prod --site=\$\{APP_SITE_ID\}/);
  });

  it("writes host files into the output only, never into public/", () => {
    // public/ is copied into the APK, where _headers and netlify.toml do nothing
    // but ship as dead weight.
    expect(existsSync(resolve(ROOT, "public", "_headers"))).toBe(false);
    expect(existsSync(resolve(ROOT, "public", "netlify.toml"))).toBe(false);
  });

  it("never builds into the native output directory", () => {
    // dist/ is the exact input to `npx cap sync android`. Overwriting it between
    // a build and a gradle run ships the wrong JavaScript inside the APK.
    expect(resolve(buildWeb.OUT)).not.toBe(resolve(ROOT, "dist"));
  });
});
