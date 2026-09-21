import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { fetchAthleteDossier, formatDossierForPrompt, getAgeCaps } from "../_shared/athleteDossier.ts";
import { MODELS } from "../_shared/aiModels.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

    const body = await req.json();
    const { sport, goal, level, duration_weeks, age, quiz, pbs } = body;
    if (!sport || !goal || !level || !duration_weeks) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Authoritative dossier (if caller is authenticated) ----
    let dossierText = "";
    let serverCaps: ReturnType<typeof getAgeCaps> | null = null;
    try {
      const authHeader = req.headers.get("Authorization") || "";
      if (authHeader) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const userClient = createClient(supabaseUrl, anon, { global: { headers: { Authorization: authHeader } } });
        const { data: { user } } = await userClient.auth.getUser();
        if (user) {
          const serviceClient = createClient(supabaseUrl, serviceKey);
          const dossier: any = await fetchAthleteDossier(serviceClient, user.id, Array.isArray(pbs) ? pbs : null);
          dossierText = formatDossierForPrompt(dossier);
          serverCaps = (dossier as any)?.profile?.ageCaps ?? null;
        }
      }
    } catch (_e) {
      // dossier is best-effort; don't block plan generation
    }

    // ---- Enforce age caps server-side (never trust client) ----
    const ageNum = typeof age === "number" ? age : parseInt(String(age)) || null;
    const caps = getAgeCaps(ageNum);
    // If server derived caps differ (e.g. DOB vs supplied age), prefer the stricter
    const effectiveCaps = serverCaps
      ? {
          maxSessionsPerWeek: Math.min(caps.maxSessionsPerWeek, serverCaps.maxSessionsPerWeek),
          maxMinutesPerSession: Math.min(caps.maxMinutesPerSession, serverCaps.maxMinutesPerSession),
          maxRPE: Math.min(caps.maxRPE, serverCaps.maxRPE),
          minRestDays: Math.max(caps.minRestDays, serverCaps.minRestDays),
          deloadEvery: Math.min(caps.deloadEvery, serverCaps.deloadEvery),
          youth: caps.youth || serverCaps.youth,
        }
      : caps;

    // Clamp quiz availability if present
    let safeQuiz: any = quiz || {};
    if (typeof safeQuiz.daysPerWeek === "number") {
      const maxDays = Math.min(effectiveCaps.maxSessionsPerWeek, Math.max(1, 7 - effectiveCaps.minRestDays));
      safeQuiz = { ...safeQuiz, daysPerWeek: Math.min(safeQuiz.daysPerWeek, maxDays) };
    }
    if (typeof safeQuiz.hoursPerWeek === "number" && typeof safeQuiz.daysPerWeek === "number") {
      const maxHours = (safeQuiz.daysPerWeek * effectiveCaps.maxMinutesPerSession) / 60;
      safeQuiz = { ...safeQuiz, hoursPerWeek: Math.min(safeQuiz.hoursPerWeek, maxHours) };
    }

    const ageGuidance = !ageNum ? "" : ageNum < 13
      ? `CRITICAL AGE SAFETY (${ageNum}y — child): NO 1RM lifts, NO max-effort plyometrics, NO adult loading. Bodyweight & technique focus. Max 45-min sessions. Mandatory rest days ≥2/wk. Emphasise multi-sport play & motor skills. No supplementation cues. All exercises must be child-safe.`
      : ageNum < 16
      ? `AGE SAFETY (${ageNum}y — youth): Sub-maximal loading only (≤70% projected 1RM). No heavy singles. Emphasise technique, mobility, coordination. Cap intensity RPE ≤ 8. Max 60-min sessions. Two full rest days per week. No fasted training cues.`
      : ageNum < 18
      ? `AGE SAFETY (${ageNum}y — late-teen): Progressive loading OK but no maximal singles. Cap heavy work RPE ≤ 9. At least one full rest day per week. Sleep & nutrition cues framed for developing athletes.`
      : ageNum >= 60
      ? `AGE SAFETY (${ageNum}y — masters): Joint-friendly progressions, longer warm-ups (≥12 min), mobility every session, reduce plyometric volume, cap heavy work RPE ≤ 8, extra recovery day, prioritise tendon health.`
      : ageNum >= 45
      ? `AGE ADAPTATION (${ageNum}y): Slightly extended warm-up, protect tendons/joints, cap heavy singles, ensure ≥1 full rest day/wk.`
      : `AGE (${ageNum}y — adult): Standard adult loading appropriate. Respect user's stated level.`;

    const capsLine = `HARD CAPS (enforced): max ${effectiveCaps.maxSessionsPerWeek} sessions/week, max ${effectiveCaps.maxMinutesPerSession} min/session, RPE ≤${effectiveCaps.maxRPE}, ≥${effectiveCaps.minRestDays} rest days/week, deload every ${effectiveCaps.deloadEvery} weeks. Do NOT exceed these caps even if the quiz asks for more.`;

    const system = `You are an elite sports coach generating structured training plans.
${ageGuidance}
${capsLine}
${dossierText ? `\n${dossierText}\n— Use the dossier to tailor volume, focus and exercise selection to THIS athlete (PBs, injuries, goals, recovery). Avoid movements that aggravate listed injuries.` : ""}
Return ONLY valid JSON matching this exact schema (no markdown, no prose):
{
  "weeks": [
    {
      "week": <number>,
      "isDeload": <boolean>,
      "isHoliday": false,
      "sessions": [
        {
          "day": <1-7>,
          "dayName": "<Monday..Sunday>",
          "title": "<session title>",
          "type": "<strength|endurance|speed|intervals|recovery|rest|sport_specific|power|cross_training|conditioning>",
          "duration_minutes": <number, 0 if rest>,
          "description": "<one sentence>",
          "warmup": [{"name":"<exercise>","sets":"<sets/reps/notes>"}],
          "exercises": [{"name":"<exercise>","sets":"<sets x reps @ RPE, rest, cues>"}],
          "cooldown": [{"name":"<exercise>","sets":"<duration/notes>"}],
          "skipped": false,
          "isRest": <boolean>,
          "isRecovery": <boolean>
        }
      ]
    }
  ]
}
Rules: exactly ${duration_weeks} weeks, each week has exactly 7 days (Mon-Sun). Every 4th week is a deload (every ${effectiveCaps.deloadEvery}th for youth/masters). Rest days have empty warmup/exercises/cooldown (just a note in exercises) and duration_minutes=0. Every prescribed exercise MUST be safe for the athlete's chronological age and caps above.`;

    const user = `Generate a ${duration_weeks}-week ${goal} plan for ${sport} (level: ${level}, age: ${age ?? "unknown"}).
Availability Quiz (already capped to age-safe limits): ${JSON.stringify(safeQuiz || {})}
${dossierText ? `Athlete dossier already in system prompt — do not ask for it again.` : ""}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELS.CHAT.PRIMARY,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limited. Try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "AI generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = typeof content === "string" ? JSON.parse(content) : content; }
    catch { return new Response(JSON.stringify({ error: "AI returned invalid JSON" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

    const weeks = Array.isArray(parsed?.weeks) ? parsed.weeks : [];
    return new Response(JSON.stringify({ plan_data: weeks }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-plan error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
