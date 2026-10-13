import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticate, readJsonBody, json } from "../_shared/guard.ts";
import type { RenderPlanInput } from "../_shared/renderPlan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const RENDER_WORKER_URL = Deno.env.get("RENDER_WORKER_URL") ?? "";
const RENDER_TOKEN = Deno.env.get("RENDER_TOKEN") ?? "";

interface RenderRequestBody {
  action?: string;
  jobId?: string;
  campaignId?: string | null;
  conceptId?: string | null;
  renderRequest?: RenderPlanInput;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const body = (await readJsonBody(req)) as RenderRequestBody | null;
    if (!body) return json({ error: "Invalid request body" }, 400);

    const action = typeof body.action === "string" ? body.action : "render";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole);

    if (action === "poll" || action === "status") {
      const jobId = body.jobId;
      if (typeof jobId !== "string") return json({ error: "jobId required" }, 400);

      const { data: job, error } = await admin
        .from("ad_render_jobs")
        .select("*")
        .eq("job_id", jobId)
        .eq("owner_id", userId)
        .single();

      if (error || !job) return json({ error: "Job not found" }, 404);

      // If still running/queued and worker configured, try to sync status
      if (RENDER_WORKER_URL && RENDER_TOKEN && job.status !== "done" && job.status !== "failed") {
        try {
          const res = await fetch(`${RENDER_WORKER_URL}/jobs/${jobId}`, {
            headers: { "x-render-token": RENDER_TOKEN },
          });
          if (res.ok) {
            const wjob = (await res.json()) as {
              state?: string;
              progress?: number;
              error?: string | null;
              bytes?: number | null;
              meta?: Record<string, unknown> | null;
            };
            const updates: {
              status: string | undefined;
              progress: number;
              error: string | null;
              bytes: number | null;
              meta: unknown;
              updated_at: string;
              finished_at?: string;
              storage_path?: string;
              public_url?: string;
            } = {
              status: wjob.state,
              progress: wjob.progress ?? 0,
              error: wjob.error ?? null,
              bytes: wjob.bytes ?? null,
              meta: wjob.meta ?? job.meta,
              updated_at: new Date().toISOString(),
            };
            if (wjob.state === "done") {
              updates.finished_at = new Date().toISOString();
              const storagePath = job.storage_path ?? `renders/${userId}/${jobId}.mp4`;
              updates.storage_path = storagePath;
              updates.public_url = `${supabaseUrl}/storage/v1/object/public/renders/${userId}/${jobId}.mp4`;
              // Create export record
              try {
                await admin.from("ad_exports").insert({
                  campaign_id: job.campaign_id,
                  concept_id: job.concept_id,
                  owner_id: userId,
                  preset_id: job.preset_id ?? "reels",
                  storage_path: storagePath,
                  public_url: updates.public_url,
                  duration_seconds: Number(wjob.meta?.durationSeconds ?? 0),
                  width: Number(wjob.meta?.width ?? 1080),
                  height: Number(wjob.meta?.height ?? 1920),
                  bytes: wjob.bytes,
                  status: "done",
                  render_job_id: jobId,
                  cost_usd: 0,
                });
              } catch (e) {
                console.warn("Failed to create export record", e);
              }
            }
            await admin
              .from("ad_render_jobs")
              .update(updates)
              .eq("job_id", jobId);
            const { data: updated } = await admin
              .from("ad_render_jobs")
              .select("*")
              .eq("job_id", jobId)
              .single();
            return json({ job: updated });
          }
        } catch (e) {
          // ignore sync errors
        }
      }

      return json({ job });
    }

    if (action === "render") {
      const renderReq = body.renderRequest;
      const campaignId = body.campaignId ?? null;
      const conceptId = body.conceptId ?? null;
      const jobId = body.jobId ?? crypto.randomUUID();

      if (!renderReq) return json({ error: "renderRequest required" }, 400);
      if (!RENDER_WORKER_URL) return json({ error: "RENDER_WORKER_URL not configured" }, 503);
      if (!RENDER_TOKEN) return json({ error: "RENDER_TOKEN not configured" }, 503);

      // Store job
      const { error: insertErr } = await admin
        .from("ad_render_jobs")
        .insert({
          job_id: jobId,
          owner_id: userId,
          campaign_id: campaignId,
          concept_id: conceptId,
          status: "queued",
          progress: 0,
          preset_id: renderReq.presetId,
          render_request: renderReq,
          meta: { started: true },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertErr) {
        console.error(insertErr);
        return json({ error: "Failed to create job" }, 500);
      }

      // Call worker
      const workerReq = { ...renderReq, jobId };
      const res = await fetch(`${RENDER_WORKER_URL}/render`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-render-token": RENDER_TOKEN,
        },
        body: JSON.stringify(workerReq),
      });

      const wbody = (await res.json().catch(() => ({}))) as {
        error?: string;
        state?: string;
        progress?: number;
      };
      if (!res.ok && res.status !== 202 && res.status !== 200) {
        await admin
          .from("ad_render_jobs")
          .update({ status: "failed", error: wbody.error ?? "Worker error", updated_at: new Date().toISOString() })
          .eq("job_id", jobId);
        return json({ error: wbody.error ?? "Render failed" }, res.status);
      }

      // Sync status
      await admin
        .from("ad_render_jobs")
        .update({ status: wbody.state ?? "queued", progress: wbody.progress ?? 0, updated_at: new Date().toISOString() })
        .eq("job_id", jobId);

      return json({ jobId, worker: wbody });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("ad-render error:", e);
    return json({ error: "Request failed" }, 500);
  }
});
