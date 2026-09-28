// ============================================================================
// LEGAL DOCUMENT URLS
// ----------------------------------------------------------------------------
// Where the privacy policy, terms and account-deletion pages live on the web.
// Those are the URLs entered in Google Play Console (privacy policy, and the
// Data deletion requirement), and the ones every in-app legal link opens.
//
// They are served by the `legal` edge function rather than a static host,
// because Play will not publish a listing without a reachable policy URL and
// this project has no public domain yet — vaylosports.com, which the code
// defaults to elsewhere, does not resolve. The pages themselves are in legal/
// and are embedded into that function by scripts/gen-legal-pages.cjs, so moving
// to a real domain later means deploying the same files to it and setting
// VITE_LEGAL_BASE_URL; nothing else changes.
//
// Kept in one module so a link added to a new screen cannot invent its own path
// and 404 quietly. The `.html`-less paths are what the function serves; it
// accepts the suffix too, for links inside the documents themselves.
// ============================================================================

/** Slugs of the published documents. Mirrors the keys in legal/. */
export type LegalSlug = "privacy" | "terms" | "account-deletion";

function resolveBase(): string {
  const explicit = import.meta.env.VITE_LEGAL_BASE_URL as string | undefined;
  if (explicit) return explicit.replace(/\/+$/, "");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (supabaseUrl) return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/legal`;

  // Nothing configured. Returning a relative path keeps the links inert rather
  // than pointing a reviewer at someone else's domain; the pages are bundled in
  // dev but not in the app, so this only shows up in an unconfigured build.
  return "/legal";
}

export const LEGAL_BASE_URL = resolveBase();

/** Full URL of one published legal document. */
export function legalUrl(slug: LegalSlug): string {
  return `${LEGAL_BASE_URL}/${slug}`;
}

export const PRIVACY_POLICY_URL = legalUrl("privacy");
export const TERMS_OF_SERVICE_URL = legalUrl("terms");
export const ACCOUNT_DELETION_URL = legalUrl("account-deletion");
