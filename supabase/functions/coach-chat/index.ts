import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { fetchAthleteDossier, formatDossierForPrompt } from "../_shared/athleteDossier.ts";
import { MODELS } from "../_shared/aiModels.ts";
import { refundCredits } from "../_shared/refund.ts";
import { languageDirective } from "../_shared/openai.ts";
import { terminologyDirective } from "../_shared/terminology.ts";
import { aiCallAllowed, throttled } from "../_shared/guard.ts";
import { coachVoiceDirective, familyForCoach } from "../_shared/coachVoice.ts";

/**
 * Server-side coach-memory persistence.
 *
 * The model is instructed to end a reply with [MEMORY_SAVE: category=…, key=…,
 * value=…] lines when the athlete shares durable facts. These USED to be parsed
 * by the browser after the stream finished — one omitted stream frame, a closed
 * tab, or a doctored client silently dropped or fabricated memories. Parsing
 * here makes every memory the model actually asked to save land exactly once,
 * from a server that saw the full reply.
 *
 * Values are clamped (category 32 / key 80 / value 240 chars) and the table is
 * self-scoped RLS, so a malicious model line can only ever write the caller's
 * own memory row.
 */
export async function persistCoachMemories(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
  assistantText: string,
): Promise<number> {
  const regex = /\[MEMORY_SAVE:\s*category=([^,\]]+),\s*key=([^,\]]+),\s*value=([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  let saved = 0;
  while ((match = regex.exec(assistantText)) !== null) {
    const category = match[1].trim().slice(0, 32) || "general";
    const key = match[1] === match[2] ? "" : match[2].trim().slice(0, 80);
    const value = match[3].trim().slice(0, 240);
    if (!key || !value) continue;
    try {
      const { error } = await admin.from("coach_memories").upsert(
        { user_id: userId, category, key, value, updated_at: new Date().toISOString() },
        { onConflict: "user_id,key" },
      );
      if (!error) saved += 1;
    } catch {
      // Memory persistence is best-effort: the reply must never fail because of it.
    }
  }
  return saved;
}

/**
 * Wraps the upstream SSE byte stream so the FULL assistant reply can be
 * inspected as it passes through, without buffering the whole stream first.
 *
 * Two guarantees the naive tee does not give:
 *
 *   1. The terminal frame is held back, not forwarded. Memory persistence is
 *      awaited BEFORE the held frame is delivered — a function frozen right
 *      after the response would otherwise drop the memories. Fire-and-forget
 *      here is a lost write dressed as a saved one.
 *   2. Persistence is skipped when the upstream never said DONE. An
 *      interrupted stream has no complete response to remember, and persisting
 *      a fragment would store a half-thought as the coach's answer.
 *
 * Split UTF-8 stays split-safe (the decoder holds partial code points across
 * chunks and is flushed once the stream ends), and an unterminated final line
 * is still processed rather than dropping the tail of the reply. A line that
 * is not valid JSON is kept for the next chunk while the stream is open — a
 * frame split across chunks — and reported as malformed only once the stream
 * has ended, never spun on.
 */
export function teeSseText(
  upstream: ReadableStream<Uint8Array>,
  onDone: (fullText: string, completed: boolean) => unknown,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = upstream.getReader();
  let buffer = "";
  let full = "";
  let terminalSeen = false;
  let heldTerminal = "";
  const SSE_LINE = /"choices"\s*:\s*\[\s*\{[\s\S]*?"delta"\s*:\s*\{\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"/;
  const forwardable: string[] = [];
  const drainLines = (final: boolean) => {
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.slice(5).trim();
      if (jsonStr.includes("[DONE]")) {
        terminalSeen = true;
        heldTerminal += line + "\n";
        continue;
      }
      if (!jsonStr) continue;
      try {
        const payload = JSON.parse(jsonStr);
        const delta = payload?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") {
          full += delta;
          // Fast path: once the trailing marker region has fully passed, stop
          // unescaping every frame.
          if (full.includes("MEMORY_SAVE") || /[\],]\s*$/.test(full)) {
            const m = SSE_LINE.exec(line);
            if (m) full = full.slice(0, full.length - delta.length) + JSON.parse(`"${m[1]}"`);
          }
        }
      } catch {
        // A line that is still broken once the stream has ended is forwarded
        // as-is: the client flags it explicitly rather than either side
        // spinning on it or silently dropping the tail of the reply.
        if (!final) { buffer = line + "\n" + buffer; break; }
      }
      forwardable.push(line + "\n");
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) buffer += "\n";
        drainLines(true);
        if (forwardable.length) {
          controller.enqueue(encoder.encode(forwardable.join("")));
          forwardable.length = 0;
        }
        if (terminalSeen) {
          try { await onDone(full, true); } catch { /* memory persistence must not break the stream */ }
          controller.enqueue(encoder.encode(heldTerminal));
        }
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      drainLines(false);
      if (forwardable.length) {
        controller.enqueue(encoder.encode(forwardable.join("")));
        forwardable.length = 0;
      }
    },
    cancel() {
      try { reader.cancel(); } catch { /* already closed */ }
    },
  });
}

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
    if (!(await aiCallAllowed(req, user.id, "coach-chat", { max: 20, windowSeconds: 60 }))) {
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
    // Prompt 9: regional terminology follows the same strict validation as
    // everywhere else — the raw value is never echoed into the prompt.
    const userRegion = typeof body.userRegion === "string" ? body.userRegion : undefined;
    const regionDirective = terminologyDirective(userRegion);
    const langDirective = languageDirective(userLocale);
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Rejected BEFORE spending credits: an empty conversation buys nothing,
    // and a caller-supplied system/developer message would be forwarded to
    // the model as an instruction — the server's own prompt is the only one.
    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    for (const m of messages) {
      const role = (m as { role?: unknown } | null)?.role;
      if (role !== "user" && role !== "assistant") {
        return new Response(JSON.stringify({ error: "Invalid message role" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

    // Charged — but honour the documented refund policy: a spent credit line is
    // only written for a real deduction, never for an Unlimited-plan audit row.
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
THE INTENDED VAYLO SPORTS ATHLETE IS AN ADULT AGED 18–30, from a developing athlete through a serious, competitive one. Never assume or imply the athlete is younger, and never address them as a child, a teenager or a junior. You are a coaching aid, not a doctor, physiotherapist or dietitian.

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
          { role: "system", content: systemPrompt + (langDirective ? "\n\n" + langDirective : "") + (regionDirective ? "\n\n" + regionDirective : "") },
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

    // Tee the stream: the athlete receives the SSE frames unmodified while the
    // full reply is reassembled server-side for memory persistence. The model
    // is the source of truth for what gets remembered — not whichever client
    // happens to finish parsing the stream.
    const adminForMem = serviceClient;
    const memUserId = user.id;
    // response.body is null when the upstream closed without a body: the
    // athlete was charged and got nothing, so this enters the refund path
    // like any other provider failure rather than answering a bare 502.
    if (!response.body) {
      if (chargedUserId) {
        await refundCredits({
          supabaseUrl: chargedUrl,
          serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          userId: chargedUserId,
          amount: chargedCredits,
          reason: "Coach reply failed — empty provider response (auto refund)",
        });
        chargedUserId = null;
      }
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const streamed = teeSseText(response.body, async (fullText, completed) => {
      // Awaited before the held terminal frame is delivered, and skipped when
      // the upstream never finished — there is no complete response to
      // remember then. Fire-and-forget is unsafe in a function that may be
      // frozen after the response.
      if (!completed) return;
      await persistCoachMemories(adminForMem, memUserId, fullText).catch(() => undefined);
    });
    return new Response(streamed, {
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
    // Internal details (config errors, stack traces) stay in the logs; the
    // client gets a stable, non-leaking message.
    console.error("coach-chat error:", e);
    return new Response(JSON.stringify({ error: "The coach is unavailable right now. Please try again." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
