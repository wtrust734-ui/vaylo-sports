// ============================================================================
// LEGAL DOCUMENT URLS
// ----------------------------------------------------------------------------
// Where the published legal documents live on the web. Those are the URLs
// entered in Google Play Console (privacy policy, and the Data deletion
// requirement), and the ones every in-app legal link opens.
//
// They are published twice, deliberately, and the app points at the static one.
//
//   https://vaylo-sports.netlify.app/legal/<slug>/    ← VITE_LEGAL_BASE_URL
//   https://<project>.supabase.co/functions/v1/legal/<slug>   ← the fallback
//
// The Netlify site is the one that matters: Supabase's edge gateway and
// Supabase Storage both serve text content as text/plain, so a policy opened
// from the app rendered as raw source. Google Play will not publish a listing
// whose privacy-policy or data-deletion URL does that, and neither will a
// crawler read it. Netlify serves the same generated files as text/html.
//
// The fallback is kept so a build with no VITE_LEGAL_BASE_URL still resolves to
// real documents on this project's own infrastructure rather than to nothing.
// The page contents are identical in both places — both are generated from
// legal/ by scripts/gen-legal-pages.cjs and scripts/gen-website.cjs — so the two
// cannot describe different products.
//
// Kept in one module so a link added to a new screen cannot invent its own path
// and 404 quietly. URLs carry a trailing slash because that is the canonical
// form on the static host: without it, /legal/privacy 301s to /legal/privacy/,
// and the URL handed to a Play reviewer or written into a store listing would
// not be the URL that renders. Both hosts serve the slashed form with a 200.
// ============================================================================

/** Slugs of the published documents. Mirrors the keys in legal/. */
export type LegalSlug =
  | "privacy"
  | "terms"
  | "ai-disclaimer"
  | "health-safety"
  | "community-guidelines"
  | "child-safety"
  | "advertising"
  | "purchases"
  | "refunds"
  | "account-deletion"
  | "data-rights"
  | "intellectual-property"
  | "cookies"
  | "competition-terms"
  | "report-safety-concern"
  | "report-content"
  | "security-disclosure"
  | "complaints"
  | "ai-training-advice"
  | "video-analysis-disclaimer"
  | "injury-guidance"
  | "nutrition-disclaimer"
  | "mental-wellbeing"
  | "wearable-health-privacy"
  | "ai-data-use"
  | "waitlist-terms"
  | "contact";

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

/**
 * In-app path for one published document: /legal/<slug>.
 *
 * The viewer route (src/pages/LegalDocument.tsx) renders the same published
 * HTML inside the app, so an in-app link never has to leave for the website.
 * legalUrl() below stays the external form — for store listings, Play Console
 * and anything opened outside the app — and both derive from the same slug, so
 * the two can never point at different documents.
 */
export const legalPath = (slug: LegalSlug): string => `/legal/${slug}`;

/** Full URL of one published legal document. */
export function legalUrl(slug: LegalSlug): string {
  // The unconfigured fallback ("/legal") is an in-app route, not a published
  // document, so it keeps the old slash-less shape — there is nothing for a
  // canonical form to be canonical *to*. Only real hosts get the trailing slash.
  if (!/^https?:\/\//i.test(LEGAL_BASE_URL)) return `${LEGAL_BASE_URL}/${slug}`;
  return `${LEGAL_BASE_URL.replace(/\/+$/, "")}/${slug}/`;
}

export const PRIVACY_POLICY_URL = legalUrl("privacy");
export const TERMS_OF_SERVICE_URL = legalUrl("terms");
export const ACCOUNT_DELETION_URL = legalUrl("account-deletion");
export const AI_DISCLAIMER_URL = legalUrl("ai-disclaimer");
export const HEALTH_SAFETY_URL = legalUrl("health-safety");
export const COMMUNITY_GUIDELINES_URL = legalUrl("community-guidelines");
export const CHILD_SAFETY_URL = legalUrl("child-safety");
export const ADVERTISING_URL = legalUrl("advertising");
export const PURCHASES_URL = legalUrl("purchases");
export const REFUNDS_URL = legalUrl("refunds");
export const DATA_RIGHTS_URL = legalUrl("data-rights");
export const INTELLECTUAL_PROPERTY_URL = legalUrl("intellectual-property");
export const COOKIES_URL = legalUrl("cookies");
export const COMPETITION_TERMS_URL = legalUrl("competition-terms");
export const REPORT_SAFETY_CONCERN_URL = legalUrl("report-safety-concern");
export const REPORT_CONTENT_URL = legalUrl("report-content");
export const SECURITY_DISCLOSURE_URL = legalUrl("security-disclosure");
export const COMPLAINTS_URL = legalUrl("complaints");
export const AI_TRAINING_ADVICE_URL = legalUrl("ai-training-advice");
export const VIDEO_ANALYSIS_URL = legalUrl("video-analysis-disclaimer");
export const INJURY_GUIDANCE_URL = legalUrl("injury-guidance");
export const NUTRITION_DISCLAIMER_URL = legalUrl("nutrition-disclaimer");
export const MENTAL_WELLBEING_URL = legalUrl("mental-wellbeing");
export const WEARABLE_HEALTH_URL = legalUrl("wearable-health-privacy");
export const AI_DATA_USE_URL = legalUrl("ai-data-use");
export const CONTACT_URL = legalUrl("contact");
