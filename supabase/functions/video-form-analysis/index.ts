import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAthleteDossier, formatDossierForPrompt } from "../_shared/athleteDossier.ts";
import { languageDirective } from "../_shared/openai.ts";
import { throttled } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Gemini models: Flash for free tier, Pro for premium
const FLASH_MODEL = "gemini-3.8-flash";
const PRO_MODEL = "gemini-3.1-pro-preview";

const MAX_BYTES = 18 * 1024 * 1024; // ~18MB inline video limit
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

  try {
    const GOOGLE_API = Deno.env.get("GOOGLE_API");
    if (!GOOGLE_API) return json({ error: "Video analysis is not configured." }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Unauthorized" }, 401);
    if (throttled(user.id)) return json({ error: "Too many requests. Wait a moment and try again." }, 429);

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: "Invalid request body" }, 400);

    const { video_base64, mime_type, sport_type, video_name, save, pbs, userLocale } = body as {
      video_base64?: unknown;
      mime_type?: unknown;
      sport_type?: unknown;
      video_name?: unknown;
      save?: unknown;
      pbs?: unknown;
      userLocale?: unknown;
    };
    const langDirective = languageDirective(typeof userLocale === "string" ? userLocale : undefined);

    if (typeof video_base64 !== "string" || video_base64.length < 100)
      return json({ error: "No video received. Please upload an MP4 or MOV file." }, 400);
    if (typeof mime_type !== "string" || !ALLOWED_MIME.includes(mime_type))
      return json({ error: "Unsupported video format. Please upload an MP4, MOV or WebM file." }, 400);

    const base64 = video_base64.includes(",") ? video_base64.split(",")[1] : video_base64;
    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes > MAX_BYTES)
      return json({ error: "Video is too large. Please upload a clip under 18MB (5–15 seconds is ideal)." }, 413);

    const sport = typeof sport_type === "string" && sport_type.length <= 40 ? sport_type : "general";

    // ---- Tier check: free = 1 analysis / 7 days on Flash, premium = unlimited on Pro ----
    const { data: sub } = await admin
      .from("subscriptions")
      .select("plan_type, status, is_lifetime, unlimited_credits")
      .eq("user_id", user.id)
      .maybeSingle();

    // Premium = any active subscription (incl. trial, lifetime, Unlimited Plan).
    // Deliberately does NOT depend on plan_type — Unlimited/lifetime rows carry
    // no legacy tier name but still include video analysis.
    const isPremium =
      sub?.is_lifetime === true ||
      sub?.unlimited_credits === true ||
      sub?.status === "active" ||
      sub?.status === "trial";

    if (!isPremium) {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { count } = await admin
        .from("video_form_analyses")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", weekAgo);
      if ((count ?? 0) >= 1) {
        return json(
          {
            error: "Free plan includes 1 video analysis per week. Upgrade for unlimited analyses.",
            limit_reached: true,
          },
          429,
        );
      }
    }

    const model = isPremium ? PRO_MODEL : FLASH_MODEL;

    // ---- Athlete dossier for context-aware feedback ----
    let dossierText = "";
    try {
      const dossier = await fetchAthleteDossier(admin, user.id, Array.isArray(pbs) ? pbs : null);
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

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: `${ANALYSIS_PROMPT}\n\n${sportContext}${dossierBlock}${langDirective ? "\n\n" + langDirective : ""}` },
                { inlineData: { mimeType: mime_type, data: base64 } },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      },
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini video analysis failed", geminiRes.status, errText);
      if (geminiRes.status === 429)
        return json({ error: "Analysis service is busy. Please try again in a moment." }, 429);
      if (geminiRes.status === 400)
        return json({ error: "That video couldn't be analysed. Try a shorter, clearer clip." }, 400);
      return json({ error: "Video analysis failed. Please try again.", status: geminiRes.status }, 502);
    }

    const data = await geminiRes.json();
    const parts = (data?.candidates?.[0]?.content?.parts ?? []) as { text?: string }[];
    const text = parts.map((p) => p.text ?? "").join("") ?? "";
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(text);
    } catch {
      console.error("Unparsable Gemini response", text.slice(0, 500));
      return json({ error: "The analysis came back malformed. Please try again." }, 502);
    }

    const score = Math.max(0, Math.min(100, Number(result?.overall_score) || 0));
    result.overall_score = score;

    let saved_id: string | null = null;
    const shouldSave = save !== false;
    const { data: inserted, error: insertError } = await admin
      .from("video_form_analyses")
      .insert({
        user_id: user.id,
        sport_type: sport,
        video_name: typeof video_name === "string" ? video_name.slice(0, 120) : null,
        model_used: model,
        overall_score: score,
        result,
        saved: shouldSave,
      })
      .select("id")
      .maybeSingle();
    if (insertError) console.error("Failed to record analysis", insertError.message);
    else saved_id = inserted?.id ?? null;

    return json({ result, model, saved_id, tier: isPremium ? "premium" : "free" });
  } catch (err) {
    console.error("video-form-analysis error", err);
    return json({ error: (err as Error).message || "Unexpected error" }, 500);
  }
});
