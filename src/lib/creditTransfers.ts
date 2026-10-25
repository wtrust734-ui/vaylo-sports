// ECONOMY REMOVED — Vaylo Sports 1.5.0
// Credit transfer functions are deleted; the RPCs it called no longer exist.
// This file is retained as a stub so importers do not break the build.
export const TRANSFER_MAX_AMOUNT = 50;
export const TRANSFER_EXPIRY_DAYS = 7;
export function messageFromPostgresError(err: { message?: string } | null): string {  return "This feature is gone — the economy was removed in Vaylo Sports 1.5.0.";}
export async function sendCreditTransfer(  _receiverId: string,  _amount: number,  _note?: string): Promise<{ ok: true; transferId: string } | { ok: false; error: string }> {  return { ok: false, error: messageFromPostgresError(null) };}
export async function claimCreditTransfer(  _transferId: string): Promise<{ ok: true; newBalance: number } | { ok: false; error: string }> {  return { ok: false, error: messageFromPostgresError(null) };}
export async function declineCreditTransfer(  _transferId: string): Promise<{ ok: boolean }> {  return { ok: true };}
export async function setTransferAuth(  _allowedSenderId: string,  _allow: boolean): Promise<void> {  /* no-op */}
export async function fetchIncomingTransfers(): Promise<{ id: string; amount: number; created_at: string; expires_at: string; note: string | null; status: string }[]> {  return [];}
export {};
