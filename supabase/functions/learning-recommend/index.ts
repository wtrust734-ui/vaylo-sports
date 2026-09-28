import { MODELS } from "../_shared/aiModels.ts";
import { aiCallAllowed, authenticate, readJsonBody, throttled } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Prompt-stuffing caps — this function spends real AI budget. */
const MAX_LESSONS = 150;
const MAX_COMPLETED = 400;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Auth: the public anon key is itself a valid JWT, so identity MUST be
    // verified here or anyone could spend the AI budget.
    const userId = await authenticate(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (throttled(userId)) {
      return new Response(JSON.stringify({ error: "Too many AI requests. Wait a moment and try again." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!(await aiCallAllowed(req, userId, "learning-recommend", { max: 20, windowSeconds: 60 }))) {
      return new Response(JSON.stringify({ error: "Too many AI requests. Wait a moment and try again." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await readJsonBody(req);
    if (!body) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const completedIds: string[] = Array.isArray(body?.completedIds) ? body.completedIds.slice(0, MAX_COMPLETED) : [];
    const masteryByCategory = body?.masteryByCategory ?? {};
    const sport = body?.sport ?? "general";
    const goals = body?.goals ?? [];
    const experience = body?.experience ?? "intermediate";
    interface LessonSummary {
      id: string;
      category: string;
      title: string;
      sports?: string[];
      goals?: string[];
    }
    const allLessons: LessonSummary[] = Array.isArray(body?.allLessons) ? (body.allLessons as LessonSummary[]).slice(0, MAX_LESSONS) : [];
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

    const remaining = allLessons.filter((l) => !completedIds.includes(l.id));
    if (remaining.length === 0) {
      return new Response(JSON.stringify({ recommendations: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const goalsList = Array.isArray(goals) ? goals.join(", ") : String(goals || "none");
    const prompt = `You are a sport performance coach. Recommend the 5 most impactful next lessons for THIS specific athlete.

Athlete:
- Primary sport: ${sport}
- Experience: ${experience}
- Stated goals: ${goalsList || "none"}
- Category mastery (0-100): ${JSON.stringify(masteryByCategory)}
- Already completed lessons: ${completedIds.join(", ") || "none"}

Available lessons (id · category · title · sports · goals):
${remaining.map((l) => `${l.id} · ${l.category} · ${l.title} · sports:[${(l.sports || []).join("|") || "any"}] · goals:[${(l.goals || []).join("|") || "any"}]`).join("\n")}

Selection rules (apply in order):
1. STRONGLY prefer lessons whose 'sports' array matches the athlete's sport, OR whose 'goals' array matches one of the athlete's stated goals.
2. Among matches, prioritize the athlete's weakest category.
3. Only fall back to generic lessons if there are fewer than 5 matches.
Return exactly 5 lesson IDs from the list above.`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELS.CHAT.MINI,
        messages: [{ role: "user", content: prompt }],
        tools: [{
          type: "function",
          function: {
            name: "recommend_lessons",
            description: "Return 5 lesson ids",
            parameters: {
              type: "object",
              properties: { recommendations: { type: "array", items: { type: "string" } } },
              required: ["recommendations"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "recommend_lessons" } },
      }),
    });

    if (resp.status === 429) return new Response(JSON.stringify({ error: "Rate limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("OpenAI:", resp.status, t);
      return new Response(JSON.stringify({ error: "AI failure" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await resp.json();
    const args = JSON.parse(data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments || "{}");
    const valid = ((args.recommendations ?? []) as string[]).filter((id: string) => remaining.some((l) => l.id === id));

    return new Response(JSON.stringify({ recommendations: valid }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("learning-recommend error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
