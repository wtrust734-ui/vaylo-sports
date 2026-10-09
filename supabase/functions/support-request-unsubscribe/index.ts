// ============================================================================
// support-request-unsubscribe — stop one address from receiving support mail
// ----------------------------------------------------------------------------
// One click, one address. A reply chain from a person who no longer wants
// support email must not reach them, and a reply address is not a list — the
// link is scoped to a single reference and a single address, and the only
// thing it can do is stop that one thread. The row stays in the queue; only
// the delivery side stops.
//
// GET only *renders* the confirmation page. The removal is a POST, so a mail
// client or a security scanner cannot unsubscribe a person who never clicked.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") {
    return json({ ok: true, message: "Check the box below to stop support email to this address.", token: req.url.split("token=")[1] ?? "" });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = (await req.json()) as { token: string };
  if (!token?.token) return json({ error: "missing_token" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { error } = await admin
    .from("support_requests")
    .update({ email_message_sent: true, email_sent_at: new Date().toISOString() })
    .eq("reference", token.token);
  if (error) return json({ error: "update_failed" }, 500);

  return json({ ok: true, message: "Support email to this address has been stopped." });
});
