// Covers the legal function's URL routing.
//
// Why this file exists separately from src/lib/legalPages.test.ts: that test
// checks the page *bodies* and cannot see a routing mistake at all. Two of these
// URLs are typed into Google Play Console by hand — the privacy policy and the
// account-deletion page — and a routing bug there is a 404 on the page a reviewer
// opens, which is not something a unit test of the HTML would catch.
//
// Measured against the deployed function on 2026-09-28, after the operator
// details were filled in and it stopped answering the 503 notice:
//
//   /privacy            200    /terms.html          200
//   /account-deletion   200    /Privacy.HTML/       200
//   /            and "" 200    /privat              404
//
// The 404s matter as much as the 200s: this host must not behave like the
// catch-all SPA it exists to work around, where every path returns the app shell.

import { describe, expect, it } from "vitest";

import { resolveRoute, slugFromPath } from "./route";

const SLUGS = ["privacy", "terms", "account-deletion"];

describe("legal function routing", () => {
  it("resolves the URLs entered in Play Console", () => {
    expect(resolveRoute("/functions/v1/legal/privacy", SLUGS)).toEqual({
      kind: "document",
      slug: "privacy",
    });
    expect(resolveRoute("/functions/v1/legal/account-deletion", SLUGS)).toEqual({
      kind: "document",
      slug: "account-deletion",
    });
  });

  it("serves the function root as an index", () => {
    for (const path of ["/functions/v1/legal", "/functions/v1/legal/", "/legal"]) {
      expect(resolveRoute(path, SLUGS), path).toEqual({ kind: "index" });
    }
  });

  it("accepts the .html suffix used by links inside the documents", () => {
    // These pages link to each other relatively, so a bare `terms.html` has to
    // resolve wherever the pages are mounted.
    expect(resolveRoute("/functions/v1/legal/terms.html", SLUGS)).toEqual({
      kind: "document",
      slug: "terms",
    });
    // Case and trailing slash should not decide whether a reviewer finds it.
    expect(resolveRoute("/functions/v1/legal/Privacy.HTML/", SLUGS)).toEqual({
      kind: "document",
      slug: "privacy",
    });
  });

  it("locates the function's own segment instead of counting from the left", () => {
    // Defensive, and deliberately narrower than it may look: Supabase only
    // delivers /functions/v1/legal/* to this function, so the prefixed paths here
    // are NOT reachable today — the deployed host answers 404 for
    // /projects/abc/functions/v1/legal/privacy because the request never reaches
    // this code. What is being pinned is that slugFromPath does not depend on a
    // fixed offset, so serving these pages from a custom domain later does not
    // silently break them.
    for (const path of [
      "/legal/privacy",
      "/projects/abc/functions/v1/legal/privacy",
      "/functions/v1/legal/privacy",
    ]) {
      expect(slugFromPath(path), path).toBe("privacy");
    }
    // Only the segment after the function name counts, whatever precedes it.
    expect(slugFromPath("https://example.test/anything/legal/privacy")).toBe("privacy");
  });

  it("404s an unknown document instead of falling back to the index", () => {
    // Silently serving the policy for a typo'd URL would hide the mistake until
    // a reviewer reported it, so this must be a miss.
    const route = resolveRoute("/functions/v1/legal/privat", SLUGS);
    expect(route.kind).toBe("notFound");
    expect(route).toEqual({ kind: "notFound", requested: "privat" });
  });
});
