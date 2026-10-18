// ============================================================================
// researchApi.ts — Ads Studio competitor research client.
// ----------------------------------------------------------------------------
// Competitor rows and raw research tables go direct to Supabase with RLS
// (owner from the session). The engine itself runs server-side through the
// ads-research Edge Function: retrieval, metered analysis, citation-validated
// opportunities — the browser never fetches on the engine's behalf.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { edgeErrorMessage } from "@/lib/edgeErrors";

function rawFrom(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from(table);
}

// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------

export interface Competitor {
  id: string;
  name: string;
  website: string | null;
  notes: string | null;
}

const SEED_COMPETITORS = ["Strava", "Nike Run Club", "Runna"];

export async function listCompetitors(): Promise<Competitor[]> {
  const { data, error } = await rawFrom("ad_competitors").select("*").order("name");
  if (error) {
    // Fresh projects before the migration runs: seed the well-known three so
    // the UI still works while pending backend setup.
    if (String(error.message).includes("ad_competitors")) {
      return SEED_COMPETITORS.map((name, i) => ({ id: `seed-${i}`, name, website: null, notes: "pending backend setup" }));
    }
    throw new Error(error.message);
  }
  return (data ?? []) as Competitor[];
}

export async function addCompetitor(name: string, website: string | null): Promise<Competitor> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) throw new Error("Sign in first");
  if (!/^https:\/\/.+/.test(website ?? "https://") && website) throw new Error("Website must be an https:// URL");
  const { data, error } = await rawFrom("ad_competitors")
    .insert({ owner_id: uid, name: name.trim().slice(0, 80), website: website?.trim() || null })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Competitor;
}

export async function updateCompetitor(id: string, name: string, website: string | null, notes: string): Promise<void> {
  const { error } = await rawFrom("ad_competitors")
    .update({ name: name.trim().slice(0, 80), website: website?.trim() || null, notes: notes.slice(0, 500) })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCompetitor(id: string): Promise<void> {
  const { error } = await rawFrom("ad_competitors").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Research projects (engine actions via ads-research)
// ---------------------------------------------------------------------------

export async function startResearch(input: {
  competitors: string[];
  topic?: string;
  title?: string;
}): Promise<{ projectId: string; status: string; findings: number; blockedCount: number }> {
  const { data, error } = await supabase.functions.invoke("ads-research", {
    body: {
      action: "start",
      competitors: input.competitors,
      topic: input.topic ?? "",
      title: input.title,
      sourceTypes: ["official_page", "press"],
    },
  });
  if (error) throw new Error(await edgeErrorMessage(error));
  return data as { projectId: string; status: string; findings: number; blockedCount: number };
}

export interface ResearchStatus {
  status: "queued" | "running" | "done" | "failed" | "partial";
  findings: number;
  log: string[];
  updatedAt: string;
}

export async function researchStatus(projectId: string): Promise<ResearchStatus> {
  const { data, error } = await supabase.functions.invoke("ads-research", {
    body: { action: "status", projectId },
  });
  if (error) throw new Error(await edgeErrorMessage(error));
  return data as ResearchStatus;
}

export interface Finding {
  id: string;
  competitor_name: string | null;
  kind: "ad" | "organic" | "page";
  source_type: string;
  source_url: string;
  title: string;
  excerpt: string;
  captured: Record<string, string>;
  media_kind: string;
  published_at: string | null;
  retrieved_at: string;
  analysis: { mode: string; analysis: AnalysisPayload } | null;
}

export interface BlockedSource {
  type: string;
  reason: string;
}

export interface ResearchResults {
  project: { id: string; title: string; topic: string; status: string; log: string[] };
  findings: Finding[];
  blocked: BlockedSource[];
  opportunities: Record<string, unknown>[];
}

export async function researchResults(projectId: string): Promise<ResearchResults> {
  const { data, error } = await supabase.functions.invoke("ads-research", {
    body: { action: "results", projectId },
  });
  if (error) throw new Error(await edgeErrorMessage(error));
  return data as ResearchResults;
}

export async function ingestFinding(input: {
  projectId: string;
  sourceUrl: string;
  title?: string;
  excerpt?: string;
  kind?: "ad" | "organic" | "page";
  captured?: Record<string, string>;
  competitorId?: string | null;
  publishedAt?: string;
}): Promise<void> {
  const { error } = await supabase.functions.invoke("ads-research", {
    body: { action: "ingest", ...input },
  });
  if (error) throw new Error(await edgeErrorMessage(error));
}

export interface AnalysisPayload {
  captured: Record<string, string>;
  quotes: string[];
  interpretation: string;
  unavailable: string[];
}

export async function analyzeFinding(findingId: string): Promise<{ analysis: AnalysisPayload; mode: string }> {
  const { data, error } = await supabase.functions.invoke("ads-research", {
    body: { action: "analyze", findingId },
  });
  if (error) throw new Error(await edgeErrorMessage(error));
  return data as { analysis: AnalysisPayload; mode: string };
}

export async function generateOpportunities(projectId: string): Promise<{ accepted: number; rejected: { problems: string[] }[]; opportunities: Record<string, unknown>[] }> {
  const { data, error } = await supabase.functions.invoke("ads-research", {
    body: { action: "opportunities", projectId },
  });
  if (error) throw new Error(await edgeErrorMessage(error));
  return data as { accepted: number; rejected: { problems: string[] }[]; opportunities: Record<string, unknown>[] };
}

export interface ComparisonRow {
  rows: { competitor: string; value: string | null; evidenceCount: number }[];
  dimension: string;
}

export interface Comparison {
  rows: ComparisonRow[];
  coverage: { competitor: string; evidenceCount: number }[];
}

export async function compareCompetitors(projectId: string): Promise<Comparison> {
  const { data, error } = await supabase.functions.invoke("ads-research", {
    body: { action: "compare", projectId },
  });
  if (error) throw new Error(await edgeErrorMessage(error));
  return data as Comparison;
}

export async function exportResearch(projectId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("ads-research", {
    body: { action: "export", projectId },
  });
  if (error) throw new Error(await edgeErrorMessage(error));
  return (data as { markdown: string }).markdown;
}

/** Projects sidebar — direct read (RLS-protected). */
export interface ResearchProject {
  id: string;
  title: string;
  status: string;
  updated_at: string;
}

export async function listResearchProjects(): Promise<ResearchProject[]> {
  const { data, error } = await rawFrom("ad_research_projects").select("id, title, status, updated_at").order("updated_at", { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []) as ResearchProject[];
}
