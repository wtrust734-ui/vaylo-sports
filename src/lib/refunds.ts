// ============================================================================
// Refund client — the only way the app talks to the refund system
// ----------------------------------------------------------------------------
// All decisions happen server-side (supabase/functions/refund-request and
// refund-admin). This module supplies types and transport, and re-exports the
// policy vocabulary so the screen and the server cannot disagree about a status
// label or which reasons apply to which transaction.
//
// The shared module is imported directly rather than copied: a duplicated label
// list has already drifted in this codebase once, and "Declined" vs "Rejected"
// between a mail, the server and the app is the kind of difference a customer
// notices at the worst moment.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import {
  REFUND_REASONS,
  REFUND_STATUS_LABELS,
  evaluateRefundRequest,
  reasonByCode,
  reasonsForSource,
  type RefundDecision,
  type RefundFacts,
  type RefundKind,
  type RefundReason,
  type RefundSourceType,
  type RefundStatus,
} from "../../supabase/functions/_shared/refundPolicy";

export {
  REFUND_REASONS,
  REFUND_STATUS_LABELS,
  evaluateRefundRequest,
  reasonByCode,
  reasonsForSource,
};
export type { RefundDecision, RefundFacts, RefundKind, RefundReason, RefundSourceType, RefundStatus };

export type RefundJobStatus = "started" | "delivered" | "failed";

export interface RefundCaseView {
  ref: string;
  kind: RefundKind;
  sourceType: RefundSourceType;
  reasonCode: string;
  details: string | null;
  feature: string | null;
  credits: number | null;
  amountCents: number | null;
  currency: string;
  status: RefundStatus | string;
  resolution: string | null;
  decisionNote: string | null;
  escalationRules: string[];
  canEscalate: boolean;
  providerState: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  completedAt: string | null;
}

export interface RefundTimelineEntry {
  label: string;
  actor: string;
  at: string;
}

export interface RefundChargeOption {
  id: string;
  feature: string | null;
  reason: string;
  credits: number;
  createdAt: string;
  jobStatus: RefundJobStatus | null;
  alreadyRefunded: boolean;
  existingCase: { ref: string; status: string } | null;
  reasons: string[];
}

export interface RefundPurchaseOption {
  id: string;
  productId: string;
  productType: string;
  priceCents: number;
  currency: string;
  purchasedAt: string;
  creditsGranted: number | null;
  creditsUnused: number | null;
  refundable: boolean;
  existingCase: { ref: string; status: string } | null;
  reasons: string[];
}

export interface RefundOptions {
  balance: { credits: number; infinite: boolean };
  charges: RefundChargeOption[];
  purchases: RefundPurchaseOption[];
  subscription: {
    planType: string;
    status: string;
    startedAt: string | null;
    expiresAt: string | null;
    reasons: string[];
  } | null;
  cases: RefundCaseView[];
  provider: { id: string; refundsEnabled: boolean };
  moneyExecutionEnabled: boolean;
}

export interface SubmitRefundInput {
  sourceType: RefundSourceType;
  reasonCode: string;
  details?: string;
  chargeId?: string;
  purchaseId?: string;
  submissionKey: string;
}

export interface SubmitRefundResult {
  case: RefundCaseView;
  message?: string;
  balance?: number | null;
  canEscalate?: boolean;
  duplicate?: boolean;
}

async function call<T>(fn: "refund-request" | "refund-admin", body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw new Error(await edgeErrorMessage(error));
  const payload = data as { error?: unknown } | null;
  if (payload && typeof payload.error === "string" && payload.error) {
    throw new Error(payload.error);
  }
  return data as T;
}

export function loadRefundOptions(): Promise<RefundOptions> {
  return call<RefundOptions>("refund-request", { action: "options" });
}

export function submitRefund(input: SubmitRefundInput): Promise<SubmitRefundResult> {
  return call<SubmitRefundResult>("refund-request", { action: "submit", ...input });
}

export function loadRefundCase(ref: string): Promise<{ case: RefundCaseView; timeline: RefundTimelineEntry[] }> {
  return call("refund-request", { action: "case", ref });
}

export function escalateRefundCase(ref: string): Promise<{ case: RefundCaseView; message?: string }> {
  return call("refund-request", { action: "escalate", ref });
}

// ---------------------------------------------------------------------------
// Administrator transport
// ---------------------------------------------------------------------------

export interface AdminRefundCase extends RefundCaseView {
  id: string;
  userId: string;
  submissionKey: string;
  adminNote: string | null;
  provider: string | null;
  providerRefundId: string | null;
}

export interface AdminRefundDetail {
  case: {
    id: string;
    public_ref: string;
    user_id: string;
    kind: RefundKind;
    source_type: RefundSourceType;
    status: RefundStatus;
    reason_code: string;
    details: string | null;
    feature: string | null;
    credits_requested: number | null;
    amount_cents: number | null;
    currency: string;
    escalation_rules: string[];
    eligibility: Record<string, unknown>;
    admin_note: string | null;
    provider: string | null;
    provider_refund_id: string | null;
    provider_state: string | null;
    created_at: string;
    updated_at: string;
    decided_at: string | null;
    completed_at: string | null;
  };
  events: Array<{
    event: string;
    actor_type: string;
    actor_id: string | null;
    detail: Record<string, unknown>;
    created_at: string;
  }>;
  charge: {
    id: string;
    amount: number;
    reason: string;
    feature: string | null;
    source: string;
    balance_after: number | null;
    created_at: string;
    idempotency_key: string | null;
  } | null;
  refundGrants: Array<{
    id: string;
    amount: number;
    reason: string;
    source: string;
    created_at: string;
    idempotency_key: string | null;
  }>;
  serviceJob: {
    id: string;
    feature: string;
    status: RefundJobStatus;
    error_code: string | null;
    started_at: string;
    finished_at: string | null;
  } | null;
  purchase: {
    id: string;
    product_id: string;
    product_type: string;
    price_cents: number;
    currency: string;
    purchased_at: string;
    provider_reference: string | null;
    platform: string | null;
  } | null;
  history: Array<{ public_ref: string; status: string; resolution: string | null; created_at: string }>;
  provider: { id: string; configured: boolean; canInitiateRefund: boolean };
  actions: { canApprove: boolean; canReject: boolean; approveOperation: string };
}

export function listAdminRefunds(status: "open" | "all" | RefundStatus = "open") {
  return call<{ cases: AdminRefundDetail["case"][]; counts: { open: number; total: number } }>(
    "refund-admin",
    { action: "list", status }
  );
}

export function getAdminRefund(ref: string): Promise<AdminRefundDetail> {
  return call<AdminRefundDetail>("refund-admin", { action: "get", ref });
}

export function decideAdminRefund(
  ref: string,
  decision: "approve" | "reject",
  note?: string
): Promise<{ case: AdminRefundDetail["case"]; message: string; moneyMoved?: boolean }> {
  return call("refund-admin", { action: "decide", ref, decision, note });
}

export function retryAdminRefundNotification(ref: string) {
  return call<{ attempted: number; sent: number; failed: number; case: AdminRefundDetail["case"] }>(
    "refund-admin",
    { action: "retry_notification", ref }
  );
}

/** Statuses that mean the customer is still waiting. */
export const OPEN_STATUSES: RefundStatus[] = [
  "submitted",
  "under_review",
  "approved_processing",
  "awaiting_provider",
];

export function statusTone(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "declined":
      return "bg-rose-500/10 text-rose-300 border-rose-500/30";
    case "processing_failed":
      return "bg-amber-500/10 text-amber-300 border-amber-500/30";
    case "awaiting_provider":
      return "bg-sky-500/10 text-sky-300 border-sky-500/30";
    case "approved_processing":
      return "bg-violet-500/15 text-violet-200 border-violet-500/30";
    default:
      return "bg-white/5 text-muted-foreground border-white/10";
  }
}

export function statusLabel(status: string): string {
  return REFUND_STATUS_LABELS[status as RefundStatus] ?? status;
}
