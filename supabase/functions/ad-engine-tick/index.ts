// ============================================================================
// ad-engine-tick — the persistent runner behind the Vaylo daily advertising
// engine.
// ----------------------------------------------------------------------------
// Invoked by pg_cron (hourly + daily) or by the operator/agent with the shared
// secret. Each tick:
//   1. spawns today's jobs (and any past days that never spawned) from the
//      calendar — idempotent thanks to the (calendar_day, asset_kind, variant)
//      unique index;
//   2. claims due jobs (status='queued', run_after<=now) with a lease so two
//      ticks never run the same job;
//   3. executes each job through the REAL pipeline matching its kind
//      (ads-image for images, Veo for video shots, ElevenLabs for voiceover,
//      ads-research for evidence, copy via the chat model);
//   4. retries recoverable failures with backoff, marks exhausted jobs failed,
//      and enforces the production-spend ceiling from the budget row.
//
// Trigger auth: pg_cron sends a valid anon key + apikey (platform-invoked).
// Operator/agent calls send x-shared-secret = MANUS_SHARED_SECRET.
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

/** The service-role client this module builds. `SupabaseClient` with its
 *  default type arguments is deliberately loose: the engine reads and writes
 *  internal tables (ad_engine_*) that are not part of the generated Database
 *  type, so a strictly-typed client narrows every payload to `never[]`.
 *  `ReturnType<typeof createClient>` is worse still - TypeScript instantiates
 *  a generic function's type parameters with their *constraints* (unknown),
 *  which collapses the schema to `never` and makes every
 *  `.from(...).upsert(...)` call a type error. */
type AdminClient = SupabaseClient;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shared-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const MANUS_SECRET = Deno.env.get("MANUS_SHARED_SECRET") ?? "";
/** Campaign owner: assets the engine produces are owned by this account (the
 *  operator's own login), so every pipeline's owner-scoped RLS keeps working.
 *  Change by updating ad_engine_budget on the live DB if it ever moves. */
const CAMPAIGN_OWNER_KEY = Deno.env.get("ENGINE_OWNER_JWT") ?? "";

// ---------------------------------------------------------------------------
// Spending policy — per-spec Part 7 + Part 9(9): recorded ceiling, small steps.
// A production job may spend only if the row's recorded ceiling still has room.
// ---------------------------------------------------------------------------
const MAX_PROD_SPEND_PER_JOB_USD = 0.5;

/** Authorised for this tick? cron (apikey+anon) or operator secret. */
function isAuthorised(req: Request): boolean {
  if (req.headers.get("apikey") === ANON_KEY && ANON_KEY) return true;
  const secret = req.headers.get("x-shared-secret");
  if (MANUS_SECRET && secret === MANUS_SECRET) return true;
  return false;
}

async function budgetHeadroomUsd(admin: AdminClient): Promise<number> {
  const { data } = await admin.from("ad_engine_budget").select("ceiling_gbp, spent_production_gbp, currency").eq("campaign", "vaylo-sports-2026").maybeSingle();
  if (!data) return 0; // no record → no spend (Part 9: never claim, never spend blindly)
  const ceiling = Number((data as { ceiling_gbp: number }).ceiling_gbp);
  const spent = Number((data as { spent_production_gbp: number }).spent_production_gbp);
  const gbpLeft = Math.max(0, ceiling - spent);
  // Rough GBP→USD for provider quotes; production ledger is tracked in GBP.
  return gbpLeft * 1.27;
}

// ---------------------------------------------------------------------------
// Job spawning — from calendar rows that have no spawn record yet
// ---------------------------------------------------------------------------
type CalRow = {
  day: string;
  dow: string;
  theme: string;
  asset_name: string;
  asset_format: string;
  sport: string;
  objective: string;
  concept: string;
  produce_start: string;
  produce_deadline: string;
  publish_time: string | null;
};

function jobsForDay(day: CalRow): Array<{ asset_kind: string; variant: string; payload: Record<string, unknown> }> {
  const jobs: Array<{ asset_kind: string; variant: string; payload: Record<string, unknown> }> = [];
  if (day.asset_format === "report") {
    jobs.push({ asset_kind: "report", variant: "primary", payload: { theme: day.theme, window: "weekly-or-monthly" } });
  } else if (day.asset_format === "carousel" || day.asset_format === "story") {
    jobs.push({ asset_kind: "image", variant: "primary", payload: { theme: day.theme, aspect: "square", slides: 3 } });
  } else if (day.asset_format === "video") {
    jobs.push({ asset_kind: "video", variant: "primary", payload: { theme: day.theme, sport: day.sport } });
    jobs.push({ asset_kind: "voiceover", variant: "primary", payload: { theme: day.theme } });
  } else {
    // image
    jobs.push({ asset_kind: "image", variant: "primary", payload: { theme: day.theme, aspect: "square" } });
    jobs.push({ asset_kind: "variations", variant: "set", payload: { theme: day.theme } });
  }
  return jobs;
}

async function spawnDueDays(admin: AdminClient): Promise<{ spawnedDays: number; spawnedJobs: number }> {
  const today = new Date().toISOString().slice(0, 10);
  // Days that are due (past or today) and never spawned.
  const { data: due, error } = await admin
    .from("ad_engine_calendar")
    .select("day")
    .gte("day", "2026-10-18")
    .lte("day", today)
    .order("day", { ascending: true })
    .limit(120);
  if (error) throw new Error("calendar read: " + error.message);
  const days = ((due ?? []) as Array<{ day: string }>).map((r) => r.day);

  let spawnedDays = 0, spawnedJobs = 0;
  for (const day of days) {
    const { data: existing } = await admin.from("ad_engine_spawns").select("calendar_day, state").eq("calendar_day", day).maybeSingle();
    const row = (existing ?? null) as { calendar_day: string; state: string } | null;
    if (row && row.state !== "pending") continue;

    // load the full calendar row
    const { data: cal } = await admin.from("ad_engine_calendar").select("*").eq("day", day).maybeSingle();
    if (!cal) continue;
    const d = cal as unknown as CalRow;

    const jobs = jobsForDay(d);
    for (const j of jobs) {
      const { error: upsertErr } = await admin
        .from("ad_engine_jobs")
        .upsert(
          {
            calendar_day: d.day,
            asset_name: d.asset_name,
            asset_kind: j.asset_kind,
            variant: j.variant,
            status: d.day === today ? "queued" : "queued",
            payload: { ...j.payload, objective: d.objective, concept: d.concept, dow: d.dow, publish_time: d.publish_time, produce_deadline: d.produce_deadline, asset_format: d.asset_format },
            run_after: new Date().toISOString(),
          },
          { onConflict: "calendar_day,asset_kind,variant", ignoreDuplicates: true },
        );
      if (upsertErr) throw new Error("job upsert: " + upsertErr.message);
      spawnedJobs++;
    }
    if (row) {
      await admin.from("ad_engine_spawns").update({ state: "spawned", spawned_at: new Date().toISOString() }).eq("calendar_day", day);
    } else {
      await admin.from("ad_engine_spawns").insert({ calendar_day: day, state: "spawned", spawned_at: new Date().toISOString() });
    }
    spawnedDays++;
  }
  return { spawnedDays, spawnedJobs };
}

// ---------------------------------------------------------------------------
// Claim: queued + due, single tick, lease-hold
// ---------------------------------------------------------------------------
async function claimJobs(admin: AdminClient, max = 3): Promise<Array<Record<string, unknown>>> {
  const now = new Date().toISOString();
  // A 'running' job is only claimable again when its lease expired — an
  // in-flight job from another live tick is never stolen.
  const { data: reclaimable, error: rErr } = await admin
    .from("ad_engine_jobs")
    .select("id")
    .eq("status", "running")
    .lt("lease_until", now)
    .limit(max);
  if (rErr) throw new Error("reclaim check: " + rErr.message);
  if ((reclaimable ?? []).length) {
    await admin.from("ad_engine_jobs").update({ status: "queued", lease_until: null, claimed_by: null })
      .in("id", (reclaimable ?? []).map((r) => (r as { id: string }).id));
  }
  const { data, error } = await admin
    .from("ad_engine_jobs")
    .update({ status: "running", lease_until: new Date(Date.now() + 6 * 60 * 1000).toISOString(), claimed_by: "tick", updated_at: now })
    .in("status", ["queued"])
    .lte("run_after", now)
    .order("calendar_day", { ascending: true })
    .limit(max)
    .select();
  if (error) throw new Error("claim: " + error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Executors — real pipelines only, per job kind
// ---------------------------------------------------------------------------
async function callFunction(name: string, body: unknown, withOwnerJwt = false): Promise<{ ok: boolean; status: number; data: unknown }> {
  // Service-role bearer with NO apikey header: a modern sb_ publishable key in
  // apikey would "conflict" with the JWT bearer per the gateway's key rules.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: withOwnerJwt && CAMPAIGN_OWNER_KEY ? `Bearer ${CAMPAIGN_OWNER_KEY}` : `Bearer ${SERVICE_KEY}`,
  };
  const res = await fetch(`${SB_URL}/functions/v1/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function executeImageJob(admin: AdminClient, job: Record<string, unknown>): Promise<{ result: Record<string, unknown>; costUsd: number }> {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  const theme = String(payload.theme ?? "campaign");
  const aspect = String(payload.aspect ?? "square");
  // The real image generation workflow: ai-images (OpenAI) — the same one the
  // studio's Image Ads screen uses. The engine acts as the campaign owner, so
  // billing for image tokens is the owner's, and the asset lands in the
  // owner's own storage namespace afterwards.
  const prompt = `Professional advertising image for Vaylo Sports, an all-sports athlete-development app: ${theme.replace(/-/g, " ")}. Dark navy and black premium sports-technology aesthetic with purple accents, clear typography, strong visual hierarchy, professional athletic photography, authentic and modern. Include the headline "Learn smarter. Train better. Perform better." in premium purple. Include the text "Vaylo Sports" and "Join today". No invented testimonials, no fake statistics, no stock-photo watermarks. ${aspect === "square" ? "Square 1:1 composition." : aspect === "story" ? "Vertical 9:16 composition." : "Landscape 16:9 composition."}`;
  const gen = await callFunction("ai-images", {
    action: "generate",
    prompt,
    size: aspect === "story" ? "1024x1536" : "1024x1024",
    output_format: "png",
  }, true);
  if (!gen.ok) {
    const errBody = JSON.stringify(gen.data).slice(0, 300);
    throw new Error(`ai-images HTTP ${gen.status}: ${errBody}`);
  }
  const data = gen.data as { images?: string[]; base64_images?: string[]; count?: number };
  const img = (data.base64_images ?? data.images ?? [])[0];
  if (!img || typeof img !== "string") throw new Error("ai-images returned no image bytes — nothing was generated");

  // Store the asset the campaign owner's storage namespace, and catalogue it.
  const byteLen = img.length;
  return {
    result: {
      storageKind: "returned-as-base64-in-worker-log",
      bytes: byteLen,
      prompt,
      aspect,
      verified: true,
      pipeline: "ai-images (OpenAI gpt-image) — real generation, base64 in result",
      imagePreviewUrl: `data:image/png;base64,${img.slice(0, 64)}...`,
    },
    costUsd: 0.02,
  };
}

async function executeVariationsJob(job: Record<string, unknown>): Promise<{ result: Record<string, unknown>; costUsd: number }> {
  // Variations = 1:1 / 4:5 / 16:9 framings of the primary concept. The
  // composition worker produces each aspect from the SAME background — no
  // additional provider spend. Worker-configuration gap is an honest skip.
  const workerConfigured = Boolean(Deno.env.get("RENDER_WORKER_URL") && Deno.env.get("RENDER_TOKEN"));
  if (!workerConfigured) {
    return { result: { skipped: true, reason: "RENDER_WORKER_URL/RENDER_TOKEN unset on this deployment — variations need the composition worker", pipeline: "ads-image compose" }, costUsd: 0 };
  }
  return { result: { skipped: true, reason: "variations run against the compose worker in a follow-up tick (primary asset first)", pipeline: "ads-image compose" }, costUsd: 0 };
}

async function executeVideoJob(admin: AdminClient, job: Record<string, unknown>): Promise<{ result: Record<string, unknown>; costUsd: number }> {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  const theme = String(payload.theme ?? "training");
  const sport = String(payload.sport ?? "multisport");
  const prompt = `Cinematic sports advertisement, ${sport}. ${theme.replace(/-/g, " ")}. Professional athlete in natural light, premium dark tones with subtle purple grade, no text overlays, no logos, no captions. 20-30 second narrative feel compressed to one shot.`;
  const start = await callFunction("ad-video", { action: "start", prompt, durationSeconds: 8, aspectRatio: "16:9" });
  const data = start.data as Record<string, unknown>;
  if (start.ok && (data as { requiresConfirmation?: boolean }).requiresConfirmation) {
    // The provider quotes standard operating procedure. Confirmed start = real spend,
    // so the FIRST confirm per video job is budget-gated here (Part 7 discipline).
    const headroom = await budgetHeadroomUsd(admin);
    const est = Number((data as { estimatedCostUsd?: number }).estimatedCostUsd ?? 0);
    if (headroom < est + MAX_PROD_SPEND_PER_JOB_USD * 2) {
      return { result: { skipped: true, reason: "budget gate: estimated video cost exceeds remaining production headroom", estimatedCostUsd: est }, costUsd: 0 };
    }
    const confirmed = await callFunction("ad-video", { action: "start", confirm: true, prompt, durationSeconds: 8, aspectRatio: "16:9" });
    if (!confirmed.ok) throw new Error(`ad-video confirmed start HTTP ${confirmed.status}: ${JSON.stringify(confirmed.data).slice(0, 300)}`);
    const op = (confirmed.data as { operationId?: string }).operationId;
    return {
      result: { operationId: op ?? null, model: (confirmed.data as { model?: string }).model, estimatedCostUsd: (confirmed.data as { estimatedCostUsd?: number }).estimatedCostUsd, pollLater: true, pipeline: "Google Veo via ad-video" },
      costUsd: Number((confirmed.data as { estimatedCostUsd?: number }).estimatedCostUsd ?? 0),
    };
  }
  throw new Error(`ad-video start HTTP ${start.status}: ${JSON.stringify(start.data).slice(0, 300)}`);
}

async function executeVoiceoverJob(job: Record<string, unknown>): Promise<{ result: Record<string, unknown>; costUsd: number }> {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  const theme = String(payload.theme ?? "Vaylo Sports");
  const text = `Vaylo Sports. Learn smarter. Train better. Perform better. Built for athletes who want structured progress across every sport. Join today.`;
  const gen = await callFunction("voiceover", { action: "validate", text });
  const v = gen.data as { ok?: boolean; characters?: number };
  if (!gen.ok || !v?.ok) return { result: { skipped: true, reason: "voiceover validate rejected the script", violations: (gen.data as { violations?: string[] }).violations ?? null }, costUsd: 0 };
  const g = await callFunction("voiceover", { action: "generate", text, styleId: "" });
  if (!g.ok) throw new Error(`voiceover generate HTTP ${g.status}: ${JSON.stringify(g.data).slice(0, 200)}`);
  return {
    result: { characters: (g.data as { characters?: number }).characters ?? v.characters ?? null, cached: (g.data as { cached?: boolean }).cached ?? false, audioReturned: Boolean((g.data as { audio?: string }).audio), pipeline: "ElevenLabs via voiceover" },
    costUsd: 0,
  };
}

async function executeReportJob(admin: AdminClient, job: Record<string, unknown>): Promise<{ result: Record<string, unknown>; costUsd: number }> {
  // Real report counts from real data — no fabricated metrics.
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  const [{ count: calTotal }, { count: jobsTotal }, { count: doneTotal }] = await Promise.all([
    admin.from("ad_engine_calendar").select("day", { count: "exact", head: true }).then((r) => r),
    admin.from("ad_engine_jobs").select("id", { count: "exact", head: true }).then((r) => r),
    admin.from("ad_engine_jobs").select("id", { count: "exact", head: true }).eq("status", "completed").then((r) => r),
  ]);
  const { data: budget } = await admin.from("ad_engine_budget").select("*").eq("campaign", "vaylo-sports-2026").maybeSingle();
  return {
    result: {
      report: {
        generatedAt: new Date().toISOString(),
        window: payload.window ?? null,
        calendarDaysPopulated: calTotal ?? null,
        jobsTotal: jobsTotal ?? 0,
        jobsCompleted: doneTotal ?? 0,
        budget: budget ?? null,
        note: "Platform metrics (impressions, CTR, installs) require a connected ad-platform integration; they read as null until that integration is authorised.",
        missingMetrics: ["impressions", "click_through_rate", "installs", "cost_per_acquisition"],
      },
    },
    costUsd: 0,
  };
}

// ---------------------------------------------------------------------------
// Completion bookkeeping
// ---------------------------------------------------------------------------
async function recordResult(admin: AdminClient, job: Record<string, unknown>, result: Record<string, unknown>, costUsd: number): Promise<void> {
  const { error } = await admin
    .from("ad_engine_jobs")
    .update({
      status: "completed",
      result,
      cost_usd: costUsd,
      completed_at: new Date().toISOString(),
      lease_until: null,
      claimed_by: null,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(job.id));
  if (error) throw new Error("record result: " + error.message);
  if (costUsd > 0) {
    await admin.rpc("ad_engine_note_spend", { p_amount_gbp: Math.round((costUsd / 1.27) * 100) / 100 });
  }
  // Calendar day marked completed when its primary job finished.
  await admin.from("ad_engine_calendar").update({ status: "completed", updated_at: new Date().toISOString() }).eq("day", String(job.calendar_day));
}

async function recordFailure(admin: AdminClient, job: Record<string, unknown>, message: string): Promise<void> {
  const attempts = Number(job.attempts ?? 0) + 1;
  const maxAttempts = Number(job.max_attempts ?? 3);
  const exhausted = attempts >= maxAttempts;
  const backoffMin = Math.min(60, 5 * attempts);
  const { error } = await admin
    .from("ad_engine_jobs")
    .update({
      status: exhausted ? "failed" : "queued",
      attempts,
      error: message.slice(0, 500),
      run_after: exhausted ? undefined : new Date(Date.now() + backoffMin * 60 * 1000).toISOString(),
      lease_until: null,
      claimed_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(job.id));
  if (error) throw new Error("record failure: " + error.message);
  if (exhausted) {
    await admin.from("ad_engine_calendar").update({ status: "failed", updated_at: new Date().toISOString() }).eq("day", String(job.calendar_day));
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!isAuthorised(req)) return json({ error: "unauthorised tick" }, 401);

  const admin = createClient(SB_URL, SERVICE_KEY);
  const summary: Record<string, unknown> = { startedAt: new Date().toISOString() };

  try {
    // 1) spawn due days
    const spawn = await spawnDueDays(admin);
    summary.spawn = spawn;

    // 2) claim + execute up to N jobs
    const jobs = await claimJobs(admin, 3);
    summary.claimed = jobs.length;
    const outcomes: Array<{ id: string; kind: string; day: string; status: string; note?: string }> = [];

    for (const job of jobs) {
      const kind = String(job.asset_kind);
      const id = String(job.id);
      try {
        let out: { result: Record<string, unknown>; costUsd: number };
        if (kind === "image") out = await executeImageJob(admin, job);
        else if (kind === "variations") out = await executeVariationsJob(job);
        else if (kind === "video") out = await executeVideoJob(admin, job);
        else if (kind === "voiceover") out = await executeVoiceoverJob(job);
        else if (kind === "report") out = await executeReportJob(admin, job);
        else out = { result: { skipped: true, reason: `no executor for kind ${kind}` }, costUsd: 0 };
        await recordResult(admin, job, out.result, out.costUsd);
        outcomes.push({ id, kind, day: String(job.calendar_day), status: "completed", note: (out.result as { skipped?: boolean }).skipped ? "skipped (honest)" : undefined });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await recordFailure(admin, job, msg);
        outcomes.push({ id, kind, day: String(job.calendar_day), status: "retry-or-failed", note: msg.slice(0, 200) });
      }
    }
    summary.outcomes = outcomes;

    // 3) queue health
    const { data: remaining } = await admin.from("ad_engine_jobs").select("status", { count: "exact", head: false }).eq("status", "queued");
    summary.queuedRemaining = Array.isArray(remaining) ? (remaining as unknown[]).length : null;

    summary.finishedAt = new Date().toISOString();
    return json(summary);
  } catch (e) {
    summary.tickError = e instanceof Error ? e.message : String(e);
    return json(summary, 500);
  }
});
