// ============================================================================
// imageAdsApi.ts — the Image Ads workspace's typed client to ads-image.
// ----------------------------------------------------------------------------
// Every call goes through the Edge Function (server-side auth, rate limits and
// keys). The browser never fetches provider images itself and never sees a
// public ad URL: downloads are freshly-minted, time-boxed signed reads.
// Failure messages surface the honest cause (provider refused, worker not
// configured, layout overflow) via edgeErrorMessage — no generic "failed".
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { renderComposedAd } from "@/lib/adCompose";

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("ads-image", { body });
  if (error) throw new Error(await edgeErrorMessage(error));
  return (data ?? {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shapes (mirror ads-image's actions)
// ---------------------------------------------------------------------------

export interface ImageBriefInput {
  request: string;
  productName?: string;
  audience?: string;
  objective?: string;
  message?: string;
  cta?: string;
  angle?: string;
  visualDirection?: string;
  conceptCount?: number;
  researchProjectId?: string | null;
}

export interface StoredConcept {
  id: string;
  concept_number: number;
  payload: {
    objective: string; audience: string; message: string; product: string;
    angle: string; visualDirection: string; headline: string; supportingCopy: string;
    cta: string; composition: string; placements: string[]; appeal: string;
    evidenceRefs: string[];
  };
  status: "proposed" | "selected" | "rejected";
  selected_at: string | null;
}

export interface ArtifactView {
  id: string;
  projectId: string;
  conceptId: string | null;
  parentArtifactId: string | null;
  artifactKind: "original" | "composed" | "variant" | "exported";
  stage: "generated" | "composed";
  placementId: string;
  width: number;
  height: number;
  bytes: number | null;
  status: "pending" | "generating" | "composing" | "ready" | "failed";
  failureReason: string | null;
  provider: Record<string, unknown>;
  createdAt: string;
  downloadUrl: string | null;
}

export interface JobView {
  jobId: string;
  status: "queued" | "preparing" | "rendering" | "done" | "failed";
  error: string | null;
  bytes: number | null;
  placementId: string;
  backgroundArtifactId: string | null;
  outputArtifactId: string | null;
  createdAt: string;
}

export interface ProjectStatus {
  project: { id: string; status: string; request: string; brief: Record<string, unknown>; log: string[] };
  concepts: StoredConcept[];
  jobs: JobView[];
  artifacts: ArtifactView[];
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export async function startImageProject(brief: ImageBriefInput): Promise<{ projectId: string; status: string }> {
  const data = await call({ action: "start", ...brief, conceptCount: 0 });
  return { projectId: String(data.projectId), status: String(data.status) };
}

export async function generateConcepts(
  projectId: string,
  conceptCount = 3,
): Promise<{ projectId: string; concepts: StoredConcept[]; rejected: { problems: string[] }[] }> {
  const data = await call({ action: "concepts", projectId, conceptCount });
  return data as unknown as { projectId: string; concepts: StoredConcept[]; rejected: { problems: string[] }[] };
}

export async function selectConcept(projectId: string, conceptId: string): Promise<{ selected: number }> {
  const data = await call({ action: "select", projectId, conceptId });
  return { selected: Number(data.selected) };
}

export async function generateBackgrounds(
  projectId: string,
  placementIds?: string[],
): Promise<{ projectId: string; outcomes: Record<string, { ok: boolean; artifactId?: string; error?: string }>; failed: { placementId: string; error: string }[] }> {
  const data = await call({ action: "generate", projectId, ...(placementIds ? { placementIds } : {}) });
  return data as unknown as {
    projectId: string;
    outcomes: Record<string, { ok: boolean; artifactId?: string; error?: string }>;
    failed: { placementId: string; error: string }[];
  };
}

export async function composeAd(
  projectId: string,
  artifactId: string,
  text?: { headline?: string; supportingCopy?: string; cta?: string },
): Promise<{ projectId: string; artifactId: string; placementId: string }> {
  // Compose in the browser. The server-side compose step needs a hosted FFmpeg
  // worker, and none is provisioned on this deployment, so it always answered
  // "composition worker is not configured". A still ad is background + type,
  // which canvas draws exactly; `store_composed` then owns validation, storage
  // and lineage, so the pixel work moving client-side costs no trust.
  const status = await imageProjectStatus(projectId);
  const background = status.artifacts.find((a) => a.id === artifactId);
  if (!background) throw new Error("the background artifact is not in this project");
  if (!background.downloadUrl) throw new Error("the background has no downloadable image — regenerate it and retry");

  const concept =
    status.concepts.find((c) => c.id === background.conceptId) ??
    status.concepts.find((c) => c.status === "selected") ??
    null;
  const headline = text?.headline?.trim() || concept?.payload.headline || "";
  const supportingCopy = text?.supportingCopy?.trim() ?? concept?.payload.supportingCopy;
  const cta = text?.cta?.trim() || concept?.payload.cta || "";

  const pngBase64 = await renderComposedAd({
    imageUrl: background.downloadUrl,
    width: background.width,
    height: background.height,
    headline,
    supportingCopy,
    cta,
  });

  const data = await call({
    action: "store_composed",
    projectId,
    artifactId,
    headline,
    supportingCopy: supportingCopy || undefined,
    cta,
    pngBase64,
  });
  return data as unknown as { projectId: string; artifactId: string; placementId: string };
}

export async function imageProjectStatus(projectId: string): Promise<ProjectStatus> {
  const data = await call({ action: "status", projectId });
  return data as unknown as ProjectStatus;
}

export type ReviseOutcome =
  | { kind: "recompose"; projectId: string; backgroundArtifactId: string; originalArtifactId: string }
  | { kind: "variant"; projectId: string; variantArtifactId: string; priorArtifactId: string };

export async function reviseAd(
  artifactId: string,
  input: { headline?: string; supportingCopy?: string; cta?: string; visualInstruction?: string },
): Promise<ReviseOutcome> {
  const data = await call({ action: "revise", artifactId, ...input });
  if (data.recompose) {
    const r = data.recompose as { backgroundArtifactId: string; originalArtifactId: string };
    return { kind: "recompose", projectId: String(data.projectId), ...r };
  }
  return {
    kind: "variant",
    projectId: String(data.projectId),
    variantArtifactId: String(data.variantArtifactId),
    priorArtifactId: String(data.priorArtifactId),
  };
}

export async function exportAd(
  artifactId: string,
): Promise<{ artifact: Record<string, unknown>; downloadUrl: string | null }> {
  const data = await call({ action: "export", artifactId });
  return { artifact: (data.artifact ?? {}) as Record<string, unknown>, downloadUrl: (data.downloadUrl as string) ?? null };
}
