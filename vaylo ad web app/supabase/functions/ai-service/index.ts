/**
 * ai-service — the single backend entry point for AI in Vaylo Sports.
 *
 * GET  → { features: [...] }  model/prompt catalog (developer testing page)
 * POST → { feature, userPrompt, systemPrompt?, userData?, history?, images?, maxOutputTokens? }
 *        ⇒ { text, feature, model, durationMs, usage }
 *
 * Security: authenticated users only, validated input, per-user throttling,
 * server-side logging, and the OpenAI key never leaves this runtime.
 * userData is auto-enriched server-side with the authoritative athlete dossier
 * (PBs, goals, injuries, recovery) so callers that forget to send it still get personalised AI.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AI_FEATURES, featureCatalog } from "../_shared/aiModels.ts";
import { AIServiceError, generateAIResponse, type ChatTurn } from "../_shared/openai.ts";
import { fetchAthleteDossier, type EdgePB } from "../_shared/athleteDossier.ts";
import { aiCallAllowed, readJsonBody, spendForUser } from "../_shared/guard.ts";

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



/** Verifies the caller's JWT. Returns the user id + token. */
async function authenticate(req: Request): Promise<{ userId: string; token: string } | null> {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) return null;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return { userId: data.user.id, token };
}

/**
 * Cost policy for the generic AI service.
 *
 * Every feature name the client sends is a string the server must price. The
 * economy table prices metered features by name — which means a client could
 * previously run ANY catalog feature through ai-service without a charge,
 * because nothing here asked what the call cost. The allowlist below closes
 * that:
 *
 *  • FREE_FEATURES — light copy features with a bounded output cap; free by
 *    product decision, and re-validated against the economy table on every
 *    call so an admin pricing one of them later takes effect immediately.
 *  • everything else — charged through the SAME shared deduction path as the
 *    dedicated functions (credits_spend with the feature's own name, so the
 *    price always comes from the economy table, never from the client).
 *
 * Cost drift is a hard failure: if a feature's expected price and the price
 * the deduction path resolved disagree, the call is refused rather than
 * silently charged at a different rate than the product intends.
 */
const FREE_FEATURES = new Set([
  "connection_test", "ignition", "mental_checkin", "music_recommendations",
  "light_chat", "summary", "reinforcement", "encouragement",
]);

async function authorizeAndCharge(
  req: Request,
  userId: string,
  feature: string,
): Promise<Response | null> {
  // Only features the server actually knows may run at all — an unknown name
  // is a 400 before anything is charged or sent to a provider.
  if (!AI_FEATURES[feature]) {
    return json({ error: `Unknown AI feature "${feature}".` }, 400);
  }
  if (FREE_FEATURES.has(feature)) {
    // Re-check against the economy table: a feature priced > 0 there is no
    // longer free, whatever this list says.
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: cost, error } = await admin.rpc("credit_cost", { p_feature: feature });
    if (!error && typeof cost === "number" && cost > 0) {
      return json({ error: `Feature "${feature}" is no longer free. Please update the app.` }, 402);
    }
    return null;
  }
  const spend = await spendForUser(req, userId, feature, `AI ${feature}`, { source: "ai-service" });
  if (!spend.success) {
    return json({
      error: spend.error || `Not enough credits. You need ${spend.cost} credits — you are ${spend.shortfall ?? 0} short.`,
      shortfall: spend.shortfall,
      cost: spend.cost,
      balance: spend.balance,
    }, 402);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await authenticate(req);
    if (!auth) return json({ error: "Unauthorized" }, 401);

    // Model/prompt catalog for the developer testing page.
    if (req.method === "GET") return json({ features: featureCatalog() });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await readJsonBody(req);
    if (!body) return json({ error: "Invalid JSON body" }, 400);

    // Per feature rather than one global bucket, so a heavy feature cannot
    // spend another feature's budget, and counted in Postgres rather than in
    // this isolate, so a cold start or a second instance does not reset it.
    const feature = typeof body.feature === "string" ? body.feature.slice(0, 60) : "ai-service";
    if (!(await aiCallAllowed(req, auth.userId, feature, { max: 20, windowSeconds: 60 }))) {
      return json({ error: "Too many AI requests. Wait a moment and try again." }, 429);
    }

    // Authorisation + charging, before any provider call. Free features are
    // re-validated against the economy table; everything else pays the price
    // the table names for exactly this feature string.
    const paymentError = await authorizeAndCharge(req, auth.userId, feature);
    if (paymentError) return paymentError;

    // ---- Auto-enrich userData with authoritative dossier (if caller didn't send rich data) ----
    let userData: Record<string, unknown> | null =
      body.userData && typeof body.userData === "object" && !Array.isArray(body.userData)
        ? (body.userData as Record<string, unknown>)
        : null;
    const hasRichData = userData && typeof userData === "object" && (("pbs" in userData) || ("profile" in userData));
    if (!hasRichData) {
      try {
        const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        // If client sent bare pbs, forward them; otherwise dossier fetches purely from DB
        const bodyPbs = (body as { pbs?: unknown }).pbs;
        const clientPBs = Array.isArray(userData?.pbs)
          ? (userData.pbs as EdgePB[])
          : Array.isArray(bodyPbs)
            ? (bodyPbs as EdgePB[])
            : null;
        const dossier = await fetchAthleteDossier(serviceClient, auth.userId, clientPBs);
        userData = { ...(userData || {}), dossier, pbs: dossier.pbs, pbs_text: dossier.pbs_text };
      } catch (e) {
        console.error("[ai-service] dossier enrich failed", e);
        // proceed without dossier
      }
    }

    const result = await generateAIResponse({
      feature: typeof body.feature === "string" ? body.feature : "",
      userPrompt: typeof body.userPrompt === "string" ? body.userPrompt : "",
      systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : undefined,
      userData: userData ?? null,
      history: Array.isArray(body.history) ? (body.history as ChatTurn[]) : undefined,
      images: Array.isArray(body.images) ? (body.images as string[]) : undefined,
      maxOutputTokens: typeof body.maxOutputTokens === "number" ? body.maxOutputTokens : undefined,
      // The athlete's UI language — the AI answers in it (validated inside
      // generateAIResponse; unknown values degrade to a plain language name).
      userLocale: typeof body.userLocale === "string" ? body.userLocale.slice(0, 8) : undefined,
    });

    return json(result);
  } catch (err) {
    if (err instanceof AIServiceError) {
      console.error(`[ai-service] handled status=${err.status} message=${err.message}`);
      return json({ error: err.message }, err.status);
    }
    console.error("[ai-service] unhandled", err);
    return json({ error: "Unexpected server error" }, 500);
  }
});
