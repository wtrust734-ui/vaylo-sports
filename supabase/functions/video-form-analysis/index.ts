import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAthleteDossier, formatDossierForPrompt } from "../_shared/athleteDossier.ts";
import { languageDirective } from "../_shared/openai.ts";
import { GEMINI_MODELS } from "../_shared/aiModels.ts";
import { geminiGenerate } from "../_shared/google.ts";
import { aiCallAllowed, authenticate, readJsonBody, spendForUser, throttled } from "../_shared/guard.ts";
import { refundCredits } from "../_shared/refund.ts";

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

// Keep the base64 JSON body below the shared 10 MiB Edge Function guard cap.
// A 6 MiB video expands to ~8 MiB plus JSON framing.
const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED_MIME = ["video/mp4", "video/quicktime", "video/webm"];

const ANALYSIS_PROMPT =
  "Analyse this athlete movement video like an elite sports coach. Evaluate visible technique, efficiency, posture, movement patterns, strengths, weaknesses, and improvements. Provide practical drills and recommendations. Tailor feedback to the athlete's dossier (sport, level, injuries, PBs) — avoid prescribing movements that aggravate listed injuries. Do not diagnose injuries.";

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
    coach_summary: { type: "string" },
  },
  required: [
    "overall_score",
    "strengths",
    "areas_to_improve",
    "technical_analysis",
    "recommended_drills",
    "coach_summary",
  ],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let chargedAmount = 0;
  let chargedUserId: string | null = null;
  let debitKey: string = crypto.randomUUID();
  let premiumSlotId: number | null = null;
  let requestClaimUserId: string | null = null;
  let requestClaimId: string | null = null;
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
          debitKey,
      amount: chargedAmount,
      reason: "AI video form analysis failed — auto refund",
      source: "video-form-analysis-refund",
    });
    chargedAmount = 0;
    chargedUserId = null;
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

    const { video_base64, mime_type, sport_type, video_name, save, pbs, userLocale, request_id } = body as {
      video_base64?: unknown;
      mime_type?: unknown;
      sport_type?: unknown;
      video_name?: unknown;
      save?: unknown;
      pbs?: unknown;
      userLocale?: unknown;
      request_id?: unknown;
    };
    const langDirective = languageDirective(typeof userLocale === "string" ? userLocale : undefined);

    if (typeof video_base64 !== "string" || video_base64.length < 100)
      return json({ error: "No video received. Please upload an MP4 or MOV file." }, 400);
    if (typeof mime_type !== "string" || !ALLOWED_MIME.includes(mime_type))
      return json({ error: "Unsupported video format. Please upload an MP4, MOV or WebM file." }, 400);

    const base64 = video_base64.includes(",") ? video_base64.split(",")[1] : video_base64;
    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes > MAX_BYTES)
      return json({ error: "Video is too large. Please upload a clip under 6MB (5–15 seconds is ideal)." }, 413);

    const sport = typeof sport_type === "string" && sport_type.length <= 40 ? sport_type : "general";

    admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const service = admin;

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
    const fingerprint = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${userId}:${clientRequestId}:${base64}`),
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
        debitKey = spend.debitKey!;
        chargedUserId = userId;
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

    const gemini = await geminiGenerate({
      model,
      apiKey: GOOGLE_API,
      parts: [
        { text: `${ANALYSIS_PROMPT}\n\n${sportContext}${dossierBlock}${langDirective ? "\n\n" + langDirective : ""}` },
        { inlineData: { mimeType: mime_type, data: base64 } },
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
        return json({ error: "That video couldn't be analysed. Try a shorter, clearer clip." }, 400);
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
    chargedAmount = 0;
    chargedUserId = null;
    return json({ result, model, saved_id, tier: premiumTier ? "premium" : "free", cost: analysisCost });
  } catch (err) {
    await cleanupFailedCall();
    console.error("video-form-analysis error", err instanceof Error ? err.name : err);
    return json({ error: "Video analysis could not run. Please try again." }, 500);
  }
});
