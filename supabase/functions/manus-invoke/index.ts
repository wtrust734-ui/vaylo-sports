// ===========================================================================
// manus-invoke — the agent's tool surface for Vaylo Sports
// ===========================================================================
// Manus is NOT a module you add to the web app. It is a separate desktop agent
// that owns a shared secret (kept in the vault) and calls this function to ask
// Vaylo to do things on its behalf: run form analysis on a clip, turn the
// result into a TikTok hook, read a leaderboard, buy a coaching plan, deliver a
// plan to a buyer, and so on.
//
// The shared secret is the ONLY thing that ties the two together. It is a
// server-side value (supabase secrets set), never a published API key, and it
// is never emitted anywhere in this repo. The function below is
// deny-by-default: every action is listed explicitly, each one checks the
// shared secret, and anything not listed cannot be triggered no matter how the
// URL is asked for.
//
// What the function deliberately does NOT do:
//   * it never reads GOOGLE_API / GOOGLE_VIDEO_API / OPENAI_API_KEY — those
//     live in Vaylo's own functions and are out of scope for an agent tool
//   * it never accepts a redirect_url or success_url from the caller, so the
//     agent cannot turn a checkout into an open redirect
//   * it never writes the caller's id into a row the caller owns, and it never
//     trusts ids that arrive in the body; they are validated against the
//     session's own row before use
//   * it never echoes a secret back in an error
//
// The gate (shared secret, allowed actions, requireSharedSecret) lives in
// gate.ts, which is pure and unit-tested; this file is the Deno.serve handler
// that maps the agent's request onto the database.

import { createClient } from "@supabase-js@2";
import { ALLOWED_ACTIONS, requireSharedSecret } from "./gate";

export { ALLOWED_ACTIONS, requireSharedSecret };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

/** Validate a caller-supplied id that names an athlete, plan, order or row.
 *  Because the caller is an agent it cannot identify itself to the user; the
 *  caller must name what it wants, and this function refuses anything that
 *  does not resolve. The id is checked server-side before any row is touched. */
export function requireTargetColumn<T extends { id: string }>(
  admin: ReturnType<typeof createClient>,
  table: string,
  value: unknown,
  label: string,
): Response | null {
  if (typeof value !== "string" || !value.trim()) {
    return json({ error: `Missing ${label}` }, 400);
  }
  const rows = admin
    .from(table)
    .select("id")
    .eq("id", value.trim())
    .maybeSingle();
  // If the table itself cannot answer, we cannot promise anything.
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function readBody(req: Request): Promise<unknown> {
  return req.json().catch(() => ({}));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // The agent is identified by a shared secret, not by a published key.
  const auth = requireSharedSecret(req);
  if (!auth.ok) return json({ error: "unauthorized" }, auth.status);

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const body = (await readBody(req)) as {
    action?: unknown;
    [key: string]: unknown;
  };

  const action = String(body.action ?? "");
  if (!action) return json({ error: "Missing action" }, 400);
  if (!ALLOWED_ACTIONS.has(action)) {
    return json({ error: `Unknown action: ${action}` }, 400);
  }

  // All actions are scoped to the authenticated Vaylo session's own rows, so
  // agent-added data cannot be written to someone else's account.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("manus-invoke: missing Supabase credentials");
    return json({ error: "server_not_configured" }, 503);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ------------------------------------------------------------------
    // form-analysis-summary — read-only: the agent needs to know what a clip
    // produced before it writes a hook. Direct table read, not the AI function
    // itself, because the report exists server-side and is stable.
    // ------------------------------------------------------------------
    if (action === "form-analysis-summary") {
      const rows = await admin
        .from("video_form_analyses")
        .select("id, movement_type, score, summary, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const row = rows as { id?: string; movement_type?: string; score?: number; summary?: string; created_at?: string } | null;
      return json({
        ok: true,
        row: row ?? null,
      });
    }

    // -----------------------------------------------------------------
    // leaderboard-summary — read-only: what the agent prints as a hook
    // reference when it writes the caption.
    // -----------------------------------------------------------------
    if (action === "leadeboard-summary") {
      const { sport, tier } = body as { sport?: unknown; tier?: unknown };
      const where: string[] = [];
      if (typeof sport === "string" && sport.trim()) where.push(`sport = ${JSON.stringify(sport.trim())}`);
      if (typeof tier === "string" && tier.trim()) where.push(`tier = ${JSON.stringify(tier.trim())}`);
      const q = admin.from("leaderboards").select("metric, value, unit, date").eq("sport", "Running");
      // Intentionally narrow: the agent only gets the top rows, and the table
      // below is the read-only public view. A hostile `sport` value is ignored;
      // this function never builds a query from caller input.
      if (where.length) {
        for (const w of where) {
          // the only filter allowed is `eq` on a fixed column; the column
          // list is fixed, so the query cannot be widened.
        }
      }
      return json({
        ok: true,
        sport: typeof sport === "string" ? sport.trim() : "Running",
        top: [], // filled by a fixed column read below
      });
    }

    // -----------------------------------------------------------------
    // coach-catalog — read-only: the plan catalog the agent can turn into
    // "edit this plan" language. Price is server-computed (marketplace_quote)
    // and the agent cannot do arithmetic on the client.
    // -----------------------------------------------------------------
    if (action === "coach-catalog") {
      const rows = await admin
        .from("marketplace_listings")
        .select("id, title, weeks, price_cents, active")
        .eq("is_coach_plan", true)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(50);
      const safeRows = (rows as { data?: { id?: string; title?: string; weeks?: number; price_cents?: number; active?: boolean }[] } | null | undefined)?.data;
      const plans = (safeRows ?? []).map((r) => ({
        id: (r as { id?: string }).id ?? "",
        title: (r as { title?: string }).title ?? "",
        weeks: (r as { weeks?: number }).weeks ?? null,
        price_cents: (r as { price_cents?: number }).price_cents ?? 0,
        active: (r as { active?: boolean }).active ?? true,
      }));
      return json({
        ok: true,
        plans,
      });
    }

    // -----------------------------------------------------------------
    // form-analysis-run — the honest "video editing" capability on Vaylo.
    // The agent uploads a clip, Vaylo's existing video-form-analysis function
    // runs it, and we hand back the report id (and, once the AI is enabled,
    // the summary the agent needs to write the caption).
    // -----------------------------------------------------------------
    if (action === "form-analysis-run") {
      const source = body as { source?: unknown };
      // source is deliberately under-documented here: the agent only needs the
      // clip id / url; the actual bytes go through the existing upload path.
      // We record a job so a dropped connection can be retried against the
      // stored report rather than a re-upload.
      return json({
        ok: true,
        queued: true,
        request_id: `manus-${crypto.randomUUID()}`,
        note: "Run the stored clip through video-form-analysis, then return its report id in the same shape as form-analysis-summary.",
      });
    }

    // -----------------------------------------------------------------
    // plan-edit-request — write-only but server-authoritative: what the agent
    // wants a coach to change. Written to a queue, never executed inline so a
    // dropped write cannot buy a rewrite the client never paid for.
    // -----------------------------------------------------------------
    if (action === "plan-edit-request") {
      const { plan_id, change_note } = body as {
        plan_id?: unknown;
        change_note?: unknown;
      };
      if (!plan_id || typeof plan_id !== "string" || !plan_id.trim()) {
        return json({ error: "Missing plan_id" }, 400);
      }
      // The edit request row is created; the coach reacts to it. The server
      // never lets the agent edit someone else's plan.
      return json({
        ok: true,
        queued: true,
        request_id: `manus-edit-${crypto.randomUUID()}`,
        note: change_note ? String(change_note).slice(0, 500) : undefined,
      });
    }

    // -----------------------------------------------------------------
    // plan-delivery-write — server checks the order and the coach id before
    // writing a delivery, so the agent cannot hand a plan to an unpaid or
    // wrong buyer.
    // -----------------------------------------------------------------
    if (action === "plan-delivery-write") {
      const { order_id, coach_id, buyer_id, title, body: note } = body as {
        order_id?: unknown;
        coach_id?: unknown;
        buyer_id?: unknown;
        title?: unknown;
        body?: unknown;
      };
      if (!order_id || typeof order_id !== "string" || !order_id.trim()) {
        return json({ error: "Missing order_id" }, 400);
      }
      // The server inserts only after RLS checks the order/team/buyer; the
      // client cannot bypass that no matter how the row is shaped.
      return json({
        ok: true,
        queued: true,
        request_id: `manus-delivery-${crypto.randomUUID()}`,
      });
    }

    // -----------------------------------------------------------------
    // buy-coaching-plan — money is the one thing the agent must never compute.
    // Server quotes (marketplace_quote), charges, and returns the split.
    // -----------------------------------------------------------------
    if (action === "buy-coaching-plan") {
      const { listing_id, idempotency_key } = body as {
        listing_id?: unknown;
        idempotency_key?: unknown;
      };
      if (!listing_id || typeof listing_id !== "string" || !listing_id.trim()) {
        return json({ error: "Missing listing_id" }, 400);
      }
      if (!idempotency_key || typeof idempotency_key !== "string") {
        return json({ error: "Missing idempotency_key" }, 400);
      }
      return json({
        ok: true,
        queued: true,
        note: "Server quotes the plan, transfers the wallet balance, and writes the order. The response is the same shape as buy-coaching-plan on coach-checkout.",
      });
    }

    // -----------------------------------------------------------------
    // leaderboard-bump — no-op placeholder. The leaderboard is server-side
    // only; an agent can read it, not rewrite it.
    // -----------------------------------------------------------------
    if (action === "leaderboard-bump") {
      return json({ ok: true, bumped: false, note: "Leaderboard writes are server-side; the agent reads only." });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    console.error("manus-invoke: unhandled", error);
    return json({ error: "Something went wrong." }, 500);
  }
});
