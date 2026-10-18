// ============================================================================
// ads-brand — persistent Vaylo Sports brand settings for Ads Studio.
// ----------------------------------------------------------------------------
// GET  → the owner's merged config (stored rows layered over server defaults).
// PUT  → validate + upsert the owner's stored config (partial fields allowed).
//
// Owner is always the JWT subject; no client id is ever trusted. Values never
// hold secrets. Defaults come from _shared/brandDefaults.ts, which itself is
// seeded from the verified brand corpus — one source of truth, not copies.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { authenticate, readJsonBody, json } from "../_shared/guard.ts";
import { DEFAULT_BRAND, mergeBrandConfig, validateBrandConfigInput } from "../_shared/brandDefaults.ts";

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function corsOnly(): Response {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsOnly();

  try {
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const db = admin();

    if (req.method === "GET") {
      const { data, error } = await db
        .from("ad_brand_settings")
        .select("config, updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return json({ error: "Could not load brand settings" }, 500);
      return json({ brand: mergeBrandConfig(data?.config), updatedAt: data?.updated_at ?? null, isDefault: !data });
    }

    if (req.method === "PUT") {
      const body = await readJsonBody(req);
      const check = validateBrandConfigInput(body);
      if (!check.ok) return json({ error: "Invalid brand settings", problems: check.problems }, 400);

      const { data, error } = await db
        .from("ad_brand_settings")
        .upsert({ user_id: userId, config: check.value, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
        .select("config, updated_at")
        .single();
      if (error) return json({ error: "Could not save brand settings" }, 500);

      // Reply merged (the stored side is partial; consumers see a full config).
      return json({ brand: mergeBrandConfig(data.config), updatedAt: data.updated_at });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("ads-brand unhandled", err);
    return json({ error: "Brand settings request failed." }, 500);
  }
});

// Defaults travel to the client for the first-run UI and for tests.
export { DEFAULT_BRAND };
