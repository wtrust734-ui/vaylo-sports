// ============================================================================
// ads-chat — the Creative Assistant's server-side brain for Ads Studio.
// ----------------------------------------------------------------------------
// One function per request:
//   1. verify the caller (never trust the anon key);
//   2. load a bounded message history (context-aware follow-ups);
//   3. classify the request with an OpenAI structured-JSON call, falling back
//      to the deterministic router when the model is unreachable — and state
//      which path produced the plan ("model" vs "rules"/"rules_fallback");
//   4. persist both messages and return the validated plan.
//
// What it deliberately does NOT do: start a paid generation. Specialists
// (image/video/research pipelines, Prompt 3+) execute plan steps behind their
// own cost gates. A script never stands in for a finished video here because
// nothing is claimed to be generated at all.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { aiCallAllowed, authenticate, readJsonBody, json } from "../_shared/guard.ts";
import { MODELS } from "../_shared/aiModels.ts";
import {
  CLARIFYING_QUESTION,
  classifyLocal,
  validateClassification,
  type Classification,
  type PlanStep,
} from "../_shared/adsRouter.ts";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_API_KEY = Deno.env.get("ADS_OPENAI_API_KEY") ?? Deno.env.get("OPENAI_API_KEY");

const MAX_CONTENT = 4000;
const HISTORY_LIMIT = 12;

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function corsOnly(): Response {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

/** Content validation shared with tests: trimmed, bounded, non-empty. */
export function normaliseContent(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_CONTENT) return null;
  return s;
}

const SYSTEM_PROMPT = `You are the routing brain for Vaylo Sports Ads Studio. You classify a user's advertising request and return ONLY a JSON object, no prose outside it.

Intents (use exactly these strings):
"image_ad" | "video_ad" | "competitor_research" | "campaign_ideation" | "creative_revision" | "asset_library" | "platform_question" | "campaign_analyse" | "export_asset"

More intent rules:
- "campaign_analyse" covers performance/result/report/evaluate requests AND comparison requests ("compare these two concepts"). It reviews what evidence actually exists — it never invents a winner or converts a subjective judgement into a performance claim.
- "export_asset" covers export/download requests. options: {"format": "image"|"video"} when the format was named.
- Requests to publish an ad, go live or spend money map to "platform_question": publishing to ad platforms is NOT connected. Reply honestly that publishing is not yet available and nothing spend is approved by chat.

Return shape:
{
  "primary": "<intent>",
  "steps": [{"type": "<intent>", "options": {}}],
  "reply": "one or two sentences acknowledging what you understood and what happens next"
}

Rules:
- Explicit image-ad requests map to "image_ad" with options.format="image". Never convert an image request into a video plan, and never describe a script-substitute as a finished ad.
- Explicit video-ad requests map to "video_ad" with options.format="video" and options.durationSeconds (whole seconds, 6-60) whenever a duration was stated.
- Combined requests ("research X before creating Y") list steps in the ORDER THE USER ASKED: research steps first when they were requested first. Up to 5 steps.
- "competitor_research" options: {"competitors": ["<named brands from the message>"]} when brands are named.
- "campaign_ideation" options: {"conceptCount": <1-5>} when a count was stated or implied.
- "creative_revision" options: {"revisionTarget": "<hook|script|storyboard|captions|call to action|cta|voiceover>"} when the part being changed is named.
- "asset_library" options: {"query": "<what the user wants to find>"}.
- "campaign_analyse" options: {"query": "<which campaign, assets or comparison>"}.
- "export_asset" options: {"query": "<what to export>", "format": "video"|"image" when stated}.
- "platform_question" options: {"query": "<their question>"} and "reply" is your helpful answer about Ads Studio or the brand.
- If the request is genuinely ambiguous (no format, no research, no concepts, no revision, no question), return the single most likely intent as primary, set "steps" to that same single step, and put ONE concise clarifying question into "clarification". Do not ask a clarification for clearly worded requests.
- "reply" must never claim anything was generated; generation happens later in specialist workflows after the user approves costs.
- Never invent features, results, statistics, prices or claims about Vaylo Sports.`;

const BRAND_CONTEXT = `Vaylo Sports: all-sports athlete-development app (training, coaching, learning, performance). Positioning: premium, modern, ambitious sports technology. Audience: athletes, core 18-30. Slogan: "Learn smarter. Train better. Perform better." Brand look: dark navy/black foundations, restrained purple accents, strong typography.`;

interface HistoryRow {
  role: string;
  content: string;
}

/**
 * The owner's asset library, compact and bounded, injected into the model's
 * context so the brain reasons over REAL uploaded files — screen recordings,
 * footage, generated assets — instead of inventing them. Owner-scoped RLS
 * read, capped to the 20 newest rows, and only the fields the model needs.
 */
async function loadLibraryContext(db: ReturnType<typeof admin>, userId: string): Promise<string> {
  try {
    const { data, error } = await db
      .from("ad_library_items")
      .select("id, kind, name, status, metadata")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !data || data.length === 0) return "";
    const lines = data.map((item) => {
      const meta = (item.metadata ?? {}) as { screenRecording?: boolean };
      return `- ${item.name} (${item.kind}${meta.screenRecording ? ", screen recording" : ""}, ${item.status})`;
    });
    return `Owner's asset library (real stored files, newest first — reference these by name, never invent assets):
${lines.join("\n")}`;
  } catch {
    // A library read must never take chat down; the assistant works without it.
    return "";
  }
}

function buildModelMessages(history: HistoryRow[], content: string, libraryContext: string) {
  const system = [SYSTEM_PROMPT, `Brand context: ${BRAND_CONTEXT}`, libraryContext]
    .filter(Boolean)
    .join("\n\n");
  return [
    { role: "system", content: system },
    ...history.slice(-HISTORY_LIMIT).map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }))
      .filter((m) => m.role !== "system"),
    { role: "user", content },
  ];
}

async function classifyWithModel(history: HistoryRow[], content: string, libraryContext = ""): Promise<Classification | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELS.MINI,
        messages: buildModelMessages(history, content, libraryContext),
        temperature: 1,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const validated = validateClassification({
      primary: parsed.primary,
      steps: parsed.steps,
      clarification: parsed.clarification ?? null,
    });
    // Reply text travels with the classification; callers read it separately.
    if (validated) return validated;
    return null;
  } catch {
    return null;
  }
}

/** Assistant reply text used when the model path produced no prose. */
function fallbackReply(c: Classification): string {
  if (c.clarification) return c.clarification;
  if (c.primary === "platform_question") {
    return "Ads Studio helps you plan campaigns, research competitors and produce image and video advertising with the Vaylo brand settings. Describe what you want and I'll route it to the right workflow.";
  }
  const done = c.steps.map((s) => describeStep(s)).join(" → ");
  return `Understood. Planned route: ${done}. Nothing has been generated yet — press Run here, or open the specialist workflow, and it will build it end to end.`;
}

function describeStep(s: PlanStep): string {
  switch (s.type) {
    case "image_ad": return `image ad${s.options.platform ? ` (for ${s.options.platform})` : ""}`;
    case "video_ad": return `video ad${s.options.durationSeconds ? ` (${s.options.durationSeconds}s)` : ""}`;
    case "competitor_research": return `competitor research${s.options.competitors?.length ? ` (${s.options.competitors.join(", ")})` : ""}`;
    case "campaign_ideation": return `${s.options.conceptCount ?? 3} concept(s)`;
    case "creative_revision": return `revision${s.options.revisionTarget ? ` of the ${s.options.revisionTarget}` : ""}`;
    case "asset_library": return "asset library lookup";
    case "campaign_analyse": return "campaign review (verified data only, uncertainty disclosed)";
    case "export_asset": return `export${s.options.format ? ` (${s.options.format})` : ""}`;
    case "platform_question": return "answered from brand/feature knowledge";
    default: return s.type;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsOnly();

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);

    if (!(await aiCallAllowed(req, userId, "ads-chat", { max: 30, windowSeconds: 60 }))) {
      return json({ error: "Too many messages. Wait a moment and try again." }, 429);
    }

    const body = await readJsonBody(req);
    if (!body) return json({ error: "Invalid request body" }, 400);
    const content = normaliseContent(body.content);
    if (!content) return json({ error: "content is required (1-4000 characters)" }, 400);

    const db = admin();

    // Session resolution: the id must already belong to this owner.
    let sessionId: string;
    if (typeof body.sessionId === "string" && body.sessionId.length === 36) {
      const { data: found } = await db
        .from("ad_chat_sessions")
        .select("id")
        .eq("id", body.sessionId)
        .eq("owner_id", userId)
        .maybeSingle();
      if (!found) return json({ error: "Unknown session" }, 404);
      sessionId = found.id;
    } else {
      const { data: created, error } = await db
        .from("ad_chat_sessions")
        .insert({ owner_id: userId, title: content.slice(0, 120) })
        .select("id")
        .single();
      if (error || !created) return json({ error: "Could not create session" }, 500);
      sessionId = created.id;
    }

    // Bounded history for model context — loaded from the DB, not the client.
    const { data: history } = await db
      .from("ad_chat_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(HISTORY_LIMIT);

    const { error: userMsgError } = await db.from("ad_chat_messages").insert({
      session_id: sessionId,
      owner_id: userId,
      role: "user",
      content,
    });
    if (userMsgError) return json({ error: "Could not save message" }, 500);
    await db.from("ad_chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);

    const priorHistory: HistoryRow[] = (history ?? []).map((h) => ({ role: h.role, content: h.content }));
    const libraryContext = await loadLibraryContext(db, userId);
    const modelResult = await classifyWithModel(priorHistory, content, libraryContext);
    const localResult = classifyLocal(content);

    // Model wins when it produced a valid plan; the rules classify the
    // ambiguous case ("rules") and rescue otherwise ("rules_fallback").
    let classification: Classification;
    let source: "model" | "rules" | "rules_fallback";
    if (modelResult) {
      classification = modelResult;
      source = "model";
    } else if (localResult.clarification) {
      classification = localResult;
      source = "rules";
    } else {
      classification = localResult;
      source = "rules_fallback";
    }

    let reply = fallbackReply(classification);

    // Video requests acknowledge the owner's real uploaded screen recordings
    // so the assistant answers with files that exist, never invented ones.
    const wantsVideo = classification.steps.some((s) => s.type === "video_ad");
    const hasRecording = libraryContext.includes(", screen recording");
    if (wantsVideo && hasRecording) {
      reply += " Your uploaded screen recordings are in the Asset Library; shots can use them directly in the Video Ads workspace — no video-model spend is needed for those shots.";
    } else if (wantsVideo) {
      reply += " If you want app screen-recording footage inside the ad, upload it in the Asset Library first — library clips cover shots directly with no video-model spend.";
    }

    // ---- research-aware routing (Prompt 3) ----------------------------------
    // A research step creates a REAL queued project the Research workspace
    // executes; creation steps that follow it state the preserved order; and
    // concepts cite the owner's saved evidence instead of generic advice.
    const hasResearch = classification.steps.some((s) => s.type === "competitor_research");
    const hasCreation = classification.steps.some((s) => s.type === "image_ad" || s.type === "video_ad" || s.type === "campaign_ideation");

    if (hasResearch) {
      const researchStep = classification.steps.find((s) => s.type === "competitor_research");
      const names = (researchStep?.options.competitors ?? []).slice(0, 5);
      const { data: queued, error: queuedErr } = await db
        .from("ad_research_projects")
        .insert({
          owner_id: userId,
          title: (names.length ? `Research: ${names.join(", ")}` : `Research: ${content.slice(0, 80)}`).slice(0, 200),
          // Natural-language topic — options carry no topic field yet; keep the
          // user's own words bounded and searchable from the workspace.
          topic: names.length !== classification.steps.length ? content.slice(0, 300) : "",
          scope: { competitors: names, sourceTypes: [], refresh: false, topic: "" },
          status: "queued",
        })
        .select("id")
        .single();
      if (!queuedErr && queued) {
        reply = `Research project queued (id ${queued.id.slice(0, 8)}…) — the Research workspace runs it against accessible sources (official pages, press, manual ingest). Meta/TikTok/Google ad-library APIs remain documented blockers until their owner approvals exist, and that limitation is disclosed in results, not hidden.${
          hasCreation ? " Order is preserved: research completes and is stored before any concept generation." : ""
        }`;
      }
    } else if (hasCreation) {
      // Cite the most recent saved research when concepts/creatives are asked for.
      const { data: recent } = await db
        .from("ad_research_projects")
        .select("id, title")
        .eq("owner_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recent) {
        const { count, data: rows } = await db
          .from("ad_research_findings")
          .select("id, title", { count: "exact" })
          .eq("project_id", recent.id)
          .limit(3);
        if (count && (rows ?? []).length) {
          const names = (rows ?? []).map((r) => r.title).join("; ");
          reply += ` Saved research “${recent.title}” holds ${count} finding(s) (e.g. ${names}); concept work will cite that evidence with references rather than generic advice.`;
        }
      }

      // Real image-ad context: cite the owner's latest project and its actual
      // artifacts so a follow-up revision lands on the same assets instead of
      // restarting anything. The Image Ads workspace is where generation and
      // compose run; chat never spends provider budget directly.
      const { data: lastImageProject } = await db
        .from("ad_image_projects")
        .select("id, request, status")
        .eq("owner_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastImageProject) {
        const { count: composedCount } = await db
          .from("ad_image_artifacts")
          .select("id", { count: "exact", head: true })
          .eq("project_id", lastImageProject.id)
          .eq("stage", "composed")
          .eq("status", "ready");
        const revision = classification.steps.some((s) => s.type === "creative_revision");
        reply +=
          ` Your latest image-ad project (“${String(lastImageProject.request).slice(0, 60)}”) is ${lastImageProject.status}` +
          (composedCount ? ` with ${composedCount} composed ad(s) ready in the Image Ads workspace` : " with no composed ads yet") +
          (revision
            ? ". Headline/CTA-only changes recompose from the existing background — the imagery is kept, nothing is regenerated."
            : ". The Image Ads workspace produces and composes the placements.");
        reply += ` (project id ${lastImageProject.id.slice(0, 8)}…)`;
      }
    }

    const { data: assistantMsg, error: assistantError } = await db
      .from("ad_chat_messages")
      .insert({
        session_id: sessionId,
        owner_id: userId,
        role: "assistant",
        content: reply,
        intent: classification.primary,
        plan: { steps: classification.steps, primary: classification.primary, clarification: classification.clarification },
        classification_source: source,
      })
      .select("id, created_at")
      .single();
    if (assistantError || !assistantMsg) return json({ error: "Could not save reply" }, 500);

    return json({
      sessionId,
      assistant: {
        id: assistantMsg.id,
        role: "assistant",
        content: reply,
        createdAt: assistantMsg.created_at,
        intent: classification.primary,
        plan: classification.steps,
        clarification: classification.clarification,
        classificationSource: source,
      },
    });
  } catch (err) {
    console.error("ads-chat unhandled", err);
    return json({ error: "Ad chat failed. Please try again." }, 500);
  }
});