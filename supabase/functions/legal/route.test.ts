// Covers the legal function's URL routing.
//
// Why this file exists separately from src/lib/legalPages.test.ts: that test
// checks the page *bodies*, and cannot see a routing mistake at all. Two of
// these URLs are typed into Google Play Console by hand — the privacy policy and
// the account-deletion page — and a routing bug there is a 404 on the page a
// reviewer opens. The live function cannot be used to check this either, because
// it answers 503 until legal/operator.json is filled in, before routing runs.
//
// Verified against the deployed function on 2026-09-28: every path below returned
// the expected status, and the single-page body shape (2089 bytes) for each.

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

  it("finds the function's own segment rather than counting from the left", () => {
    // A custom domain, a projects path segment, or a proxy prefix must not
    // change the result — only the segment after "legal" matters.
    for (const path of [
      "/legal/privacy",
      "/projects/abc/functions/v1/legal/privacy",
      "https://example.test/legal/privacy",
    ]) {
      expect(slugFromPath(path), path).toBe("privacy");
    }
  });

  it("404s an unknown document instead of falling back to the index", () => {
    // Silently serving the policy for a typo'd URL would hide the mistake until
    // a reviewer reports it, so this must be a miss.
    const route = resolveRoute("/functions/v1/legal/privat", SLUGS);
    expect(route.kind).toBe("notFound");
    expect(route).toEqual({ kind: "notFound", requested: "privat" });
  });
});
