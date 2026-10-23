import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAthleteDossier, formatDossierForPrompt } from "../_shared/athleteDossier.ts";
import { languageDirective } from "../_shared/openai.ts";
import { GEMINI_MODELS } from "../_shared/aiModels.ts";
import { geminiDeleteFile, geminiGenerate, geminiUploadFile } from "../_shared/google.ts";
import { aiCallAllowed, authenticate, readJsonBody, spendForUser, throttled } from "../_shared/guard.ts";
import { refundCredits } from "../_shared/refund.ts";
import { markServiceJobDelivered } from "../_shared/serviceJobs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Gemini models, from the registry (aiModels.ts): Flash for free tier, Pro for premium.
const FLASH_MODEL = GEMINI_MODELS.FLASH;
const PRO_MODEL = GEMINI_MODELS.PRO;

interface VideoQuotaSlot {
  allowed?: boolean;
  duplicate?: boolean;
  reservation_id?: number;
}

// THE LIMITS, mirrored from the client's single source in src/lib/formVideo.ts.
// An edge function cannot import from src/, and the numbers have to be checked
// on both sides anyway — the client so the athlete is told before a long upload,
// the server because a client check is a convenience, not a control.
//
// Why they moved twice. The clip used to travel as base64 inside the request
// body, which capped it at 6 MiB — five to fifteen seconds, no approach, no
// complete rep, no follow-through, so the report was written about a fragment
// and read like one. It now goes to a private Storage bucket (form-videos,
// owner-scoped) and this function streams it to the provider's Files API.
//
// Why ten minutes and not one. A single rep is a few seconds, but an athlete
// filming a set wants the approach, several reps and the point where form breaks
// down — and refusing at sixty seconds was refusing exactly the footage worth
// reviewing. Ten minutes is where "almost any clip" stops being true: beyond it
// the clip is a training session rather than a technique sample, and the
// provider bill, which is per second of video, grows with it.
//
// The byte cap is deliberately generous because the bytes are never buffered:
// they flow from Storage straight into the provider's upload, so this number is
// not a memory limit. It exists to refuse an obvious mistake, not to pace the
// athlete.
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_SECONDS = 600;
/** Bucket the client uploads to. Private: see the migration that creates it. */
const VIDEO_BUCKET = "form-videos";
const ALLOWED_MIME = ["video/mp4", "video/quicktime", "video/webm"];

/**
 * What the coach is asked for, and why it reads the way it does.
 *
 * The old prompt asked for "strengths, weaknesses and improvements" over a clip
 * that could only ever be a few seconds long, and the answers came back as
 * praise with no evidence in it: the athlete could not tell which part of their
 * movement was being described, or check it. Two changes fix that, and neither
 * is about the file size.
 *
 *   1. The report is built from the clip's own timeline. A minute of footage
 *      contains a movement rather than a snapshot, so the coach works through
 *      it in order and cites timestamps the athlete can scrub to. A timestamp
 *      turns an opinion into something checkable, which is the difference
 *      between coaching and commentary.
 *   2. Invention is named as the failure mode. Video invites confident detail
 *      nobody could actually see — a knee angle at a camera position that never
 *      had it — and an invented fault is worse than an admitted gap, because
 *      the athlete goes away and drills it. "Not visible from this angle" is
 *      an acceptable answer, and the prompt says so twice.
 */
const ANALYSIS_PROMPT = [
  "You are an elite technique coach reviewing one clip an athlete uploaded of themselves. Write a report they can act on, not a description of the clip.",
  "",
  "HOW TO WATCH IT:",
  "- Work through the clip in order and split it into the phases it actually has (approach, the key action, the follow-through or the landing). Name the timestamps you see — mm:ss exactly as the video player shows them.",
  "- For each phase, say what the body is doing: the segment and joint positions that matter for this movement, the timing of the key contacts or transitions, trunk-to-hip and shoulder relationships, rhythm and tempo, and where control is gained or lost.",
  "- If the clip shows repetition, compare the earliest reps with the last ones and say what changes: which quality holds up as the athlete tires, and which is the first to go.",
  "- Cite a timestamp for every observation, and make it a moment the athlete can scrub to.",
  "",
  "HONESTY RULES — these matter more than sounding impressive:",
  "- Describe only what is visible in the footage. If the feet are out of frame, the camera is side-on only, the light or distance hides a joint, or the clip cuts before the landing, say exactly that in the field where it matters instead of guessing.",
  "- An invented detail sends the athlete away to drill a fault they do not have. 'This cannot be judged from this angle — film a side-on clip of the same rep' is a better answer than a confident one.",
  "- Never diagnose an injury, never name a tissue, never prescribe medication. Describe movement only.",
  "- Use the athlete dossier to tailor everything: never build a recommendation on a movement that aggravates a listed injury, and scale drills to their sport and level.",
  "",
  "WHAT TO RETURN:",
  "- moments: 5 to 8 entries in clip order. Each one is a timestamp, what happens there, and why it does or does not matter. These are the evidence for the whole report — every claim in strengths, areas_to_improve and technical_analysis must trace back to one of them.",
  "- strengths: what genuinely works, each with the timestamp that shows it.",
  "- areas_to_improve: the two or three changes with the most effect on performance, not every imperfection you can find. Say where each appears in the clip.",
  "- technical_analysis: one or two sentences per field, drawn from what you saw rather than from general principles.",
  "- recommended_drills: 3 to 5 drills for THIS athlete, each with sets, reps or time, and what they should feel or check while doing it, so the drill is testable.",
  "- focus_next_session: the single change to make next session, in one sentence.",
  "- coach_summary: two or three sentences the athlete will actually read — what the clip shows them doing, and what to do about it.",
  "- overall_score: 0-100 for the movement in THIS clip, judged against a competent athlete of this sport and level. Use the whole scale; 90+ has to mean exceptional.",
].join("\n");

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    overall_score: { type: "integer" },
    strengths: { type: "array", items: { type: "string" } },
    areas_to_improve: { type: "array", items: { type: "string" } },
    technical_analysis: {
      type: "object",
      properties: {
        posture: { type: "string" },
        movement_efficiency: { type: "string" },
        arm_mechanics: { type: "string" },
        leg_mechanics: { type: "string" },
        balance_and_control: { type: "string" },
      },
      required: ["posture", "movement_efficiency", "arm_mechanics", "leg_mechanics", "balance_and_control"],
    },
    recommended_drills: { type: "array", items: { type: "string" } },
    // The evidence trail. Required, not optional: a report without moments is a
    // report whose claims nobody can check, which is the complaint this schema
    // answers. The page renders these as a timeline in clip order.
    moments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          t: { type: "string" },
          what: { type: "string" },
          why: { type: "string" },
        },
        required: ["t", "what", "why"],
      },
    },
    focus_next_session: { type: "string" },
    coach_summary: { type: "string" },
  },
  required: [
    "overall_score",
    "strengths",
    "areas_to_improve",
    "technical_analysis",
    "recommended_drills",
    "moments",
    "focus_next_session",
    "coach_summary",
  ],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let chargedAmount = 0;
  let chargedUserId: string | null = null;
  // The charge's idempotency key; the refund derives `refund:<charge key>`.
  let chargedKey: string | undefined = undefined;
  let premiumSlotId: number | null = null;
  let requestClaimUserId: string | null = null;
  let requestClaimId: string | null = null;
  // The clip's two copies: the object in Storage the client uploaded, and the
  // file this function uploads to Gemini. Both are deleted on every exit path
  // (see discardVideo), because "your video is never stored" is a promise about
  // failures too — the refund path is exactly when an orphan would be left.
  let uploadedPath: string | null = null;
  let geminiFileName: string | null = null;
  // Dynamic RPCs/tables in the deployed schema aren't part of the generated
  // web Database type; all access uses this service-role Supabase client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- these migrations are not in generated Database types.
  type AdminClient = ReturnType<typeof createClient<any>>;
  let admin: AdminClient | null = null;

  const releasePremiumSlot = async () => {
    if (premiumSlotId === null || !admin) return;
    const { error } = await admin.rpc("release_video_analysis_slot", {
      p_reservation_id: premiumSlotId,
    });
    if (error) console.error("video quota release failed", error.message);
    premiumSlotId = null;
  };

  const refundCharge = async () => {
    if (!chargedUserId || chargedAmount <= 0) return;
    await refundCredits({
      supabaseUrl: Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      userId: chargedUserId,
      amount: chargedAmount,
      dedupeKey: chargedKey,
      reason: "AI video form analysis failed — auto refund",
      source: "video-form-analysis-refund",
    });
    chargedAmount = 0;
    chargedUserId = null;
    chargedKey = undefined;
  };

  const releaseRequestClaim = async () => {
    if (!requestClaimUserId || !requestClaimId || !admin) return;
    const { error } = await admin.rpc("release_video_analysis_request", {
      p_user_id: requestClaimUserId,
      p_request_id: requestClaimId,
    });
    if (error) console.error("video request claim release failed", error.message);
    requestClaimUserId = null;
    requestClaimId = null;
  };

  const cleanupFailedCall = async () => {
    await Promise.all([refundCharge(), releasePremiumSlot(), releaseRequestClaim()]);
  };

  /**
   * Delete the athlete's clip from Storage and the copy sent to the provider.
   *
   * Runs in a finally, so it covers delivered reports, refunded failures and
   * thrown errors alike. Nothing here may throw: a cleanup problem must never
   * turn a completed analysis into an error response.
   */
  const discardVideo = async () => {
    const apiKey = Deno.env.get("GOOGLE_API");
    if (geminiFileName && apiKey) {
      await geminiDeleteFile({ apiKey, name: geminiFileName });
      geminiFileName = null;
    }
    if (uploadedPath) {
      const path = uploadedPath;
      uploadedPath = null;
      if (admin) {
        const { error } = await admin.storage.from(VIDEO_BUCKET).remove([path]);
        if (error) console.error("Uploaded clip cleanup failed", error.message);
      }
    }
  };

  try {
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    if (throttled(userId)) return json({ error: "Too many requests. Wait a moment and try again." }, 429);
    if (!(await aiCallAllowed(req, userId, "video-form-analysis", { max: 5, windowSeconds: 60 }))) {
      return json({ error: "Too many requests. Wait a moment and try again." }, 429);
    }

    const GOOGLE_API = Deno.env.get("GOOGLE_API");
    if (!GOOGLE_API) return json({ error: "Video analysis is not configured." }, 500);

    const body = await readJsonBody(req);
    if (!body) return json({ error: "Invalid request body or request too large" }, 400);

    const { storage_path, duration_seconds, mime_type, sport_type, video_name, save, pbs, userLocale, request_id } = body as {
      storage_path?: unknown;
      duration_seconds?: unknown;
      mime_type?: unknown;
      sport_type?: unknown;
      video_name?: unknown;
      save?: unknown;
      pbs?: unknown;
      userLocale?: unknown;
      request_id?: unknown;
    };
    const langDirective = languageDirective(typeof userLocale === "string" ? userLocale : undefined);

    // The service client comes up before validation on purpose. By the time this
    // function is called the clip is already in Storage, so every exit path —
    // including a rejected request — has to be able to delete it.
    admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const service = admin;

    // Owner-scoped path only. The client always writes under its own auth id, so
    // anything else is malformed or forged, and the service-role download below
    // must never be able to reach another athlete's object.
    const uploadedByThisAthlete =
      typeof storage_path === "string" &&
      storage_path.length > 0 &&
      storage_path.length <= 200 &&
      !storage_path.startsWith("/") &&
      !storage_path.includes("..") &&
      storage_path.startsWith(`${userId}/`);
    if (uploadedByThisAthlete) uploadedPath = storage_path as string;
    if (!uploadedByThisAthlete) return json({ error: "No video received. Please upload an MP4 or MOV file." }, 400);
    if (typeof mime_type !== "string" || !ALLOWED_MIME.includes(mime_type))
      return json({ error: "Unsupported video format. Please upload an MP4, MOV or WebM file." }, 400);

    // Duration comes from the clip's own metadata, read on the client. A longer
    // clip is refused rather than trimmed: the provider bills by the second of
    // video, so an unbounded upload is an unbounded cost, and a silently cut
    // clip would produce a report about footage the athlete cannot see.
    const durationSeconds =
      typeof duration_seconds === "number" && Number.isFinite(duration_seconds) ? duration_seconds : null;
    // Worded like the client's own refusal ("up to 10 minutes"), from the same
    // number, so the two sides of the cap do not read as two different rules —
    // and the athlete who trimmed the clip on their phone recognises the limit.
    if (durationSeconds !== null && durationSeconds > MAX_SECONDS + 1)
      return json({
        error: `That clip is ${Math.round(durationSeconds)} seconds long. Clips can be up to ${MAX_SECONDS / 60} minutes — trim it and try again.`,
      }, 413);

    const sport = typeof sport_type === "string" && sport_type.length <= 40 ? sport_type : "general";

    // Subscription entitlement is still checked server-side. Expired or
    // cancelled rows never unlock the high-cost Pro model.
    const { data: sub } = await service
      .from("subscriptions")
      .select("plan_type, status, is_lifetime, unlimited_credits, expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    const lapsed = !!sub?.expires_at && new Date(String(sub?.expires_at)).getTime() <= Date.now();
    const liveSubscription = ["active", "trialing", "renewing", "trial"].includes(String(sub?.status ?? ""));
    const isPremium = sub?.is_lifetime === true || (liveSubscription && !lapsed);
    const subscriptionTier = String(sub?.plan_type ?? "").toLowerCase();
    // The stored unlimited flag is deliberately not read here: it stays true
    // after a plan lapses, and plan_type is always populated by the current
    // constraint, so the timestamp-checked plan is the only honest signal.
    const premiumTier = isPremium && (
      sub?.is_lifetime === true || /premium|pro|elite|unlimited/.test(subscriptionTier)
    );

    // Free athletes keep the advertised 1 Flash analysis per rolling week.
    // The durable quota ledger, rather than analysis-history rows, is the source
    // of truth so paid overages don't consume next week's complimentary analysis.
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { count: recentFreeSlots, error: freeQuotaError } = await service
      .from("video_analysis_quota_reservations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("tier", "free")
      .in("status", ["reserved", "committed"])
      .gt("expires_at", new Date().toISOString())
      .gt("reserved_at", weekAgo);
    if (freeQuotaError) return json({ error: "Usage could not be verified. Please try again." }, 503);

    // Backstop for analyses that predate the quota ledger, and for a ledger that
    // is ever partially rebuilt: a live (non-deleted) row from this week still
    // consumed the athlete's one complimentary Flash call. Rows the athlete
    // deleted are excluded, matching the documented retention rule.
    const { count: recentHistoryRows, error: historyError } = await service
      .from("video_form_analyses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("deleted_at", null)
      .gt("created_at", weekAgo);
    if (historyError) return json({ error: "Usage could not be verified. Please try again." }, 503);

    // Bind an idempotency token to this user and exact upload. The client makes
    // a fresh UUID for each intentional analysis and reuses it for transport
    // retries; including the video prevents the token from replaying a different
    // payload. Credits use a separate fresh ledger key, so failed/refunded calls
    // can be retried without being mistaken for a successful prior debit.
    const clientRequestId = typeof request_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request_id)
      ? request_id
      : crypto.randomUUID();
    // The object path stands in for the bytes here: it is unique per upload and
    // the client makes a fresh one for each intentional analysis, so the token
    // still cannot be replayed against a different clip.
    const fingerprint = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${userId}:${clientRequestId}:${uploadedPath}`),
    );
    const requestId = Array.from(new Uint8Array(fingerprint), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const { data: previousRequest, error: replayError } = await service
      .from("video_form_analyses")
      .select("id, model_used, result, saved")
      .eq("user_id", userId)
      .eq("request_id", requestId)
      .maybeSingle();
    if (replayError) return json({ error: "Usage could not be verified. Please try again." }, 503);
    if (previousRequest?.saved) {
      // An upstream/network retry after a successful save must not spend credits
      // or consume another quota slot. Return the exact prior result.
      return json({
        result: previousRequest.result,
        model: previousRequest.model_used,
        saved_id: previousRequest.id,
        tier: premiumTier ? "premium" : "free",
        cost: 0,
        replayed: true,
      });
    }
    if (previousRequest) {
      // Unsaved analyses cannot provide reliable request replay, so fail closed
      // rather than accidentally replaying or double charging after a lost reply.
      return json({ error: "This video analysis request cannot be replayed. Start a new analysis." }, 409);
    }

    // ---- Read the uploaded clip (server-side, owner-scoped) ----
    // Streamed rather than buffered. `storage.download()` hands back a Blob —
    // the whole clip in this function's memory, and then a second copy as it is
    // sent on — which is what failed first on a long clip. Reading the object
    // over the Storage REST endpoint gives the same service-role access with a
    // readable body, and the size comes from the object's own `content-length`:
    // Storage's metadata, not the caller's claim.
    //
    // Deliberately before the claim and before the charge, exactly as the
    // buffered version was, so a missing, empty or oversized object costs the
    // athlete nothing. The body is opened here and consumed once, at the
    // provider call below.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const objectPath = (uploadedPath as string).split("/").map(encodeURIComponent).join("/");
    const download = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/${VIDEO_BUCKET}/${objectPath}`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!download.ok || !download.body) {
      console.error("Uploaded clip download failed", download.status, "storage_error");
      return json({ error: "The uploaded clip could not be read. Please try again." }, 400);
    }
    const declaredBytes = Number(download.headers.get("content-length"));
    if (!Number.isFinite(declaredBytes) || declaredBytes <= 0)
      return json({ error: "That file is empty. Please upload the clip again." }, 400);
    if (declaredBytes > MAX_BYTES)
      return json({
        error: `That clip is over ${Math.round(MAX_BYTES / (1024 * 1024))}MB. Please trim it and upload again.`,
      }, 413);
    const clip = { body: download.body, byteLength: declaredBytes };

    const { data: claim, error: claimError } = await service.rpc("claim_video_analysis_request", {
      p_user_id: userId,
      p_request_id: requestId,
    });
    if (claimError) {
      console.error("Video request claim unavailable", claimError.message);
      return json({ error: "Usage could not be verified. Please try again." }, 503);
    }
    const requestClaim = claim as { claimed?: boolean; duplicate?: boolean } | null;
    if (!requestClaim?.claimed) {
      return json({ error: "This video analysis is already in progress. Please wait and retry." }, 409);
    }
    requestClaimUserId = userId;
    requestClaimId = requestId;

    let model = FLASH_MODEL;
    // Either signal alone is enough to require a charge; the union only ever
    // errs toward charging, never toward a second free analysis.
    let chargeRequired = (recentFreeSlots ?? 0) >= 1 || (recentHistoryRows ?? 0) >= 1;

    if (!premiumTier) {
      // The reservation row is the durable authority and survives history deletion.
      // Do not reserve another complimentary slot during its rolling week.
      if (!chargeRequired) {
        const { data: slot, error: slotError } = await service.rpc("reserve_video_analysis_slot", {
          p_user_id: userId,
          p_tier: "free",
          p_limit: 1,
          p_window_seconds: 7 * 86400,
          p_idempotency_key: `${requestId}:free`,
        });
        if (slotError) {
          console.error("Free video quota unavailable", slotError.message);
          await releaseRequestClaim();
          return json({ error: "Usage could not be verified. Please try again." }, 503);
        }
        const reservation = slot as VideoQuotaSlot | null;
        if (reservation?.duplicate) {
          await releaseRequestClaim();
          return json({ error: "This video analysis is already in progress. Please wait and retry." }, 409);
        }
        if (reservation?.allowed && typeof reservation.reservation_id === "number") {
          premiumSlotId = reservation.reservation_id;
          chargeRequired = false;
        } else {
          chargeRequired = true;
        }
      }
    } else {
      // Lifetime and subscription plans include at most 10 expensive Pro calls
      // in a rolling 30-day period. Once the cap is hit, Flash remains available
      // for 12 credits instead of exposing Vaylo to unbounded Pro API costs.
      const { data: slot, error: slotError } = await service.rpc("reserve_video_analysis_slot", {
        p_user_id: userId,
        p_tier: "premium",
        p_limit: 10,
        p_window_seconds: 30 * 86400,
        p_idempotency_key: `${requestId}:premium`,
      });
      if (slotError) {
        console.error("Pro video quota unavailable", slotError.message);
        await releaseRequestClaim();
        return json({ error: "Usage could not be verified. Please try again." }, 503);
      }
      const reservation = slot as VideoQuotaSlot | null;
      if (reservation?.duplicate) {
        await releaseRequestClaim();
        return json({ error: "This video analysis is already in progress. Please wait and retry." }, 409);
      }
      if (reservation?.allowed && typeof reservation.reservation_id === "number") {
        premiumSlotId = reservation.reservation_id;
        model = PRO_MODEL;
        chargeRequired = false;
      } else {
        chargeRequired = true;
      }
    }

    let analysisCost = 0;
    if (chargeRequired) {
      const spend = await spendForUser(
        req,
        userId,
        "video_form_analysis",
        "AI video form analysis",
        {
          source: "video-form-analysis",
          billUnlimited: true,
          // A failed/refunded call can be retried as a new charge attempt; the
          // request claim prevents simultaneous requests from double-debiting.
          idempotencyKey: `video-form-analysis:${userId}:${crypto.randomUUID()}`,
        },
      );
      if (!spend.success) {
        await Promise.all([releasePremiumSlot(), releaseRequestClaim()]);
        return json({
          error: spend.error || `Not enough credits. This analysis costs ${spend.cost} credits.`,
          shortfall: spend.shortfall ?? null,
          cost: spend.cost,
          balance: spend.balance,
        }, 402);
      }
      if (spend.duplicate) {
        await Promise.all([releasePremiumSlot(), releaseRequestClaim()]);
        return json({ error: "This video analysis is already in progress. Please wait and retry." }, 409);
      }
      analysisCost = spend.cost;
      if (!spend.unlimited && spend.cost > 0) {
        chargedAmount = spend.cost;
        chargedUserId = userId;
        chargedKey = spend.idempotencyKey;
      }
    }

    // ---- Athlete dossier for context-aware feedback ----
    let dossierText = "";
    try {
      const dossier = await fetchAthleteDossier(service, userId, Array.isArray(pbs) ? pbs : null);
      dossierText = formatDossierForPrompt(dossier);
    } catch (e) {
      console.error("dossier fetch failed", e);
    }

    const sportContext =
      sport === "running"
        ? "Focus on running technique: cadence, foot strike, hip extension, trunk lean, arm carriage."
        : sport === "sprint"
          ? "Focus on sprint mechanics: drive phase, shin angles, ground contact time, knee drive, arm speed."
          : "Focus on general athletic movement quality, coordination and efficiency.";

    const dossierBlock = dossierText ? `\n\nAthlete dossier (use to tailor feedback — do not contradict injuries/level):\n${dossierText}` : "";

    // ---- Upload the clip to the provider, then analyse it by reference ----
    // A clip of any useful length is far too large to inline in a request, so it
    // goes through the Files API once and the call references the resulting URI.
    // The body is the stream opened above — never a copy of it — and the file is
    // registered here and deleted in the finally block, so the provider holds it
    // only for the length of this request.
    const uploaded = await geminiUploadFile({
      apiKey: GOOGLE_API,
      body: clip.body,
      byteLength: clip.byteLength,
      mimeType: mime_type,
      displayName: "form-clip",
    });
    if (!uploaded.ok) {
      console.error("Gemini video upload failed", uploaded.status, "upstream_error");
      await cleanupFailedCall();
      if (uploaded.status === 429)
        return json({ error: "Analysis service is busy. Please try again in a moment." }, 429);
      if (uploaded.status === 413 || uploaded.status === 400)
        return json({ error: "That video couldn't be uploaded for analysis. Try a shorter or clearer clip." }, 400);
      return json({ error: "Video analysis failed. Please try again.", status: uploaded.status }, 502);
    }
    geminiFileName = uploaded.file.name;

    const gemini = await geminiGenerate({
      model,
      apiKey: GOOGLE_API,
      parts: [
        { text: `${ANALYSIS_PROMPT}\n\n${sportContext}${dossierBlock}${langDirective ? "\n\n" + langDirective : ""}` },
        { fileData: { fileUri: uploaded.file.uri, mimeType: mime_type } },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    if (!gemini.ok) {
      // Log the provider status and a short, value-free marker — never the raw
      // provider body, which can echo request metadata back into our logs.
      console.error("Gemini video analysis failed", gemini.status, "upstream_error");
      await cleanupFailedCall();
      if (gemini.status === 429)
        return json({ error: "Analysis service is busy. Please try again in a moment." }, 429);
      if (gemini.status === 400)
        return json({ error: "That video couldn't be analysed. Try a clearer clip, filmed closer." }, 400);
      return json({ error: "Video analysis failed. Please try again.", status: gemini.status }, 502);
    }

    const text = gemini.text;
    let result: Record<string, unknown>;

    try {
      result = JSON.parse(text);
    } catch {
      console.error("Unparsable Gemini response", "invalid_json");
      await cleanupFailedCall();
      return json({ error: "The analysis came back malformed. Please try again." }, 502);
    }

    const score = Math.max(0, Math.min(100, Number(result?.overall_score) || 0));
    result.overall_score = score;

    let saved_id: string | null = null;
    const shouldSave = save !== false;
    const { data: inserted, error: insertError } = await service
      .from("video_form_analyses")
      .insert({
        user_id: userId,
        request_id: requestId,
        sport_type: sport,
        video_name: typeof video_name === "string" ? video_name.slice(0, 120) : null,
        model_used: model,
        overall_score: score,
        result,
        saved: shouldSave,
      })
      .select("id")
      .maybeSingle();
    if (insertError) {
      console.error("Failed to record analysis", insertError.message);
      await cleanupFailedCall();
      return json({ error: "The analysis could not be saved. Your credits were refunded; please try again." }, 500);
    }
    saved_id = inserted?.id ?? null;

    // The provider delivered and persisted a result; mark the request replayable
    // before returning it. A later retry also finds the result row if this RPC
    // transiently fails.
    const { error: completeRequestError } = await service.rpc("complete_video_analysis_request", {
      p_user_id: userId,
      p_request_id: requestId,
    });
    if (completeRequestError) {
      console.error("video request completion failed", completeRequestError.message);
    }
    requestClaimUserId = null;
    requestClaimId = null;

    // Keep the Pro reservation and credit charge after a successful persisted
    // analysis. A failed quota finalization is logged, not refunded, because the
    // provider has already delivered the result.
    if (premiumSlotId !== null) {
      const { error: commitError } = await service.rpc("commit_video_analysis_slot", {
        p_reservation_id: premiumSlotId,
      });
      if (commitError) {
        console.error("video quota commit failed", commitError.message);
        // The result was already delivered by the provider. Keep the reservation
        // consumed even if finalization fails; do not free a Pro slot on retry.
      }
      premiumSlotId = null;
    }
    // The report exists and is saved: this is a delivered service, which the
    // refund policy will not auto-refund. Recorded before the charge markers are
    // cleared, and best-effort — bookkeeping must not fail a delivered report.
    await markServiceJobDelivered({
      supabaseUrl: Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      userId,
      chargeKey: chargedKey,
    });
    chargedAmount = 0;
    chargedUserId = null;
    return json({ result, model, saved_id, tier: premiumTier ? "premium" : "free", cost: analysisCost });
  } catch (err) {
    await cleanupFailedCall();
    console.error("video-form-analysis error", err instanceof Error ? err.name : err);
    return json({ error: "Video analysis could not run. Please try again." }, 500);
  } finally {
    // The clip is gone whatever happened above: analysed, refunded or thrown.
    await discardVideo();
  }
});
