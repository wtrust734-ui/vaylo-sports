// ============================================================================
// researchPipeline — pure helpers for the research engine.
// ----------------------------------------------------------------------------
// Everything that must be unit-testable and free of network or DB access
// lives here: URL classification (ad-library record vs ordinary organic or
// page link), text extraction from retrieved HTML, content hashing for
// duplicate-result detection, scope normalisation, comparison building with
// unequal-evidence disclosure, opportunity citation validation (which rejects
// fabricated source claims) and the markdown report renderer.
// ============================================================================

import type { SourceType } from "./researchSources.ts";

// ---------------------------------------------------------------------------
// URL classification — is a link an ad-library record or ordinary content?
// ---------------------------------------------------------------------------

export interface LinkKind {
  kind: "ad" | "organic" | "page";
  sourceType: SourceType;
}

export function classifyLink(url: string): LinkKind | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const path = u.pathname.toLowerCase();

  if (host === "facebook.com" || host.endsWith(".facebook.com")) {
    if (path.startsWith("/ads/library")) return { kind: "ad", sourceType: "meta_library" };
    return { kind: "organic", sourceType: "social" };
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    // Commercial-content library paths carry ads; profile/video URLs are organic.
    if (path.includes("commercial-content") || path.includes("/ads/")) return { kind: "ad", sourceType: "tiktok_library" };
    return { kind: "organic", sourceType: "social" };
  }
  if (host === "adstransparency.google.com") return { kind: "ad", sourceType: "google_transparency" };
  // Press/newsroom subdomains (press.strava.com, news.… ) before the generic
  // brand-domain rule, so a site's press section is recognised.
  if (host.startsWith("press.") || host.startsWith("news.")) return { kind: "page", sourceType: "press" };
  if (/(^|\.)(nike\.com|strava\.com|runna\.com|underarmour\.com|garmin\.com|whoop\.com)$/.test(host)) {
    return { kind: "page", sourceType: "official_page" };
  }
  return { kind: "organic", sourceType: "social" };
}

// ---------------------------------------------------------------------------
// Text extraction from retrieved HTML — server-side, dependency-free
// ---------------------------------------------------------------------------

const BLOCK_TAGS = /<script\b[\s\S]*?<\/script|<style\b[\s\S]*?<\/style|<noscript\b[\s\S]*?<\/noscript/gi;

/** Strip scripts/styles/tags and collapse whitespace; bounded defensively. */
export function extractText(html: string, maxChars = 8000): string {
  const stripped = html
    .replace(BLOCK_TAGS, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, maxChars);
}

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

export function extractMetaDescription(html: string): string {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,500})["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']{0,500})["'][^>]+name=["']description["']/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

/** Non-crypto 64-bit-ish hash for duplicate detection (not a security tool). */
export function contentHash(text: string): string {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// ---------------------------------------------------------------------------
// Scope normalisation + validation
// ---------------------------------------------------------------------------

export interface ResearchScope {
  competitors: string[];
  topic: string;
  sourceTypes: string[];
  refresh: boolean;
}

export function normaliseScope(raw: unknown): { ok: boolean; problems: string[]; scope?: ResearchScope } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const competitors = Array.isArray(o.competitors)
    ? o.competitors.filter((c): c is string => typeof c === "string").map((s) => s.trim()).filter(Boolean).slice(0, 8)
    : [];
  if (!competitors.length) problems.push("at least one competitor is required");
  const topic = typeof o.topic === "string" ? o.topic.trim().slice(0, 300) : "";
  const allowed = ["official_page", "press", "meta_library", "tiktok_library", "google_transparency", "social", "manual"];
  const sourceTypes = Array.isArray(o.sourceTypes)
    ? (o.sourceTypes.filter((s): s is string => typeof s === "string") as string[]).filter((s) => allowed.includes(s)).slice(0, 7)
    : [];
  if (o.sourceTypes !== undefined && !Array.isArray(o.sourceTypes)) problems.push("sourceTypes must be an array");
  return {
    ok: problems.length === 0,
    problems,
    scope: { competitors, topic, sourceTypes, refresh: o.refresh === true },
  };
}

// ---------------------------------------------------------------------------
// Comparison with unequal-evidence disclosure (no fabricated metrics)
// ---------------------------------------------------------------------------

export interface FindingLite {
  competitor_id: string | null;
  captured: Record<string, unknown>;
  excerpt: string;
}

export interface ComparisonDimension {
  dimension: string;
  rows: { competitor: string; value: string | null; evidenceCount: number }[];
}

const DIMENSIONS: { key: string; label: string }[] = [
  { key: "targetAudience", label: "Apparent target audience" },
  { key: "positioning", label: "Main positioning" },
  { key: "benefit", label: "Benefit promoted" },
  { key: "cta", label: "Calls to action" },
  { key: "creativeFormat", label: "Creative formats" },
  { key: "visualStyle", label: "Visual style" },
  { key: "messagingTheme", label: "Messaging themes" },
];

/**
 * Builds a comparison only from what each finding actually captured.
 * `value` is null and the row carries evidenceCount 0 — and the UI must show
 * "no supporting evidence", never a guess — wherever a competitor has nothing.
 */
export function buildComparison(
  competitors: { id: string; name: string }[],
  findings: FindingLite[],
): { rows: ComparisonDimension[]; coverage: { competitor: string; evidenceCount: number }[] } {
  const byComp = new Map<string, FindingLite[]>();
  for (const c of competitors) byComp.set(c.id, []);
  for (const f of findings) {
    if (f.competitor_id && byComp.has(f.competitor_id)) byComp.get(f.competitor_id)!.push(f);
  }
  const coverage = competitors.map((c) => ({
    competitor: c.name,
    evidenceCount: (byComp.get(c.id) ?? []).length,
  }));

  const rows: ComparisonDimension[] = DIMENSIONS.map(({ key, label }) => ({
    dimension: label,
    rows: competitors.map((c) => {
      const list = byComp.get(c.id) ?? [];
      const values = list
        .map((f) => f.captured?.[key])
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .slice(0, 3);
      return {
        competitor: c.name,
        value: values.length ? values.join(" | ") : null,
        evidenceCount: values.length,
      };
    }),
  }));
  return { rows, coverage };
}

// ---------------------------------------------------------------------------
// Opportunity validation — fabricated citations are rejected outright
// ---------------------------------------------------------------------------

export const OPPORTUNITY_FIELDS = [
  "observation", "evidenceFindingIds", "interpretation", "gap", "approach",
  "suggestedFormat", "targetAudience", "hook", "cta", "validationPlan",
] as const;

export function validateOpportunity(raw: unknown, knownFindingIds: Set<string>): { problems: string[]; value?: Record<string, unknown> } {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object") return { problems: ["opportunity must be an object"] };
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  for (const f of OPPORTUNITY_FIELDS) {
    if (f === "evidenceFindingIds") {
      const ids = Array.isArray(o[f]) ? o[f].filter((x): x is string => typeof x === "string") : [];
      if (!ids.length) problems.push("every opportunity needs at least one evidence reference");
      const unknown = ids.filter((id) => !knownFindingIds.has(id));
      if (unknown.length) problems.push(`evidence references not found in this project's findings: ${unknown.join(", ")}`);
    } else if (!str(o[f])) {
      problems.push(`${f} is required`);
    }
  }
  if (problems.length) return { problems };
  const value: Record<string, unknown> = {};
  for (const f of OPPORTUNITY_FIELDS) value[f] = f === "evidenceFindingIds" ? o[f] : str(o[f]);
  return { problems: [], value };
}

// ---------------------------------------------------------------------------
// Markdown report — deterministic, no AI, includes what was NOT retrievable
// ---------------------------------------------------------------------------

export interface FindingRow {
  title: string;
  kind: string;
  source_type: string;
  source_url: string;
  excerpt: string;
  retrieved_at: string;
  competitor_name?: string | null;
  analysis_mode?: string | null;
}

export function renderReport(
  project: { title: string; scope: Record<string, unknown>; status: string; topic: string },
  findings: FindingRow[],
  comparison: { rows: ComparisonDimension[]; coverage: { competitor: string; evidenceCount: number }[] },
  blocked: { reason: string }[],
  opportunities: Record<string, unknown>[],
): string {
  const lines: string[] = [];
  lines.push(`# ${project.title}`);
  lines.push("");
  lines.push(`Topic: ${project.topic || "—"}`);
  lines.push(`Scope: ${(project.scope?.competitors as string[] ?? []).join(", ") || "—"}`);
  lines.push(`Status: ${project.status}`);
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  for (const f of findings) {
    lines.push(`### ${f.title || f.source_url}`);
    lines.push(`- Type: **${f.kind}** via ${f.source_type}${f.competitor_name ? ` — ${f.competitor_name}` : ""}`);
    lines.push(`- Source: ${f.source_url}`);
    lines.push(`- Retrieved: ${f.retrieved_at}`);
    if (f.excerpt) lines.push(`- Excerpt: "${f.excerpt.slice(0, 400)}"`);
    if (f.analysis_mode) lines.push(`- Analysis mode: ${f.analysis_mode}`);
    lines.push("");
  }
  lines.push("## Comparison");
  lines.push("");
  lines.push("| Dimension | " + comparison.rows[0]?.rows.map((r) => r.competitor).join(" | ") + " |");
  lines.push("|---" + comparison.rows[0]?.rows.map(() => "|---").join("") + "|");
  for (const dim of comparison.rows) {
    lines.push(
      `| ${dim.dimension} | ` +
      dim.rows.map((r) => (r.value ? r.value.replace(/\|/g, "/") : `_no supporting evidence_`)).join(" | ") +
      " |",
    );
  }
  lines.push("");
  lines.push(`Coverage: ${comparison.coverage.map((c) => `${c.competitor}: ${c.evidenceCount} item(s)`).join(", ")}. Unequal coverage is disclosed, not hidden; blank cells mean no evidence, not no activity.`);
  lines.push("");
  if (blocked.length) {
    lines.push("## Sources not queried (documented blockers)");
    lines.push("");
    for (const b of blocked) lines.push(`- ${b.reason}`);
    lines.push("");
  }
  if (opportunities.length) {
    lines.push("## Opportunities for Vaylo Sports");
    lines.push("");
    opportunities.forEach((o, i) => {
      lines.push(`### ${i + 1}. ${o.approach ?? "Opportunity"}`);
      lines.push(`- Observation: ${o.observation}`);
      lines.push(`- Evidence: ${(o.evidenceFindingIds as string[]).join(", ")}`);
      lines.push(`- Interpretation: ${o.interpretation}`);
      lines.push(`- Gap/opportunity: ${o.gap}`);
      lines.push(`- Recommended approach: ${o.approach}`);
      lines.push(`- Suggested format: ${o.suggestedFormat}`);
      lines.push(`- Target audience: ${o.targetAudience}`);
      lines.push(`- Hook: ${o.hook}`);
      lines.push(`- CTA: ${o.cta}`);
      lines.push(`- Validation plan: ${o.validationPlan}`);
      lines.push("");
    });
  }
  return lines.join("\n");
}
