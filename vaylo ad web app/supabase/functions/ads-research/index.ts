// ============================================================================
// ads-research — the competitor research engine.
// ----------------------------------------------------------------------------
// Actions (POST, owner-scoped throughout; owner always comes from the JWT):
//   start          validate scope → retrieve accessible public sources →
//                  store findings → bounded AI extraction where a text key
//                  exists (mode is honest; analysis without media is text-only)
//   status         progress + pipeline log (names only, never secret values)
//   results        findings + analyses + blocked-source list + opportunities
//   ingest         explicit manual capture of an ad-library record or an
//                  organic item the researcher has lawfully read
//   analyze        deep analysis of one finding — metered; text-only stage
//   opportunities  evidence-backed opportunity blocks; fabricated citations
//                  are rejected server-side before anything is stored
//   compare        comparison built ONLY from captured fields, with coverage
//   export         deterministic markdown report (no AI)
//
// Rules: never claim an ad was analysed that was never seen; never present
// ordinary brand content as advertising-library data; disclose blocked sources
// rather than pretending they ran; skip identical re-retrievals by content
// hash; every stored row carries its source URL and retrieval timestamp.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { aiCallAllowed, authenticate, readJsonBody, json } from "../_shared/guard.ts";
import { MODELS } from "../_shared/aiModels.ts";
import { candidatePages, planSources, type SourceType } from "../_shared/researchSources.ts";
import {
  buildComparison,
  classifyLink,
  contentHash,
  extractMetaDescription,
  extractText,
  extractTitle,
  normaliseScope,
  renderReport,
  validateOpportunity,
  type ComparisonDimension,
} from "../_shared/researchPipeline.ts";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

const FETCH_TIMEOUT_MS = 8000;
const MAX_PAGES_PER_RUN = 9;
const MAX_PAGE_TEXT = 8000;

/** Secrets are read lazily: module import must stay clean for node-side tests. */
function openAiKey(): string | null {
  if (typeof Deno === "undefined" || !Deno.env) return null;
  return Deno.env.get("ADS_OPENAI_API_KEY") ?? Deno.env.get("OPENAI_API_KEY") ?? null;
}

function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function corsOnly(): Response {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

// ---------------------------------------------------------------------------
// Injectables exported for tests — no network or secrets at module scope.
// ---------------------------------------------------------------------------


import {
  fetchPage,
  retrieveScope,
  modelJson,
  coerceAnalysis,
  ANALYSIS_SYSTEM,
  OPPORTUNITY_SYSTEM,
} from "../_shared/researchRun.ts";

// Fetch/extraction helpers and prompts live in _shared/researchRun.ts (pure,
// node-importable). They are re-exported here for the edge runtime.
export { fetchPage, retrieveScope, modelJson, coerceAnalysis, ANALYSIS_SYSTEM, OPPORTUNITY_SYSTEM } from "../_shared/researchRun.ts";

async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const userId = await authenticate(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const body = await readJsonBody(req);
  if (!body) return json({ error: "Invalid request body" }, 400);
  const action = typeof body.action === "string" ? body.action : "";
  const db = supabaseAdmin();

  // ---- start ---------------------------------------------------------------
  if (action === "start") {
    if (!(await aiCallAllowed(req, userId, "ads-research-start", { max: 6, windowSeconds: 3600 }))) {
      return json({ error: "Research runs are limited to a few per hour. Try again later." }, 429);
    }
    const scope = normaliseScope(body);
    if (!scope.ok || !scope.scope) return json({ error: "Invalid research scope", problems: scope.problems }, 400);
    const { competitors, topic, sourceTypes, refresh } = scope.scope;

    // Resolve competitor rows by exact name; create when new (still owner's).
    const compIds: { id: string; name: string; website: string | null }[] = [];
    for (const name of competitors) {
      const { data: row } = await db
        .from("ad_competitors")
        .select("id, name, website")
        .eq("owner_id", userId)
        .ilike("name", name)
        .maybeSingle();
      if (row) {
        compIds.push(row as { id: string; name: string; website: string | null });
      } else {
        const { data: made, error: mkErr } = await db
          .from("ad_competitors")
          .insert({ owner_id: userId, name: name.slice(0, 80) })
          .select("id, name, website")
          .single();
        if (mkErr) return json({ error: mkErr.message }, 500);
        if (made) compIds.push(made as { id: string; name: string; website: string | null });
      }
    }

    // Known content hashes for this owner — the duplicate-result cache.
    const { data: hashRows } = await db
      .from("ad_research_findings")
      .select("competitor_id, content_hash")
      .eq("owner_id", userId)
      .not("content_hash", "is", null);
    const known = new Map<string, Set<string>>();
    for (const h of (hashRows ?? []) as { competitor_id: string | null; content_hash: string }[]) {
      if (!h.competitor_id || !h.content_hash) continue;
      const set = known.get(h.competitor_id) ?? new Set<string>();
      set.add(h.content_hash);
      known.set(h.competitor_id, set);
    }

    const title = (typeof body.title === "string" && body.title.trim() ? body.title.trim() : `Research: ${competitors.join(", ")}`).slice(0, 200);
    const { data: project, error: projErr } = await db
      .from("ad_research_projects")
      .insert({ owner_id: userId, title, topic, scope: { competitors, sourceTypes, refresh, topic }, status: "running" })
      .select("id")
      .single();
    if (projErr || !project) return json({ error: projErr?.message ?? "could not create project" }, 500);

    const run = await retrieveScope(compIds, { sourceTypes, refresh }, known);

    let insertedIds: string[] = [];
    if (run.findings.length) {
      const { data: insertedRows, error: insErr } = await db
        .from("ad_research_findings")
        .insert(
          run.findings.map((f) => ({
            project_id: project.id,
            owner_id: userId,
            competitor_id: f.competitorId,
            kind: "page" as const,
            source_type: f.sourceType,
            source_url: f.url,
            title: f.title,
            excerpt: f.excerpt,
            captured: {},
            media_kind: "unknown" as const,
            content_hash: f.hash,
            evidence_grade: "source" as const,
          })),
        )
        .select("id");
      if (insErr) return json({ error: insErr.message }, 500);
      insertedIds = (insertedRows ?? []).map((r) => r.id as string);

      // Bounded extraction: one model call over up to 6 combined rows. The
      // model quote-based shape keeps evidence distinguishable from reading.
      const combined = run.findings
        .map((f, i) => ({ id: insertedIds[i] ?? `f${i}`, competitor: f.competitorName, url: f.url, text: f.excerpt.slice(0, 1600) }))
        .filter((f) => f.text)
        .slice(0, 6);
      if (combined.length) {
        const ai = await modelJson(ANALYSIS_SYSTEM, JSON.stringify({ findings: combined }));
        if (ai && Array.isArray(ai.results)) {
          const byId = new Map<string, { captured: Record<string, string> }>();
          for (const row of ai.results as unknown[]) {
            const a = coerceAnalysis(String((row as Record<string, unknown>).id ?? ""), row);
            if (a.captured && Object.keys(a.captured).length) byId.set(a.id, a);
          }
          const analysisRows = insertedIds
            .filter((id) => byId.has(id))
            .map((id) => {
              const a = byId.get(id)!;
              return { finding_id: id, owner_id: userId, mode: "text", analysis: a };
            });
          if (analysisRows.length) await db.from("ad_research_analyses").insert(analysisRows);
        }
      }
    }

    const blocked = planSources({ sourceTypes }).blocked;
    const neverGot = run.notes.some((n) => n.includes("retrieval failed") || n.includes("timeout"));
    const status = run.findings.length === 0 ? (neverGot ? "failed" : "partial") : run.notes.length ? "partial" : "done";
    await db
      .from("ad_research_projects")
      .update({
        status,
        pipeline_log: [
          ...blocked.map((b) => `BLOCKED: ${b.reason}`),
          ...run.notes.slice(0, 20),
          run.findings.length
            ? `${run.findings.length} finding(s) stored from ${run.fetches} retrieval(s).`
            : "No new findings retrieved this run.",
        ].slice(0, 40),
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .eq("owner_id", userId);

    return json({ projectId: project.id, status, findings: run.findings.length, blockedCount: blocked.length });
  }

  // ---- status ---------------------------------------------------------------
  if (action === "status") {
    const { data: project } = await db
      .from("ad_research_projects")
      .select("id, status, pipeline_log, updated_at")
      .eq("id", String(body.projectId ?? ""))
      .eq("owner_id", userId)
      .maybeSingle();
    if (!project) return json({ error: "Research project not found" }, 404);
    const { count } = await db.from("ad_research_findings").select("id", { count: "exact", head: true }).eq("project_id", project.id);
    return json({
      status: project.status,
      findings: count ?? 0,
      log: (project.pipeline_log as string[]).slice(-10),
      updatedAt: project.updated_at,
    });
  }

  // ---- results ---------------------------------------------------------------
  if (action === "results") {
    const { data: project } = await db.from("ad_research_projects").select("*").eq("id", String(body.projectId ?? "")).eq("owner_id", userId).maybeSingle();
    if (!project) return json({ error: "Research project not found" }, 404);
    const { data: findings } = await db
      .from("ad_research_findings")
      .select("*")
      .eq("project_id", project.id)
      .order("retrieved_at", { ascending: false })
      .limit(200);
    const fps = (findings ?? []) as Record<string, unknown>[];

    const compIds = [...new Set(fps.map((f) => f.competitor_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (compIds.length) {
      const { data: comps } = await db.from("ad_competitors").select("id, name").in("id", compIds);
      for (const c of (comps ?? []) as { id: string; name: string }[]) names.set(c.id, c.name);
    }
    const { data: analyses } = await db
      .from("ad_research_analyses")
      .select("finding_id, mode, analysis")
      .in("finding_id", fps.map((f) => String(f.id)));
    const byFinding = new Map<string, { mode: string; analysis: Record<string, unknown> }>();
    for (const a of (analyses ?? []) as { finding_id: string; mode: string; analysis: Record<string, unknown> }[]) {
      byFinding.set(a.finding_id, { mode: a.mode, analysis: a.analysis });
    }
    const { data: opps } = await db
      .from("ad_research_opportunities")
      .select("payload")
      .eq("project_id", project.id)
      .order("created_at");
    const blocked = planSources({ sourceTypes: (project.scope as { sourceTypes?: string[] }).sourceTypes ?? [] }).blocked;

    return json({
      project: { id: project.id, title: project.title, topic: project.topic, status: project.status, log: (project.pipeline_log as string[]).slice(-12) },
      findings: fps.map((f) => ({
        ...f,
        competitor_name: f.competitor_id ? names.get(String(f.competitor_id)) ?? null : null,
        analysis: byFinding.get(String(f.id)) ?? null,
      })),
      blocked,
      opportunities: (opps ?? []).map((o) => (o as { payload: unknown }).payload),
    });
  }

  // ---- ingest (manual evidence — the supported path for blocked libraries) ---
  if (action === "ingest") {
    const projectId = String(body.projectId ?? "");
    const url = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
    if (!projectId || !url) return json({ error: "projectId and sourceUrl are required" }, 400);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return json({ error: "sourceUrl must be a valid URL" }, 400);
    }
    if (!/^https?:$/.test(parsed.protocol)) return json({ error: "only http(s) URLs are accepted" }, 400);
    const { data: project } = await db.from("ad_research_projects").select("id").eq("id", projectId).eq("owner_id", userId).maybeSingle();
    if (!project) return json({ error: "Research project not found" }, 404);

    const link = classifyLink(url);
    const kind = ["ad", "organic", "page"].includes(String(body.kind)) ? String(body.kind) : link?.kind ?? "page";
    const sourceType = typeof body.sourceType === "string" && body.sourceType ? body.sourceType : link?.sourceType ?? "manual";
    const captured: Record<string, string> = {};
    if (body.captured && typeof body.captured === "object") {
      for (const [k, v] of Object.entries(body.captured as Record<string, unknown>)) {
        if (typeof v === "string") captured[k.slice(0, 40)] = v.slice(0, 400);
      }
    }
    const { data: inserted, error } = await db
      .from("ad_research_findings")
      .insert({
        project_id: projectId,
        owner_id: userId,
        competitor_id: typeof body.competitorId === "string" && body.competitorId.length === 36 ? body.competitorId : null,
        kind,
        source_type: sourceType,
        source_url: url.slice(0, 2000),
        title: String(body.title ?? "").slice(0, 200) || parsed.hostname,
        excerpt: String(body.excerpt ?? "").slice(0, 4000),
        captured,
        media_kind: ["image", "video", "none"].includes(String(body.mediaKind)) ? (String(body.mediaKind) as "image" | "video" | "none") : "none",
        published_at: typeof body.publishedAt === "string" && !Number.isNaN(Date.parse(body.publishedAt)) ? body.publishedAt : null,
        evidence_grade: "source",
      })
      .select("id, source_url, retrieved_at")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ finding: inserted });
  }

  // ---- analyze (metered; text-only at this stage) -----------------------------
  if (action === "analyze") {
    if (!(await aiCallAllowed(req, userId, "ads-research-analyze", { max: 20, windowSeconds: 300 }))) {
      return json({ error: "Too many analyses. Wait a moment." }, 429);
    }
    const findingId = String(body.findingId ?? "");
    const { data: finding } = await db
      .from("ad_research_findings")
      .select("id, source_url, source_type, excerpt")
      .eq("id", findingId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (!finding) return json({ error: "Finding not found" }, 404);
    if (!openAiKey()) {
      return json({ error: "AI analysis is not configured on this deployment (ADS_OPENAI_API_KEY or OPENAI_API_KEY is missing).", code: "not_configured" }, 503);
    }
    const ai = await modelJson(ANALYSIS_SYSTEM, JSON.stringify({ rows: [{ id: finding.id, url: finding.source_url, sourceType: finding.source_type, text: String(finding.excerpt ?? "").slice(0, 4000) }] }));
    if (!ai || !Array.isArray(ai.results) || !ai.results.length) {
      return json({ error: "The analysis model did not return a usable result." }, 502);
    }
    const a = coerceAnalysis(finding.id, ai.results[0]);
    await db.from("ad_research_analyses").upsert({ finding_id: finding.id, owner_id: userId, mode: "text", analysis: a }, { onConflict: "finding_id" });
    return json({ analysis: a, mode: "text" });
  }

  // ---- opportunities ------------------------------------------------------------
  if (action === "opportunities") {
    if (!(await aiCallAllowed(req, userId, "ads-research-opp", { max: 6, windowSeconds: 3600 }))) {
      return json({ error: "Opportunity generation is limited per hour." }, 429);
    }
    const projectId = String(body.projectId ?? "");
    const { data: project } = await db.from("ad_research_projects").select("id").eq("id", projectId).eq("owner_id", userId).maybeSingle();
    if (!project) return json({ error: "Research project not found" }, 404);
    if (!openAiKey()) return json({ error: "AI analysis is not configured on this deployment.", code: "not_configured" }, 503);

    const { data: findings } = await db.from("ad_research_findings").select("id, title, excerpt, captured, source_url").eq("project_id", projectId).limit(24);
    const list = (findings ?? []) as { id: string; title: string; excerpt: string; captured: Record<string, unknown>; source_url: string }[];
    if (!list.length) return json({ error: "No findings yet — run retrieval or add manual evidence first." }, 400);

    const ai = await modelJson(
      OPPORTUNITY_SYSTEM,
      JSON.stringify({ rows: list.map((f) => ({ id: f.id, title: f.title, url: f.source_url, text: f.excerpt.slice(0, 800), captured: f.captured })) }),
      1600,
    );
    if (!ai || !Array.isArray(ai.opportunities)) return json({ error: "The opportunity model did not return a usable result." }, 502);
    const known = new Set(list.map((f) => f.id));
    const accepted: Record<string, unknown>[] = [];
    const rejected: { problems: string[] }[] = [];
    for (const c of (ai.opportunities as unknown[]).slice(0, 5)) {
      const v = validateOpportunity(c, known);
      if (v.problems.length) rejected.push({ problems: v.problems });
      else if (v.value) accepted.push(v.value);
    }
    if (accepted.length) {
      await db.from("ad_research_opportunities").insert(accepted.map((payload) => ({ project_id: projectId, owner_id: userId, payload })));
    }
    return json({ accepted: accepted.length, rejected, opportunities: accepted });
  }

  // ---- compare ---------------------------------------------------------------------
  if (action === "compare") {
    const projectId = String(body.projectId ?? "");
    const { data: project } = await db.from("ad_research_projects").select("id").eq("id", projectId).eq("owner_id", userId).maybeSingle();
    if (!project) return json({ error: "Research project not found" }, 404);
    const { data: findings } = await db.from("ad_research_findings").select("competitor_id, captured, excerpt").eq("project_id", projectId).limit(400);
    const { data: comps } = await db.from("ad_competitors").select("id, name").eq("owner_id", userId);
    return json(buildComparison(
      (comps ?? []) as { id: string; name: string }[],
      (findings ?? []) as never,
    ));
  }

  // ---- export ----------------------------------------------------------------------
  if (action === "export") {
    const projectId = String(body.projectId ?? "");
    const { data: project } = await db.from("ad_research_projects").select("*").eq("id", projectId).eq("owner_id", userId).maybeSingle();
    if (!project) return json({ error: "Research project not found" }, 404);
    const { data: findings } = await db
      .from("ad_research_findings")
      .select("*")
      .eq("project_id", projectId)
      .order("retrieved_at", { ascending: false })
      .limit(200);
    const fps = (findings ?? []) as Record<string, unknown>[];

    const compIds = [...new Set(fps.map((f) => f.competitor_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (compIds.length) {
      const { data: comps } = await db.from("ad_competitors").select("id, name").in("id", compIds);
      for (const c of (comps ?? []) as { id: string; name: string }[]) names.set(c.id, c.name);
    }
    const { data: comps } = await db.from("ad_competitors").select("id, name").eq("owner_id", userId);
    const comparison = buildComparison(
      (comps ?? []) as { id: string; name: string }[],
      fps.map((f) => ({ competitor_id: f.competitor_id as string | null, captured: (f.captured ?? {}) as Record<string, unknown>, excerpt: String(f.excerpt ?? "") })),
    );

    const md = renderReport(
      project as { title: string; scope: Record<string, unknown>; status: string; topic: string },
      fps.map((f) => ({
        title: String(f.title ?? ""),
        kind: String(f.kind),
        source_type: String(f.source_type),
        source_url: String(f.source_url),
        excerpt: String(f.excerpt ?? ""),
        retrieved_at: String(f.retrieved_at ?? ""),
        competitor_name: f.competitor_id ? names.get(String(f.competitor_id)) ?? null : null,
        analysis_mode: null,
      })),
      comparison,
      planSources({ sourceTypes: (project.scope as { sourceTypes?: string[] }).sourceTypes ?? [] }).blocked,
      [],
    );
    return json({ markdown: md });
  }

  return json({ error: "Unknown action" }, 400);
}

// Deno.serve exists only in the edge runtime; node-side unit tests import the
// pure exports above without triggering the server.
const g = globalThis as { Deno?: { serve?: (h: (r: Request) => Promise<Response>) => void } };
if (typeof g.Deno !== "undefined" && typeof g.Deno!.serve === "function") {
  g.Deno!.serve(handler);
}
