/**
 * guard.ts — shared security helpers for edge functions that spend AI budget.
 *
 * Every AI function gets, in one import:
 *  • authenticate()  — verifies the caller's JWT (never trust the anon key alone)
 *  • aiCallAllowed() — durable per-user rate limit, counted in Postgres
 *  • throttled()     — cheap in-memory pre-filter (per isolate; see aiCallAllowed)
 *  • readJsonBody()  — strict JSON parse with a hard request-size cap
 *  • edgeError()     — client-side helper: surface a function error's message
 *  • spendForUser()  — authoritative server-side credit charge via credits_spend()
 *
 * Why server-side charging matters: credits used to be deducted in the browser
 * before the function was invoked. Anything computed client-side is an
 * attacker's to skip — a direct functions.invoke() call with no spend step could
 * burn OpenAI budget for free. Charging inside the function closes that hole;
 * the client now calls the function and reads { cost, balance } from the reply.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { beginServiceJob } from "./serviceJobs.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

// ---------------------------------------------------------------------------
// Auth — verify the caller's JWT and return their user id
// ---------------------------------------------------------------------------

export async function authenticate(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------
// Two layers, and the second one is the one that counts.
//
// The in-memory window below is per isolate: Supabase runs each function on
// several instances and recycles them, so it resets on a cold start and is not
// shared between instances. Useful for turning away a flood without a database
// round trip; useless as a bound on what a script can spend.
//
// aiCallAllowed() counts in Postgres, where every instance sees the same rows.
// It fails OPEN — if the database is unreachable the call proceeds, because an
// outage in the limiter should not take the coach offline. Credits remain the
// real bound; this is the thing that stops the spend rate, not the total.

export async function aiCallAllowed(
  req: Request,
  userId: string,
  feature: string,
  opts: { max?: number; windowSeconds?: number } = {}
): Promise<boolean> {
  const max = opts.max ?? 20;
  const windowSeconds = opts.windowSeconds ?? 60;
  // The caller's own JWT, so auth.uid() inside ai_call_allowed() resolves to
  // the athlete making the call rather than to nobody.
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) return false;
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await supabase.rpc("ai_call_allowed", {
      p_feature: feature,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.warn(`ai_call_allowed failed for ${userId}, failing open:`, error.message);
      return true;
    }
    return data === true;
  } catch (e) {
    console.warn("ai_call_allowed threw, failing open:", e);
    return true;
  }
}

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();

/** Per-isolate pre-filter. See aiCallAllowed() for the limit that actually binds. */
export function throttled(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent);
    return true;
  }
  recent.push(now);
  hits.set(userId, recent);
  // Map can only grow with distinct user ids; reset well before it can matter.
  if (hits.size > 5000) hits.clear();
  return false;
}

// ---------------------------------------------------------------------------
// Body — strict JSON with a hard size cap
// ---------------------------------------------------------------------------

/** 10 MB covers a downscaled photo as base64 with headroom; anything bigger is abuse. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  try {
    const text = await req.text();
    // Content-Length can lie (chunked uploads) — enforce on the raw text too.
    if (text.length > MAX_BODY_BYTES) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Data-URL images: require image/* MIME, cap the decoded byte size.
 * base64-encoded bytes ≈ len(chars) × 3/4 (data-URL prefix is a few dozen bytes
 * and pushes the estimate up slightly — err on the strict side).
 *
 * The allowlist is WHAT THE VISION PROVIDER CAN READ, not what looks like a
 * photo. HEIC/HEIF used to sit here, which made ai-analyze validate an
 * iPhone library photo, charge its credit, then fail at the provider (their
 * image input cannot decode HEIC) and refund it — scan always failing for
 * exactly the gallery photos iPhones produce. The client normalises photos
 * to JPEG before upload (src/lib/mealImage.ts) where the browser can decode,
 * and tells the athlete to use the camera button where it can't.
 */
export function validImagePayload(image: unknown, maxBytes = 8 * 1024 * 1024): string | null {
  if (typeof image !== "string") return null;
  const mimeMatch = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  if (!mimeMatch) return null;
  const mime = mimeMatch[1];
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(mime)) return null;
  const approxBytes = Math.floor((image.length * 3) / 4);
  if (approxBytes <= 0 || approxBytes > maxBytes) return null;
  return image;
}

// ---------------------------------------------------------------------------
// Credits — authoritative server-side charge
// ---------------------------------------------------------------------------

export interface CreditSpend {
  success: boolean;
  unlimited: boolean;
  cost: number;
  balance: number;
  error?: string;
  shortfall?: number;
  duplicate?: boolean;
  /**
   * The key credits_spend/credits_spend_metered recorded on the charge
   * transaction, so a refund can derive its own deterministic key from it.
   * Present whenever the charge succeeded; charge failures carry none.
   */
  idempotencyKey?: string;
}

/**
 * Charges the signed-in user through the shared server deduction path. Cost is
 * resolved server-side from economy_config — the client never names a price.
 * Ordinary features honor Unlimited; selected provider-costly features may opt
 * into server-only metering via credits_spend_metered even for those plans.
 */
export async function spendForUser(
  req: Request,
  userId: string,
  feature: string,
  reason: string,
  opts: { quantity?: number; source?: string; idempotencyKey?: string; billUnlimited?: boolean } = {},
): Promise<CreditSpend> {
  let data: Record<string, unknown> | null = null;
  let error: { message: string } | null = null;
  let usedKey: string | undefined;

  const spendKey = opts.idempotencyKey ?? crypto.randomUUID();

  if (opts.billUnlimited) {
    // For metered high-cost features, an Unlimited subscription does not exempt
    // the request. The service role is restricted to this internal Edge path;
    // never accept a client-controlled idempotency key for a credit debit.
    const authorization = (req.headers.get("Authorization") ?? "").trim();
    if (!authorization) {
      return { success: false, unlimited: false, cost: 0, balance: 0, error: "Not authenticated" };
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Always charge under a real key: retries of the same spend collapse into
    // one debit, and refunds derive `refund:<key>` from it.
    const metered = await admin.rpc("credits_spend_metered", {
      p_user_id: userId,
      p_feature: feature,
      p_reason: reason,
      p_source: opts.source ?? "edge",
      p_idempotency_key: spendKey,
      p_metadata: {},
    });
    data = metered.data as Record<string, unknown> | null;
    error = metered.error;
    usedKey = data?.success === true ? spendKey : undefined;
  } else {
    // credits_spend() uses auth.uid() to scope the locked profile row. A
    // service-role JWT has no athlete sub, so use the verified caller's JWT
    // through the anon client for the ordinary (subscription-aware) path.
    const authorization = (req.headers.get("Authorization") ?? "").trim();
    if (!authorization) {
      return { success: false, unlimited: false, cost: 0, balance: 0, error: "Not authenticated" };
    }
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const spend = await client.rpc("credits_spend", {
      p_feature: feature,
      p_reason: reason,
      p_quantity: Math.max(1, opts.quantity ?? 1),
      p_source: opts.source ?? "edge",
      // Retry-safe: pass a per-request idempotency key so a retry cannot double-charge.
      p_idempotency_key: spendKey,
      p_metadata: {},
    });
    data = spend.data as Record<string, unknown> | null;
    error = spend.error;
    usedKey = data?.success === true ? spendKey : undefined;
  }
  if (error) return { success: false, unlimited: false, cost: 0, balance: 0, error: error.message };

  // The refund system needs to know which charged call this was. Recording a
  // started job here (rather than in each AI function) means every charged call
  // is linked to its ledger debit even if a later code path forgets to mark the
  // outcome — and "started with no outcome" is treated by the refund engine as
  // unverified, never as failed. Best-effort: bookkeeping cannot fail a charge.
  if (data?.success === true && usedKey && Number(data?.cost ?? 0) > 0) {
    await beginServiceJob({
      supabaseUrl: Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      userId,
      feature,
      chargeKey: usedKey,
      credits: Number(data?.cost ?? 0),
      metadata: { source: opts.source ?? "edge" },
    });
  }

  return {
    success: !!data?.success,
    unlimited: !!data?.unlimited,
    cost: Number(data?.cost ?? 0),
    balance: Number(data?.balance ?? 0),
    error: typeof data?.error === "string" ? data.error : undefined,
    shortfall: typeof data?.shortfall === "number" ? data.shortfall : undefined,
    duplicate: data?.duplicate === true,
    idempotencyKey: usedKey,
  };
}

/** True when the user holds a one-off purchase product (e.g. "injury_management"). */
export async function userOwnsProduct(userId: string, product: string): Promise<boolean> {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await admin
      .from("user_purchases")
      .select("product_id")
      .eq("user_id", userId)
      .eq("product_id", product)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Statuses that represent a plan the user is currently entitled to. Mirrors the
 * `status IN (...)` list in public.has_unlimited_credits() — keep the two in
 * sync, or the browser and the database will disagree about who is paying.
 */
const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "renewing", "lifetime", "trial"];

/**
 * True when the user has a live subscription or a one-off purchase with the
 * given product id (used for "unlock"-style features such as form_analysis).
 *
 * Two traps this deliberately guards against:
 *  • `unlimited_credits` is NOT cleared when a plan lapses —
 *    cancel_my_subscription() leaves the flag set and only flips `status` — so
 *    the flag alone must never be treated as proof of payment.
 *  • An `active` row keeps saying `active` after `expires_at` passes, because
 *    nothing rewrites the row on expiry (get_my_entitlements() only derives an
 *    'expired' status at read time). Reading the timestamp here is the same
 *    check that function performs.
 */
export async function hasEntitlement(userId: string, product: string): Promise<boolean> {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: sub } = await admin
      .from("subscriptions")
      .select("status, unlimited_credits, is_lifetime, expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    const isLifetime = sub?.is_lifetime === true;
    const liveStatus = LIVE_SUBSCRIPTION_STATUSES.includes(String(sub?.status ?? ""));
    const lapsed = !!sub?.expires_at && new Date(sub.expires_at as string).getTime() <= Date.now();

    // A live plan unlocks unlock-style features; a lapsed one does not, even if
    // its row still carries `unlimited_credits: true` or `status: 'active'`.
    if (isLifetime || (liveStatus && !lapsed)) return true;
    return await userOwnsProduct(userId, product);
  } catch {
    return false;
  }
}
