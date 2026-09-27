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
import { featureCatalog } from "../_shared/aiModels.ts";
import { AIServiceError, generateAIResponse } from "../_shared/openai.ts";
import { fetchAthleteDossier } from "../_shared/athleteDossier.ts";

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

/** Best-effort per-user sliding-window throttle (per isolate) — abuse guard. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();

function throttled(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent);
    return true;
  }
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

/** Verifies the caller's JWT. Returns the user id + token. */
async function authenticate(req: Request): Promise<{ userId: string; token: string } | null> {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) return null;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return { userId: data.user.id, token };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await authenticate(req);
    if (!auth) return json({ error: "Unauthorized" }, 401);

    // Model/prompt catalog for the developer testing page.
    if (req.method === "GET") return json({ features: featureCatalog() });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    if (throttled(auth.userId)) {
      return json({ error: "Too many AI requests. Wait a moment and try again." }, 429);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Invalid JSON body" }, 400);

    // ---- Auto-enrich userData with authoritative dossier (if caller didn't send rich data) ----
    let userData: Record<string, unknown> | null = body.userData ?? null;
    const hasRichData = userData && typeof userData === "object" && (("pbs" in userData) || ("profile" in userData));
    if (!hasRichData) {
      try {
        const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        // If client sent bare pbs, forward them; otherwise dossier fetches purely from DB
        const clientPBs = Array.isArray(userData?.pbs) ? userData.pbs as any : (Array.isArray((body as any).pbs) ? (body as any).pbs : null);
        const dossier = await fetchAthleteDossier(serviceClient, auth.userId, clientPBs);
        userData = { ...(userData || {}), dossier, pbs: (dossier as any).pbs, pbs_text: (dossier as any).pbs_text };
      } catch (e) {
        console.error("[ai-service] dossier enrich failed", e);
        // proceed without dossier
      }
    }

    const result = await generateAIResponse({
      feature: typeof body.feature === "string" ? body.feature : "",
      userPrompt: body.userPrompt,
      systemPrompt: body.systemPrompt,
      userData: userData ?? null,
      history: body.history,
      images: body.images,
      maxOutputTokens: body.maxOutputTokens,
      // The athlete's UI language — the AI answers in it (validated inside
      // generateAIResponse; unknown values degrade to a plain language name).
      userLocale: typeof body.userLocale === "string" ? body.userLocale.slice(0, 8) : undefined,
    });

    return json(result);
  } catch (err: any) {
    if (err instanceof AIServiceError) {
      console.error(`[ai-service] handled status=${err.status} message=${err.message}`);
      return json({ error: err.message }, err.status);
    }
    console.error("[ai-service] unhandled", err);
    return json({ error: "Unexpected server error" }, 500);
  }
});
