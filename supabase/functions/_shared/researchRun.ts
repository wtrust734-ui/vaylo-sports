// ============================================================================
// researchRun — pure-ish research run helpers, imported by both ads-research
// (edge runtime) and the unit tests (node). Kept free of Supabase client
// imports so tests can load it without network.
// ============================================================================
import { MODELS } from "./aiModels.ts";
import { candidatePages, planSources, type SourceType } from "./researchSources.ts";
import {
  contentHash,
  extractMetaDescription,
  extractText,
  extractTitle,
} from "./researchPipeline.ts";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const FETCH_TIMEOUT_MS = 8000;
const MAX_PAGES_PER_RUN = 9;
const MAX_PAGE_TEXT = 8000;

/** Secrets are read lazily: module import must stay clean for node-side tests. */
function openAiKey(): string | null {
  if (typeof Deno === "undefined" || !Deno.env) return null;
  return Deno.env.get("ADS_OPENAI_API_KEY") ?? Deno.env.get("OPENAI_API_KEY") ?? null;
}
export interface PageResult {
  ok: boolean;
  status: number | null;
  html: string;
  error?: string;
}

export async function fetchPage(url: string, fetcher: typeof fetch = fetch): Promise<PageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // A real, honest User-Agent: we are a named product retrieving a public
    // page, not a covert crawler.
    const res = await fetcher(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "VayloAdsResearch/1.0 (public competitor research; +https://vaylo-sports-app.netlify.app)",
        Accept: "text/html,text/plain;q=0.9",
      },
    });
    if (!res.ok) {
      return { ok: false, status: res.status, html: "", error: `HTTP ${res.status}` };
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/")) {
      return { ok: false, status: res.status, html: "", error: `content-type ${ct} is not textual` };
    }
    const html = await res.text();
    return { ok: true, status: res.status, html: html.slice(0, 400_000) };
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "timeout" : String(e);
    return { ok: false, status: null, html: "", error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export interface PlannedFinding {
  competitorId: string | null;
  competitorName: string;
  url: string;
  sourceType: SourceType;
  title: string;
  excerpt: string;
  text: string;
  hash: string;
  skipped: boolean;
}

export interface RetrievalOutcome {
  findings: PlannedFinding[];
  fetches: number;
  notes: string[];
}

/** One bounded retrieval pass over the scope's accessible sources. */
export async function retrieveScope(
  competitors: { id: string; name: string; website: string | null }[],
  scope: { sourceTypes: string[]; refresh: boolean },
  knownHashes: Map<string, Set<string>>,
  fetcher: typeof fetch = fetch,
): Promise<RetrievalOutcome> {
  const out: RetrievalOutcome = { findings: [], fetches: 0, notes: [] };
  const plan = planSources({ sourceTypes: scope.sourceTypes });
  const webRunning = plan.runnable.some((t) => t === "official_page" || t === "press");
  if (!webRunning) {
    out.notes.push(
      "No programmatically accessible web sources in scope for this run. Advertising-library content goes through manual ingest until those APIs are approved.",
    );
    return out;
  }

  for (const c of competitors) {
    if (!c.website) {
      out.notes.push(`${c.name}: no website on record — add one in the competitor editor to retrieve official pages.`);
      continue;
    }
    for (const cand of candidatePages(c.website)) {
      if (out.fetches >= MAX_PAGES_PER_RUN) {
        out.notes.push("Retrieval cap reached for this run — refresh the project to retrieve more pages.");
        break;
      }
      if (!plan.runnable.includes(cand.type)) continue;

      out.fetches++;
      const res = await fetchPage(cand.url, fetcher);
      if (!res.ok) {
        out.notes.push(`${c.name}: ${cand.url} → ${res.error ?? "retrieval failed"}`);
        continue;
      }

      const text = extractText(res.html, MAX_PAGE_TEXT);
      const hash = contentHash(text);
      const seen = knownHashes.get(c.id);

      if (seen?.has(hash) && !scope.refresh) {
        out.notes.push(`${c.name}: ${cand.url} → identical to already-retrieved content; skipped.`);
        continue;
      }

      out.findings.push({
        competitorId: c.id,
        competitorName: c.name,
        url: cand.url,
        sourceType: cand.type,
        title: extractTitle(res.html) || `${c.name} — ${cand.url}`,
        excerpt: extractMetaDescription(res.html) || text.slice(0, 1200),
        text,
        hash,
        skipped: false,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// AI prompts — the model sees only retrieved strings and must quote them.
// Shape here: {"results":[{"id","captured","quotes","interpretation","unavailable"}]}
// ---------------------------------------------------------------------------

export const ANALYSIS_SYSTEM = `You extract advertising-research observations from PUBLICLY RETRIEVED text. Reply ONLY with JSON:
{"results":[{"id":"<id from input>","captured":{"cta":"...","positioning":"...","benefit":"...","targetAudience":"...","messagingTheme":"...","creativeFormat":"...","visualStyle":"..."},"quotes":["verbatim phrases copied from the input text"],"interpretation":"one sentence that says it is your reading of the text","unavailable":["aspects the text cannot establish (images, video pacing, performance, dates)"]}]}

Rules:
- captured fields must be directly observable in the supplied text; each needs support in "quotes";
- anything the text cannot show belongs in "unavailable" — never in captured;
- never invent performance numbers, targeting details, spend or results;
- use empty objects/arrays when a row's text really is thin, rather than guessing.`;

export const OPPORTUNITY_SYSTEM = `You propose advertising opportunities for Vaylo Sports using ONLY the research findings supplied as JSON rows. Reply ONLY with JSON:
{"opportunities":[{"observation":"","evidenceFindingIds":["id"],"interpretation":"","gap":"","approach":"","suggestedFormat":"image|video|combination","targetAudience":"","hook":"","cta":"","validationPlan":""}]}

Rules:
- cite ONLY ids present in the supplied rows — fabricated citations are rejected by a validator and the item is discarded;
- recommendations must differentiate, not copy: multi-sport coverage, the VPR score claim and pre-launch posture are Vaylo angles competitors do not lead with;
- never state performance metrics, targeting knowledge or budgets that nobody supplied;
- brand rules: no price or subscription claims, no guaranteed results, pre-launch CTAs only (e.g. "Join the waitlist").`;

export interface AnalysisResult {
  id: string;
  captured: Record<string, string>;
  quotes: string[];
  interpretation: string;
  unavailable: string[];
}

export async function modelJson(system: string, user: string, maxTokens = 900): Promise<Record<string, unknown> | null> {
  if (!openAiKey()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELS.MINI,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Sane coercion of one model result row; junk in, conservative object out. */
export function coerceAnalysis(id: string, row: unknown): AnalysisResult {
  const o = (row ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
  const captured: Record<string, string> = {};
  if (o.captured && typeof o.captured === "object") {
    for (const [k, v] of Object.entries(o.captured as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) captured[k.slice(0, 40)] = v.slice(0, 400);
    }
  }
  return {
    id,
    captured,
    quotes: Array.isArray(o.quotes) ? o.quotes.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 8) : [],
    interpretation: str(o.interpretation, 600),
    unavailable: Array.isArray(o.unavailable) ? o.unavailable.filter((q): q is string => typeof q === "string").slice(0, 8) : [],
  };
}

