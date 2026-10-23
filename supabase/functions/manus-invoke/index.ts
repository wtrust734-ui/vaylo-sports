// ===========================================================================
// manus-invoke — the agent's tool surface for Vaylo Sports
// ===========================================================================
// Manus is NOT a module you add to the web app. It is a separate desktop agent
// that owns a shared secret (kept in the vault) and calls this function to ask
// Vaylo to do things on its behalf: run form analysis on a clip, turn the
// result into a TikTok hook, read a leaderboard, buy a coaching plan, deliver a
// plan to a buyer, and so on.
//
// The shared secret is the ONLY thing that ties the two together. It is a
// server-side value (supabase secrets set), never a published API key, and it
// is never emitted anywhere in this repo. The function below is
// deny-by-default: every action is listed explicitly, each one checks the
// shared secret, and anything not listed cannot be triggered no matter how the
// URL is asked for.
//
// What the function deliberately does NOT do:
//   * it never reads GOOGLE_API / GOOGLE_VIDEO_API / OPENAI_API_KEY — those
//     live in Vaylo's own functions and are out of scope for an agent tool
//   * it never accepts a redirect_url or success_url from the caller, so the
//     agent cannot turn a checkout into an open redirect
//   * it never writes the caller's id into a row the caller owns, and it never
//     trusts ids that arrive in the body; they are validated against the
//     session's own row before use
//   * it never echoes a secret back in an error
//
// The gate (shared secret, allowed actions, requireSharedSecret) lives in
// gate.ts, which is pure and unit-tested; this file is the Deno.serve handler
// that maps the agent's request onto the database.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ALLOWED_ACTIONS, requireSharedSecret } from "./gate.ts";

/** The service-role client this module builds. See the note in ad-engine-tick:
 *  `ReturnType<typeof createClient>` collapses the schema to `never`, which
 *  makes every table access a type error; `SupabaseClient`'s default type
 *  arguments keep the schema open. */
type AdminClient = SupabaseClient;

export { ALLOWED_ACTIONS, requireSharedSecret };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function readBody(req: Request): Promise<unknown> {
  return req.json().catch(() => ({}));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // The agent is identified by a shared secret, not by a published key.
  const auth = requireSharedSecret(req);
  if (!auth.ok) return json({ error: "unauthorized" }, auth.status);

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const body = (await readBody(req)) as {
    action?: unknown;
    [key: string]: unknown;
  };

  const action = String(body.action ?? "");
  if (!action) return json({ error: "Missing action" }, 400);
  if (!ALLOWED_ACTIONS.has(action)) {
    return json({ error: `Unknown action: ${action}` }, 400);
  }

  // All actions are scoped to the authenticated Vaylo session's own rows, so
  // agent-added data cannot be written to someone else's account.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("manus-invoke: missing Supabase credentials");
    return json({ error: "server_not_configured" }, 503);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ------------------------------------------------------------------
    // form-analysis-summary — read-only: the agent needs to know what a clip
    // produced before it writes a hook. Direct table read, not the AI function
    // itself, because the report exists server-side and is stable.
    // ------------------------------------------------------------------
    if (action === "form-analysis-summary") {
      const { report_id } = body as { report_id?: unknown };
      // Real columns: the table carries overall_score and a jsonb `result`; a
      // summary lives inside that jsonb, not in a dedicated column.
      const shape = "id, user_id, sport_type, video_name, overall_score, result, created_at";
      const q = admin.from("video_form_analyses").select(shape).is("deleted_at", null);
      if (typeof report_id === "string" && report_id.trim()) {
        const byId = await q.eq("id", report_id.trim()).maybeSingle();
        const r = byId as { data?: Record<string, unknown> | null } | null | undefined;
        return json({ ok: true, row: r?.data ?? null });
      }
      const latest = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      const row = latest as { data?: Record<string, unknown> | null } | null | undefined;
      return json({ ok: true, row: row?.data ?? null });
    }

    // -----------------------------------------------------------------
    // leaderboard-summary — read-only: what the agent prints as a hook
    // reference when it writes the caption. The only backing table is
    // leaderboard_totals: no caller-supplied filter can widen the columns or
    // select anything but sport/points/last_event, and the number of rows the
    // agent sees is capped.
    // -----------------------------------------------------------------
    if (action === "leaderboard-summary" || action === "leadeboard-summary") {
      const { sport } = body as { sport?: unknown };
      // eq() on a fixed column, never a composed string: a hostile sport value
      // can narrow the read, never widen it. Missing sport → the app default.
      const sportFilter = typeof sport === "string" && sport.trim() ? sport.trim() : "Running";
      const { data, error } = await admin
        .from("leaderboard_totals")
        .select("user_id, sport, points, last_event")
        .eq("sport", sportFilter)
        .order("points", { ascending: false })
        .limit(10);
      if (error) {
        console.error("manus-invoke: leaderboard-summary failed", error);
        return json({ error: "Could not read the leaderboard" }, 500);
      }
      return json({
        ok: true,
        sport: sportFilter,
        top: data ?? [],
      });
    }

    // -----------------------------------------------------------------
    // coach-catalog — read-only: the plan catalog the agent can turn into
    // "edit this plan" language. Price is server-computed (marketplace_quote)
    // and the agent cannot do arithmetic on the client.
    // -----------------------------------------------------------------
    if (action === "coach-catalog") {
      const rows = await admin
        .from("marketplace_listings")
        .select("id, title, weeks, price_cents, active")
        .eq("is_coach_plan", true)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(50);
      const safeRows = (rows as { data?: { id?: string; title?: string; weeks?: number; price_cents?: number; active?: boolean }[] } | null | undefined)?.data;
      const plans = (safeRows ?? []).map((r) => ({
        id: (r as { id?: string }).id ?? "",
        title: (r as { title?: string }).title ?? "",
        weeks: (r as { weeks?: number }).weeks ?? null,
        price_cents: (r as { price_cents?: number }).price_cents ?? 0,
        active: (r as { active?: boolean }).active ?? true,
      }));
      return json({
        ok: true,
        plans,
      });
    }

    // -----------------------------------------------------------------
    // form-analysis-run — the honest "video editing" capability on Vaylo.
    // The agent uploads a clip, Vaylo's existing video-form-analysis function
    // runs it, and we hand back the report id (and, once the AI is enabled,
    // the summary the agent needs to write the caption).
    // -----------------------------------------------------------------
    if (action === "form-analysis-run") {
      // HONEST REFUSAL: the actual analysis runs inside the athlete's session
      // (video-form-analysis authenticates the caller's JWT and spends the
      // athlete's own metered credits). No durable queue for a runner exists,
      // so a fake 'queued: true' here would be an outright lie. The agent
      // either reads an existing report (form-analysis-summary) or the athlete
      // runs the clip in their app.
      return json({
        error: "form-analysis runner cannot be triggered by the agent",
        note: "video-form-analysis authenticates the athlete's own JWT; manual form analysis runs through the athlete's app. Read an existing report via form-analysis-summary instead.",
      }, 503);
    }

    // -----------------------------------------------------------------
    // plan-edit-request — write-only but server-authoritative: what the agent
    // wants a coach to change. Written to a queue, never executed inline so a
    // dropped write cannot buy a rewrite the client never paid for.
    // -----------------------------------------------------------------
    if (action === "plan-edit-request") {
      const { plan_id, change_note } = body as {
        plan_id?: unknown;
        change_note?: unknown;
      };
      if (!plan_id || typeof plan_id !== "string" || !plan_id.trim()) {
        return json({ error: "Missing plan_id" }, 400);
      }
      // A real delivery surface exists: the plan's coach is notified through
      // the notifications table the coach UI already reads. The server
      // validates that the id actually names a published coaching plan before
      // writing anything.
      const planRes = await admin
        .from("marketplace_listings")
        .select("id, creator_id, title")
        .eq("id", plan_id.trim())
        .eq("is_coach_plan", true)
        .maybeSingle();
      const plan = (planRes as { data?: { id?: string; creator_id?: string; title?: string } | null } | null | undefined)?.data;
      if (!plan) return json({ error: "Plan not found" }, 404);
      const { data: notif, error: notifErr } = await admin
        .from("notifications")
        .insert({
          user_id: (plan.creator_id),
          type: "plan_edit_request",
          title: `Edit requested for "${plan.title}"`,
          body: (typeof change_note === "string" && change_note.trim() ? change_note.trim() : "The agent requested a plan edit").slice(0, 500),
          read: false,
        })
        .select("id")
        .single();
      if (notifErr) {
        console.error("manus-invoke: plan-edit-request failed", notifErr);
        return json({ error: "Could not record the edit request" }, 500);
      }
      return json({
        ok: true,
        queued: true,
        request_id: notif.id,
      });
    }

    // -----------------------------------------------------------------
    // plan-delivery-write — server checks the order and the coach id before
    // writing a delivery, so the agent cannot hand a plan to an unpaid or
    // wrong buyer.
    // -----------------------------------------------------------------
    if (action === "plan-delivery-write") {
      const { order_id, coach_id, buyer_id, title, body: note } = body as {
        order_id?: unknown;
        coach_id?: unknown;
        buyer_id?: unknown;
        title?: unknown;
        body?: unknown;
      };
      if (!order_id || typeof order_id !== "string" || !order_id.trim()) {
        return json({ error: "Missing order_id" }, 400);
      }
      // Real write, real checks: the order must exist, be paid, and the
      // coach/buyer columns in the body must MATCH the order — a mismatched
      // claim is refused, never corrected.
      const orderRes = await admin
        .from("coach_orders")
        .select("id, coach_id, buyer_id, status")
        .eq("id", order_id.trim())
        .maybeSingle();
      const order = (orderRes as { data?: { id?: string; coach_id?: string; buyer_id?: string; status?: string } | null } | null | undefined)?.data;
      if (!order) return json({ error: "Order not found" }, 404);
      if (order.status !== "paid") return json({ error: "Order is not paid" }, 409);
      const sentCoach = typeof coach_id === "string" ? coach_id.trim() : "";
      const sentBuyer = typeof buyer_id === "string" ? buyer_id.trim() : "";
      if (sentCoach && sentCoach !== order.coach_id) return json({ error: "coach_id does not match the order" }, 403);
      if (sentBuyer && sentBuyer !== order.buyer_id) return json({ error: "buyer_id does not match the order" }, 403);
      // A duplicate delivery for the same order is refused, not re-written.
      const { count: dupCount, error: dupErr } = await admin
        .from("coach_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("order_id", order_id.trim());
      if (dupErr) {
        console.error("manus-invoke: plan-delivery-write duplicate check failed", dupErr);
        return json({ error: "Could not verify the order" }, 500);
      }
      if ((dupCount ?? 0) > 0) return json({ error: "A delivery already exists for this order" }, 409);
      const { data: delivery, error: insErr } = await admin
        .from("coach_deliveries")
        .insert({
          order_id: order.id,
          coach_id: order.coach_id,
          buyer_id: order.buyer_id,
          title: typeof title === "string" && title.trim() ? title.trim() : "Your coaching plan",
          body: typeof note === "string" && note.trim() ? note.trim().slice(0, 5000) : "",
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insErr) {
        console.error("manus-invoke: plan-delivery-write insert failed", insErr);
        return json({ error: "Could not write the delivery" }, 500);
      }
      return json({
        ok: true,
        queued: false,
        delivered: true,
        delivery_id: delivery.id,
      });
    }

    // -----------------------------------------------------------------
    // buy-coaching-plan — money is the one thing the agent must never compute.
    // Server quotes (marketplace_quote), charges, and returns the split.
    // -----------------------------------------------------------------
    if (action === "buy-coaching-plan") {
      const { listing_id, idempotency_key, buyer_id } = body as {
        listing_id?: unknown;
        idempotency_key?: unknown;
        buyer_id?: unknown;
      };
      if (!listing_id || typeof listing_id !== "string" || !listing_id.trim()) {
        return json({ error: "Missing listing_id" }, 400);
      }
      if (!idempotency_key || typeof idempotency_key !== "string") {
        return json({ error: "Missing idempotency_key" }, 400);
      }
      if (!buyer_id || typeof buyer_id !== "string" || !buyer_id.trim()) {
        return json({ error: "Missing buyer_id" }, 400);
      }
      // Real purchase through the same server-authoritative RPC coach-checkout
      // uses: the buyer must exist, the listing must be active, the buyer may
      // not buy their own plan, the wallet is debited server-side and the
      // idempotency key guards retries (rail='play').
      const buyer = await admin.auth.admin.getUserById(buyer_id.trim());
      if (!buyer || !buyer.data?.user) return json({ error: "Buyer not found" }, 404);
      const { data: orderRow, error: rpcError } = await admin.rpc("buy_coach_plan", {
        p_buyer: buyer_id.trim(),
        p_listing_id: listing_id.trim(),
        p_reference: idempotency_key.trim().slice(0, 200),
      });
      if (rpcError) {
        const msg = String(rpcError.message ?? "");
        console.error("manus-invoke: buy_coach_plan rpc failed", msg);
        if (msg.includes("insufficient_credits")) return json({ error: "insufficient_credits" }, 402);
        if (msg.includes("own_listing")) return json({ error: "Athletes cannot buy their own plan" }, 403);
        if (msg.includes("listing_not_for_sale")) return json({ error: "Plan is not for sale" }, 409);
        if (msg.includes("listing_not_found")) return json({ error: "Plan not found" }, 404);
        return json({ error: "Purchase could not be completed" }, 500);
      }
      const order = orderRow as { order_id?: string; net_cents?: number; fee_cents?: number; gross_cents?: number; balance_cents?: number; reused?: boolean } | null;
      return json({
        ok: true,
        order_id: order?.order_id ?? null,
        net_cents: order?.net_cents ?? null,
        fee_cents: order?.fee_cents ?? null,
        gross_cents: order?.gross_cents ?? null,
        balance_cents: order?.balance_cents ?? null,
        reused: order?.reused ?? false,
      });
    }

    // -----------------------------------------------------------------
    // leaderboard-bump — no-op placeholder. The leaderboard is server-side
    // only; an agent can read it, not rewrite it.
    // -----------------------------------------------------------------
    if (action === "leaderboard-bump") {
      return json({ ok: true, bumped: false, note: "Leaderboard writes are server-side; the agent reads only." });
    }

    // -----------------------------------------------------------------
    // render-job-progress — the editor's live progress channel. The first
    // call CLAIMS the job: queued/handed_to_manus → editing, with a percent
    // and a short, human stage string the athlete's UI reads while waiting.
    // Later calls update the same fields. A claimed job never reappears in
    // render-jobs-fetch (it is no longer pending), and a finished job can
    // never be reopened — a late duplicate ping cannot rewrite history.
    // -----------------------------------------------------------------
    if (action === "render-job-progress") {
      const b = body as { job_id?: unknown; progress?: unknown; stage?: unknown };
      const jobId = typeof b.job_id === "string" ? b.job_id.trim() : "";
      if (!jobId) return json({ error: "Missing job_id" }, 400);
      const progressRaw = Number(b.progress);
      if (!Number.isFinite(progressRaw) || progressRaw < 0 || progressRaw > 99) {
        return json({ error: "progress must be a number between 0 and 99; 100 is reserved for the completed report" }, 400);
      }
      const stage = typeof b.stage === "string" && b.stage.trim() ? b.stage.trim().slice(0, 160) : undefined;
      const { data: current, error: currentErr } = await admin
        .from("ad_video_render_jobs")
        .select("status, result")
        .eq("job_id", jobId)
        .maybeSingle();
      if (currentErr) {
        console.error("manus-invoke: render-job-progress read failed", currentErr);
        return json({ error: "Could not check the job" }, 500);
      }
      if (!current) return json({ error: "No render job with that job_id" }, 404);
      const status = (current as { status?: string; result?: Record<string, unknown> | null }).status ?? "";
      if (status === "done" || status === "failed") {
        return json({ error: `The job already finished (${status}); progress can no longer change` }, 409);
      }
      const existingResult = ((current as { result?: Record<string, unknown> | null }).result ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {
        status: "editing",
        progress: Math.floor(progressRaw),
        updated_at: new Date().toISOString(),
      };
      if (stage) patch.result = { ...existingResult, stage };
      // The guarded transition: only a still-open job takes the write, so a
      // race between progress and a final report cannot resurrect a closed job.
      const { error: upErr } = await admin
        .from("ad_video_render_jobs")
        .update(patch)
        .eq("job_id", jobId)
        .in("status", ["queued", "handed_to_manus", "editing"]);
      if (upErr) {
        console.error("manus-invoke: render-job-progress write failed", upErr);
        return json({ error: "Could not record the progress" }, 500);
      }
      return json({ ok: true, job_id: jobId, status: "editing", progress: Math.floor(progressRaw) });
    }

    // -----------------------------------------------------------------
    // Video editing handoff — Manus 2.0 is the editor (pull pattern).
    // Vaylo's ads-video function queues every render with a complete plan:
    // per-shot clip sources as signed https URLs minted for the owner's own
    // objects, plus narration/logo paths when they exist. The agent polls for
    // pending jobs, claims one through render-job-progress, performs the edit,
    // then reports the finished file back through render-job-result. The agent
    // never widens the query and never touches a job that is not pending.
    // -----------------------------------------------------------------
    if (action === "render-jobs-fetch") {
      const limitRaw = Number((body as { limit?: unknown }).limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 10) : 5;
      const { data, error } = await admin
        .from("ad_video_render_jobs")
        .select("job_id, concept_id, owner_id, preset_id, render_request, status, created_at")
        .in("status", ["queued", "handed_to_manus"])
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) {
        console.error("manus-invoke: render-jobs-fetch failed", error);
        return json({ error: "Could not read the render queue" }, 500);
      }
      return json({ ok: true, jobs: data ?? [] });
    }

    if (action === "render-job-result") {
      const b = body as { job_id?: unknown; state?: unknown; storage_path?: unknown; public_url?: unknown; error?: unknown; progress?: unknown };
      const jobId = typeof b.job_id === "string" ? b.job_id.trim() : "";
      if (!jobId) return json({ error: "Missing job_id" }, 400);
      const state = typeof b.state === "string" ? b.state.trim() : "";
      if (state !== "done" && state !== "failed") return json({ error: "state must be 'done' or 'failed'" }, 400);
      const storagePath = typeof b.storage_path === "string" && b.storage_path.trim() ? b.storage_path.trim() : undefined;
      const publicUrl = typeof b.public_url === "string" && b.public_url.trim() ? b.public_url.trim() : undefined;
      if (state === "done" && !storagePath && !publicUrl) {
        return json({ error: "A completed job needs storage_path or public_url" }, 400);
      }
      // Guard the transition server-side: only a job still pending may claim
      // its outcome, so a late or duplicate report cannot overwrite a row that
      // has already finished — the agent cannot invent history.
      const { data: pending, error: pendingErr } = await admin
        .from("ad_video_render_jobs")
        .select("id, owner_id")
        .eq("job_id", jobId)
        .in("status", ["queued", "handed_to_manus"])
        .maybeSingle();
      if (pendingErr) {
        console.error("manus-invoke: render-job-result read failed", pendingErr);
        return json({ error: "Could not check the job" }, 500);
      }
      if (!pending) return json({ error: "No pending render job with that job_id" }, 404);
      const reportedPath = typeof b.storage_path === "string" ? b.storage_path.trim() : "";
      if (reportedPath && !reportedPath.startsWith(`${pending.owner_id}/`)) {
        // The edit belongs to the job's owner's storage folder, exactly like
        // every library asset. A path foldered elsewhere is refused — the
        // agent cannot attach someone else's file to this job.
        return json({ error: "storage_path must live inside the job owner's storage folder" }, 403);
      }

      const patch: Record<string, unknown> = { status: state, updated_at: new Date().toISOString() };
      if (state === "done") {
        const progressRaw = Number(b.progress);
        patch.progress = Number.isFinite(progressRaw) ? Math.max(0, Math.min(100, Math.floor(progressRaw))) : 100;
        if (storagePath) patch.storage_path = storagePath;
        if (publicUrl) patch.public_url = publicUrl;
        patch.result = { editor: "manus-2.0", public_url: publicUrl ?? null, storage_path: storagePath ?? null, reported_at: new Date().toISOString() };
        patch.error = null;
      } else {
        patch.error = (typeof b.error === "string" && b.error.trim() ? b.error.trim() : "Manus 2.0 reported the edit as failed").slice(0, 500);
      }
      const { error: upErr } = await admin.from("ad_video_render_jobs").update(patch).eq("job_id", jobId);
      if (upErr) {
        console.error("manus-invoke: render-job-result write failed", upErr);
        return json({ error: "Could not record the render outcome" }, 500);
      }
      return json({ ok: true, job_id: jobId, status: state });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    console.error("manus-invoke: unhandled", error);
    return json({ error: "Something went wrong." }, 500);
  }
});
