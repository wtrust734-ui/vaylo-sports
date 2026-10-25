// ============================================================================
// chatRun — the Creative Assistant's automatic build runner (one approval).
// ----------------------------------------------------------------------------
// When a chat plan contains a creation step (image ad / video ad), the user
// presses Run once; this module then runs the whole pipeline through the exact
// same server endpoints the workspaces use, answering the per-step quote/confirm
// gates itself, and streams honest progress events back to the chat while it
// works. There is no credit charge at any step — the app has no credit economy.
//
// Order rules:
//   • a competitor_research step listed BEFORE the creation step runs first;
//     the image brief links the research project natively and the video brief
//     embeds its top findings as citations;
//   • a video build is: concepts → shots → narration → render → watch.
//   • an image build is: concepts → select the first → ONE background
//     generation (9:16 Story/Reels) → compose → hand back the finished ad.
//
// Nothing in here fabricates success: every "done" line comes from a server
// response, and every failure carries the server's own message. The runner is
// pure data-in/data-out — rendering and persistence live in the caller.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import {
  generateVideoConcept,
  quoteShot,
  startShot,
  pollShot,
  validateVoiceover,
  generateVoiceover,
  uploadNarration,
  renderVideo,
  jobStatus,
  type VideoConceptResult,
} from "./videoAdsApi";
import {
  startImageProject,
  generateConcepts,
  selectConcept,
  generateBackgrounds,
  composeAd,
  imageProjectStatus,
  exportAd,
} from "./imageAdsApi";
import { startResearch, researchResults } from "./researchApi";

const IMAGE_PLACEMENT = "ig_story_reels"; // one 9:16 Story/Reels ad (the agreed default)

// Poll cadences — the same honest "still generating, Xs elapsed" behaviour the
// workspaces show; nothing claims motion the server has not reported.
const SHOT_POLL_INTERVAL_MS = 15_000;
const SHOT_POLL_MAX_MS = 6 * 60_000;
const RENDER_POLL_INTERVAL_MS = 10_000;
const RENDER_POLL_MAX_MS = 15 * 60_000;
const IMAGE_STATUS_INTERVAL_MS = 3_000;
const IMAGE_STATUS_MAX_MS = 3 * 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanStep {
  type: string;
  options?: Record<string, unknown>;
}

export type RunEvent =
  | { level: "start" | "progress" | "done"; text: string }
  | { level: "error"; text: string };

export type RunDeliverable =
  | {
      kind: "image";
      projectId: string;
      conceptId: string | null;
      headline: string;
      cta: string;
      previewUrl: string | null;
      researchProjectId: string | null;
      notes: string[];
    }
  | {
      kind: "video";
      conceptId: string;
      jobId: string | null;
      publicUrl: string | null;
      shotsDone: number;
      shotsFailed: number;
      researchProjectId: string | null;
      notes: string[];
    }
  | { kind: "failed"; reason: string };

/** True when the plan is one this runner can execute end to end. */
export function isRunnable(steps: PlanStep[]): boolean {
  return steps.some((s) => s.type === "image_ad" || s.type === "video_ad");
}

// ---------------------------------------------------------------------------
// Research-first support
// ---------------------------------------------------------------------------

interface ResearchContext {
  projectId: string;
  citations: string | null;
}

async function runResearchStep(
  step: PlanStep,
  brief: string,
  emit: (e: RunEvent) => void,
): Promise<ResearchContext | null> {
  const competitors = Array.isArray(step.options?.competitors)
    ? (step.options?.competitors as unknown[]).filter((c): c is string => typeof c === "string").slice(0, 5)
    : [];
  try {
    emit({ level: "start", text: "Running the market research first — pulling real sources before any concept is written" });
    const started = await startResearch({
      competitors,
      topic: brief.slice(0, 300),
      title: `For concept: ${brief.slice(0, 120)}`,
    });
    emit({
      level: "progress",
      text: `Research run finished — ${started.findings} finding${started.findings === 1 ? "" : "s"} collected${started.blockedCount ? `, ${started.blockedCount} source(s) blocked and disclosed` : ""}`,
    });
    let citations: string | null = null;
    try {
      const results = await researchResults(started.projectId);
      const top = results.findings.slice(0, 3);
      if (top.length) {
        citations = top
          .map((f) => `• ${f.competitor_name ?? "source"}: "${f.title}" — ${f.excerpt.slice(0, 160)} (source: ${f.source_url})`)
          .join("\n");
      }
    } catch {
      citations = null; // findings stay linked by project id for the image brief
    }
    emit({ level: "done", text: "Research stored — the concept step will cite it" });
    return { projectId: started.projectId, citations };
  } catch (e) {
    emit({ level: "error", text: e instanceof Error ? e.message : "The research step failed" });
    emit({ level: "progress", text: "Continuing without research — the build can still proceed, but the concepts will not cite this run" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// The video build
// ---------------------------------------------------------------------------

interface ShotWork {
  sceneShot: number;
  state: "pending" | "generating" | "ready" | "failed";
  shotId?: string;
  operationId?: string;
  videoUri?: string | null;
  error?: string | null;
}

const secs = (ms: number) => `${Math.round(ms / 1000)}s`;

async function runVideoBuild(
  brief: string,
  step: PlanStep,
  research: ResearchContext | null,
  emit: (e: RunEvent) => void,
): Promise<Extract<RunDeliverable, { kind: "video" } | { kind: "failed" }>> {
  const duration = Number(step.options?.durationSeconds) || 15;
  const cta = typeof step.options?.callToAction === "string" && (step.options?.callToAction as string).trim()
    ? (step.options?.callToAction as string)
    : "Join the waitlist";

  // ---- concept (free) -----------------------------------------------------
  emit({ level: "start", text: "Writing the video concept — script, storyboard and shot plan (free, no provider spend)" });
  let concept: VideoConceptResult;
  try {
    concept = await generateVideoConcept({
      prompt: research?.citations
        ? `${brief}\n\nGround the concept in this saved competitor research (cite the sources, never invent claims):\n${research.citations.slice(0, 1600)}`
        : brief,
      durationSeconds: Math.max(6, Math.min(60, duration)),
      callToAction: cta,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Concept generation failed.";
    emit({ level: "error", text: msg });
    return { kind: "failed", reason: msg };
  }
  emit({
    level: "done",
    text: `Concept done — hook: “${concept.hook}” · ${concept.storyboard.length} shot plan${concept.storyboard.length === 1 ? "" : "s"}${concept.storyboardSource !== "model" ? " (deterministic fallback planner)" : ""}`,
  });

  const work: ShotWork[] = concept.storyboard.map((scene) => ({
    sceneShot: scene.shot,
    state: "pending",
    videoUri: scene.source || null,
  }));
  const libraryShots = work.filter((w) => w.videoUri).length;

  // ---- shots (server-quoted, paid on receipt of each quote) ---------------
  for (const row of work) {
    if (row.videoUri) {
      emit({ level: "progress", text: `Shot ${row.sceneShot} uses your own library clip — no video-model spend needed` });
      row.state = "ready";
      continue;
    }
    const stepId = `shot ${row.sceneShot}`;
    emit({ level: "start", text: `Generating shot ${row.sceneShot} with the video model` });
    try {
      const quote = await quoteShot({ conceptId: concept.conceptId, shot: row.sceneShot, placement: "reels" });
      emit({
        level: "progress",
        text: `The server quoted shot ${row.sceneShot} at ~$${(quote.estimatedCostUsd ?? 0).toFixed(2)} — generating it now`,
      });
      const started = await startShot(quote);
      row.shotId = started.shotId;
      row.operationId = started.operationId;
      row.state = "generating";

      const paidAt = Date.now();
      let arrived = false;
      for (;;) {
        if (Date.now() - paidAt >= SHOT_POLL_MAX_MS) {
          row.state = "pending";
          emit({
            level: "progress",
            text: `Shot ${row.sceneShot}: the server still reports it generating after ${secs(SHOT_POLL_MAX_MS)} of checking — it may finish on its own; retrying once more before giving this shot up`,
          });
          // One more bounded wait round; if it still has not arrived, fail the build honestly.
          for (;;) {
            if (Date.now() - paidAt >= 2 * SHOT_POLL_MAX_MS) break;
            await new Promise((r) => setTimeout(r, SHOT_POLL_INTERVAL_MS));
            try {
              const p = await pollShot(started.shotId, started.operationId);
              if (p.done && p.state !== "failed") {
                row.videoUri = p.videoUri ?? null;
                row.state = "ready";
                arrived = true;
                break;
              }
              if (p.done && p.state === "failed") {
                row.state = "failed";
                row.error = p.error ?? "failed";
                break;
              }
            } catch {
              /* transient poll errors are retried on the next tick */
            }
          }
          if (arrived) {
            emit({ level: "done", text: `Shot ${row.sceneShot} arrived` });
            break;
          }
          const msg = row.error ?? `shot ${row.sceneShot} did not arrive within the watch window`;
          emit({ level: "error", text: `Shot ${row.sceneShot}: ${msg}` });
          return { kind: "failed", reason: msg };
        }
        await new Promise((r) => setTimeout(r, SHOT_POLL_INTERVAL_MS));
        const p = await pollShot(started.shotId, started.operationId);
        if (p.done) {
          if (p.state === "failed") {
            const msg = p.error ?? "The server reported this shot as failed";
            row.state = "failed";
            row.error = msg;
            emit({ level: "error", text: `Shot ${row.sceneShot}: ${msg}. Nothing further was spent on this shot.` });
            return { kind: "failed", reason: msg };
          }
          row.videoUri = p.videoUri ?? null;
          row.state = "ready";
          emit({ level: "done", text: `Shot ${row.sceneShot} done — the clip is stored in your library` });
          break;
        }
        emit({
          level: "progress",
          text: `Shot ${row.sceneShot} still generating — ${secs(Date.now() - paidAt)} elapsed (status straight from the server's poll)`,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The shot could not be generated.";
      row.state = "failed";
      row.error = msg;
      emit({ level: "error", text: `Shot ${row.sceneShot}: ${msg}` });
      return { kind: "failed", reason: msg };
    }
  }

  const notReady = work.filter((w) => w.state !== "ready").length;

  // ---- narration (billed per character) ------------------------------------
  let narrationPath: string | null = null;
  emit({ level: "start", text: "Writing the narration — the server validates the script first, then bills the characters" });
  try {
    const quote = await validateVoiceover(concept.concept.script);
    if (!quote.valid) {
      const msg = "The server refused the script for the voiceover brand checks — nothing was billed.";
      emit({ level: "error", text: msg });
      return { kind: "failed", reason: msg };
    }
    emit({ level: "progress", text: `Script validated at ${quote.characters} characters — generating the audio now` });
    const audio = await generateVoiceover({ text: concept.concept.script });
    narrationPath = await uploadNarration(audio.audio, audio.mimeType);
    emit({ level: "done", text: `Narration done — ${audio.characters} characters billed${audio.cached ? " (served from the provider's cache)" : ""}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Narration generation failed.";
    emit({ level: "error", text: msg });
    return { kind: "failed", reason: msg };
  }

  // ---- render --------------------------------------------------------------
  if (notReady > 0) {
    const msg = `${notReady} shot${notReady === 1 ? "" : "s"} still has no clip — the server refuses a render without them.`;
    emit({ level: "error", text: msg });
    return { kind: "failed", reason: msg };
  }
  emit({ level: "start", text: "Dispatching the render — the editable cuts are being assembled into one finished ad" });
  try {
    const assetPaths: Record<string, string> = {};
    for (const w of work) if (w.videoUri) assetPaths[String(w.sceneShot)] = w.videoUri;
    const render = await renderVideo({
      conceptId: concept.conceptId,
      voiceover: concept.concept.script,
      captions: concept.captions,
      narrationPath,
      assetPaths,
    });
    if (render.state === "handed_to_manus") {
      emit({ level: "progress", text: "Render queued with the editor — I will watch for the finished file" });
    }

    // ---- watch -------------------------------------------------------------
    emit({ level: "progress", text: render.notes?.[0] ?? "Watching the render job for the finished ad" });
    const startedAt = Date.now();
    let lastStage: string | null = null;
    for (;;) {
      if (Date.now() - startedAt >= RENDER_POLL_MAX_MS) {
        const msg = "The editor has not reported back after 15 minutes of checking. The job stays queued — I will pick it up next time you ask here.";
        emit({ level: "error", text: msg });
        return {
          kind: "failed",
          reason: msg,
        };
      }
      await new Promise((r) => setTimeout(r, RENDER_POLL_INTERVAL_MS));
      const st = await jobStatus(render.jobId);
      if (st.stage && st.stage !== lastStage) {
        lastStage = st.stage;
        emit({ level: "progress", text: `Editor: ${st.stage}` });
      }
      if (st.status === "failed") {
        const msg = st.error ?? "The server reported the render as failed";
        emit({ level: "error", text: msg });
        return { kind: "failed", reason: msg };
      }
      if (st.status === "done") {
        emit({
          level: "done",
          text: st.publicUrl
            ? "Edit complete — the finished ad is ready below"
            : "The server marked the edit done but attached no watchable file",
        });
        return {
          kind: "video",
          conceptId: concept.conceptId,
          jobId: render.jobId,
          publicUrl: st.publicUrl ?? null,
          shotsDone: work.filter((w) => w.state === "ready")?.length ?? work.length,
          shotsFailed: work.filter((w) => w.state === "failed").length,
          researchProjectId: research?.projectId ?? null,
          notes: libraryShots > 0 ? [`${libraryShots} shot(s) came from your own library clips`] : [],
        };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Render dispatch failed.";
    emit({ level: "error", text: msg });
    return { kind: "failed", reason: msg };
  }
}

// ---------------------------------------------------------------------------
// The image build
// ---------------------------------------------------------------------------

async function runImageBuild(
  brief: string,
  research: ResearchContext | null,
  emit: (e: RunEvent) => void,
): Promise<Extract<RunDeliverable, { kind: "image" } | { kind: "failed" }>> {
  emit({ level: "start", text: "Starting the image-ad project from your brief" });
  try {
    const project = await startImageProject({
      request: brief.slice(0, 2000),
      objective: "waitlist signups",
      cta: "Join the waitlist",
      researchProjectId: research?.projectId ?? null,
    });
    emit({ level: "progress", text: "Writing 3 concept cards (free)…" });
    const concepts = await generateConcepts(project.projectId, 3);
    const chosen = concepts.concepts.find((c) => c.status !== "rejected");
    if (!chosen) {
      const msg = "The concept writer rejected every concept it drafted — read the reasons in the Image Ads workspace and adjust the brief.";
      emit({ level: "error", text: msg });
      return { kind: "failed", reason: msg };
    }
    emit({
      level: "done",
      text: `Concept #${chosen.concept_number} chosen — headline: “${chosen.payload.headline}”${research ? " (grounded in the research above)" : ""}`,
    });
    await selectConcept(project.projectId, chosen.id);
    emit({ level: "start", text: `Generating the ${IMAGE_PLACEMENT === "ig_story_reels" ? "9:16 Story/Reels" : IMAGE_PLACEMENT} background` });
    const gen = await generateBackgrounds(project.projectId, [IMAGE_PLACEMENT]);
    const outcome = gen.outcomes[IMAGE_PLACEMENT];
    if (!outcome?.ok || !outcome.artifactId) {
      const msg = gen.failed.find((f) => f.placementId === IMAGE_PLACEMENT)?.error ?? outcome?.error ?? "The background generation failed.";
      emit({ level: "error", text: msg });
      return { kind: "failed", reason: msg };
    }

    emit({ level: "progress", text: "Background ready — composing the finished ad (brief, headline, CTA overlaid)" });
    await composeAd(project.projectId, outcome.artifactId, {
      headline: chosen.payload.headline,
      supportingCopy: chosen.payload.supportingCopy,
      cta: chosen.payload.cta,
    });

    // Poll for the composed artifact the same way the workspace does.
    const startedAt = Date.now();
    for (;;) {
      if (Date.now() - startedAt >= IMAGE_STATUS_MAX_MS) {
        const msg = "The compose step has not reported back yet — its job stays queued server-side. The project and background are safe in the Image Ads workspace.";
        emit({ level: "error", text: msg });
        return { kind: "failed", reason: msg };
      }
      await new Promise((r) => setTimeout(r, IMAGE_STATUS_INTERVAL_MS));
      const st = await imageProjectStatus(project.projectId);
      const job = st.jobs[st.jobs.length - 1];
      if (job?.status === "failed") {
        emit({ level: "progress", text: `Compose job failed: ${job.error ?? "worker error"} — the background image is safe and already shown below.` });
        // Compose failed, but the raw generated image EXISTS and was paid for:
        // deliver the background itself instead of a failure.
        const rawOut = await exportAdSafe(outcome.artifactId);
        emit({ level: "done", text: "Delivering the generated background (the compose step failed; retry it in the Image Ads workspace)" });
        return {
          kind: "image",
          projectId: st.project.id,
          conceptId: chosen.id,
          headline: chosen.payload.headline,
          cta: chosen.payload.cta,
          previewUrl: rawOut,
          researchProjectId: research?.projectId ?? null,
          notes: [job.error ?? "compose failed"],
        };
      }
      const composed = st.artifacts.find((a) => a.stage === "composed" && a.status === "ready");
      if (composed) {
        const out = await exportAd(composed.id);
        emit({ level: "done", text: "Finished image ad ready below" });
        return {
          kind: "image",
          projectId: st.project.id,
          conceptId: chosen.id,
          headline: chosen.payload.headline,
          cta: chosen.payload.cta,
          previewUrl: out.downloadUrl ?? null,
          researchProjectId: research?.projectId ?? null,
          notes: [],
        };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The image build failed.";
    emit({ level: "error", text: msg });
    return { kind: "failed", reason: msg };
  }
}

export async function exportAdSafe(artifactId: string): Promise<string | null> {
  try {
    const out = await exportAd(artifactId);
    return out.downloadUrl ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Top-level runner
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RunInput {
  brief: string;
  steps: PlanStep[];
}

export async function runChatBuild(
  input: RunInput,
  emit: (e: RunEvent) => void,
): Promise<Extract<RunDeliverable, { kind: "image" | "video" } | { kind: "failed" }>> {
  const steps = input.steps;
  const firstCreation = steps.findIndex((s) => s.type === "image_ad" || s.type === "video_ad");
  const creation = steps[firstCreation];

  // Research steps listed before the creation step run first, in order.
  const researchSteps = steps.slice(0, firstCreation).filter((s) => s.type === "competitor_research");
  let research: ResearchContext | null = null;
  if (researchSteps.length) {
    research = await runResearchStep(researchSteps[0], input.brief, emit);
    await sleep(250);
  }

  if (!creation) return { kind: "failed", reason: "the plan holds no buildable step" };
  if (creation.type === "video_ad") {
    return await runVideoBuild(input.brief, creation, research, emit);
  }
  return await runImageBuild(input.brief, research, emit);
}

// ---------------------------------------------------------------------------
// Result persistence — the finished message is stored by the OWNER via RLS so
// it survives reload; progress lines stay local to the live session.
// ---------------------------------------------------------------------------

export interface PersistCheck {
  ok: boolean;
  signedUrlErr: string | null;
}

export async function persistRunResult(
  sessionId: string,
  intent: string,
  content: string,
  plan: Record<string, unknown>,
): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error("Sign in to save the build result");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: created, error } = await (supabase as any)
    .from("ad_chat_messages")
    .insert({
      session_id: sessionId,
      owner_id: uid,
      role: "assistant",
      intent,
      content,
      plan,
    })
    .select("id, created_at")
    .single();
  if (error || !created) throw new Error((error as { message?: string } | null)?.message ?? "Could not save the build result");
}

export const hasCreationStep = isRunnable;
