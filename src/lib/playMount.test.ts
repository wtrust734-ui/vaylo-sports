import { describe, it, expect, afterAll } from "vitest";
import {
  readFileSync,
  readdirSync,
  rmSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// scripts/build-web.cjs and scripts/deploy-web.cjs are CommonJS and guard their
// work behind require.main, so importing them reads the templates and constants
// without compiling a bundle or touching the network. That matters: a real Vite
// build under vitest fails vite.config.ts's own env validation, which refuses the
// legacy JWT-shaped key outside test mode.
const require = createRequire(import.meta.url);
const buildWeb = require(resolve(__dirname, "..", "..", "scripts", "build-web.cjs")) as {
  BASE: string;
  EMBEDDED: boolean;
  ROOT_ONLY_FILES: string[];
  resolveBase: (raw?: string) => string;
};
const deployWeb = require(resolve(__dirname, "..", "..", "scripts", "deploy-web.cjs")) as {
  PLAY_BASE: string;
  SITE_DIR: string;
  verify: (siteDir?: string) => void;
};

const ROOT = resolve(__dirname, "..", "..");
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Temp dirs to remove when the file finishes, however it finishes. */
const scratchDirs: string[] = [];

/**
 * A site directory that verify() accepts, built in a temp dir.
 *
 * Deliberately not a copy of the real website/. gen-website.cjs deletes
 * website/ every time it is invoked, so a test that depends on one is really
 * asserting "a build was run recently", which is not what any of these are
 * about. The fixture is the happy path by construction — a generated site with
 * no app preview — so each test can break precisely one property and see
 * precisely that rejection.
 */
function fixtureSite(): string {
  const dir = mkdtempSync(join(tmpdir(), "vaylo-deploy-"));
  scratchDirs.push(dir);
  writeFileSync(
    join(dir, "index.html"),
    "<!doctype html><html><head><title>fixture</title></head><body></body></html>\n",
  );
  return dir;
}

// Fixtures are made in %TEMP% so a test cannot damage the real website/.
// afterAll rather than a per-test finally: the point of the fixture is that each
// test can break it however it likes, so the tests no longer own cleanup.
afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs.length = 0;
});

/**
 * These assertions exist because the failure mode is silent and only appears
 * after a deploy.
 *
 * The app preview that used to be mounted at /play/ has been deleted from the
 * main website. Two questions from that work still have live code behind them:
 * what the router thinks the current path is, and which host files belong to a
 * root-mounted build — both still used by the standalone web build the
 * downloadable clone (`npm run build:clone`) is made from. The rest of this
 * file covers the mount as a capability plus a deploy that must never
 * resurrect the preview.
 */

// ---------------------------------------------------------------------------
// 1. The router knows where it is mounted
// ---------------------------------------------------------------------------

describe("router mount prefix", () => {
  // Under vitest, Vite's BASE_URL is the config default, so this is the
  // root-mounted case — the APK and the standalone web build. The /play/ case is
  // asserted against the built bundle in the "embedded build" block below, since
  // the value is inlined at compile time and cannot be exercised by changing the
  // environment at runtime.
  it("is empty at the origin root, which is the case the APK ships", async () => {
    // Under vitest, Vite's BASE_URL is the config default, so this genuinely is
    // the root-mounted case rather than a stand-in for it. React Router wants ""
    // here, not "/", because it strips the basename before matching.
    const { routerBasename, appHref } = await import("@/lib/routerBase");
    expect(routerBasename()).toBe("");
    // At the root mount an href is unchanged, so no link moves when the app is
    // served root-mounted. This is the regression guard for the sub-path work.
    expect(appHref("/auth")).toBe("/auth");
  });

  it("gives BrowserRouter a basename on the web and none in the APK", () => {
    const app = src("src/App.tsx");
    expect(app).toContain("routerBasename");
    expect(app).toMatch(/const routerProps = isNativeShell\(\) \? \{\} : \{ basename: routerBasename\(\) \}/);
    // A HashRouter inside Capacitor has no server path to strip. Passing a
    // basename there would be meaningless rather than harmless.
    expect(app).toMatch(/<Router \{\.\.\.routerProps\}>/);
  });

  it("has no root-absolute anchor left that would full-load past the mount", () => {
    // A plain <a href="/auth"> is a document load: the browser asks the marketing
    // site for /auth, which answers with its own 404. There were eight of these.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".tsx") || entry.name.includes(".test.")) continue;
        const text = readFileSync(full, "utf8");
        // href="/…", but not href="/play/…", which is the site's own link and
        // never appears in app source.
        if (/href="\/(?!play\/)[a-z]/.test(text)) offenders.push(full);
      }
    };
    walk(join(ROOT, "src"));
    expect(offenders, "these full-load anchors break under a sub-path mount").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. The build knows it is embedded
// ---------------------------------------------------------------------------

describe("embedded base", () => {
  it("normalises a sub-path to exactly one trailing slash", () => {
    // Vite treats "/play" and "/play/" differently in emitted asset URLs, and
    // routerBase.ts reads BASE_URL for the basename. If these disagree the
    // router 404s on a page whose assets loaded fine.
    expect(buildWeb.resolveBase("/play")).toBe("/play/");
    expect(buildWeb.resolveBase("/play/")).toBe("/play/");
    expect(buildWeb.resolveBase("/")).toBe("/");
    expect(buildWeb.resolveBase("/")).toBe("/");
    expect(buildWeb.resolveBase(undefined)).toBe("/");
  });

  it("rejects a base that is not a simple absolute path", () => {
    // A relative base makes Vite emit "./assets/…", which 404s on every nested
    // route and is invisible in the build log. "//host" and a path with ".."
    // would write outside the publish root.
    for (const bad of ["play/", "./play", "/a/../b", "//evil.example", "http://x", "/a?b"]) {
      expect(() => buildWeb.resolveBase(bad), `accepted ${bad}`).toThrow();
    }
  });

  it("throws rather than exiting, so requiring the module is safe", () => {
    // resolveBase runs at require time via BASE. If it called process.exit on a
    // bad VITE_BASE, a stray value in the environment would kill the whole test
    // run with no assertion and no file name.
    expect(() => buildWeb.resolveBase("nope")).toThrow(/build-web|must start/);
  });

  it("names the host files that belong only to a root-mounted build", () => {
    // Each is read from the publish root by its host and sets nothing from a
    // sub-directory. A nested _redirects carrying "/* /index.html 200" would
    // additionally be a claim about the whole origin.
    for (const name of ["_headers", "netlify.toml", "_redirects"]) {
      expect(buildWeb.ROOT_ONLY_FILES).toContain(name);
    }
  });

  it("strips them from an embedded build and asserts the assets are prefixed", () => {
    const script = src("scripts/build-web.cjs");
    expect(script).toMatch(/if \(embedded\) \{/);
    // Vite copies public/_redirects in on its own, so it must be removed rather
    // than merely not-written.
    expect(script).toMatch(/for \(const name of ROOT_ONLY_FILES\)/);
    expect(script).toMatch(/does not reference \$\{prefix\}\/assets\//);
  });
});

// ---------------------------------------------------------------------------
// 3. The host serves the site (the /play/ preview mount was removed)
// ---------------------------------------------------------------------------

describe("netlify.toml", () => {
  const toml = src("netlify.toml");

  it("carries no /play/ rules — the app preview was deleted", () => {
    // The live-app mount used to need a SPA fallback and per-path cache rules
    // here. With the preview gone from the main website every /play/ rule
    // would serve nothing, so their absence is the assertion.
    expect(toml).not.toMatch(/\/play\//);
  });

  it("keeps the framing policy", () => {
    // SAMEORIGIN permits exactly one thing: being framed by this same origin —
    // which the srcDoc legal documents rely on. It still blocks every other
    // site, so nothing on this origin can be framed cross-site.
    expect(toml).toMatch(/X-Frame-Options = "SAMEORIGIN"/);
    expect(toml).not.toMatch(/X-Frame-Options = "DENY"/);
  });
});

// ---------------------------------------------------------------------------
// 4. One command, and it cannot publish the removed preview
// ---------------------------------------------------------------------------

describe("the deploy orchestrator", () => {
  it("generates the site, verifies it, then deploys — nothing else in between", () => {
    // gen-website.cjs does rmSync(OUT_DIR), so the generator must run in the
    // same invocation as the deploy. No app bundle is built into the site any
    // more: the preview was deleted, and verify() checks its absence instead.
    const script = src("scripts/deploy-web.cjs");
    const generate = script.indexOf('run("gen-website.cjs")');
    const verified = script.indexOf("verify()");
    const deploy = script.indexOf('"deploy", "--no-build"');
    expect(generate, "the generator is not called").toBeGreaterThan(-1);
    expect(verified, "verify() is not called").toBeGreaterThan(-1);
    expect(deploy, "the deploy is not issued").toBeGreaterThan(-1);
    expect(verified, "verify must run after generating").toBeGreaterThan(generate);
    expect(deploy, "the deploy must come last").toBeGreaterThan(verified);
    // The embedded build (WEB_OUT_DIR=website/play) is gone with the preview.
    expect(script, "the app must not be built into the site").not.toMatch(/WEB_OUT_DIR/);
  });

  it("is parseable TOML, or every deploy dies at the config step", () => {
    // Not a substitute for a real parser — a deliberately minimal one. These are
    // the two shapes that actually broke this file, and both are invisible to
    // the structural checks below.
    const toml = src("netlify.toml");

    const glued = toml
      .split(/\r?\n/)
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /^\s*[\w"'-]+\s*=.*\[\[/.test(line));
    expect(
      glued.map(([n, line]) => `${n}: ${line}`),
      "a value and a table header share a line — TOML has no line continuation, so this is a parse error",
    ).toEqual([]);

    // A table header must be the first thing on its line, or it is part of the
    // value before it.
    const inline = toml
      .split(/\r?\n/)
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /\S\s+\[\[/.test(line) && !line.trimStart().startsWith("["));
    expect(
      inline.map(([n, line]) => `${n}: ${line}`),
      "a [[table]] header does not start its line",
    ).toEqual([]);

    // Keys must not be separated onto one line by a stray join, which is the
    // other way this file could stop parsing while still containing the strings
    // the other tests look for.
    const twoKeys = toml
      .split(/\r?\n/)
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /^[^[\s#][^=]*=[^#]*\S\s+=\s*\S/.test(line));
    expect(
      twoKeys.map(([n, line]) => `${n}: ${line}`),
      "a line carries two assignments",
    ).toEqual([]);
  });

  it("keeps every table header on its own line and every rule separated", () => {
    // The catch-all is the only redirect and the global block the only header
    // table: the /play/ fallback and its per-path cache rules went with the
    // preview. Asserted on structure rather than on a string match so a glued
    // form cannot pass.
    const toml = src("netlify.toml");
    const tables = toml.split(/\r?\n/).filter((l) => l.trimStart().startsWith("["));
    expect(
      tables.filter((l) => l.trim() === "[[redirects]]").length,
      "expected one [[redirects]] block: the catch-all",
    ).toBe(1);
    expect(
      tables.filter((l) => l.trim() === "[[headers]]").length,
      "expected one global [[headers]] block",
    ).toBe(1);
  });

  it("passes --no-build, because build detection prompts with no TTY", () => {
    // Without it the CLI dies with ERR_USE_AFTER_CLOSE before uploading anything.
    const script = src("scripts/deploy-web.cjs");
    expect(script).toMatch(/"deploy", "--no-build", "--prod"/);
  });

  it("launches the Netlify CLI through node, not a .cmd shim", () => {
    // execFileSync("npx.cmd", …) is EINVAL on Windows: a batch file cannot be
    // spawned without a shell. The deploy died at that line, after the site was
    // generated and the app was built. Asserted because the failure is
    // platform-specific and invisible on any machine that is not Windows.
    const script = src("scripts/deploy-web.cjs");
    expect(script).not.toMatch(/npx\.cmd/);
    expect(script).toMatch(/function netlifyCommand\(\)/);
    // And the resolved command has to actually be the CLI, not just that the
    // helper exists: a helper that returned node with no arguments would spawn
    // a REPL and hang.
    const { netlifyCommand } = require(resolve(ROOT, "scripts", "deploy-web.cjs")) as {
      netlifyCommand: () => string[];
    };
    const [command, ...args] = netlifyCommand();
    expect(command, "the Netlify CLI must be run by the current node binary").toBe(process.execPath);
    expect(
      args.some((a) => a.endsWith("run.js") || a.endsWith("npx-cli.js")),
      `neither a local netlify-cli nor npx was found: ${JSON.stringify(args)}`,
    ).toBe(true);
  });

  it("names the marketing site explicitly rather than trusting the link", () => {
    // The repo root is linked to the marketing site, but naming it means a
    // mis-linked checkout cannot publish an app bundle over the legal pages.
    expect(deployWeb.SITE_DIR.replace(/\\/g, "/")).toMatch(/website$/);
    const script = src("scripts/deploy-web.cjs");
    expect(script).toMatch(/MARKETING_SITE_ID = "388b0b24-27ee-472b-9197-aa8eb2782493"/);
    expect(script).toMatch(/--site=\$\{MARKETING_SITE_ID\}/);
  });

  it("accepts a site with no app preview, so the rejections below mean something", () => {
    // The other tests here assert that verify() throws. That is only evidence
    // if verify() does not throw on a good site — otherwise every assertion
    // could be passing on the first check it happens to reach. This pins that,
    // and it costs one call.
    expect(() => deployWeb.verify(fixtureSite())).not.toThrow();
  });

  it("refuses a site that carries the removed app preview", () => {
    // Exercised for real, not asserted on source. The preview (website/play/ +
    // website/app/) was deleted from the main website; if it ever reappears in
    // the generated output the deploy stops rather than publishing it.
    for (const dir of ["play", "app"]) {
      const scratch = fixtureSite();
      mkdirSync(join(scratch, dir), { recursive: true });
      writeFileSync(join(scratch, dir, "index.html"), "<!doctype html></html>\n");
      expect(() => deployWeb.verify(scratch), `website/${dir} was accepted`).toThrow(
        /removed app preview/,
      );
    }
  });

  it("refuses a site with no index.html", () => {
    // The generator did not run, or ran into a failure that left the directory
    // empty — deploying that would publish nothing at all.
    const scratch = mkdtempSync(join(tmpdir(), "vaylo-deploy-"));
    scratchDirs.push(scratch);
    expect(() => deployWeb.verify(scratch)).toThrow(/index\.html is missing/);
  });
});