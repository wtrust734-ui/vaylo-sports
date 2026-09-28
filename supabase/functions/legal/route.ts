// URL routing for the legal function, kept free of any Deno or page-table
// import so it can be unit-tested (supabase/functions/legal/route.test.ts).
//
// This is small but it is exactly the part Play depends on: the privacy policy
// and account-deletion URLs are pasted into Play Console by hand, and a routing
// mistake there is a 404 on the page a reviewer opens. The page bodies are
// covered by src/lib/legalPages.test.ts; this file covers which body a given URL
// resolves to.

export type LegalRoute =
  | { kind: "index" }
  | { kind: "document"; slug: string }
  | { kind: "notFound"; requested: string };

/**
 * The path segments after the function name, whatever the function is mounted
 * under.
 *
 * Counting from the left would break the moment this is served from a custom
 * domain or the routing changes, so the function's own segment is located
 * instead. The last occurrence wins, which keeps a project containing a literal
 * "legal" segment in its own path from confusing the split.
 *
 * A `.html` suffix is stripped because that is the form links *inside* the
 * documents use — a relative `terms.html` has to resolve wherever the pages are
 * mounted — and because a person copying a URL out of a browser may well add it.
 */
export function slugFromPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const mountedAt = segments.lastIndexOf("legal");
  if (mountedAt === -1) return "";
  const after = segments.slice(mountedAt + 1).join("/");
  return after.replace(/\.html$/i, "").toLowerCase();
}

/** Which document a request path resolves to. */
export function resolveRoute(pathname: string, slugs: readonly string[]): LegalRoute {
  const slug = slugFromPath(pathname);
  if (!slug) return { kind: "index" };
  if (slugs.includes(slug)) return { kind: "document", slug };
  return { kind: "notFound", requested: slug };
}
