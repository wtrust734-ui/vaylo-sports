import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAthleteDossier, formatDossierForPrompt } from "../_shared/athleteDossier.ts";
import { MODELS } from "../_shared/aiModels.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No auth" }), { status: 401, headers: corsHeaders });
    const { data: { user }, error: authError } = await serviceClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const body = await req.json();
    const { type, image_base64, prompt, summary, briefing, sport, pbs, stats_summary } = body;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) return new Response(JSON.stringify({ error: "API key not configured" }), { status: 500, headers: corsHeaders });

    // ---- Authoritative dossier (PBs from client supplement DB) ----
    let dossierText = "";
    try {
      const dossier = await fetchAthleteDossier(serviceClient, user.id, Array.isArray(pbs) ? pbs : null);
      dossierText = formatDossierForPrompt(dossier);
    } catch (e) {
      console.error("dossier fetch failed", e);
    }

    let systemPrompt = "";
    let userContent: any[] = [];

    if (type === "form_analysis") {
      systemPrompt = `You are an elite sports biomechanics and form analysis expert for Vaylo Sports. Analyze the uploaded image of an athlete and provide extremely detailed, actionable feedback. Cover:
1. POSTURE & ALIGNMENT - Spine, hip, knee, ankle alignment
2. TECHNIQUE BREAKDOWN - Sport-specific form analysis
3. COMMON ERRORS DETECTED - What could be improved
4. INJURY RISK - Potential injury risks from current form (cross-check with dossier injuries — never aggravate)
5. CORRECTION DRILLS - 3-5 specific drills to fix issues
6. OVERALL SCORE - Rate form out of 10 with justification
Be detailed, specific, and encouraging. Tailor to the athlete's sport and level from dossier. Format with clear headers and bullet points.

${dossierText}`;
      userContent = [
        { type: "text", text: prompt || "Analyze this athlete's form in detail." },
        ...(image_base64 ? [{ type: "image_url", image_url: { url: image_base64 } }] : []),
      ];
    } else if (type === "calorie_scan") {
      systemPrompt = `You are a certified sports dietitian analysing a food photo for Vaylo Sports. Accuracy matters — an athlete will log this.

WORKFLOW (follow strictly):
1. Identify every visible food/drink component (not just the main item). Note cooking method (fried, grilled, raw, etc.).
2. Estimate portion size using visual cues: plate diameter (assume 26cm dinner / 20cm side unless obvious), utensil size, hand references, packaging. Give grams for solids, ml for liquids.
3. For EACH component, look up standard USDA/CIQUAL macro density (kcal, protein, carbs, fat, fiber per 100g) and multiply by estimated grams.
4. Sum components. Round kcal to nearest 5, macros to 1 decimal.
5. If the image is ambiguous, choose the MOST LIKELY interpretation and reflect uncertainty by widening the description.

Athlete context (tailor advice, do not alter calorie math):
${dossierText}

Return ONLY valid JSON, no markdown, no prose outside JSON:
{"name":"<primary dish>","description":"<all components + estimated grams>","calories":<int>,"protein":<num>,"carbs":<num>,"fat":<num>,"fiber":<num>,"serving":"<total grams or ml>","confidence":"<low|medium|high>"}

Do NOT under-report calories on calorie-dense foods (oils, cheese, nuts, sauces, fried items). Include oil absorbed in frying (~10% of item weight). Include dressings and sauces visible on the plate.`;
      userContent = [
        { type: "text", text: "Analyse this food photo. Identify every component, estimate grams from visual cues, and return the JSON schema exactly." },
        ...(image_base64 ? [{ type: "image_url", image_url: { url: image_base64 } }] : []),
      ];
    } else if (type === "stats_insight") {
      systemPrompt = `You are an elite performance analyst for Vaylo Sports. Given the athlete's performance summary data, provide a comprehensive analysis covering:

1. TRAINING OVERVIEW - Volume, consistency, intensity patterns
2. STRENGTHS - What they're doing well
3. AREAS TO IMPROVE - Specific weaknesses identified
4. MENTAL STATE - Based on readiness and confidence data
5. RECOVERY - Sleep and recovery patterns
6. NUTRITION - Calorie and protein intake analysis
7. ACTIONABLE RECOMMENDATIONS - 3-5 specific things to do next

Use dossier to personalize (PBs, goals, injuries, readiness). Be direct, analytical, and sport-specific. Use bullet points. No generic motivation.

${dossierText}`;
      userContent = [
        { type: "text", text: `Here is the athlete's performance data summary:\n${summary ?? stats_summary ?? ""}\n\nProvide a detailed performance analysis with actionable insights.` },
      ];
    } else if (type === "tactical_prep") {
      systemPrompt = `You are an elite tactical analyst for Vaylo Sports. Given the athlete's briefing and dossier, produce a concise tactical plan as JSON:
{"priorities":["..."],"warmup":"...","mindset":"...","adjustments":"...","risks":"..."}
- priorities: 4-6 bullet priorities, sport-specific and opponent-aware
- warmup: 2-3 sentence warmup customization
- mindset: 1-2 sentence psychological cue
- adjustments: training tweaks for 48h before
- risks: key risks / plan B
Tailor to dossier sport/position, do not contradict injuries. Be direct, no fluff.

${dossierText}`;
      userContent = [
        { type: "text", text: `Briefing: ${briefing || prompt || ""}\nSport hint: ${sport || "unknown"}\nGenerate the tactical JSON now.` },
      ];
    } else {
      return new Response(JSON.stringify({ error: "Invalid type" }), { status: 400, headers: corsHeaders });
    }

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELS.CHAT.MINI,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const t = await aiResponse.text();
      console.error("AI error:", aiResponse.status, t);
      return new Response(JSON.stringify({ error: "AI analysis failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await aiResponse.json();
    const result = aiData.choices?.[0]?.message?.content || "Analysis unavailable.";

    return new Response(JSON.stringify({ result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
