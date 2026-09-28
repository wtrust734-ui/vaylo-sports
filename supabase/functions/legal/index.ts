/**
 * legal — publishes the privacy policy, terms and account-deletion pages.
 *
 * Why an edge function serves legal documents: Google Play will not publish a
 * store listing without a reachable privacy policy URL, and this project has no
 * public web host yet. The domain the code defaults to, vaylosports.com, does
 * not resolve. Rather than block the release on buying and configuring a domain,
 * the pages are served from infrastructure that is already deployed and already
 * public, so the URL Play needs exists today.
 *
 * Deploy with --no-verify-jwt: these pages are read by Play's reviewers, by
 * anyone following the link from the store listing, and by the app itself, none
 * of whom have a session.
 *
 *   supabase functions deploy legal --no-verify-jwt
 *
 * URLs (replace <ref> with the project ref):
 *
 *   /functions/v1/legal                    index of the three documents
 *   /functions/v1/legal/privacy            the policy, for Play Console
 *   /functions/v1/legal/terms
 *   /functions/v1/legal/account-deletion   for Play Console → Data deletion
 *
 * The `.html` suffix is accepted too, and is the form used for links *inside*
 * the pages, so a relative `terms.html` resolves wherever the function is
 * mounted. Moving to a real domain later is a DNS and routing change; nothing in
 * the documents themselves refers to this host.
 */
import {
  CONTACT_EMAIL,
  LEGAL_PAGES,
  OPERATOR_DETAILS_UNSET,
  OPERATOR_NAME,
} from "./pages.generated.ts";
import { resolveRoute } from "./route.ts";

const SLUGS = Object.keys(LEGAL_PAGES);

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  // Nothing here is personalised, and a reviewer may hit it repeatedly.
  "Cache-Control": "public, max-age=300",
  // Belt and braces for a page that must not run code: even if markup were ever
  // injected into a document, there is no script source it could reach.
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN",
};

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: SECURITY_HEADERS });
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${title} — Vaylo Sports</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 30px 20px 64px; background: #05070f; color: #e8ecf6;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  main { max-width: 720px; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
  .mark { width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, hsl(217 100% 60%), hsl(265 90% 62%)); }
  .brand span { font-weight: 700; letter-spacing: -0.01em; }
  h1 { font-size: 1.45rem; letter-spacing: -0.01em; margin: 0 0 10px; }
  p, li { color: #c9d2e4; }
  a { color: hsl(217 100% 72%); }
  ul { padding-left: 20px; }
  li { margin: 8px 0; }
  code { background: #0c1120; border: 1px solid #1b2438; border-radius: 6px; padding: 1px 6px; font-size: 0.9em; }
  .card { background: #0c1120; border: 1px solid #1b2438; border-radius: 14px; padding: 16px 20px; margin: 18px 0; }
  .warn { background: #241d0c; border: 1px solid #4a3a12; border-left: 3px solid #f0b429; border-radius: 12px; padding: 14px 18px; margin: 18px 0; }
</style>
</head>
<body>
<main>
  <div class="brand"><div class="mark"></div><span>Vaylo Sports</span></div>
  ${body}
</main>
</body>
</html>
`;
}

function indexPage(): string {
  const links = Object.entries(LEGAL_PAGES)
    .map(([slug, page]) => `<li><a href="${slug}">${page.title}</a></li>`)
    .join("\n    ");
  return shell(
    "Legal",
    `<h1>Vaylo Sports — legal</h1>
  <p>These are the documents referenced by our Google Play listing.</p>
  <ul>
    ${links}
  </ul>
  <p>Questions about any of them: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`
  );
}

function notFoundPage(slug: string): string {
  // The requested path is echoed back, so it is escaped — it is attacker-supplied
  // text arriving in a response that advertises a strict CSP.
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  const shown = slug.replace(/[&<>"']/g, (c) => entities[c] ?? c);
  return shell(
    "Not found",
    `<h1>No document called "${shown}"</h1>
  <p><a href="">See the list of available documents.</a></p>`
  );
}

/**
 * Served while legal/operator.json still holds its placeholders.
 *
 * Deliberately a refusal rather than a page with a guessed company name or an
 * inbox nobody reads: this URL is handed to Google Play, and a privacy policy
 * that names the wrong entity or offers no way to make a data request is worse
 * than one that is temporarily unavailable. The fix is a two-line change to
 * legal/operator.json plus a redeploy, described in PLAY_STORE.md.
 */
function unconfiguredPage(): string {
  return shell(
    "Temporarily unavailable",
    `<h1>Legal documents are not published yet</h1>
  <div class="warn">
    <strong>The operator details are still placeholders.</strong>
    A privacy policy must name the entity responsible for your data and give a
    working contact address, so this page stays closed until both are set.
  </div>
  <div class="card">
    <p style="margin:0">
      To publish: fill in <code>legal/operator.json</code>, run
      <code>node scripts/gen-legal-pages.cjs</code>, then redeploy this function.
      PLAY_STORE.md has the exact commands.
    </p>
  </div>`
  );
}

Deno.serve((req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  if (OPERATOR_DETAILS_UNSET) {
    console.error(
      `legal: refusing to serve — legal/operator.json still has placeholders ` +
        `(operator "${OPERATOR_NAME}", contact "${CONTACT_EMAIL}")`
    );
    return html(unconfiguredPage(), 503);
  }

  const route = resolveRoute(new URL(req.url).pathname, SLUGS);
  const body =
    route.kind === "index"
      ? { html: indexPage(), status: 200 }
      : route.kind === "document"
        ? { html: LEGAL_PAGES[route.slug].html, status: 200 }
        : { html: notFoundPage(route.requested), status: 404 };

  // A HEAD response carries the headers a crawler needs and no body, which is
  // what the method means.
  if (req.method === "HEAD") {
    return new Response(null, { status: body.status, headers: SECURITY_HEADERS });
  }
  return html(body.html, body.status);
});
