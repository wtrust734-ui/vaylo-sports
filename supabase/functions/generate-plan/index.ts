import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { fetchAthleteDossier, formatDossierForPrompt, getAgeCaps } from "../_shared/athleteDossier.ts";
import { MODELS } from "../_shared/aiModels.ts";
import { languageDirective } from "../_shared/openai.ts";
import { terminologyDirective } from "../_shared/terminology.ts";
import { refundCredits } from "../_shared/refund.ts";
import { aiCallAllowed, authenticate, json, readJsonBody, spendForUser, throttled } from "../_shared/guard.ts";
import { coachVoiceDirective } from "../_shared/coachVoice.ts";
import { equipmentDirective, normaliseEquipment, type EquipmentId } from "../_shared/equipment.ts";
import {
  buildWeekSkeleton,
  chunkSkeleton,
  planChunkWeeks,
  skeletonContinuityNote,
  skeletonTargetLines,
  type WeekSkeleton,
} from "../_shared/planPeriodisation.ts";

// Prompt-stuffing caps — this function spends real AI budget.
const MAX_PB_ITEMS = 20;
const MAX_GOAL_LEN = 300;
const MAX_BREAKS = 6;

/**
 * What the app knows about the athlete's breaks, as the client sent it.
 *
 * Sanitised like every other field here: it is attacker-controlled text that
 * ends up inside a prompt. The numbers are NOT trusted for any decision — the
 * app applies them to the stored plan itself, deterministically, after this
 * function returns. They are passed only so the model can choose sensible
 * sessions for a week it knows will be shortened.
 */
interface BreakBrief {
  label: string;
  from: string;
  to: string;
  days: number;
  activityLevel: string;
}

interface ReturnBrief {
  days: number;
  eventType: string;
  weeks: { volumePct: number; intensityPct: number }[];
}

const text = (value: unknown, max: number, fallback = ""): string =>
  typeof value === "string" && value.length <= 200 ? value.slice(0, max) : fallback;

const whole = (value: unknown, max: number): number => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
};

const readBreakBrief = (raw: unknown): BreakBrief[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object" && !Array.isArray(b))
    .slice(0, MAX_BREAKS)
    .map((b) => ({
      label: text(b.label, 40, "break"),
      from: text(b.from, 10),
      to: text(b.to, 10),
      days: whole(b.days, 730),
      activityLevel: text(b.activityLevel, 12, "unknown"),
    }))
    .filter((b) => b.days > 0);
};

const readReturnBrief = (raw: unknown): ReturnBrief[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
    .slice(0, 1)
    .map((r) => ({
      days: whole(r.days, 730),
      eventType: text(r.eventType, 20, "a break"),
      weeks: (Array.isArray(r.weeks) ? r.weeks : [])
        .filter((w): w is Record<string, unknown> => !!w && typeof w === "object" && !Array.isArray(w))
        .slice(0, 5)
        .map((w) => ({
          volumePct: Math.max(20, Math.min(100, whole(w.volumePct, 100))),
          intensityPct: Math.max(20, Math.min(100, whole(w.intensityPct, 100))),
        })),
    }))
    .filter((r) => r.days > 0);
};

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
  // The charge's idempotency key; the refund derives `refund:<charge key>`.
  let chargedKey: string | undefined = undefined;

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

    // Auth is mandatory: unauthenticated callers must never reach the model.
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    if (throttled(userId)) return json({ error: "Too many AI requests. Wait a moment and try again." }, 429);
    if (!(await aiCallAllowed(req, userId, "generate-plan", { max: 15, windowSeconds: 60 }))) {
      return json({ error: "Too many AI requests. Wait a moment and try again." }, 429);
    }

    const body = await readJsonBody(req);
    if (!body) return json({ error: "Invalid JSON body" }, 400);

    const sport = typeof body.sport === "string" ? body.sport.slice(0, 60) : "";
    const goal = typeof body.goal === "string" ? body.goal.slice(0, MAX_GOAL_LEN) : "";
    const level = typeof body.level === "string" ? body.level.slice(0, 40) : "";
    const userLocale = typeof body.userLocale === "string" ? body.userLocale.slice(0, 8) : undefined;
    // Prompt 9: the athlete's selected country. terminologyDirective validates
    // it strictly (two-letter code, known region) and expands it into static
    // text — the client never authors prompt content.
    const userRegion = typeof body.userRegion === "string" ? body.userRegion : undefined;
    const duration = Math.floor(Number(body.duration_weeks));
    const ageRaw = typeof body.age === "number" ? body.age : parseInt(String(body.age ?? ""), 10);
    const age = Number.isFinite(ageRaw) && ageRaw > 0 && ageRaw < 120 ? ageRaw : null;
    const quiz = body.quiz && typeof body.quiz === "object" && !Array.isArray(body.quiz) ? body.quiz : {};
    const pbs = Array.isArray(body.pbs) ? body.pbs.slice(0, MAX_PB_ITEMS) : null;
    const breaks = readBreakBrief(body.breaks);
    const returns = readReturnBrief(body.returns);

    if (!sport || !goal || !level || !duration) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (duration < 1 || duration > 52) {
      return json({ error: "Plan length must be between 1 and 52 weeks" }, 400);
    }

    // ---- Server-side charge (authoritative; honours Unlimited subscriptions) ----
    const spend = await spendForUser(req, userId, "training_plan_week", `Training plan: ${goal} (${duration}w)`, {
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
      chargedKey = spend.idempotencyKey;
    }

    // ---- Authoritative dossier (PBs from client supplement DB) ----
    let dossierText = "";
    let serverCaps: ReturnType<typeof getAgeCaps> | null = null;
    // Equipment saved on the profile at signup, read server-side. Preferred over
    // whatever the client sent, because the client value is attacker-controlled
    // and the stored one is the answer the athlete actually gave.
    let profileEquipment: EquipmentId[] = [];
    try {
      const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const dossier: Record<string, unknown> = await fetchAthleteDossier(serviceClient, userId, pbs);
      dossierText = formatDossierForPrompt(dossier);
      serverCaps = ((dossier?.profile as { ageCaps?: ReturnType<typeof getAgeCaps> } | null)?.ageCaps) ?? null;

      // extended_profile is not part of the dossier's column list, so it is read
      // separately. Best-effort: a failure here falls back to the quiz value
      // rather than blocking a plan the athlete has already paid for.
      const { data: profileRow } = await serviceClient
        .from("profiles")
        .select("extended_profile")
        .eq("user_id", userId)
        .maybeSingle();
      const extended = (profileRow?.extended_profile ?? null) as Record<string, unknown> | null;
      profileEquipment = normaliseEquipment(extended?.equipment);
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
    let safeQuiz: Record<string, unknown> = { ...(quiz as Record<string, unknown> | undefined) };
    if (typeof safeQuiz.daysPerWeek === "number") {
      const maxDays = Math.min(effectiveCaps.maxSessionsPerWeek, Math.max(1, 7 - effectiveCaps.minRestDays));
      safeQuiz = { ...safeQuiz, daysPerWeek: Math.min(safeQuiz.daysPerWeek, maxDays) };
    }
    if (typeof safeQuiz.hoursPerWeek === "number" && typeof safeQuiz.daysPerWeek === "number") {
      const maxHours = (safeQuiz.daysPerWeek * effectiveCaps.maxMinutesPerSession) / 60;
      safeQuiz = { ...safeQuiz, hoursPerWeek: Math.min(safeQuiz.hoursPerWeek, maxHours) };
    }

    // Equipment: the profile answer wins when present, otherwise the quiz
    // answer from this plan-creation flow. "none" in either place is treated as
    // no equipment by equipmentDirective().
    const quizEquipment = normaliseEquipment((safeQuiz as Record<string, unknown>).equipment);
    const equipment = profileEquipment.length ? profileEquipment : quizEquipment;
    const equipmentLine = equipmentDirective(equipment);

    const langBase = languageDirective(userLocale);
    const langDirective = langBase ? `${langBase} Keep the JSON schema keys exactly as specified. Keep RPE abbreviations unchanged.` : "";
    // Regional terminology rides alongside the language directive, never
    // replacing it: structure and prices are unchanged, only naming/units.
    const regionDirective = terminologyDirective(userRegion);

    const ageGuidance = !age ? "" : age < 13
      ? `CRITICAL UNDER-18 SAFETY (${age}y): NO 1RM lifts, NO max-effort plyometrics, NO adult loading. Bodyweight & technique focus. Max 45-min sessions. Mandatory rest days ≥2/wk. Emphasise multi-sport play & motor skills. No supplementation cues. Every exercise must be safe for an athlete of this age.`
      : age < 16
      ? `UNDER-18 SAFETY (${age}y): Sub-maximal loading only (≤70% projected 1RM). No heavy singles. Emphasise technique, mobility, coordination. Cap intensity RPE ≤ 8. Max 60-min sessions. Two full rest days per week. No fasted training cues.`
      : age < 18
      ? `UNDER-18 SAFETY (${age}y): Progressive loading OK but no maximal singles. Cap heavy work RPE ≤ 9. At least one full rest day per week. Sleep & nutrition cues framed for an athlete who is still developing.`
      : age >= 60
      ? `AGE SAFETY (${age}y — masters): Joint-friendly progressions, longer warm-ups (≥12 min), mobility every session, reduce plyometric volume, cap heavy work RPE ≤ 8, extra recovery day, prioritise tendon health.`
      : age >= 45
      ? `AGE ADAPTATION (${age}y): Slightly extended warm-up, protect tendons/joints, cap heavy singles, ensure ≥1 full rest day/wk.`
      : `AGE (${age}y — adult): Standard adult loading appropriate. Respect user's stated level.`;

    const capsLine = `HARD CAPS (enforced): max ${effectiveCaps.maxSessionsPerWeek} sessions/week, max ${effectiveCaps.maxMinutesPerSession} min/session, RPE ≤${effectiveCaps.maxRPE}, ≥${effectiveCaps.minRestDays} rest days/week, deload every ${effectiveCaps.deloadEvery} weeks. Do NOT exceed these caps even if the quiz asks for more.`;

    // Family voice: the plan structure adapts to what the sport demands.
    const voiceDirective = coachVoiceDirective(sport);

    // Breaks the athlete has told the app about. Their sessions will be cancelled
    // by the availability layer, so the model does not need to plan around the
    // dates — it needs to know not to write a plan that assumes the athlete is
    // fully fit the morning they get back.
    const breakLine = breaks.length
      ? `BREAKS ON RECORD (from the athlete's own availability): ${breaks
          .map((b) => `${b.label} ${b.from} to ${b.to} (${b.days} days away, activity: ${b.activityLevel})`)
          .join("; ")}. Sessions inside those dates are cancelled by the app — do not plan make-up work for them, and do not compress them into the days after.`
      : "";

    // The return-from-break progression, computed by the app from the same rules
    // it rebuilds stored plans with. Stated here so the model picks sessions that
    // make sense *inside* a shortened, downgraded week — and explicitly handed
    // to the app to apply, so the model never has to do the arithmetic itself.
    const returnLine = returns.length
      ? `RETURNING FROM A BREAK: ${returns[0].days} days away (${returns[0].eventType}). The app scales the numbers itself — ${
          returns[0].weeks.length
            ? returns[0].weeks.map((w, i) => `week ${i + 1} back at ~${w.volumePct}% volume, intensity capped at ${w.intensityPct}%`).join("; ")
            : "the first weeks back are reduced"
        }. Write the plan for the athlete's normal level and do NOT reduce volume or intensity yourself, do NOT add make-up sessions for the missed days, and do NOT schedule a testing week. Make week 1 back easy to shorten: technique, aerobic work, short sessions, nothing maximal.`
      : "";

    const system = `You are an elite sports coach generating structured training plans.\nTHE INTENDED VAYLO SPORTS ATHLETE IS AN ADULT AGED 18–30, from a developing athlete through a serious, competitive one. Never assume or imply the athlete is younger, and never address them as a child, a teenager or a junior. The safety bands below apply only when the athlete's own date of birth puts them outside that range.
${ageGuidance}
${capsLine}
${equipmentLine}
${voiceDirective}
${breakLine}
${returnLine}
${dossierText ? `\n${dossierText}\n— Use the dossier to tailor volume, focus and exercise selection to THIS athlete (PBs, injuries, goals, recovery). Avoid movements that aggravate listed injuries.\n\nAny \`sessionLoads\` in the dossier are sport-specific load figures the app computed from the athlete's own logged sessions — an hour of swimming is NOT an hour of running in those numbers, and a field/court match is worth more than the same time training. Where recovery data is thin, write for the athlete's normal week. Never state a probability of injury or illness, never diagnose, and never claim the plan prevents anything: the only permitted register is "their recent load and recovery indicators suggest that X may be appropriate".` : ""}
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
Rules: exactly ${duration} weeks, each week has exactly 7 days (Mon-Sun). Every 4th week is a deload (on the tighter ${effectiveCaps.deloadEvery}-week cycle, which the caps set for an under-18 or masters athlete). Rest days have empty warmup/exercises/cooldown (just a note in exercises) and duration_minutes=0. Every prescribed exercise MUST be safe for the athlete's chronological age and caps above.`;

    const user = `Generate a ${duration}-week ${goal} plan for ${sport} (level: ${level}, age: ${age ?? "unknown"}).
Availability Quiz (already capped to age-safe limits): ${JSON.stringify(safeQuiz)}
Equipment available to this athlete: ${equipment.length ? equipment.join(", ") : "none recorded — bodyweight and space only"}
${dossierText ? `Athlete dossier already in system prompt — do not ask for it again.` : ""}`;

    // ---- Periodisation is the app's, and the weeks are written in parallel ----
    //
    // This used to be one call for the whole plan: a 12-week plan asked the
    // model for roughly 23k completion tokens in a single response, which is why
    // an athlete waited minutes. Wall-clock time for one call is the plan's own
    // text (measured: ~27s for a one-week response, ~55s for a two-week one), so
    // the fix is many small calls in flight rather than one long one — the total
    // is then the slowest call, not the sum.
    //
    // The shape of the plan is NOT left to those calls. `buildWeekSkeleton`
    // decides here which weeks are deloads, what each block is for and how
    // volume and intensity progress (pure, unit-tested in
    // src/lib/planPeriodisation.test.ts), every chunk is shown the whole
    // progression and told which slice is its own, and the merged plan comes
    // back with `isDeload` stamped from the skeleton — so a plan cannot ramp for
    // three weeks and then flatten because the model forgot what it wrote.
    const skeleton = buildWeekSkeleton({
      duration,
      deloadEvery: effectiveCaps.deloadEvery,
      level,
      // The athlete's own answer, already clamped to the age caps above.
      sessionsPerWeek: whole((safeQuiz as Record<string, unknown>).daysPerWeek, 7) || 4,
    });
    const chunks = chunkSkeleton(skeleton, planChunkWeeks(duration));

    /**
     * One chunk's weeks, from one provider call.
     *
     * Throws on a provider error, a rate limit or unparseable JSON so the caller
     * can refund once and report the same failure it always reported — the
     * charge/refund bookkeeping above is deliberately untouched by this change.
     */
    const writeChunk = async (own: WeekSkeleton[]): Promise<Record<string, unknown>[]> => {
      const first = own[0].week;
      const last = own[own.length - 1].week;
      const chunkSystem = `${system}

YOUR SLICE OF THIS REQUEST: write ONLY weeks ${first} to ${last} of the plan — ${own.length} week${own.length === 1 ? "" : "s"}. The sentence above saying "exactly ${duration} weeks" describes the whole plan; the JSON you return carries only your own weeks in its \`weeks\` array, and writing any other week is an error. Position your weeks against the targets and the continuity note below rather than against the weeks you did not write.

WEEK TARGETS FOR THE WHOLE PLAN (computed by the app, not by you):
${skeletonTargetLines(skeleton, own)}

${skeletonContinuityNote(own, skeleton)}`;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODELS.CHAT.MINI,
          messages: [
            { role: "system", content: chunkSystem + (langDirective ? "\n\n" + langDirective : "") + (regionDirective ? "\n\n" + regionDirective : "") },
            // `user` first (the athlete, quiz and equipment), then the week range
            // and the targets, so the request ends on what to write.
            { role: "user", content: `${user}\n\nWrite exactly weeks ${first} to ${last} (${own.length} week${own.length === 1 ? "" : "s"}), in the schema above, and nothing else.` },
          ],
          response_format: { type: "json_object" },
          // Output budget scales with the CHUNK, not the plan: measured need is
          // ~1.9k completion tokens per week, and 3k/week bounds one runaway
          // response instead of letting a whole-plan call bill to 128k.
          max_completion_tokens: Math.min(16000, own.length * 3000 + 1500),
        }),
      });

      if (!response.ok) {
        // Status + marker only — never the raw provider body.
        console.error("AI gateway error:", response.status, "upstream_error");
        const err = new Error(response.status === 429 ? "rate_limited" : response.status === 402 ? "ai_credits" : "provider_error") as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content ?? "{}";
      let parsed: { weeks?: unknown } | null = null;
      try { parsed = typeof content === "string" ? JSON.parse(content) : content; }
      catch {
        throw new Error("invalid_json");
      }
      const chunkWeeksParsed = Array.isArray(parsed?.weeks) ? (parsed.weeks as unknown[]) : [];
      if (chunkWeeksParsed.length === 0) throw new Error("empty_plan");
      return chunkWeeksParsed.filter((w): w is Record<string, unknown> => !!w && typeof w === "object" && !Array.isArray(w));
    };

    // Every chunk at once. `allSettled` rather than `all`, so one failed chunk
    // still lets the others finish before the refund — abandoning a request in
    // flight would not stop the provider billing for it.
    const settled = await Promise.allSettled(chunks.map(writeChunk));
    const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) {
      const status = (failed.reason as { status?: number })?.status ?? 0;
      const reason = (failed.reason as Error)?.message ?? "provider_error";
      await refundAndReset();
      if (status === 429 || reason === "rate_limited") {
        return json({ error: "Rate limited. Try again shortly." }, 429);
      }
      if (status === 402 || reason === "ai_credits") {
        return json({ error: "AI credits exhausted." }, 402);
      }
      if (reason === "invalid_json") return json({ error: "AI returned invalid JSON" }, 502);
      if (reason === "empty_plan") return json({ error: "AI returned an empty plan" }, 502);
      return json({ error: "AI generation failed" }, 500);
    }

    // Merged in skeleton order, so the plan reads week 1..N no matter which call
    // answered first, and each week carries the app's own deload decision.
    const skeletonByWeek = new Map(skeleton.map((w) => [w.week, w]));
    const weeks: unknown[] = [];
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      for (const week of result.value) {
        const planWeek = skeletonByWeek.get(Number(week.week));
        weeks.push(planWeek ? { ...week, isDeload: planWeek.isDeload } : week);
      }
    }
    // The merged plan must cover the whole skeleton: a chunk that quietly
    // returned four of its six weeks is a plan with a hole in it, and the
    // athlete paid for all of it.
    const covered = new Set(weeks.map((w) => Number((w as Record<string, unknown>).week)));
    const missing = skeleton.filter((w) => !covered.has(w.week)).map((w) => w.week);
    if (missing.length > 0) {
      console.error("generate-plan incomplete:", missing.join(","));
      await refundAndReset();
      return json({ error: "AI returned an incomplete plan" }, 502);
    }

    const parsed = { weeks };

    // Plan-structure validation before the plan is returned (and before the
    // client can save it): every week must carry exactly 7 day objects with a
    // safe type and non-negative numeric durations. Malformed shapes are
    // dropped; if nothing valid remains the charge is refunded.
    const isSafeString = (v: unknown, max: number): boolean =>
      typeof v === "string" && v.length <= max && !/\p{C}/u.test(v);
    // A week is an OBJECT carrying a `sessions` array — that is what the schema
    // above asks the model for and what the client reads (planData[i].sessions).
    // Treating each week as a bare array of days dropped every week and refunded
    // every plan as "malformed", so the shape check follows the two ends that
    // have to agree. The per-day safety checks below are unchanged.
    const cleanWeeks: Record<string, unknown>[] = [];
    for (const week of weeks.slice(0, duration)) {
      if (!week || typeof week !== "object" || Array.isArray(week)) continue;
      const w = week as Record<string, unknown>;
      const sessions = Array.isArray(w.sessions) ? w.sessions : null;
      if (!sessions) continue;
      const days = sessions.filter(
        (d): d is Record<string, unknown> =>
          !!d && typeof d === "object" &&
          isSafeString((d as Record<string, unknown>).dayName, 20) &&
          isSafeString((d as Record<string, unknown>).title, 120) &&
          isSafeString((d as Record<string, unknown>).type, 30),
      ).map((d) => ({
        ...d,
        duration_minutes: Math.max(0, Math.min(600, Number(d.duration_minutes) || 0)),
      }));
      if (days.length !== 7) continue;
      cleanWeeks.push({
        ...w,
        week: Number.isFinite(Number(w.week)) ? Number(w.week) : cleanWeeks.length + 1,
        sessions: days,
      });
    }
    if (cleanWeeks.length === 0) {
      await refundAndReset();
      return json({ error: "The generated plan was malformed. Please try again." }, 502);
    }

    return json({ plan_data: cleanWeeks, cost: spend.cost, balance: spend.balance });
  } catch (e) {
    console.error("generate-plan error:", e instanceof Error ? e.name : e);
    await refundAndReset();
    return json({ error: "The plan could not be generated. Please try again." }, 500);
  }

  async function refundAndReset() {
    if (chargedUserId) {
      await refundCredits({
        supabaseUrl: Deno.env.get("SUPABASE_URL")!,
        serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        userId: chargedUserId,
        amount: charged,
        dedupeKey: chargedKey,
        reason: "Training plan failed — server error (auto refund)",
      });
      chargedUserId = null;
    }
  }
});
