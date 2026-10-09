/** Refund a recorded debit once; the database derives the amount from the ledger. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

interface RefundArgs {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  amount: number;
  debitKey: string;
  reason: string;
  /** Ledger source, e.g. "refund". */
  source?: string;
}

export async function refundCredits({
  supabaseUrl,
  serviceRoleKey,
  userId,
  amount,
  debitKey,
  reason,
  source = "refund",
}: RefundArgs): Promise<boolean> {
  if (!debitKey || !amount || amount <= 0) return false;
  try {
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await admin.rpc("credits_refund", {
      p_user: userId,
      p_debit_key: debitKey,
      p_reason: reason,
      p_source: source,
    });
    if (error || !data?.success) {
      console.error("credit refund failed:", error?.message ?? "Debit not found");
      return false;
    }
    console.log(`refunded ${amount} credits to ${userId}: ${reason}`);
    return true;
  } catch (e) {
    console.error("credit refund threw:", e);
    return false;
  }
}
