import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { fetchAthleteDossier, formatDossierForPrompt, getAgeCaps } from "../_shared/athleteDossier.ts";
import { MODELS } from "../_shared/aiModels.ts";
import { languageDirective } from "../_shared/openai.ts";
import { refundCredits } from "../_shared/refund.ts";
import { aiCallAllowed, authenticate, json, readJsonBody, spendForUser, throttled } from "../_shared/guard.ts";
import { coachVoiceDirective } from "../_shared/coachVoice.ts";
import { equipmentDirective, normaliseEquipment, type EquipmentId } from "../_shared/equipment.ts";
import { cleanPlanWeeks as cleanWeekObjects } from "../_shared/planSchema.ts";
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

    const systemHead = `You are an elite sports coach writing ONE PART of a structured training plan.\nTHE INTENDED VAYLO SPORTS ATHLETE IS AN ADULT AGED 18–30, from a developing athlete through a serious, competitive one. Never assume or imply the athlete is younger, and never address them as a child, a teenager or a junior. The safety bands below apply only when the athlete's own date of birth puts them outside that range.
${ageGuidance}
${capsLine}
${equipmentLine}
${voiceDirective}
${breakLine}
${returnLine}
${dossierText ? `\n${dossierText}\n— Use the dossier to tailor volume, focus and exercise selection to THIS athlete (PBs, injuries, goals, recovery). Avoid movements that aggravate listed injuries.\n\nAny \`sessionLoads\` in the dossier are sport-specific load figures the app computed from the athlete's own logged sessions — an hour of swimming is NOT an hour of running in those numbers, and a field/court match is worth more than the same time training. Where recovery data is thin, write for the athlete's normal week. Never state a probability of injury or illness, never diagnose, and never claim the plan prevents anything: the only permitted register is "their recent load and recovery indicators suggest that X may be appropriate".` : ""}
`;

    // ---- The plan's periodisation, computed here ---------------------------
    // The app decides the SHAPE of the plan — deload placement, each block's
    // focus, the volume and intensity target per week — and the model fills in
    // sessions inside that shape. Three consequences, all deliberate:
    //
    //   * the weeks can be written in parallel, which is where the speed comes
    //     from, without the plan fraying at the seams: progression does not
    //     depend on a model remembering what it wrote seven minutes ago for
    //     week 3, because the numbers it has to hit are computed here;
    //   * "every 4th week is a deload" stops being a sentence a model is free
    //     to ignore — the flags are stamped onto the merged plan below;
    //   * the reasoning lives in a pure, unit-tested module
    //     (_shared/planPeriodisation.ts), which a prompt cannot be.
    const skeleton = buildWeekSkeleton({
      duration,
      deloadEvery: effectiveCaps.deloadEvery,
      level,
      sessionsPerWeek: typeof safeQuiz.daysPerWeek === "number" ? safeQuiz.daysPerWeek : 4,
    });
    // One week per call up to twelve weeks (see planChunkWeeks): latency grows
    // with the weeks inside a call, and every call here runs at the same time.
    const chunks = chunkSkeleton(skeleton, planChunkWeeks(duration));

    const planSchema = `Return ONLY valid JSON matching this exact schema (no markdown, no prose):
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
Each week you are asked for has exactly 7 day objects (day 1 = Monday, day 7 = Sunday). Rest days have empty warmup/exercises/cooldown (just a note in exercises) and duration_minutes=0. Every prescribed exercise MUST be safe for the athlete's chronological age and caps above.`;

    // What THIS call is writing. The shared head (systemHead) and the schema
    // above are byte-identical for every chunk, which is what keeps the safety
    // rules independent of which slice a call happened to be given — and what
    // lets the provider cache the large prefix instead of re-reading it per
    // chunk.
    const chunkBrief = (chunk: WeekSkeleton[]): string => {
      const first = chunk[0]?.week ?? 1;
      const last = chunk[chunk.length - 1]?.week ?? first;
      return `Write ONLY weeks ${first}-${last} of this plan: exactly ${chunk.length} week object${chunk.length === 1 ? "" : "s"}, numbered ${first} to ${last}. The other weeks are written by other calls running at the same time — do not write them and do not mention them.
Keep every entry to one line: the name, then sets/reps/RPE/rest/cues. 3-5 exercises per session, 2-4 warmup entries, 2-3 cooldown entries. No sentences inside an entry.
These are the app's own periodisation targets for the whole plan — hit them; they are the structure, not a suggestion:
${skeletonTargetLines(skeleton, chunk)}
${skeletonContinuityNote(chunk, skeleton)}${chunk.some((w) => w.isDeload) ? "\nA deload week is not the same week with easier numbers: one fewer session, reduced loads, technique and mobility work kept in. Write it as its own week." : ""}`;
    };

    /**
     * One model call: the sessions for a single slice of the skeleton.
     *
     * Each chunk is independent, and that is the point — four two-week calls
     * running at once come back in roughly the time one of them takes, where the
     * single whole-plan call this replaces took minutes on a long plan and got
     * slower (and likelier to time out) the more weeks it was asked for.
     *
     * A failure comes back as `ok: false` with the provider's status instead of
     * throwing, so the caller keeps the same 429/402/500 mapping this function
     * has always returned: a rate limit is worth retrying, a malformed response
     * is not.
     */
    const generateChunk = async (
      chunk: WeekSkeleton[],
    ): Promise<{ ok: true; weeks: Record<string, unknown>[] } | { ok: false; status: number }> => {
      const first = chunk[0]?.week ?? 1;
      const last = chunk[chunk.length - 1]?.week ?? first;
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: MODELS.CHAT.MINI,
            messages: [
              {
                role: "system",
                content: systemHead + planSchema + chunkBrief(chunk) + (langDirective ? "\n\n" + langDirective : ""),
              },
              {
                role: "user",
                content: `Write weeks ${first}-${last} of a ${duration}-week ${goal} plan for ${sport} (level: ${level}, age: ${age ?? "unknown"}).\nAvailability Quiz (already capped to age-safe limits): ${JSON.stringify(safeQuiz)}\nEquipment available to this athlete: ${equipment.length ? equipment.join(", ") : "none recorded — bodyweight and space only"}\n${dossierText ? "Athlete dossier already in system prompt — do not ask for it again." : ""}`,
              },
            ],
            response_format: { type: "json_object" },
            // Output budget scales with the weeks THIS call writes, not with the
            // whole plan. Measured need is ~1.9k completion tokens per week;
            // 3k/week leaves room for verbosity while still bounding a runaway
            // generation instead of letting it bill up to the model's ceiling.
            max_completion_tokens: Math.min(32000, chunk.length * 3000 + 1500),
          }),
        });

        if (!response.ok) {
          // Status + marker only — never the raw provider body.
          console.error("AI gateway error:", response.status, "upstream_error");
          return { ok: false, status: response.status };
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content ?? "{}";
        let parsed: { weeks?: unknown } | null = null;
        try { parsed = typeof content === "string" ? JSON.parse(content) : content; }
        catch { return { ok: false, status: 502 }; }

        // The prompt asks for exactly the weeks this chunk was given. A short
        // slice means the model answered a different question, so it is a failed
        // call rather than a plan missing weeks the athlete paid for.
        const raw = Array.isArray(parsed?.weeks) ? (parsed.weeks as unknown[]) : [];
        const clean = cleanWeekObjects(raw).slice(0, chunk.length);
        if (clean.length !== chunk.length) return { ok: false, status: 502 };
        return { ok: true, weeks: clean };
      } catch (e) {
        console.error("generate-plan chunk error:", e instanceof Error ? e.name : e);
        return { ok: false, status: 500 };
      }
    };

    // Every chunk starts together. One chunk failing does not cancel the others
    // mid-flight, and a single retry covers the ordinary provider hiccup.
    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const first = await generateChunk(chunk);
        return first.ok ? first : await generateChunk(chunk);
      }),
    );

    const failure = results.find((r) => !r.ok);
    if (failure && !failure.ok) {
      // Charged, and nothing usable came back — refund before reporting it.
      await refundAndReset();
      if (failure.status === 429) return json({ error: "Rate limited. Try again shortly." }, 429);
      if (failure.status === 402) return json({ error: "AI credits exhausted." }, 402);
      if (failure.status === 502) return json({ error: "The AI returned a plan we could not read. Please try again." }, 502);
      return json({ error: "AI generation failed" }, 500);
    }

    const weeks = results.flatMap((r) => (r.ok ? r.weeks : []));

    // The merged plan, validated and stamped. Week numbering, deload placement
    // and the holiday flag are the app's, not the model's: a chunk was told
    // which weeks to write, so any other numbering is corrected here, and a week
    // cannot be labelled a deload on a whim.
    const cleanWeeks = cleanWeekObjects(weeks).slice(0, duration).map((w, i) => ({
      ...w,
      week: i + 1,
      isDeload: skeleton[i]?.isDeload === true,
      isHoliday: w.isHoliday === true,
    }));
    if (cleanWeeks.length !== duration) {
      // Charged but short: the athlete paid for `duration` weeks, so a partial
      // plan is refunded rather than kept.
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
        reason: "Training plan failed — server error (auto refund)",
      });
      chargedUserId = null;
    }
  }
});
