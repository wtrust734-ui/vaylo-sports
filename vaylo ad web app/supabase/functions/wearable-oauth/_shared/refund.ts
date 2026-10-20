/**
 * refundCredits — return credits that were charged before an AI call failed.
 *
 * Why this exists: coach-chat and weekly-review deduct credits up-front (single
 * authoritative path via credits_spend) and then call OpenAI. If the provider
 * fails, the athlete has paid for nothing. This grants the charge back through
 * the service-role-only credits_grant RPC, which the client cannot call.
 *
 * Each refund uses a unique idempotency key on purpose: every charge is a
 * separate payment, so every failure gets exactly one matching refund.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

interface RefundArgs {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  amount: number;
  reason: string;
  /** Ledger source, e.g. "refund". */
  source?: string;
}

export async function refundCredits({
  supabaseUrl,
  serviceRoleKey,
  userId,
  amount,
  reason,
  source = "refund",
}: RefundArgs): Promise<boolean> {
  if (!amount || amount <= 0) return false;
  try {
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await admin.rpc("credits_grant", {
      p_user: userId,
      p_amount: amount,
      p_reason: reason,
      p_source: source,
      p_idempotency_key: `refund:${crypto.randomUUID()}`,
      p_metadata: { kind: "refund" },
    });
    if (error) {
      console.error("credit refund failed:", error.message);
      return false;
    }
    console.log(`refunded ${amount} credits to ${userId}: ${reason}`);
    return true;
  } catch (e) {
    console.error("credit refund threw:", e);
    return false;
  }
}
