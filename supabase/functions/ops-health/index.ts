/**
 * ops-health — the operator's JSON read of the ops metrics rollup.
 *
 * Serving (not storing) the answer to "how has the product run lately": the
 * last 30 rows of public.ops_metrics_daily plus the last days of the per-
 * feature cost sheet. It is deliberately tiny — the monitoring strategy doc is
 * the map for anything deeper — and equally deliberately PRIVATE. The rollup
 * and the cost view are operator surfaces, so the function stands behind a
 * secret header like the scheduled functions do: the caller presents
 * OPS_HEALTH_SECRET (a random value stored as a Supabase edge secret, never in
 * the repo) or the service-role key itself, and nobody else gets rows.
 *
 * Because ops_rollup_one_day is idempotent and takes an explicit day, this
 * endpoint can also trigger a missed rollup (`?rollup=yesterday`, same
 * secret): the overview is the state's repair lever, not a separate tool.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-ops-secret, x-client-info, apikey, content-type",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Authorised calls carry the ops secret in x-ops-secret (a curl-friendly
 * header) or the service-role key as a Bearer. The comparison is through a
 * timing-safe path is unnecessary here — a failed comparison leaks nothing a
 * rate limit does not already bound — but the secret is checked before ANY
 * result is built, not after.
 */
function authorised(req: Request, secret: string, serviceKey: string): boolean {
  if ((req.headers.get("x-ops-secret") ?? "") === secret) return true;
  const auth = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return !!auth && auth === serviceKey;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const secret = Deno.env.get("OPS_HEALTH_SECRET");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !serviceKey) return json({ error: "server_not_configured" }, 500);
  if (!authorised(req, secret, serviceKey)) return json({ error: "forbidden" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // Optional same-secret repair: replay the day the cron missed.
  const url = new URL(req.url);
  if (url.searchParams.get("rollup") === "yesterday") {
    const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { error } = await admin.rpc("ops_rollup_one_day", { p_day: day });
    if (error) return json({ error: `rollup_failed: ${error.message}` }, 500);
  }

  const { data: daily, error: dailyError } = await admin
    .from("ops_metrics_daily")
    .select("day, ai_calls, credits_charged, credits_refunded, error_shapes_new, refund_failure_shapes, computed_at")
    .order("day", { ascending: false })
    .limit(30);
  if (dailyError) return json({ error: `daily_failed: ${dailyError.message}` }, 500);

  const { data: cost, error: costError } = await admin
    .from("ops_ai_cost_daily")
    .select("day, feature, paid_uses, credits_charged, credits_refunded")
    .order("day", { ascending: false })
    .limit(50);
  // A missing view on a partially-applied deploy yields rows=null — report the
  // daily series anyway; the doc's §6 queries cover the gaps.
  if (costError) console.error("ops-health: cost sheet unavailable", costError.message);

  return json({ daily, costs: cost ?? [] }, 200);
});
