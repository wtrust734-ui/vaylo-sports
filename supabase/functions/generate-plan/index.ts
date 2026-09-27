import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { fetchAthleteDossier, formatDossierForPrompt, getAgeCaps } from "../_shared/athleteDossier.ts";
import { MODELS } from "../_shared/aiModels.ts";
import { languageDirective } from "../_shared/openai.ts";
import { refundCredits } from "../_shared/refund.ts";
import { authenticate, json, readJsonBody, spendForUser, throttled } from "../_shared/guard.ts";

// Prompt-stuffing caps — this function spends real AI budget.
const MAX_PB_ITEMS = 20;
const MAX_GOAL_LEN = 300;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Charged up-front — remembered so a failed AI call can be refunded.
  let charged = 0;
  let chargedUserId: string | null = null;

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

    // Auth is mandatory: unauthenticated callers must never reach the model.
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    if (throttled(userId)) return json({ error: "Too many AI requests. Wait a moment and try again." }, 429);

    const body = await readJsonBody(req);
    if (!body) return json({ error: "Invalid JSON body" }, 400);

    const sport = typeof body.sport === "string" ? body.sport.slice(0, 60) : "";
    const goal = typeof body.goal === "string" ? body.goal.slice(0, MAX_GOAL_LEN) : "";
    const level = typeof body.level === "string" ? body.level.slice(0, 40) : "";
    const userLocale = typeof body.userLocale === "string" ? body.userLocale.slice(0, 8) : undefined;
    const duration = Math.floor(Number(body.duration_weeks));
    const ageRaw = typeof body.age === "number" ? body.age : parseInt(String(body.age ?? ""), 10);
    const age = Number.isFinite(ageRaw) && ageRaw > 0 && ageRaw < 120 ? ageRaw : null;
    const quiz = body.quiz && typeof body.quiz === "object" && !Array.isArray(body.quiz) ? body.quiz : {};
    const pbs = Array.isArray(body.pbs) ? body.pbs.slice(0, MAX_PB_ITEMS) : null;

    if (!sport || !goal || !level || !duration) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (duration < 1 || duration > 52) {
      return json({ error: "Plan length must be between 1 and 52 weeks" }, 400);
    }

    // ---- Server-side charge (authoritative; honours Unlimited subscriptions) ----
    const spend = await spendForUser(userId, "training_plan_week", `Training plan: ${goal} (${duration}w)`, {
      quantity: duration,
      source: "generate-plan",
    });
    if (!spend.success) {
      return json({
        error: spend.error || `Not enough credits. You need ${spend.cost} credits — you are ${spend.shortfall ?? 0} short.`,
        shortfall: spend.shortfall ?? null,
        cost: spend.cost,
        balance: spend.balance,
      }, 402);
    }
    if (!spend.unlimited && spend.cost > 0) {
      charged = spend.cost;
      chargedUserId = userId;
    }

    // ---- Authoritative dossier (PBs from client supplement DB) ----
    let dossierText = "";
    let serverCaps: ReturnType<typeof getAgeCaps> | null = null;
    try {
      const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const dossier: Record<string, any> = await fetchAthleteDossier(serviceClient, userId, pbs);
      dossierText = formatDossierForPrompt(dossier);
      serverCaps = dossier?.profile?.ageCaps ?? null;
    } catch (_e) {
      // dossier is best-effort; don't block plan generation
    }

    // ---- Enforce age caps server-side (never trust client) ----
    const caps = getAgeCaps(age);
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
    let safeQuiz: Record<string, any> = { ...quiz };
    if (typeof safeQuiz.daysPerWeek === "number") {
      const maxDays = Math.min(effectiveCaps.maxSessionsPerWeek, Math.max(1, 7 - effectiveCaps.minRestDays));
      safeQuiz = { ...safeQuiz, daysPerWeek: Math.min(safeQuiz.daysPerWeek, maxDays) };
    }
    if (typeof safeQuiz.hoursPerWeek === "number" && typeof safeQuiz.daysPerWeek === "number") {
      const maxHours = (safeQuiz.daysPerWeek * effectiveCaps.maxMinutesPerSession) / 60;
      safeQuiz = { ...safeQuiz, hoursPerWeek: Math.min(safeQuiz.hoursPerWeek, maxHours) };
    }

    const langBase = languageDirective(userLocale);
    const langDirective = langBase ? `${langBase} Keep the JSON schema keys exactly as specified. Keep RPE abbreviations unchanged.` : "";

    const ageGuidance = !age ? "" : age < 13
      ? `CRITICAL AGE SAFETY (${age}y — child): NO 1RM lifts, NO max-effort plyometrics, NO adult loading. Bodyweight & technique focus. Max 45-min sessions. Mandatory rest days ≥2/wk. Emphasise multi-sport play & motor skills. No supplementation cues. All exercises must be child-safe.`
      : age < 16
      ? `AGE SAFETY (${age}y — youth): Sub-maximal loading only (≤70% projected 1RM). No heavy singles. Emphasise technique, mobility, coordination. Cap intensity RPE ≤ 8. Max 60-min sessions. Two full rest days per week. No fasted training cues.`
      : age < 18
      ? `AGE SAFETY (${age}y — late-teen): Progressive loading OK but no maximal singles. Cap heavy work RPE ≤ 9. At least one full rest day per week. Sleep & nutrition cues framed for developing athletes.`
      : age >= 60
      ? `AGE SAFETY (${age}y — masters): Joint-friendly progressions, longer warm-ups (≥12 min), mobility every session, reduce plyometric volume, cap heavy work RPE ≤ 8, extra recovery day, prioritise tendon health.`
      : age >= 45
      ? `AGE ADAPTATION (${age}y): Slightly extended warm-up, protect tendons/joints, cap heavy singles, ensure ≥1 full rest day/wk.`
      : `AGE (${age}y — adult): Standard adult loading appropriate. Respect user's stated level.`;

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
Rules: exactly ${duration} weeks, each week has exactly 7 days (Mon-Sun). Every 4th week is a deload (every ${effectiveCaps.deloadEvery}th for youth/masters). Rest days have empty warmup/exercises/cooldown (just a note in exercises) and duration_minutes=0. Every prescribed exercise MUST be safe for the athlete's chronological age and caps above.`;

    const user = `Generate a ${duration}-week ${goal} plan for ${sport} (level: ${level}, age: ${age ?? "unknown"}).
Availability Quiz (already capped to age-safe limits): ${JSON.stringify(safeQuiz)}
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
          { role: "system", content: system + (langDirective ? "\n\n" + langDirective : "") },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      // Charged but nothing delivered — refund before reporting the failure.
      if (chargedUserId) {
        await refundCredits({
          supabaseUrl: Deno.env.get("SUPABASE_URL")!,
          serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          userId: chargedUserId,
          amount: charged,
          reason: "Training plan failed — AI error (auto refund)",
        });
        chargedUserId = null;
      }
      if (response.status === 429) return json({ error: "Rate limited. Try again shortly." }, 429);
      if (response.status === 402) return json({ error: "AI credits exhausted." }, 402);
      return json({ error: "AI generation failed" }, 500);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = typeof content === "string" ? JSON.parse(content) : content; }
    catch {
      await refundAndReset();
      return json({ error: "AI returned invalid JSON" }, 502);
    }

    const weeks = Array.isArray(parsed?.weeks) ? parsed.weeks : [];
    if (weeks.length === 0) {
      await refundAndReset();
      return json({ error: "AI returned an empty plan" }, 502);
    }

    return json({ plan_data: weeks, cost: spend.cost, balance: spend.balance });
  } catch (e) {
    console.error("generate-plan error:", e);
    await refundAndReset();
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }

  async function refundAndReset() {
    if (chargedUserId) {
      await refundCredits({
        supabaseUrl: Deno.env.get("SUPABASE_URL")!,
        serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        userId: chargedUserId,
        amount: charged,
        reason: "Training plan failed — server error (auto refund)",
      });
      chargedUserId = null;
    }
  }
});
