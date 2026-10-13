import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticate, readJsonBody, json } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PATCH, DELETE",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  
  try {
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole);
    
    if (req.method === "GET") {
      const url = new URL(req.url);
      const campaignId = url.searchParams.get("id");
      if (campaignId) {
        const { data, error } = await admin
          .from("ad_campaigns")
          .select("*, ad_concepts(*), ad_assets(*), ad_exports(*)")
          .eq("id", campaignId)
          .eq("owner_id", userId)
          .single();
        if (error) return json({ error: error.message }, 404);
        return json({ campaign: data });
      }
      const { data, error } = await admin
        .from("ad_campaigns")
        .select("*")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ campaigns: data });
    }
    
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body) return json({ error: "Invalid body" }, 400);
      // Handle concepts upsert
      if (body.concepts) {
        const { campaignId, concepts } = body;
        if (!campaignId) return json({ error: "campaignId required" }, 400);
        // concepts arrives over the wire: a non-array here used to throw a
        // 500 inside .map. Reject it as a 400 like every other bad field.
        if (!Array.isArray(concepts)) return json({ error: "concepts must be an array" }, 400);
        const upserts = concepts.map((c: Record<string, unknown>) => ({ ...c, campaign_id: campaignId, owner_id: userId }));
        const { data, error } = await admin
          .from("ad_concepts")
          .upsert(upserts, { onConflict: "campaign_id,concept_number" })
          .select();
        if (error) return json({ error: error.message }, 500);
        return json({ concepts: data });
      }
      const { data, error } = await admin
        .from("ad_campaigns")
        .insert({ ...body, owner_id: userId })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ campaign: data });
    }
    
    if (req.method === "PATCH") {
      const body = await readJsonBody(req);
      if (body?.conceptId) {
        const { conceptId, ...updates } = body;
        const { data, error } = await admin
          .from("ad_concepts")
          .update(updates)
          .eq("id", conceptId)
          .eq("owner_id", userId)
          .select()
          .single();
        if (error) return json({ error: error.message }, 500);
        return json({ concept: data });
      }
      if (!body?.id) return json({ error: "id required" }, 400);
      const { id, ...updates } = body;
      const { data, error } = await admin
        .from("ad_campaigns")
        .update(updates)
        .eq("id", id)
        .eq("owner_id", userId)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ campaign: data });
    }
    
    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: "Request failed" }, 500);
  }
});
