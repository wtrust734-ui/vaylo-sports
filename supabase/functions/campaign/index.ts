/**
 * campaign — Steps 1 and 2 of the advertising workflow, plus the approval gate
 * that guards Step 3.
 *
 * Four actions:
 *   options   → objectives, platforms and the presets they map to. Free.
 *   brief     → validate a campaign brief before anything is sent to a model. Free.
 *   concepts  → write three distinct concepts with OpenAI, costed but NOT generated.
 *   plan      → one approved concept → the exact ordered asset pipeline, with the
 *               budget decision for every paid step.
 *
 * THE ONE RULE THAT SHAPES THIS FILE
 *
 * Nothing here spends money. `concepts` calls OpenAI once (cheap, text only) and
 * `plan` only does arithmetic. Veo and ElevenLabs are never called: the client
 * shows the estimate, the athlete approves, and only then does ad-video or
 * voiceover get invoked for a single concept. That is what "approve a concept
 * before generating paid assets" has to mean in code, because a warning that can
 * be clicked past is not an approval gate.
 *
 * FABRICATION
 *
 * The brief forbids inventing app features, reviews, statistics and performance
 * claims — and a model asked for "a hook and a benefit" will invent all four. So
 * every concept is validated by campaign.ts before it is returned, and a concept
 * that breaks the rules comes back with its problems rather than quietly passing.
 * Shots that should show the app are marked `useAppFootage: true`: they carry no
 * Veo prompt, cost nothing, and are filled from real screenshots later. Nothing
 * in this file can produce a mock app interface.
 */

import { aiCallAllowed, authenticate, readJsonBody } from "../_shared/guard.ts";
import { GEMINI_MODELS, MODELS } from "../_shared/aiModels.ts";
import {
  AD_CONCEPT_SCHEMA,
  AD_PLATFORMS,
  CAMPAIGN_OBJECTIVES,
  CONCEPT_COUNT,
  CONCEPT_SYSTEM_PROMPT,
  FABRICATION_PATTERNS,
  checkBudget,
  estimateConceptCost,
  normaliseConcept,
  parseConceptPayload,
  validateBrief,
  validateConcept,
  type AdConcept,
  type CampaignBrief,
} from "../_shared/campaign.ts";
import { ELEVENLABS_MODELS } from "../_shared/elevenlabs.ts";
import { DEFAULT_VEO_MODEL, VEO_DURATIONS } from "../_shared/veo.ts";
import { AD_PRESETS } from "../_shared/renderPlan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
/**
 * The efficient chat tier, the same id ad-agent and the voiceover drafter use.
 * Overridable so a campaign can be re-run on a stronger model without a deploy.
 */
const CONCEPT_MODEL = Deno.env.get("CAMPAIGN_MODEL") ?? MODELS.CHAT.MINI;

/**
 * Output ceiling for one concepts call.
 *
 * Three concepts with storyboards is roughly 2k tokens in practice; 6k bounds a
 * runaway generation instead of letting it bill to the model's ceiling.
 */
const MAX_COMPLETION_TOKENS = 6000;

/** How long a single approved concept is expected to take, for the progress UI. */
const APPROVAL_NOTE =
  "Nothing is generated until a concept is approved. Approving runs only the steps listed for that concept.";

interface ConceptResult {
  index: number;
  concept: AdConcept;
  cost: ReturnType<typeof estimateConceptCost>;
  approved: boolean;
}

/** Serialise the brief for the model, with the schema it must return. */
function buildConceptPrompt(brief: CampaignBrief): string {
  const platform = AD_PLATFORMS[brief.platform];
  return `CAMPAIGN BRIEF
Name: ${brief.name}
Objective: ${CAMPAIGN_OBJECTIVES[brief.objective]} (${brief.objective})
Target audience: ${brief.audience}
Platform: ${platform.label} (${platform.aspect}, up to ${platform.maxSeconds}s)
Spending limit: $${brief.budgetUsd.toFixed(2)} — this is a ceiling on generation, not something to mention in the advert
Campaign message: ${brief.message}
Call to action: ${brief.callToAction}

Write ${CONCEPT_COUNT} genuinely different concepts for this brief. Ranges for total advert length are 6-15s for short edits and 15-30s for demonstrations; give each concept a total that suits ${platform.label} and state shot lengths as ${VEO_DURATIONS.join(", ")} seconds.

Return ONLY JSON, no markdown and no prose, in exactly this shape:
{"concepts": [${JSON.stringify({ ...AD_CONCEPT_SCHEMA, properties: { ...AD_CONCEPT_SCHEMA.properties, storyboard: { type: "array", items: { type: "object", properties: AD_CONCEPT_SCHEMA.properties.storyboard.items.properties, required: AD_CONCEPT_SCHEMA.properties.storyboard.items.required } } } })}]}

The call to action must be the campaign's call to action or a faithful shortening of it. At least one shot in each concept must set useAppFootage to true: real product footage is used for the app, never a generated imitation of it.`;
}

/**
 * Concept parsing and normalisation live in `_shared/campaign.ts`, not here.
 * They are pure, so they belong with the code that is unit-tested — this file is
 * the thin part that needs a live runtime and cannot be.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await readJsonBody(req);
    if (!body) return json({ error: "Invalid request body" }, 400);

    const action = typeof body.action === "string" ? body.action : "";

    // ---- options: the form's source of truth, free --------------------------
    if (action === "options") {
      return json({
        action,
        objectives: CAMPAIGN_OBJECTIVES,
        platforms: AD_PLATFORMS,
        presets: AD_PRESETS,
        conceptCount: CONCEPT_COUNT,
        veoDurations: VEO_DURATIONS,
        defaultVeoModel: DEFAULT_VEO_MODEL,
        voiceoverModels: ELEVENLABS_MODELS,
        videoModel: GEMINI_MODELS.VEO_LITE,
        fabricationRules: FABRICATION_PATTERNS.map((p) => p.reason),
        approvalNote: APPROVAL_NOTE,
      });
    }

    // ---- brief: free validation, before anything is written -----------------
    if (action === "brief") {
      return json({ action, ...validateBrief(body.brief as Partial<CampaignBrief>) });
    }

    // ---- concepts: one OpenAI call, three costed concepts -------------------
    if (action === "concepts") {
      const brief = body.brief as Partial<CampaignBrief>;
      const briefCheck = validateBrief(brief);
      if (!briefCheck.ok) return json({ action, ok: false, error: "The brief is incomplete", problems: briefCheck.problems }, 400);

      if (!OPENAI_API_KEY) {
        return json({ action, error: "Concept writing is not configured on this deployment (OPENAI_API_KEY is missing).", code: "not_configured" }, 503);
      }
      if (!(await aiCallAllowed(req, userId, "ad-campaign", { max: 10, windowSeconds: 60 }))) {
        return json({ action, error: "Too many concept requests. Try again in a minute." }, 429);
      }

      const response = await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: CONCEPT_MODEL,
          messages: [
            { role: "system", content: CONCEPT_SYSTEM_PROMPT },
            { role: "user", content: buildConceptPrompt(brief as CampaignBrief) },
          ],
          // JSON mode guarantees parseable output; the shape itself is then
          // validated here rather than trusted.
          response_format: { type: "json_object" },
          max_completion_tokens: MAX_COMPLETION_TOKENS,
        }),
      });

      if (!response.ok) {
        // Status and a marker only: the provider body can echo request metadata.
        console.error("concept generation failed:", response.status, "upstream_error");
        if (response.status === 429) return json({ action, error: "OpenAI is rate limiting this project. Try again shortly." }, 429);
        if (response.status === 401 || response.status === 403) return json({ action, error: "OpenAI rejected the API key on this deployment." }, 502);
        return json({ action, error: `Concept generation failed (OpenAI returned ${response.status}).` }, 502);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const raw = parseConceptPayload(payload?.choices?.[0]?.message?.content);

      const briefJson = brief as CampaignBrief;
      const concepts: ConceptResult[] = [];
      const rejected: Array<{ index: number; problems: string[] }> = [];

      raw.slice(0, 12).forEach((candidate, index) => {
        const normalised = normaliseConcept(candidate);
        const check = validateConcept(normalised);
        if (!check.ok) {
          rejected.push({ index, problems: check.problems });
          return;
        }
        const concept = normalised as AdConcept;
        const cost = estimateConceptCost(concept);
        concepts.push({
          index,
          concept,
          cost,
          // A concept is only affordable to generate if its own estimate fits
          // inside the campaign's ceiling.
          approved: checkBudget(briefJson.budgetUsd, 0, cost.totalUsd).allowed,
        });
      });

      if (concepts.length === 0) {
        return json(
          {
            action,
            ok: false,
            error: "OpenAI returned no concept that passes the brand rules. Nothing was generated.",
            rejected,
            model: CONCEPT_MODEL,
          },
          502,
        );
      }

      const budget = checkBudget(briefJson.budgetUsd, 0, Math.min(...concepts.map((c) => c.cost.totalUsd)));

      return json({
        action,
        ok: true,
        model: CONCEPT_MODEL,
        // Reported so the caller can see this was one metered text call, not a
        // generation. Veo and ElevenLabs have not been touched.
        usage: payload.usage ?? null,
        generated: false,
        concepts,
        rejected,
        // The cheapest concept's estimate against the ceiling, which is the
        // cheapest way to produce anything for this brief.
        minimumSpend: budget,
        approvalNote: APPROVAL_NOTE,
      });
    }

    // ---- plan: what approval would actually run ----------------------------
    if (action === "plan") {
      const concept = body.concept as Partial<AdConcept>;
      const check = validateConcept(concept);
      if (!check.ok) return json({ action, ok: false, error: "This concept cannot be generated as written", problems: check.problems }, 400);

      const budgetUsd = Number(body.budgetUsd);
      const spentUsd = Number(body.spentUsd ?? 0) || 0;
      const cost = estimateConceptCost(concept);
      const decision = checkBudget(budgetUsd, spentUsd, cost.totalUsd);

      const platform = body.platform && (body.platform as string) in AD_PLATFORMS
        ? AD_PLATFORMS[body.platform as keyof typeof AD_PLATFORMS]
        : AD_PLATFORMS.reels;

      // The ordered pipeline. Each step names the function that performs it, so
      // the client never has to know which provider handles which part.
      const steps = [
        {
          step: "voiceover",
          fn: "voiceover",
          action: "generate",
          label: "Narration",
          provider: "ElevenLabs",
          model: cost.voiceoverModel,
          charges: cost.hasNarration ? `${cost.voiceoverCharacters} characters` : "nothing — this concept has no narration",
          paid: cost.hasNarration,
          required: cost.hasNarration,
        },
        ...(concept.storyboard ?? [])
          .filter((s) => !s.useAppFootage)
          .map((s) => ({
            step: `veo-shot-${s.shot}`,
            fn: "ad-video",
            action: "start",
            label: `Shot ${s.shot}`,
            provider: "Google Veo",
            model: GEMINI_MODELS.VEO_LITE,
            charges: `${s.seconds}s of video`,
            paid: true,
            required: true,
            prompt: s.veoPrompt,
          })),
        {
          step: "app-footage",
          fn: "storage",
          action: "fetch",
          label: "Real app footage",
          provider: "Vaylo Sports",
          charges: "nothing — supplied by you",
          paid: false,
          required: (concept.storyboard ?? []).some((s) => s.useAppFootage),
          note: "Screenshots and screen recordings are uploaded, never generated.",
        },
        {
          step: "branding",
          fn: "storage",
          action: "fetch",
          label: "Vaylo Sports logo",
          provider: "Vaylo Sports",
          charges: "nothing — the supplied artwork",
          paid: false,
          required: true,
          note: "The official logo file is overlaid as supplied. It is never generated or approximated.",
        },
        {
          step: "render",
          fn: "ad-render",
          action: "render",
          label: "Assemble and export",
          provider: "FFmpeg (render worker)",
          charges: `${cost.estimatedRenderSeconds}s of CPU on the render host, not a per-call charge`,
          paid: false,
          required: true,
          presetId: platform.presetId,
          aspect: platform.aspect,
        },
      ];

      return json({
        action,
        ok: decision.allowed,
        concept: { title: concept.title ?? "", hook: concept.hook ?? "" },
        estimation: cost,
        budget: decision,
        preset: platform,
        steps,
        // Stated plainly, because "estimated" is not a receipt.
        note: "Costs are estimates from published provider list prices. Rendering runs on the FFmpeg worker and is not billed per call.",
      });
    }

    return json({ error: "action must be one of: options, brief, concepts, plan" }, 400);
  } catch (e) {
    console.error("campaign function error:", e instanceof Error ? e.message : "unknown");
    return json({ error: "Campaign request failed" }, 500);
  }
});
