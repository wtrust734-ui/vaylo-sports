import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAthleteDossier, formatDossierForPrompt } from "../_shared/athleteDossier.ts";
import { MODELS } from "../_shared/aiModels.ts";
import { languageDirective } from "../_shared/openai.ts";
import { refundCredits } from "../_shared/refund.ts";
import {
  authenticate,
  hasEntitlement,
  json,
  readJsonBody,
  spendForUser,
  throttled,
  userOwnsProduct,
  validImagePayload,
} from "../_shared/guard.ts";

// Prompt-stuffing caps — this function spends real AI budget.
const MAX_PB_ITEMS = 20;
const MAX_TEXT_LEN = 4_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Charged up-front — remembered so a failed AI call can be refunded.
  let charged = 0;
  let chargedUserId: string | null = null;

  try {
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    if (throttled(userId)) return json({ error: "Too many AI requests. Wait a moment and try again." }, 429);

    const body = await readJsonBody(req);
    if (!body) return json({ error: "Invalid JSON body" }, 400);

    const type = typeof body.type === "string" ? body.type : "";
    const userLocale = typeof body.userLocale === "string" ? body.userLocale.slice(0, 8) : undefined;
    const langDirective = languageDirective(userLocale);
    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, MAX_TEXT_LEN) : "";
    const summary = typeof body.summary === "string" ? body.summary.slice(0, MAX_TEXT_LEN) : "";
    const briefing = typeof body.briefing === "string" ? body.briefing.slice(0, MAX_TEXT_LEN) : "";
    const sport = typeof body.sport === "string" ? body.sport.slice(0, 40) : "";
    const pbs = Array.isArray(body.pbs) ? body.pbs.slice(0, MAX_PB_ITEMS) : null;

    // Images: data-URL only, image/* MIME allowlist, 8MB decoded cap.
    const image = validImagePayload(body.image_base64);

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) return json({ error: "API key not configured" }, 500);

    if (type !== "form_analysis" && type !== "calorie_scan" && type !== "stats_insight" && type !== "tactical_prep") {
      return json({ error: "Invalid type" }, 400);
    }
    if ((type === "form_analysis" || type === "calorie_scan") && !image) {
      return json({ error: "A valid image is required for this analysis (JPEG, PNG, WebP or HEIC up to 8MB)." }, 400);
    }

    // ---- Server-side charging (authoritative; honours Unlimited subscriptions) ----
    let chargeFeature: string | null = null;
    if (type === "calorie_scan") {
      // Nutrition Pack owners scan free — verified server-side, not client-side.
      chargeFeature = (await userOwnsProduct(userId, "nutrition_pack")) ? null : "calorie_scan";
    } else if (type === "tactical_prep") {
      chargeFeature = "tactical_prep";
    } else if (type === "form_analysis") {
      // Unlock-style feature: active subscription or one-off "form_analysis" purchase.
      chargeFeature = (await hasEntitlement(userId, "form_analysis")) ? null : "form_analysis";
    } // stats_insight is free — never carried a client-side cost.

    let spend: Awaited<ReturnType<typeof spendForUser>> | null = null;
    if (chargeFeature) {
      spend = await spendForUser(userId, chargeFeature, `AI ${type}`, { source: "ai-analyze" });
      if (!spend.success) {
        const shortfall = spend.shortfall ?? 0;
        return json({
          error: spend.error || `Not enough credits. You need ${spend.cost} credits — you are ${shortfall} short.`,
          shortfall,
          cost: spend.cost,
          balance: spend.balance,
        }, 402);
      }
      if (!spend.unlimited && spend.cost > 0) {
        charged = spend.cost;
        chargedUserId = userId;
      }
    }

    // ---- Authoritative dossier (PBs from client supplement DB) ----
    let dossierText = "";
    try {
      const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const dossier = await fetchAthleteDossier(serviceClient, userId, pbs);
      dossierText = formatDossierForPrompt(dossier);
    } catch (e) {
      console.error("dossier fetch failed", e);
    }

    let systemPrompt = "";
    let userContent: { type: string; text?: string; image_url?: { url: string } }[] = [];

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
        ...(image ? [{ type: "image_url", image_url: { url: image } }] : []),
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
        ...(image ? [{ type: "image_url", image_url: { url: image } }] : []),
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
        { type: "text", text: `Here is the athlete's performance data summary:\n${summary || ""}\n\nProvide a detailed performance analysis with actionable insights.` },
      ];
    } else {
      // tactical_prep
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
        { type: "text", text: `Briefing: ${briefing || prompt}\nSport hint: ${sport || "unknown"}\nGenerate the tactical JSON now.` },
      ];
    }

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELS.CHAT.MINI,
        messages: [
          { role: "system", content: systemPrompt + (langDirective ? "\n\n" + langDirective : "") },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!aiResponse.ok) {
      // Charged but nothing delivered — refund before reporting the failure.
      if (chargedUserId) {
        await refundCredits({
          supabaseUrl: Deno.env.get("SUPABASE_URL")!,
          serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          userId: chargedUserId,
          amount: charged,
          reason: `AI ${type} failed — auto refund`,
        });
        chargedUserId = null;
      }
      if (aiResponse.status === 429) {
        return json({ error: "Rate limited. Please try again in a moment." }, 429);
      }
      if (aiResponse.status === 402) {
        return json({ error: "AI credits exhausted." }, 402);
      }
      const t = await aiResponse.text();
      console.error("AI error:", aiResponse.status, t);
      return json({ error: "AI analysis failed" }, 500);
    }

    const aiData = await aiResponse.json();
    const result = aiData.choices?.[0]?.message?.content || "Analysis unavailable.";

    return json({ result, cost: spend?.cost ?? 0, balance: spend?.balance ?? null });
  } catch (err: unknown) {
    if (chargedUserId) {
      await refundCredits({
        supabaseUrl: Deno.env.get("SUPABASE_URL")!,
        serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        userId: chargedUserId,
        amount: charged,
        reason: "AI analysis failed — server error (auto refund)",
      }).catch(() => undefined);
      chargedUserId = null;
    }
    return json({ error: err instanceof Error ? err.message : "Unexpected server error" }, 500);
  }
});
