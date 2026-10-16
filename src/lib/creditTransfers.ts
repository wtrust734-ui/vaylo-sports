// ============================================================================
// CREDIT TRANSFERS — client seam
// ----------------------------------------------------------------------------
// Thin wrapper over the three transfer RPCs. Every rule (authorization,
// amount caps, one-pending-per-pair, refund-on-decline/expire) is enforced in
// the database (20261016100000_credit_transfers.sql); this module only makes
// the RPCs pleasant to call and their refusals readable.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

export type TransferSendResult =
  | { ok: true; transferId: string }
  | { ok: false; error: string; insufficient?: boolean; unauthorized?: boolean; pendingExists?: boolean };

export type TransferClaimResult =
  | { ok: true; newBalance: number }
  | { ok: false; error: string };

export type TransferDeclineResult = { ok: boolean; error?: string };

export interface PendingTransfer {
  id: string;
  amount: number;
  created_at: string;
  expires_at: string;
  note: string | null;
  status: string;
}

export const TRANSFER_MAX_AMOUNT = 50;
/** Sent transfers expire and refund automatically after this long. */
export const TRANSFER_EXPIRY_DAYS = 7;

function messageFromPostgresError(err: { message?: string } | null): string {
  const raw = err?.message ?? "Transfer failed. Please try again.";
  if (/insufficient credits/i.test(raw)) return "Not enough credits for that amount.";
  if (/not authorized/i.test(raw)) {
    return "They haven't allowed transfers from you yet. Ask them to add you first.";
  }
  if (/already pending/i.test(raw)) {
    return "A transfer between you two is already waiting to be claimed.";
  }
  if (/invalid amount/i.test(raw)) {
    return `Transfers are 1–${TRANSFER_MAX_AMOUNT} credits.`;
  }
  return raw;
}

/**
 * Send credits to another athlete. Fails unless they have authorized this
 * account — there is deliberately no way to push credits uninvited.
 */
export async function sendCreditTransfer(
  receiverId: string,
  amount: number,
  note?: string
): Promise<TransferSendResult> {
  const { data, error } = await supabase.rpc("credit_transfer_send" as never, {
    p_receiver: receiverId,
    p_amount: amount,
    p_note: note?.trim() ? note.trim().slice(0, 200) : null,
  } as never);
  if (error) {
    return {
      ok: false,
      error: messageFromPostgresError(error),
      insufficient: /insufficient/i.test(error.message),
      unauthorized: /not authorized/i.test(error.message),
      pendingExists: /already pending/i.test(error.message),
    };
  }
  return { ok: true, transferId: String(data) };
}

/** Claim a pending transfer addressed to this account. */
export async function claimCreditTransfer(transferId: string): Promise<TransferClaimResult> {
  const { data, error } = await supabase.rpc("credit_transfer_claim" as never, {
    p_transfer: transferId,
  } as never);
  if (error) {
    return { ok: false, error: messageFromPostgresError(error) };
  }
  return { ok: true, newBalance: Number(data) };
}

/** Decline a pending transfer; the sender is refunded immediately. */
export async function declineCreditTransfer(transferId: string): Promise<TransferDeclineResult> {
  const { error } = await supabase.rpc("credit_transfer_decline" as never, {
    p_transfer: transferId,
  } as never);
  if (error) return { ok: false, error: messageFromPostgresError(error) };
  return { ok: true };
}

/** Allow / disallow an account to send credits to this one. */
export async function setTransferAuth(allowedSenderId: string, allow: boolean): Promise<void> {
  const { error } = await supabase.rpc("credit_transfer_set_auth" as never, {
    p_allowed_sender: allowedSenderId,
    p_allow: allow,
  } as never);
  if (error) throw new Error(error.message);
}

/** Pending transfers addressed to this account (to claim or decline). */
export async function fetchIncomingTransfers(): Promise<PendingTransfer[]> {
  // The generated supabase types predate this migration; the cast is cosmetic
  // and disappears on the next `supabase gen types` run.
  const { data, error } = await supabase
    .from("credit_transfers" as never)
    .select("id, amount, created_at, expires_at, note, status")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((r) => r.status === "pending")
    .map((r) => ({
      id: String(r.id),
      amount: Number(r.amount),
      created_at: String(r.created_at),
      expires_at: String(r.expires_at),
      note: r.note == null ? null : String(r.note),
      status: String(r.status),
    }));
}
