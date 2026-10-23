// ============================================================================
// ads-image — the image-ad creation engine's edge function.
// ----------------------------------------------------------------------------
// Actions (POST, owner-scoped throughout; owner always comes from the JWT):
//   start     create the project from the request + brief; optionally generate
//             concepts in the same request when the caller asked for them
//   concepts  (re)generate concepts — metered; every concept validated
//             server-side BEFORE storage, including research-citation ids
//   select    mark one concept selected (others rejected)
//   generate  REAL image-provider request for the selected concept; the
//             response IS the contract — nothing is claimed generated when the
//             provider failed, and the brief stays intact for retry
//   compose   validate/shap the layout, create the job row, hand background +
//             logo + text to the render worker (FFmpeg, argument array)
//   status    project + jobs + artifacts with storage paths and public URLs
//   revise    text/layout-only → recompose from the SAME background (no
//             provider spend); visual change → provider edit on the original
//             producing a variant artifact with lineage
//   export    verify + return the finished ad's stored path/public URL
//
// The render worker endpoint /compose (see worker/server.mjs) is the only
// component that runs FFmpeg; this function never spawns processes.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { aiCallAllowed, authenticate, readJsonBody, json, spendForUser } from "../_shared/guard.ts";
import { buildConceptsUserPrompt, CONCEPT_SYSTEM, DEFAULT_PLACEMENT_IDS, PLACEMENTS, placementById, validateConcept, type ImageBrief, type ImageConcept } from "../_shared/imageAds.ts";
import { generateBackground, editBackground } from "../_shared/imageRun.ts";
import { buildComposePlan, validateComposeRequest, verifyOutput, type ComposeJobRequest } from "../_shared/composeJob.ts";
import { DEFAULT_BRAND, mergeBrandConfig } from "../_shared/brandDefaults.ts";

const RENDER_WORKER_URL = Deno.env.get("RENDER_WORKER_URL") ?? "";
const RENDER_TOKEN = Deno.env.get("RENDER_TOKEN") ?? "";

/** Secrets are read lazily: module import must stay clean for node-side tests. */
function openAiKey(): string | null {
  if (typeof Deno === "undefined" || !Deno.env) return null;
  return Deno.env.get("ADS_OPENAI_API_KEY") ?? Deno.env.get("OPENAI_API_KEY") ?? null;
}

function supabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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

// Injectables exported for tests — pure functions, no network or secrets here.

export interface BriefInput {
  request: string;
  productName?: string;
  audience?: string;
  objective?: string;
  message?: string;
  cta?: string;
  angle?: string;
  visualDirection?: string;
  conceptCount?: number;
}

export function normaliseBrief(body: Record<string, unknown>): { ok: boolean; problems: string[]; brief?: BriefInput } {
  const problems: string[] = [];
  const request = typeof body.request === "string" ? body.request.trim().slice(0, 2000) : "";
  if (!request) problems.push("request is required (a plain-language description of the ad)");
  const brief: BriefInput = {
    request,
    productName: typeof body.productName === "string" ? body.productName.trim().slice(0, 200) : undefined,
    audience: typeof body.audience === "string" ? body.audience.trim().slice(0, 400) : undefined,
    objective: typeof body.objective === "string" ? body.objective.trim().slice(0, 200) : undefined,
    message: typeof body.message === "string" ? body.message.trim().slice(0, 600) : undefined,
    cta: typeof body.cta === "string" ? body.cta.trim().slice(0, 200) : undefined,
    angle: typeof body.angle === "string" ? body.angle.trim().slice(0, 200) : undefined,
    visualDirection: typeof body.visualDirection === "string" ? body.visualDirection.trim().slice(0, 300) : undefined,
    conceptCount: Number.isFinite(Number(body.conceptCount)) ? Math.min(5, Math.max(0, Math.round(Number(body.conceptCount)))) : 3,
  };
  return { ok: problems.length === 0, problems, brief };
}

/** Brief as the concept prompt expects; defaults filled from the brand config. */
export function briefForPrompt(brief: BriefInput, brand: ReturnType<typeof mergeBrandConfig>): ImageBrief {
  return {
    productName: brief.productName || brand.description.split(".")[0] || brand.name,
    audience: brief.audience || brand.targetAudience,
    objective: brief.objective || "waitlist signups pre-launch",
    message: brief.message || `${brand.name}: ${brand.positioning}`,
    cta: brief.cta || brand.approvedCtas[0] || DEFAULT_BRAND.approvedCtas[0],
    angle: brief.angle,
    visualDirection: brief.visualDirection,
  };
}

// ---------------------------------------------------------------------------
// Worker compose call — same auth shape ad-render uses for video renders.
// ---------------------------------------------------------------------------

async function callComposeWorker(jobReq: ComposeJobRequest, backgroundPath: string, logoPath: string | null): Promise<Response> {
  if (!RENDER_WORKER_URL || !RENDER_TOKEN) {
    return json({ error: "the composition worker is not configured on this deployment (RENDER_WORKER_URL/RENDER_TOKEN missing)", code: "worker_not_configured" }, 503);
  }
  const res = await fetch(`${RENDER_WORKER_URL}/compose`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-render-token": RENDER_TOKEN },
    body: JSON.stringify({
      jobId: jobReq.jobId,
      placementId: jobReq.placementId,
      custom: jobReq.custom,
      background: backgroundPath,
      logo: logoPath ?? undefined,
      brand: jobReq.brand,
      text: jobReq.text,
      allowOverflow: jobReq.allowOverflow,
    }),
  });
  return res;
}

// ---------------------------------------------------------------------------
// Storage — finished ads land in the PRIVATE ads bucket under ads/{userId}/…
// (not the public renders bucket: download is signed, per audit E3).
// ---------------------------------------------------------------------------

const ADS_BUCKET = "ads";

async function storeArtifact(
  admin: ReturnType<typeof supabaseAdmin>,
  ownerId: string,
  artifactId: string,
  bytes: Uint8Array,
  placementId: string,
): Promise<{ path: string; publicUrl: string | null; size: number; error?: string }> {
  const path = `ads/${ownerId}/image-ads/${artifactId}.png`;
  const { error } = await admin.storage.from(ADS_BUCKET).upload(path, bytes, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) return { path, publicUrl: null, size: bytes.byteLength, error: error.message };
  // Private bucket: downloads go through signed URLs minted at read time.
  const { data: signed } = await admin.storage.from(ADS_BUCKET).createSignedUrl(path, 600);
  return {
    path,
    publicUrl: signed?.signedUrl ?? null,
    // publicUrl here is a SIGNED read URL valid 10 minutes, not a public link.
    size: bytes.byteLength,
  };
}

const IMAGE_MIME = "image/png";

function pngBytesFromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Status shape
// ---------------------------------------------------------------------------

async function loadArtifactView(admin: ReturnType<typeof supabaseAdmin>, ownerId: string, artifacts: Record<string, unknown>[]) {
  const compIds = [...new Set(artifacts.map((a) => String(a.concept_id ?? "")).filter(Boolean))];
  const parentIds = [...new Set(artifacts.map((a) => String(a.parent_artifact_id ?? "")).filter(Boolean))];
  const out: Record<string, unknown>[] = [];
  for (const a of artifacts) {
    const path = String(a.storage_path);
    // A fresh signed URL per read: storage credentials are never in the reply.
    const { data: signed } = await admin.storage.from(ADS_BUCKET).createSignedUrl(path.replace(/^ads\//, ""), 600);
    out.push({
      id: a.id,
      projectId: a.project_id,
      conceptId: a.concept_id,
      parentArtifactId: a.parent_artifact_id,
      artifactKind: a.artifact_kind,
      stage: a.stage,
      placementId: a.placement_id,
      width: a.width,
      height: a.height,
      bytes: a.bytes,
      status: a.status,
      failureReason: a.failure_reason,
      provider: a.provider,
      createdAt: a.created_at,
      conceptNumber: compIds.includes(String(a.concept_id)) ? a.concept_id : null,
      lineage: parentIds.includes(String(a.parent_artifact_id)) ? a.parent_artifact_id : null,
      downloadUrl: signed?.signedUrl ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const userId = await authenticate(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const body = await readJsonBody(req);
  if (!body) return json({ error: "Invalid request body" }, 400);
  const action = typeof body.action === "string" ? body.action : "";
  const admin = supabaseAdmin();

  // Brand is loaded for every action that needs it (defaults when unset).
  const loadBrand = async () => {
    const { data: row } = await admin.from("ad_brand_settings").select("config").eq("user_id", userId).maybeSingle();
    return mergeBrandConfig(row?.config ?? null);
  };

  // ---- start ----------------------------------------------------------------
  if (action === "start") {
    const briefInput = normaliseBrief(body);
    if (!briefInput.ok) return json({ error: "Invalid brief", problems: briefInput.problems }, 400);
    const brief = briefInput.brief!;
    const researchProjectId = typeof body.researchProjectId === "string" && body.researchProjectId.length === 36 ? body.researchProjectId : null;
    if (researchProjectId) {
      const { data: rp } = await admin.from("ad_research_projects").select("id").eq("id", researchProjectId).eq("owner_id", userId).maybeSingle();
      if (!rp) return json({ error: "researchProjectId does not belong to this owner" }, 400);
    }

    const { data: project, error: projErr } = await admin
      .from("ad_image_projects")
      .insert({
        owner_id: userId,
        request: brief.request,
        brief: brief as unknown as Record<string, unknown>,
        status: brief.conceptCount && brief.conceptCount > 0 ? "concepts" : "brief",
        research_project_id: researchProjectId,
        pipeline_log: [`Project created from: “${brief.request.slice(0, 80)}”`],
      })
      .select("id")
      .single();
    if (projErr || !project) return json({ error: projErr?.message ?? "could not create the project" }, 500);

    return json({ projectId: project.id, status: brief.conceptCount && brief.conceptCount > 0 ? "concepts" : "brief" });
  }

  // ---- concepts -----------------------------------------------------------------
  if (action === "concepts") {
    if (!(await aiCallAllowed(req, userId, "ads-image-concepts", { max: 10, windowSeconds: 600 }))) {
      return json({ error: "Concept generation is limited for now. Try again shortly." }, 429);
    }
    if (!openAiKey()) {
      return json({ error: "AI (ADS_OPENAI_API_KEY or OPENAI_API_KEY) is not configured on this deployment.", code: "not_configured" }, 503);
    }
    const projectId = String(body.projectId ?? "");
    const { data: project } = await admin.from("ad_image_projects").select("*").eq("id", projectId).eq("owner_id", userId).maybeSingle();
    if (!project) return json({ error: "Image-ad project not found" }, 404);

    const brand = await loadBrand();
    const brief = normaliseBrief({ ...(project.brief as Record<string, unknown>), request: String(project.request) });
    if (!brief.ok) return json({ error: "The stored brief is incomplete", problems: brief.problems }, 500);

    // Research findings the project chose to cite (optional link).
    let research: { id: string; title: string; captured: Record<string, string>; excerpt: string }[] = [];
    if (project.research_project_id) {
      const { data: rows } = await admin
        .from("ad_research_findings")
        .select("id, title, captured, excerpt")
        .eq("project_id", project.research_project_id)
        .limit(12);
      research = (rows ?? []) as typeof research;
    }

    const count = Math.min(5, Math.max(1, Number(body.conceptCount ?? brief.brief!.conceptCount ?? 3)));
    const { concepts, hardFail } = await (await import("../_shared/imageRun.ts")).requestConcepts(
      CONCEPT_SYSTEM,
      buildConceptsUserPrompt(
        briefForPrompt(brief.brief!, brand),
        brand,
        count,
        research,
      ),
    );
    if (!concepts) return json({ error: hardFail ?? "concept generation failed" }, 502);

    const knownEvidence = new Set(research.map((r) => r.id));
    const accepted: { number: number; payload: ImageConcept; problems: string[] }[] = [];
    const rejected: { problems: string[] }[] = [];
    let number = 0;
    for (const raw of concepts.slice(0, count)) {
      const verdict = validateConcept(raw, knownEvidence);
      if (verdict.problems.length) rejected.push({ problems: verdict.problems });
      else if (verdict.value) {
        number += 1;
        accepted.push({ number, payload: verdict.value, problems: [] });
      }
    }
    if (!accepted.length) {
      return json({ error: "The concept model returned nothing that passed validation.", rejected }, 502);
    }

    // Replace prior concepts atomically (fresh set each call).
    await admin.from("ad_image_concepts").delete().eq("project_id", projectId).eq("owner_id", userId);
    const { data: stored, error: storeErr } = await admin
      .from("ad_image_concepts")
      .insert(accepted.map((a) => ({ project_id: projectId, owner_id: userId, concept_number: a.number, payload: a.payload, status: "proposed" })))
      .select("id, concept_number, payload");
    if (storeErr) return json({ error: storeErr.message }, 500);

    await admin
      .from("ad_image_projects")
      .update({ status: "concepts", updated_at: new Date().toISOString(), pipeline_log: [`Concept model produced ${accepted.length} concept(s); ${rejected.length} rejected server-side.`] })
      .eq("id", projectId);

    return json({ projectId, concepts: stored ?? [], rejected });
  }

  // ---- select -----------------------------------------------------------------
  if (action === "select") {
    const projectId = String(body.projectId ?? "");
    const conceptId = String(body.conceptId ?? "");
    const { data: concept } = await admin.from("ad_image_concepts").select("id, concept_number").eq("id", conceptId).eq("project_id", projectId).eq("owner_id", userId).maybeSingle();
    if (!concept) return json({ error: "Concept not found for this project" }, 404);
    await admin.from("ad_image_concepts").update({ status: "rejected", selected_at: null }).eq("project_id", projectId).eq("owner_id", userId);
    const { error: selErr } = await admin.from("ad_image_concepts").update({ status: "selected", selected_at: new Date().toISOString() }).eq("id", conceptId);
    if (selErr) return json({ error: selErr.message }, 500);
    await admin.from("ad_image_projects").update({ status: "generating", updated_at: new Date().toISOString() }).eq("id", projectId).eq("owner_id", userId);
    return json({ selected: concept.concept_number });
  }

  // ---- generate -----------------------------------------------------------------
  if (action === "generate") {
    if (!(await aiCallAllowed(req, userId, "ads-image-generate", { max: 20, windowSeconds: 600 }))) {
      return json({ error: "Image generation is limited for now. Try again shortly." }, 429);
    }
    if (!openAiKey()) {
      return json({ error: "Image generation is not configured on this deployment (ADS_OPENAI_API_KEY or OPENAI_API_KEY is missing).", code: "not_configured" }, 503);
    }
    const projectId = String(body.projectId ?? "");
    const { data: concept } = await admin
      .from("ad_image_concepts")
      .select("id, concept_number, payload")
      .eq("project_id", projectId)
      .eq("owner_id", userId)
      .eq("status", "selected")
      .maybeSingle();
    if (!concept) return json({ error: "Select a concept before generating" }, 400);
    const brand = await loadBrand();
    const placementIds = Array.isArray(body.placementIds) && body.placementIds.length
      ? (body.placementIds as unknown[]).filter((p): p is string => typeof p === "string" && PLACEMENTS.some((pl) => pl.id === p)).slice(0, 4)
      : ((concept.payload as ImageConcept).placements ?? DEFAULT_PLACEMENT_IDS).filter((p) => PLACEMENTS.some((pl) => pl.id === p)).slice(0, 4);
    if (!placementIds.length) return json({ error: "No supported placements to generate for" }, 400);

    const outcomes: Record<string, { ok: boolean; artifactId?: string; error?: string; size?: string }> = {};
    for (const placementId of placementIds) {
      const placement = placementById(placementId);
      const size = `${placement.genWidth}x${placement.genHeight}`;
      // Beta cost control: one metered credit charge per provider generation,
      // Unlimited plans included (metered path) — see the ads beta migration.
      const metered = await spendForUser(req, userId, "ads_image_generate", `Image ad background ${placementId}`, {
        source: "ads-image",
        billUnlimited: true,
        idempotencyKey: `img:${crypto.randomUUID()}`,
      });
      if (!metered.success) {
        return json(
          {
            error: metered.error === "insufficient_credits"
              ? `Not enough credits for the remaining image generations (${metered.cost ?? "?"} each; you have ${metered.balance ?? 0}). Nothing further was charged.`
              : metered.error ?? "Could not record the credit charge",
            code: metered.error === "insufficient_credits" ? "insufficient_credits" : "metering_failed",
          },
          metered.error === "insufficient_credits" ? 402 : 500,
        );
      }
      const outcome = await generateBackground(concept.payload as ImageConcept, brand, size);
      if (!outcome.ok || !outcome.imageB64) {
        outcomes[placementId] = { ok: false, error: outcome.error ?? "the provider returned no image", size };
        // The provider failed AFTER the credit charge was recorded: the failed
        // generation is disclosed with its charge, never retried silently.
        console.error(`[ads-image] provider failed after metered charge (${metered.cost} credits) for ${placementId}`);
        // The concept and project stay intact; the UI's error message names the
        // failed placement so the retry decision stays with the user.
        continue;
      }
      const bytes = pngBytesFromB64(outcome.imageB64);
      const { data: inserted, error: insErr } = await admin
        .from("ad_image_artifacts")
        .insert({
          project_id: projectId,
          concept_id: concept.id,
          owner_id: userId,
          artifact_kind: "original",
          stage: "generated",
          placement_id: placementId,
          mime: IMAGE_MIME,
          width: placement.genWidth,
          height: placement.genHeight,
          bytes: bytes.byteLength,
          provider: {
            model: outcome.model,
            requestSize: outcome.size,
            totalTokens: outcome.totalTokens,
            // PNG data-URL prefix is the only container we accept back.
            format: "png",
            // Provider price list for gpt-image-2.5 variants is not published;
            // usage tokens ARE stored so a cost column can be filled later.
            costUsd: null,
            pricingNote: "provider pricing not published for this model; usage tokens recorded",
          },
          source_brief: concept.payload,
          status: "ready",
        })
        .select("id")
        .single();
      if (insErr) {
        outcomes[placementId] = { ok: false, error: `storing the generated image failed: ${insErr.message}` };
        continue;
      }
      const stored = await storeArtifact(admin, userId, inserted.id, bytes, placementId);
      if (stored.error) {
        await admin.from("ad_image_artifacts").update({ status: "failed", failure_reason: stored.error }).eq("id", inserted.id);
        outcomes[placementId] = { ok: false, error: `uploading the generated image failed: ${stored.error}` };
        continue;
      }
      await admin.from("ad_image_artifacts").update({ storage_path: stored.path }).eq("id", inserted.id);
      outcomes[placementId] = { ok: true, artifactId: inserted.id, size };
    }

    const anyOk = Object.values(outcomes).some((o) => o.ok);
    await admin
      .from("ad_image_projects")
      .update({ status: anyOk ? "generating" : "failed", updated_at: new Date().toISOString() })
      .eq("id", projectId);

    const failed = Object.entries(outcomes)
      .filter(([, o]) => !o.ok)
      .map(([p, o]) => ({ placementId: p, error: o.error }));
    return json({ projectId, outcomes, failed });
  }

  // ---- compose --------------------------------------------------------------
  if (action === "compose") {
    const projectId = String(body.projectId ?? "");
    const backgroundArtifactId = String(body.artifactId ?? "");
    const { data: bg } = await admin
      .from("ad_image_artifacts")
      .select("id, project_id, owner_id, storage_path, placement_id, concept_id, provider, source_brief")
      .eq("id", backgroundArtifactId)
      .eq("project_id", projectId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (!bg) return json({ error: "Background artifact not found" }, 404);

    // The background travels to the worker as a WORK_DIR-contained data-URL
    // (already base64) so the worker's resolveSource accepts it unmodified.
    const { data: bgBytes, error: dlErr } = await admin.storage.from(ADS_BUCKET).download(String(bg.storage_path).replace(/^ads\//, ""));
    if (dlErr || !bgBytes) return json({ error: "could not read the background image" }, 500);
    const bgBuf = new Uint8Array(await bgBytes.arrayBuffer());
    const bgB64 = btoa(String.fromCharCode(...bgBuf.subarray(0, Math.min(bgBuf.length, 32 * 1024 * 1024))));
    const backgroundDataUrl = `data:image/png;base64,${bgB64}`;

    const concept = bg.concept_id
      ? (await admin.from("ad_image_concepts").select("payload").eq("id", bg.concept_id).single()).data
      : null;
    const brand = await loadBrand();
    const textFromConcept = (concept?.payload as ImageConcept | null) ?? null;
    const headline = typeof body.headline === "string" && body.headline.trim() ? body.headline.trim().slice(0, 300) : textFromConcept?.headline;
    const supportingCopy = typeof body.supportingCopy === "string" ? body.supportingCopy.trim().slice(0, 300) || undefined : textFromConcept?.supportingCopy;
    const cta = typeof body.cta === "string" && body.cta.trim() ? body.cta.trim().slice(0, 300) : textFromConcept?.cta;
    if (!headline || !cta) return json({ error: "headline and cta are required (from the concept or the request)" }, 400);

    const jobId = crypto.randomUUID().replace(/-/g, "");
    const composeRequest: ComposeJobRequest = {
      jobId,
      placementId: String(bg.placement_id),
      background: backgroundDataUrl,
      logo: brand.logoPath ?? undefined,
      brand: { purple: brand.colors.purple },
      text: { headline, supportingCopy, cta, disclaimer: undefined },
    };
    const verdict = validateComposeRequest(composeRequest);
    if (!verdict.ok) return json({ error: verdict.reason }, 400);

    // Preview the layout server-side first — the worker refuses overflow, but
    // spending a job slot on guaranteed overflow is a wasted render.
    const preview = buildComposePlan({
      request: verdict.request!,
      backgroundPath: "job/bg.png",
      logoPath: "job/logo.png",
      fontPath: "fonts/brand.ttf",
      outPath: "job/out.png",
    });
    if ("overflow" in preview) return json({ error: "layout overflow", overflow: preview.overflow }, 422);

    // Logo file: read from the brand-bucket (ads/{userId}/brand/logo.jpg) when
    // the brand's logoPath is there; otherwise the worker has no logo to draw.
    let logoDataUrl: string | null = null;
    if (brand.logoPath) {
      const logoStoragePath = brand.logoPath.replace(/^ads\//, "");
      const { data: logoBytes } = await admin.storage.from(ADS_BUCKET).download(logoStoragePath).catch(() => ({ data: null, error: null }));
      if (logoBytes) {
        const buf = new Uint8Array(await logoBytes.arrayBuffer());
        const mimeGuess = logoStoragePath.endsWith(".jpg") || logoStoragePath.endsWith(".jpeg") ? "image/jpeg" : "image/png";
        logoDataUrl = `data:${mimeGuess};base64,${btoa(String.fromCharCode(...buf.subarray(0, Math.min(buf.length, 4 * 1024 * 1024))))}`;
      }
    }

    const { data: jobRow, error: jobErr } = await admin
      .from("ad_image_jobs")
      .insert({
        job_id: jobId,
        owner_id: userId,
        project_id: projectId,
        concept_id: bg.concept_id,
        background_artifact_id: bg.id,
        status: "queued",
        placement_id: String(bg.placement_id),
        compose_request: { placementId: String(bg.placement_id), text: { headline, supportingCopy, cta } },
      })
      .select("id")
      .single();
    if (jobErr) return json({ error: jobErr.message }, 500);

    const workerRes = await callComposeWorker(verdict.request!, backgroundDataUrl, logoDataUrl);
    const workerBody = (await workerRes.json().catch(() => ({}))) as { error?: string; jobId?: string; state?: string };
    if (!workerRes.ok && workerRes.status !== 202 && workerRes.status !== 200) {
      await admin.from("ad_image_jobs").update({ status: "failed", error: workerBody.error ?? "worker refused the compose request" }).eq("job_id", jobId);
      return json({ error: workerBody.error ?? "the composition worker refused the request" }, workerRes.status);
    }
    await admin.from("ad_image_jobs").update({ status: workerBody.state ?? "queued", started_at: new Date().toISOString() }).eq("job_id", jobId);
    return json({ projectId, jobId, artifactId: bg.id, placementId: bg.placement_id });
  }

  // ---- status --------------------------------------------------------------
  if (action === "status") {
    const projectId = String(body.projectId ?? "");
    const { data: project } = await admin.from("ad_image_projects").select("*").eq("id", projectId).eq("owner_id", userId).maybeSingle();
    if (!project) return json({ error: "Image-ad project not found" }, 404);
    const { data: jobs } = await admin.from("ad_image_jobs").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(40);
    const { data: concepts } = await admin.from("ad_image_concepts").select("id, concept_number, payload, status, selected_at").eq("project_id", projectId).order("concept_number");
    const { data: artifacts } = await admin.from("ad_image_artifacts").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(80);

    // Sync each unfinished job against the worker (bounded by MAX 6 jobs).
    const jobViews: Record<string, unknown>[] = [];
    for (const j of (jobs ?? []).slice(0, 6)) {
      let state = String(j.status);
      let error = j.error;
      let bytesCount = j.bytes;
      const outputArtifactId = j.output_artifact_id as string | null;
      if ((state === "queued" || state === "preparing" || state === "rendering") && RENDER_WORKER_URL && RENDER_TOKEN) {
        const res = await fetch(`${RENDER_WORKER_URL}/jobs/${j.job_id}`, { headers: { "x-render-token": RENDER_TOKEN } });
        if (res.ok) {
          const w = (await res.json()) as { state?: string; error?: string | null; bytes?: number | null; result?: Record<string, unknown> };
          state = w.state ?? state;
          error = w.error ?? error;
          bytesCount = w.bytes ?? bytesCount;
          await admin.from("ad_image_jobs").update({ status: state, error, bytes: bytesCount ?? null, updated_at: new Date().toISOString() }).eq("job_id", j.job_id);
        }
      }
      const row: Record<string, unknown> = {
        jobId: j.job_id,
        status: state,
        error,
        bytes: bytesCount,
        placementId: j.placement_id,
        backgroundArtifactId: j.background_artifact_id,
        outputArtifactId: outputArtifactId,
        createdAt: j.created_at,
      };
      jobViews.push(row);
    }

    return json({
      project: { id: project.id, status: project.status, request: project.request, brief: project.brief, log: (project.pipeline_log as string[]).slice(-12) },
      concepts: concepts ?? [],
      jobs: jobViews,
      artifacts: await loadArtifactView(admin, userId, (artifacts ?? []) as Record<string, unknown>[]),
    });
  }

  // ---- revise --------------------------------------------------------------
  if (action === "revise") {
    const artifactId = String(body.artifactId ?? "");
    const { data: prior } = await admin.from("ad_image_artifacts").select("*").eq("id", artifactId).eq("owner_id", userId).maybeSingle();
    if (!prior) return json({ error: "Artifact not found" }, 404);
    const projectId = String(prior.project_id);

    const projectName = typeof body.instruction === "string" ? body.instruction.trim() : "";
    const textChanges = {
      headline: typeof body.headline === "string" && body.headline.trim() ? body.headline.trim().slice(0, 300) : undefined,
      supportingCopy: typeof body.supportingCopy === "string" ? body.supportingCopy.trim().slice(0, 300) || undefined : undefined,
      cta: typeof body.cta === "string" && body.cta.trim() ? body.cta.trim().slice(0, 300) : undefined,
    };
    const wantsVisualEdit = typeof body.visualInstruction === "string" && body.visualInstruction.trim().length > 0;

    // (1) Pure text change and the caller does not want a new background:
    // recompose from the SAME background — no provider spend (prompt §7).
    if (!wantsVisualEdit) {
      // compose from prior.stage === 'generated'? composed on generated: the
      // background for a re-render is prior when prior.stage==='generated';
      // otherwise prior.parent (the original generated image).
      const backgroundId = prior.stage === "generated" ? prior.id : prior.parent_artifact_id;
      if (!backgroundId) return json({ error: "the artifact has no background to recompose from" }, 400);
      return json({ projectId, recompose: { backgroundArtifactId: backgroundId, text: textChanges, originalArtifactId: artifactId } });
    }

    // (2) Visual edit → provider edit on the ORIGINAL generated image.
    if (!(await aiCallAllowed(req, userId, "ads-image-edit", { max: 20, windowSeconds: 600 }))) {
      return json({ error: "Image editing is limited for now. Try again shortly." }, 429);
    }
    if (!openAiKey()) {
      return json({ error: "Image editing is not configured on this deployment.", code: "not_configured" }, 503);
    }
    // The original (stage 'generated') provides the pixels; a variant is made
    // with a new provider request and cited as derived from prior.
    let source = prior;
    if (prior.stage !== "generated") {
      if (!prior.parent_artifact_id) return json({ error: "the variant has no generated ancestor" }, 400);
      const { data: parentRow } = await admin.from("ad_image_artifacts").select("*").eq("id", prior.parent_artifact_id).maybeSingle();
      if (!parentRow) return json({ error: "the generated ancestor is missing" }, 404);
      source = parentRow;
    }
    const { data: srcBytes, error: dlErr } = await admin.storage.from(ADS_BUCKET).download(String(source.storage_path).replace(/^ads\//, ""));
    if (dlErr || !srcBytes) return json({ error: "could not read the source image for the edit" }, 500);
    const buf = new Uint8Array(await srcBytes.arrayBuffer());
    const srcB64 = btoa(String.fromCharCode(...buf.subarray(0, Math.min(buf.length, 48 * 1024 * 1024))));

    // Beta cost control: a variant is a NEW provider edit — metered like the
    // first generation, for every plan type.
    const editMetered = await spendForUser(req, userId, "ads_image_generate", `Image ad visual variant of ${source.id}`, {
      source: "ads-image",
      billUnlimited: true,
      idempotencyKey: `img-edit:${crypto.randomUUID()}`,
    });
    if (!editMetered.success) {
      return json(
        {
          error: editMetered.error === "insufficient_credits"
            ? `Not enough credits for a visual variant (${editMetered.cost ?? "?"} needed; you have ${editMetered.balance ?? 0}). Nothing was charged.`
            : editMetered.error ?? "Could not record the credit charge",
          code: editMetered.error === "insufficient_credits" ? "insufficient_credits" : "metering_failed",
        },
        editMetered.error === "insufficient_credits" ? 402 : 500,
      );
    }
    const outcome = await editBackground(srcB64, body.visualInstruction as string, `${source.width}x${source.height}`);
    if (!outcome.ok || !outcome.imageB64) {
      return json({ error: outcome.error ?? "the provider returned no edited image", creditsCharged: editMetered.cost }, 502);
    }
    const bytes = pngBytesFromB64(outcome.imageB64);
    const { data: inserted, error: insErr } = await admin
      .from("ad_image_artifacts")
      .insert({
        project_id: projectId,
        concept_id: prior.concept_id,
        owner_id: userId,
        artifact_kind: "variant",
        stage: "generated",
        parent_artifact_id: source.id,
        placement_id: prior.placement_id,
        mime: IMAGE_MIME,
        width: prior.width,
        height: prior.height,
        bytes: bytes.byteLength,
        provider: {
          model: outcome.model,
          fromArtifactId: source.id,
          instruction: String(body.visualInstruction).slice(0, 500),
          totalTokens: outcome.totalTokens,
          costUsd: null,
          pricingNote: "provider pricing not published for this model; usage tokens recorded",
        },
        source_brief: source.source_brief,
        status: "ready",
      })
      .select("id")
      .single();
    if (insErr) return json({ error: insErr.message }, 500);
    const stored = await storeArtifact(admin, userId, inserted.id, bytes, String(prior.placement_id));
    if (stored.error) {
      await admin.from("ad_image_artifacts").update({ status: "failed", failure_reason: stored.error }).eq("id", inserted.id);
      return json({ error: `uploading the variant failed: ${stored.error}` }, 500);
    }
    await admin.from("ad_image_artifacts").update({ storage_path: stored.path }).eq("id", inserted.id);
    return json({ projectId, variantArtifactId: inserted.id, priorArtifactId: prior.id });
  }

  // ---- export --------------------------------------------------------------
  if (action === "export") {
    const artifactId = String(body.artifactId ?? "");
    const { data: artifact } = await admin.from("ad_image_artifacts").select("*").eq("id", artifactId).eq("owner_id", userId).maybeSingle();
    if (!artifact) return json({ error: "Artifact not found" }, 404);
    if (artifact.status !== "ready") return json({ error: `artifact is ${artifact.status}` }, 409);
    if (artifact.stage !== "composed") return json({ error: "export expects a COMPOSED ad (run compose first)" }, 409);
    const { data: signed } = await admin.storage.from(ADS_BUCKET).createSignedUrl(String(artifact.storage_path).replace(/^ads\//, ""), 3600);
    return json({
      artifact: {
        id: artifact.id,
        placementId: artifact.placement_id,
        width: artifact.width,
        height: artifact.height,
        bytes: artifact.bytes,
        mime: artifact.mime,
        provider: artifact.provider,
        source_brief: artifact.source_brief,
      },
      downloadUrl: signed?.signedUrl ?? null,
      // No dimensions re-check needed here: width/height columns are the
      // worker's verified output (see verifyOutput in composeJob.ts).
    });
  }

  return json({ error: "Unknown action" }, 400);
}

// Deno.serve exists only in the edge runtime; node-side tests never trigger it.
const g = globalThis as { Deno?: { serve?: (h: (r: Request) => Promise<Response>) => void } };
if (typeof g.Deno !== "undefined" && typeof g.Deno!.serve === "function") {
  g.Deno!.serve(handler);
}

export default handler;
