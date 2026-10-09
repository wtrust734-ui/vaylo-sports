import { idempotentAiHandler } from "../_shared/idempotentAiHandler.ts";
import { MODELS, OUTPUT_SAFETY_CONTRACT, SAFETY_PREAMBLE } from "../_shared/aiModels.ts";
import { languageDirective } from "../_shared/openai.ts";
import { cleanPlanWeeks, validEditedWeeks, PLAN_SESSION_TYPES } from "../_shared/planSchema.ts";
import { aiCallAllowed, authenticate, json, readJsonBody, spendForUser, throttled } from "../_shared/guard.ts";
import { coachVoiceDirective } from "../_shared/coachVoice.ts";

// Edits preserve the requested week/day identities. The wrapper owns request
// replay and durable refund recovery; the client saves the validated result.

const MAX_INSTRUCTION = 400;
const MIN_INSTRUCTION = 4;
/** Weeks per model call. Matches generate-plan's own parallelism. */
const EDIT_CHUNK_WEEKS = 2;
const MAX_WEEKS = 52;

const text = (value: unknown, max: number, fallback = ""): string =>
  typeof value === "string" && value.length <= 4000 ? value.slice(0, max) : fallback;

const whole = (value: unknown, max: number, fallback = 0): number => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : fallback;
};


/** Read the weeks the client sent, keeping only what the shared validator accepts. */
const readWeeks = (raw: unknown): Record<string, unknown>[] => {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_WEEKS) : [];
  return cleanPlanWeeks(list);
};

Deno.serve(idempotentAiHandler("edit-plan", async (req, debitKey, attempt) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Charged up-front — remembered so a failed edit can be refunded.
  let charged = 0;

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    if (throttled(userId)) return json({ error: "Too many AI requests. Wait a moment and try again." }, 429);
    // Tighter than plan generation on purpose: an edit is fast enough to be
    // repeated, so the limit is what stops a loop from spending an athlete's
    // balance in a minute.
    if (!(await aiCallAllowed(req, userId, "edit-plan", { max: 8, windowSeconds: 60 }))) {
      return json({ error: "Too many AI requests. Wait a moment and try again." }, 429);
    }

    const body = await readJsonBody(req);
    if (!body) return json({ error: "Invalid JSON body" }, 400);

    const scope = body.scope === "plan" ? "plan" : "week";
    const instruction = text(body.instruction, MAX_INSTRUCTION).trim();
    const sport = text(body.sport, 60, "the athlete's sport");
    const level = text(body.level, 40, "intermediate");
    const week = whole(body.week, MAX_WEEKS, 0);
    const duration = whole(body.duration_weeks, MAX_WEEKS, 0);
    const userLocale = typeof body.userLocale === "string" ? body.userLocale.slice(0, 8) : undefined;
    const targetEvent = text(body.target_event, 100);

    if (instruction.length < MIN_INSTRUCTION) {
      return json({ error: "Tell the coach what to change — a few words is enough." }, 400);
    }

    // The weeks being replaced. For a week edit that is one week; for a whole-plan
    // edit it is all of them. Cleaned by the shared validator BEFORE the charge,
    // so a malformed request never costs anything.
    const sent = readWeeks(body.weeks);
    if (sent.length === 0) return json({ error: "No valid plan weeks were sent to edit" }, 400);

    let targets = sent;
    if (scope === "week") {
      const match = sent.find((w) => Number(w.week) === week);
      if (!match) return json({ error: "That week is not part of this plan" }, 400);
      targets = [match];
    }

    if (!validEditedWeeks(targets, targets)) return json({ error: "The plan has invalid week or day numbers." }, 400);

    const feature = scope === "plan" ? "plan_edit_full" : "plan_edit";
    attempt.start();
    const spend = await spendForUser(req, userId, feature, `Plan edit: ${instruction.slice(0, 80)}`, {
      quantity: 1,
      source: "edit-plan",
      idempotencyKey: debitKey,
    }).catch(() => null);
    if (!spend) return attempt.uncertain();
    if (!spend.success) {
      if (spend.error !== "insufficient_credits" || !((spend.shortfall ?? 0) > 0)) return attempt.uncertain();
      attempt.uncharged();
      return json({
        error: spend.error || `Not enough credits. You need ${spend.cost} credits — you are ${spend.shortfall ?? 0} short.`,
        shortfall: spend.shortfall ?? null,
        cost: spend.cost,
        balance: spend.balance,
      }, 402);
    }
    if (spend.duplicate) return attempt.uncertain();
    if (!spend.unlimited && spend.cost > 0) {
      charged = spend.cost;
    }

    const voice = coachVoiceDirective(sport);
    const language = languageDirective(userLocale);

    const system = `${SAFETY_PREAMBLE}
You are an elite sports coach EDITING a training plan the athlete already owns. You are not writing a new plan.
${voice}
WHAT IS BEING CHANGED: ${scope === "plan" ? `the whole ${duration || targets.length}-week plan` : `week ${week} of a ${duration || targets.length}-week plan`}.
RULES THAT ARE NOT NEGOTIABLE:
- Change ONLY what the instruction asks for. Every session, day, type and duration the instruction does not touch must come back exactly as it was sent — same titles, same exercise entries, same order.
- Return the SAME number of weeks you were given, with the same "week" numbers, each with exactly 7 day objects (day 1 = Monday). Never return more or fewer.
- Keep the JSON keys and the day objects exactly as they are in the input, including isRest, isRecovery, skipped and duration_minutes.
- If the instruction asks for something unsafe, impossible with the athlete's stated equipment, or outside a coach's remit, return the weeks unchanged rather than inventing a workaround.
Return ONLY valid JSON, no markdown and no prose:
{ "weeks": [ <the same week objects, edited> ] }
Session "type" must stay one of: ${PLAN_SESSION_TYPES.join(", ")}.
${OUTPUT_SAFETY_CONTRACT}`;

    const user = `Instruction from the athlete: "${instruction}"
${targetEvent ? `They are training towards: ${targetEvent}.` : ""}
Level: ${level}. These are the week${targets.length === 1 ? "" : "s"} to return${scope === "plan" ? "" : ` (and the only ones you may change)`}:`;

    /**
     * One call for up to EDIT_CHUNK_WEEKS weeks. A whole-plan edit is several of
     * these running at once, which is why a 12-week rewrite costs the athlete
     * roughly the wall-clock of one call rather than twelve.
     *
     * `ok: false` carries the provider status instead of throwing, so the caller
     * keeps one mapping for 429/402/500 and can retry a genuinely transient
     * failure once.
     */
    const editChunk = async (
      chunk: Record<string, unknown>[],
    ): Promise<{ ok: true; weeks: Record<string, unknown>[] } | { ok: false; status: number }> => {
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
              { role: "system", content: language ? `${system}\n\n${language}` : system },
              { role: "user", content: `${user}\n${JSON.stringify({ weeks: chunk })}` },
            ],
            response_format: { type: "json_object" },
            // The answer is the same weeks back plus whatever changed, so the
            // budget scales with the input slices rather than with a new plan.
            max_completion_tokens: Math.min(32000, chunk.length * 3000 + 1500),
          }),
        });

        if (!response.ok) {
          // Status + marker only — never the raw provider body.
          console.error("edit-plan gateway error:", response.status, "upstream_error");
          return { ok: false, status: response.status };
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content ?? "{}";
        let parsed: { weeks?: unknown } | null = null;
        try { parsed = typeof content === "string" ? JSON.parse(content) : content; }
        catch { return { ok: false, status: 502 }; }

        const returned = readWeeks(parsed?.weeks);
        // Reject invented/duplicate week and day identities before accepting the edit.
        if (!validEditedWeeks(returned, chunk)) return { ok: false, status: 502 };
        return { ok: true, weeks: returned };
      } catch (e) {
        console.error("edit-plan chunk error:", e instanceof Error ? e.name : e);
        return { ok: false, status: 500 };
      }
    };

    const chunks: Record<string, unknown>[][] = [];
    for (let i = 0; i < targets.length; i += EDIT_CHUNK_WEEKS) {
      chunks.push(targets.slice(i, i + EDIT_CHUNK_WEEKS));
    }

    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const first = await editChunk(chunk);
        return first.ok ? first : await editChunk(chunk);
      }),
    );

    const failure = results.find((r) => !r.ok);
    if (failure && !failure.ok) {
      return attempt.fail("The edit could not be applied.", failure.status === 429 ? 429 : 502, charged);
    }
    const edited = results.flatMap((r) => (r.ok ? r.weeks : []));
    if (edited.length !== targets.length) {
      return attempt.fail("The edit came back incomplete.", 502, charged);
    }
    return json({ weeks: edited, cost: spend.cost, balance: spend.balance });
  } catch (e) {
    console.error("edit-plan error:", e instanceof Error ? e.name : e);
    return attempt.fail("The edit could not be applied.", 500, charged);
  }
}));
