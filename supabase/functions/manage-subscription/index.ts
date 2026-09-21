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
    if (action === "activate") {
      return new Response(JSON.stringify({
        error: "Legacy subscription plans are deprecated and can no longer be activated.",
        deprecated: true,
      }), { status: 410, headers: corsHeaders });
    }

    if (action === "activate_legacy_disabled") {
      const { plan_type, purchase_token, platform } = body;
      if (!["minimum", "pro", "elite"].includes(plan_type)) {
        return new Response(JSON.stringify({ error: "Invalid plan" }), { status: 400, headers: corsHeaders });
      }
      const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from("subscriptions").upsert({
        user_id: user.id, plan_type, status: "active", started_at: new Date().toISOString(),
        expires_at, purchase_token: purchase_token || null, platform: platform || "web",
      }, { onConflict: "user_id" });
      if (error) throw error;

      // Grant features based on plan
      const features: Record<string, string[]> = {
        minimum: ["form_analysis", "coach_pro"],
        pro: ["form_analysis", "coach_pro", "mental_gym"],
        elite: ["form_analysis", "coach_pro", "mental_gym"],
      };
      for (const feat of features[plan_type] || []) {
        await supabase.from("user_purchases").upsert({
          user_id: user.id, product_id: feat, product_type: "feature", price_cents: 0,
        }, { onConflict: "user_id,product_id" }).select();
      }
      if (plan_type === "minimum") {
        await supabase.rpc("credits_grant", {
          p_user: user.id,
          p_amount: 50,
          p_reason: "Legacy plan credit allowance",
          p_source: "subscription-legacy",
          p_idempotency_key: `legacy-minimum:${user.id}:${new Date().toISOString().slice(0, 7)}`,
        });
      }
      return new Response(JSON.stringify({ success: true, status: "active", plan_type }), { headers: corsHeaders });
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
      // Placeholder for Google Play purchase validation
      const { purchase_token, product_id } = body;
      if (!purchase_token || !product_id) {
        return new Response(JSON.stringify({ error: "Missing token or product_id" }), { status: 400, headers: corsHeaders });
      }
      // In production, validate with Google Play Developer API here
      return new Response(JSON.stringify({ valid: true, message: "Purchase token accepted (validation pending Google Play integration)" }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
