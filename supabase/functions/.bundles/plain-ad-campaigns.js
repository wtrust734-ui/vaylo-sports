// supabase/functions/ad-campaigns/index.ts
import { createClient as createClient2 } from "https://esm.sh/@supabase/supabase-js@2";

// supabase/functions/_shared/guard.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
var json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
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
async function readJsonBody(req) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// supabase/functions/ad-campaigns/index.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PATCH, DELETE"
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient2(supabaseUrl, serviceRole);
    if (req.method === "GET") {
      const url = new URL(req.url);
      const campaignId = url.searchParams.get("id");
      if (campaignId) {
        const { data: data2, error: error2 } = await admin.from("ad_campaigns").select("*, ad_concepts(*), ad_assets(*), ad_exports(*)").eq("id", campaignId).eq("owner_id", userId).single();
        if (error2) return json({ error: error2.message }, 404);
        return json({ campaign: data2 });
      }
      const { data, error } = await admin.from("ad_campaigns").select("*").eq("owner_id", userId).order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ campaigns: data });
    }
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return json({ error: "Invalid body" }, 400);
      if (body.concepts) {
        const { campaignId, concepts } = body;
        if (!campaignId) return json({ error: "campaignId required" }, 400);
        if (!Array.isArray(concepts)) return json({ error: "concepts must be an array" }, 400);
        const upserts = concepts.map((c) => ({ ...c, campaign_id: campaignId, owner_id: userId }));
        const { data: data2, error: error2 } = await admin.from("ad_concepts").upsert(upserts, { onConflict: "campaign_id,concept_number" }).select();
        if (error2) return json({ error: error2.message }, 500);
        return json({ concepts: data2 });
      }
      const { data, error } = await admin.from("ad_campaigns").insert({ ...body, owner_id: userId }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ campaign: data });
    }
    if (req.method === "DELETE") {
      const body = await readJsonBody(req);
      if (!body?.id || typeof body.id !== "string") return json({ error: "id required" }, 400);
      const { data: owned } = await admin.from("ad_campaigns").select("id").eq("id", body.id).eq("owner_id", userId).maybeSingle();
      if (!owned) return json({ error: "Campaign not found" }, 404);
      const { error } = await admin.from("ad_campaigns").delete().eq("id", body.id).eq("owner_id", userId);
      if (error) return json({ error: error.message }, 500);
      return json({ deleted: body.id });
    }
    if (req.method === "PATCH") {
      const body = await readJsonBody(req);
      if (body?.conceptId) {
        const { conceptId, ...updates2 } = body;
        const { data: data2, error: error2 } = await admin.from("ad_concepts").update(updates2).eq("id", conceptId).eq("owner_id", userId).select().single();
        if (error2) return json({ error: error2.message }, 500);
        return json({ concept: data2 });
      }
      if (!body?.id) return json({ error: "id required" }, 400);
      const { id, ...updates } = body;
      const { data, error } = await admin.from("ad_campaigns").update(updates).eq("id", id).eq("owner_id", userId).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ campaign: data });
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: "Request failed" }, 500);
  }
});
