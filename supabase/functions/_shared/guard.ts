/**
 * guard.ts — shared security helpers for edge functions that spend AI budget.
 *
 * Every AI function gets, in one import:
 *  • authenticate()  — verifies the caller's JWT (never trust the anon key alone)
 *  • throttled()     — best-effort per-user sliding-window throttle (per isolate)
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
// Throttle — per-user sliding window, per isolate (abuse guard, not billing)
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();

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
 */
export function validImagePayload(image: unknown, maxBytes = 8 * 1024 * 1024): string | null {
  if (typeof image !== "string") return null;
  const mimeMatch = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  if (!mimeMatch) return null;
  const mime = mimeMatch[1];
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
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
}

/**
 * Charges the signed-in user through the single shared deduction path
 * (credits_spend RPC). Cost is resolved server-side from economy_config —
 * the client never gets to name a price. Honours Unlimited subscriptions.
 */
export async function spendForUser(
  userId: string,
  feature: string,
  reason: string,
  opts: { quantity?: number; source?: string } = {},
): Promise<CreditSpend> {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: spend, error } = await admin.rpc("credits_spend", {
    p_feature: feature,
    p_reason: reason,
    p_quantity: Math.max(1, opts.quantity ?? 1),
    p_source: opts.source ?? "edge",
    p_idempotency_key: null,
    p_metadata: {},
  });
  if (error) return { success: false, unlimited: false, cost: 0, balance: 0, error: error.message };
  return {
    success: !!spend?.success,
    unlimited: !!spend?.unlimited,
    cost: spend?.cost ?? 0,
    balance: spend?.balance ?? 0,
    error: spend?.error,
    shortfall: spend?.shortfall,
  };
}

/** True when the user holds a one-off purchase product (e.g. "nutrition_pack"). */
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
 * True when the user has an active subscription or a one-off purchase with the
 * given product id (used for "unlock"-style features such as form_analysis).
 */
export async function hasEntitlement(userId: string, product: string): Promise<boolean> {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: sub } = await admin
      .from("subscriptions")
      .select("status, unlimited_credits, is_lifetime")
      .eq("user_id", userId)
      .maybeSingle();
    const active =
      sub?.is_lifetime === true ||
      sub?.unlimited_credits === true ||
      sub?.status === "active" ||
      sub?.status === "trial";
    if (active) return true;
    return await userOwnsProduct(userId, product);
  } catch {
    return false;
  }
}
