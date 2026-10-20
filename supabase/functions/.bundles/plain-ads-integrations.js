// supabase/functions/_shared/guard.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
var json = (body, status2 = 200) => new Response(JSON.stringify(body), {
  status: status2,
  headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
});
async function authenticate(req) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"));
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}
var MAX_BODY_BYTES = 10 * 1024 * 1024;

// supabase/functions/ads-integrations/index.ts
function status() {
  const has = (name) => Boolean(Deno.env.get(name));
  return [
    {
      provider: "OpenAI (app project)",
      purpose: "AI text generation for the whole app (plans, coach, analysis)",
      secret: "OPENAI_API_KEY",
      configured: has("OPENAI_API_KEY"),
      verified: "Documented and in live use by app functions; routing is pinned by tests"
    },
    {
      provider: "OpenAI (Ads project)",
      purpose: "Ad creative text (concepts, hooks, revisions) \u2014 spend kept separate from the app",
      secret: "ADS_OPENAI_API_KEY",
      configured: has("ADS_OPENAI_API_KEY"),
      missing: "Set with: supabase secrets set ADS_OPENAI_API_KEY=<key> \u2014 falls back to OPENAI_API_KEY until set",
      verified: "Responses/Chat endpoints documented; wired with fallback so one key still works"
    },
    {
      provider: "Google Veo (Gemini API)",
      purpose: "Short AI-generated video shots for video ads",
      secret: "GOOGLE_VIDEO_API",
      configured: has("GOOGLE_VIDEO_API"),
      missing: "Set with: supabase secrets set GOOGLE_VIDEO_API=<key>",
      unverified: "Key shape matches AI Studio, but billing/enabled state is unconfirmed \u2014 one free models.list probe required before first use"
    },
    {
      provider: "ElevenLabs",
      purpose: "Voiceover narration",
      secret: "ELEVENLABS_API_KEY",
      configured: has("ELEVENLABS_API_KEY"),
      verified: "Confirmed live in the deployed project; key is scoped (usage only observable in billed characters)",
      unverified: "Commercial use requires the account's plan tier to license it"
    },
    {
      provider: "Render worker (FFmpeg)",
      purpose: "Assembles final video ad exports",
      secret: "RENDER_WORKER_URL / RENDER_TOKEN",
      configured: has("RENDER_WORKER_URL") && has("RENDER_TOKEN"),
      missing: "Host the worker/ container and set both secrets; the token must never reach the client",
      verified: "The renderer itself is proven locally with measured exports; hosting is not provisioned"
    },
    {
      provider: "Supabase Storage (ads bucket)",
      purpose: "Asset library media and campaign artifacts",
      secret: "\u2014",
      configured: true,
      verified: "Bucket + owner-scoped policies are created by migration 20261017220000_ads_studio_core; private, signed URLs only"
    }
  ];
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      }
    });
  }
  try {
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const configured = status().filter((s) => s.secret !== "\u2014" && (s.missing ?? "") === "").length;
    const total = status().filter((s) => s.secret !== "\u2014").length;
    return json({
      integrations: status(),
      // Reflected only as readiness, never as a capability test.
      summary: `${configured}/${total} providers configured \u2014 records configuration presence, not verified capability.`
    });
  } catch (err) {
    console.error("ads-integrations unhandled", err);
    return json({ error: "Integrations status failed." }, 500);
  }
});
