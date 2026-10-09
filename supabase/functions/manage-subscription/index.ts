import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No auth" }), { status: 401, headers: corsHeaders });

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const body = await req.json();
    const { action } = body;

    // PHASE 1: activation of legacy tiers is disabled. Validate/cancel still work
    // so existing subscribers keep and can manage their grandfathered access.
    if (action === "activate" || action === "activate_legacy_disabled") {
      return new Response(JSON.stringify({
        error: "Legacy subscription plans are deprecated and can no longer be activated.",
        deprecated: true,
      }), { status: 410, headers: corsHeaders });
    }

    if (action === "validate") {
      const { data: sub } = await supabase.from("subscriptions").select("*").eq("user_id", user.id).single();
      if (!sub) return new Response(JSON.stringify({ status: "free", plan_type: "free" }), { headers: corsHeaders });
      // Check expiry
      if (sub.status === "active" && sub.expires_at && new Date(sub.expires_at) < new Date()) {
        await supabase.from("subscriptions").update({ status: "expired" }).eq("id", sub.id);
        return new Response(JSON.stringify({ ...sub, status: "expired" }), { headers: corsHeaders });
      }
      return new Response(JSON.stringify(sub), { headers: corsHeaders });
    }

    if (action === "cancel") {
      const { error } = await supabase.from("subscriptions").update({
        status: "cancelled", cancelled_at: new Date().toISOString(),
      }).eq("user_id", user.id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, status: "cancelled" }), { headers: corsHeaders });
    }

    if (action === "validate_purchase") {
      return new Response(JSON.stringify({ valid: false, error: "Purchase validation is unavailable on this legacy endpoint." }), { status: 410, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
