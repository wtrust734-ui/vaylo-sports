// ============================================================================
// REFUND-NOTIFY — cron retry for the refund e-mail outbox
// ----------------------------------------------------------------------------
// `refund-request` and `refund-admin` attempt delivery inline. This function is
// the safety net for the cases where that attempt could not reach SMTP: it
// claims due rows, retries with bounded backoff, and reports counts.
//
// Authentication mirrors waitlist-campaigns: a random REFUND_CRON_SECRET that
// the scheduler presents in x-cron-secret, or the service-role key itself. No
// secret configured means the function refuses to run rather than exposing an
// unauthenticated mail sender.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { retryDueNotifications } from "../_shared/refundNotify.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const cronSecret = Deno.env.get("REFUND_CRON_SECRET");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!cronSecret || !serviceKey) return json({ error: "server_not_configured" }, 500);

  const header = req.headers.get("x-cron-secret") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const authorised =
    (header && constantTimeEqual(header, cronSecret)) ||
    (bearer && constantTimeEqual(bearer, serviceKey));
  if (!authorised) return json({ error: "forbidden" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const result = await retryDueNotifications(admin, { limit: 50 });
  return json({ ok: true, ...result });
});
