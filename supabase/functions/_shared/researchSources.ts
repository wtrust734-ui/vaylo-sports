// ============================================================================
// researchSources — the research engine's source registry.
// ----------------------------------------------------------------------------
// Every source declares, in one place, what it is, whether THIS deployment can
// query it programmatically today, what access it needs, and what it cannot
// provide. Capability claims here mirror PROMPT 1's web-verified research:
//   • Meta Ad Library API — only political/social-issue ads worldwide plus
//     EU/UK-delivered commercial ads; requires an owner-held app token. Not
//     configured → documented blocker, manual path provided.
//   • TikTok Commercial Content API — EU data only, developer approval (~2
//     reviewed days). Not approved → documented blocker, manual path.
//   • Google Ads Transparency Center — public web UI (link-out; no general
//     API outside the EEA); political-ads BigQuery exists but is out of scope.
//   • Official pages / press pages — plain public URLs, retrievable server-side
//     like any browser fetch, with robots-respecting single-page GETs, a
//     real User-Agent and strict timeouts.
//   • Manual ingest — always available; explicit; evidence-grade 'source'.
// Nothing here bypasses access controls, and nothing claims an API exists
// where it does not.
// ============================================================================

export type SourceType =
  | "meta_library"
  | "tiktok_library"
  | "google_transparency"
  | "official_page"
  | "press"
  | "social"
  | "manual";

export interface SourceCapability {
  type: SourceType;
  label: string;
  /** Can this deployment query it programmatically today? */
  accessible: boolean;
  /** What the owner must provide before it flips to accessible. */
  requires?: string;
  /** Promised data, and the limits admitted up front. */
  promises: string;
  limits: string;
  /** Searchable pages for this source when it is the manual/link path. */
  searchUrl?: string;
}

export const SOURCES: SourceCapability[] = [
  {
    type: "meta_library" as SourceType,
    label: "Meta Ad Library API",
    accessible: false,
    requires: "Owner's Meta developer app + access token (set as META_ADS_LIBRARY_TOKEN when granted)",
    promises: "Archived ads searchable by page id/text — but only political/social-issue ads worldwide and commercial ads delivered to the EU/UK; text, creative references, CTA labels.",
    limits: "1-year retention for EU commercial ads; search terms ≤100 chars; ≤10 page ids per query; NO spend, impressions or targeting for ordinary commercial ads; never global coverage.",
  },
  {
    type: "tiktok_library" as SourceType,
    label: "TikTok Commercial Content API",
    accessible: false,
    requires: "Owner's TikTok developer application review (~2 working days)",
    promises: "EU ads with creative URLs, titles, dates, CTA, landing URL, objective and bucketed reach/targeting indicators.",
    limits: "EU data only in this phase; retention while running + 1 year; reach is bucketed (e.g. '30K'), not exact.",
  },
  {
    type: "google_transparency" as SourceType,
    label: "Google Ads Transparency Center",
    accessible: false,
    requires: "EEA programmatic access application; no general non-EEA API exists",
    promises: "Public search of advertiser creatives; advertiser identity and payer info (in some regions).",
    limits: "No general programmatic API outside the EEA; political-ads BigQuery dataset is out of scope here.",
    searchUrl: "https://adstransparency.google.com/",
  },
  {
    type: "official_page" as SourceType,
    label: "Official brand pages",
    accessible: true,
    promises: "Real public copy: positioning, promoted features, CTA language from home/product pages the owner lists per competitor.",
    limits: "Ordinary published content, NOT advertising-library records; pages change without notice; JS-heavy sites may return little text.",
  },
  {
    type: "press" as SourceType,
    label: "Press / newsroom pages",
    accessible: true,
    promises: "Campaign announcements, partnerships and product statements with dates.",
    limits: "Announcements, not ad creative; date coverage only where the page states it.",
  },
  {
    type: "social" as SourceType,
    label: "Official social channels",
    accessible: true,
    promises: "Link records to verified official profiles/campaign posts the user supplies.",
    limits: "Link-out only unless the user pastes captured content; platform APIs are the other sources in this registry.",
  },
  {
    type: "manual" as SourceType,
    label: "Manual evidence ingest",
    accessible: true,
    promises: "The explicit supported path for blocked ad libraries: paste the source URL plus what you captured (copy, CTA, hook); stored verbatim with grade 'source'.",
    limits: "Only as good as what the researcher captured; dates must be supplied by hand.",
  },
];

export function sourceBy(type: SourceType): SourceCapability {
  const found = SOURCES.find((s) => s.type === type);
  if (!found) throw new Error(`unknown source type ${type}`);
  return found;
}

/**
 * Which sources does a given project scope actually run against?
 * Blocked libraries are listed with their blocker so the UI/assistant can
 * disclose the limitation instead of pretending the source was queried.
 */
export interface SourcePlan {
  runnable: SourceType[];
  blocked: { type: SourceType; reason: string }[];
}

export function planSources(scope: { sourceTypes?: string[] }): SourcePlan {
  const wanted = new Set<string>(
    scope.sourceTypes && scope.sourceTypes.length
      ? scope.sourceTypes
      : ["official_page", "press", "manual"],
  );
  const runnable: SourceType[] = [];
  const blocked: { type: SourceType; reason: string }[] = [];
  for (const s of SOURCES) {
    if (!wanted.has(s.type)) continue;
    if (s.accessible) {
      runnable.push(s.type);
    } else {
      blocked.push({ type: s.type, reason: `${s.label} is not queryable from this deployment. Requires: ${s.requires}` });
    }
  }
  return { runnable, blocked };
}

/** Owned competitor page candidates — never guessed hosts; rows supply them. */
export function candidatePages(website: string): { url: string; type: SourceType }[] {
  const base = website.replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) return [];
  // Landing, press and one marketing-relevant path. Bounded by the pipeline.
  return [
    { url: `${base}/`, type: "official_page" },
    { url: `${base}/press`, type: "press" },
    { url: `${base}/news`, type: "press" },
  ];
}
