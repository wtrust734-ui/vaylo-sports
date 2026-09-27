import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { fetchAthleteDossier, formatDossierForPrompt } from "../_shared/athleteDossier.ts";
import { MODELS } from "../_shared/aiModels.ts";
import { refundCredits } from "../_shared/refund.ts";
import { languageDirective } from "../_shared/openai.ts";
import { throttled } from "../_shared/guard.ts";
import { coachVoiceDirective, familyForCoach } from "../_shared/coachVoice.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // The athlete is charged up-front; remember the charge so a failed AI call
  // (or a crash after charging) can be refunded.
  let chargedCredits = 0;
  let chargedUserId: string | null = null;
  let chargedUrl = "";

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (throttled(user.id)) {
      return new Response(JSON.stringify({ error: "Too many AI requests. Wait a moment and try again." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { messages, conversationId, pbs, userLocale } = body;
    const langDirective = languageDirective(userLocale);
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Prompt-stuffing caps: bound conversation size before it hits the model.
    if (messages.length > 40) {
      return new Response(JSON.stringify({ error: "Too many messages in one request" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    for (const m of messages) {
      const content = (m as { content?: unknown } | null)?.content;
      if (!m || typeof m !== "object" || typeof content !== "string" || content.length > 8000) {
        return new Response(JSON.stringify({ error: "Invalid message payload" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Credits — single shared deduction path
    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: spend, error: spendErr } = await supabase.rpc("credits_spend", {
      p_feature: "vaylo_coach_message",
      p_reason: "Vaylo Sports Coach prompt",
      p_source: "coach-chat",
    });
    if (spendErr) {
      return new Response(JSON.stringify({ error: spendErr.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!spend?.success) {
      return new Response(JSON.stringify({
        error: `Not enough credits. You need ${spend?.cost ?? 3} credits per prompt.`,
        shortfall: spend?.shortfall ?? null,
      }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    chargedCredits = spend?.cost ?? 3;
    chargedUserId = user.id;
    chargedUrl = supabaseUrl;

    // ---- Full athlete dossier (PBs, VPR history via metrics, goals, injuries, readiness, memories) ----
    let dossierBlock = "";
    let athleteSport: string | null = null;
    try {
      const dossier = await fetchAthleteDossier(serviceClient, user.id, Array.isArray(pbs) ? pbs : null);
      dossierBlock = formatDossierForPrompt(dossier);
      athleteSport = ((dossier?.profile as { sport?: string | null } | undefined)?.sport) ?? null;
    } catch (e) {
      console.error("dossier fetch failed", e);
      // Fallback to minimal profile if dossier fails
      const { data: profile } = await serviceClient.from("profiles").select("credits, sport, full_name, date_of_birth, weight_kg, height_cm, goals, experience_level").eq("user_id", user.id).single();
      athleteSport = profile?.sport ?? null;
      dossierBlock = `ATHLETE PROFILE:\n- Name: ${profile?.full_name || "Unknown"}\n- Sport: ${profile?.sport || "Unknown"}\n- Level: ${profile?.experience_level || "Unknown"}\n- Age: ${profile?.date_of_birth ? Math.floor((Date.now() - new Date(profile.date_of_birth).getTime()) / 31557600000) : "Unknown"}\n- Weight: ${profile?.weight_kg ? profile.weight_kg + "kg" : "Unknown"}\n- Height: ${profile?.height_cm ? profile.height_cm + "cm" : "Unknown"}\n- Goals: ${profile?.goals?.join(", ") || "Not set"}`;
    }
    const voiceDirective = coachVoiceDirective(athleteSport);

    const systemPrompt = `You are Vaylo Sports Coach — an elite high-performance sports coach AI inside the Vaylo Sports app.

BEHAVIOUR:
- Direct, honest, analytical. Never generic or motivational fluff.
- Challenge weak thinking. Ask follow-up questions.
- Give precise, actionable advice. Explain WHY.
- Short, sharp responses. Bullet points when useful.
- After every response, suggest a clear next action.
- ALWAYS tailor advice to the athlete's dossier below (sport, PBs, injuries, goals, readiness). If injured, never prescribe aggravating movements. If readiness is low, prioritize recovery.

${voiceDirective}

CAPABILITIES:
1. Training Plans — Generate detailed sessions and weekly plans with EXACT exercises, sets, reps, rest times, and RPE targets. Respect age caps in dossier (max sessions, max RPE). When creating a training plan, provide a FULL structured plan with warmup, main session, and cooldown for EACH day.
2. Technique Analysis — Sport-specific form breakdown, clear corrections
3. Performance Analysis — Identify limiting factors from VPR/metrics, suggest targeted fixes
4. Competition Strategy — Race/game planning, opponent analysis
5. Mental Coaching — Check-ins, focus tools, reframing
6. Nutrition Plans — Create detailed meal plans with macros, meal timing, and hydration targets when asked. Include specific foods, portions, and calorie counts. Never create nutrition plans for under-18 athletes — refer to professional instead.

TRAINING PLAN FORMAT (when asked to create a plan):
For each training day, provide:
- Day name and session type
- Warmup (specific exercises with sets/reps)
- Main exercises with EXACT sets × reps @ RPE, rest times, and form cues
- Cooldown (specific stretches with durations)
Example: "Back Squat: 4x8 @ RPE 7 · 90s rest — brace core, break parallel, drive through heels"

NUTRITION PLAN FORMAT (when asked to create a diet/nutrition plan):
- Daily calorie target and macro split
- Meal-by-meal breakdown with specific foods and portions
- Pre and post-workout nutrition
- Hydration targets

MEMORY INSTRUCTIONS:
When the user shares personal data (PBs, injuries, weaknesses, goals, preferences) OR when the user explicitly asks you to "remember" something, include a line at the END of your response like:
[MEMORY_SAVE: category=performance, key=800m PB, value=2:28]

Save memories when:
- User shares PBs, times, or records
- User mentions injuries or pain
- User states goals or targets  
- User shares training preferences
- User explicitly says "remember this" or "save this"
Only save important, factual data. Don't save opinions or casual remarks.

${dossierBlock}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELS.CHAT.MINI,
        messages: [
          { role: "system", content: systemPrompt + (langDirective ? "\n\n" + langDirective : "") },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      // Charged but get nothing back — refund before reporting the failure.
      if (chargedUserId) {
        await refundCredits({
          supabaseUrl: chargedUrl,
          serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          userId: chargedUserId,
          amount: chargedCredits,
          reason: "Coach reply failed — AI error (auto refund)",
        });
        chargedUserId = null;
      }
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please wait and try again." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI service payment required." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("coach error:", e);
    // Charged, then crashed before replying: give the credits back.
    if (chargedUserId) {
      await refundCredits({
        supabaseUrl: chargedUrl,
        serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        userId: chargedUserId,
        amount: chargedCredits,
        reason: "Coach reply failed — server error (auto refund)",
      });
      chargedUserId = null;
    }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
