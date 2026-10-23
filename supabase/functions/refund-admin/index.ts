// ============================================================================
// REFUND-ADMIN — the private review desk
// ----------------------------------------------------------------------------
// Every action re-checks the caller's role server-side. The client's route guard
// only decides what to draw; `has_role(auth.uid(),'admin')` here is the control,
// and every write additionally goes through a SECURITY DEFINER RPC that locks
// the case row and refuses a second decision.
//
// Approve semantics, stated plainly:
//   credits       the ledger grant runs now (refund_execute_credit_restore)
//   money         a provider is asked. No provider connected, or one that cannot
//                 initiate refunds, means the case becomes 'awaiting_provider'.
//                 It is NEVER marked completed, because no money moved.
//   subscription  same rule as money.
//
// Nothing here can turn an approval into a fake completed refund: the only path
// to monetary 'completed' requires a provider-issued refund reference, and that
// check lives inside refund_case_record_provider_decision().
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { authenticate, json, readJsonBody } from "../_shared/guard.ts";
import { refundProvider } from "../_shared/refundProvider.ts";
import { notifyCustomerOfCase, retryDueNotifications } from "../_shared/refundNotify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACTIVE_STATUSES = ["submitted", "under_review", "approved_processing", "awaiting_provider"];

// See supabase/functions/_shared/refundNotify.ts: the default `SupabaseClient`
// type arguments keep the schema usable; `ReturnType<typeof createClient>`
// collapses it to `never`.
type Admin = SupabaseClient;

type CaseRow = {
  id: string;
  public_ref: string;
  user_id: string;
  kind: "credits" | "money" | "subscription";
  source_type: string;
  reason_code: string;
  details: string | null;
  charge_key: string | null;
  charge_transaction_id: string | null;
  purchase_id: string | null;
  service_job_id: string | null;
  feature: string | null;
  credits_requested: number | null;
  amount_cents: number | null;
  currency: string;
  status: string;
  resolution: string | null;
  escalation_rules: string[];
  eligibility: Record<string, unknown>;
  admin_id: string | null;
  admin_note: string | null;
  provider: string | null;
  provider_refund_id: string | null;
  provider_state: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  completed_at: string | null;
};

const adminClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function isAdmin(admin: Admin, userId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  return !error && data === true;
}

async function loadCase(admin: Admin, ref: string): Promise<CaseRow | null> {
  const { data } = await admin
    .from("refund_cases")
    .select("*")
    .eq("public_ref", ref)
    .maybeSingle();
  return (data as CaseRow | null) ?? null;
}

/**
 * Everything the reviewer needs to decide, assembled server-side. All queries
 * are scoped to the case's own athlete; a case reference is not permission to
 * read somebody else's ledger.
 */
async function caseDetail(admin: Admin, row: CaseRow) {
  const [events, charge, refunds, job, purchase, priorCases] = await Promise.all([
    admin
      .from("refund_case_events")
      .select("event, actor_type, actor_id, detail, created_at")
      .eq("case_id", row.id)
      .order("created_at", { ascending: true }),
    row.charge_transaction_id
      ? admin
          .from("credit_transactions")
          .select("id, amount, reason, feature, source, balance_after, created_at, idempotency_key")
          .eq("id", row.charge_transaction_id)
          .eq("user_id", row.user_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    row.charge_key
      ? admin
          .from("credit_transactions")
          .select("id, amount, reason, source, created_at, idempotency_key")
          .eq("user_id", row.user_id)
          .ilike("idempotency_key", `refund:${row.charge_key}%`)
      : Promise.resolve({ data: [] }),
    row.service_job_id
      ? admin
          .from("service_jobs")
          .select("id, feature, status, error_code, started_at, finished_at")
          .eq("id", row.service_job_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    row.purchase_id
      ? admin
          .from("user_purchases")
          .select("id, product_id, product_type, price_cents, currency, purchased_at, provider_reference, platform")
          .eq("id", row.purchase_id)
          .eq("user_id", row.user_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("refund_cases")
      .select("public_ref, status, resolution, created_at")
      .eq("user_id", row.user_id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return {
    case: row,
    events: events.data ?? [],
    charge: charge.data ?? null,
    refundGrants: refunds.data ?? [],
    serviceJob: job.data ?? null,
    purchase: purchase.data ?? null,
    history: (priorCases.data ?? []).filter((c: { public_ref: string }) => c.public_ref !== row.public_ref),
    provider: {
      id: refundProvider().id,
      configured: refundProvider().isConfigured(),
      canInitiateRefund: refundProvider().capabilities.initiate_refund && refundProvider().isConfigured(),
    },
    actions: {
      canApprove: ACTIVE_STATUSES.includes(row.status),
      canReject: ACTIVE_STATUSES.includes(row.status),
      approveOperation:
        row.kind === "credits"
          ? `Restore ${row.credits_requested ?? 0} credits to the athlete's ledger now.`
          : "Record the money decision. No money moves until a verified payment provider executes it.",
    },
  };
}

async function handleDecide(
  admin: Admin,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  const decision = String(body.decision ?? "");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  if (!ref) return json({ error: "Missing case reference." }, 400);
  if (decision !== "approve" && decision !== "reject") {
    return json({ error: "Decision must be approve or reject." }, 400);
  }

  const row = await loadCase(admin, ref);
  if (!row) return json({ error: "That case does not exist." }, 404);

  if (!ACTIVE_STATUSES.includes(row.status)) {
    return json(
      { error: "This case has already been decided.", status: row.status, case: row },
      409
    );
  }

  if (decision === "reject") {
    if (note.length < 3) {
      return json({ error: "A reason is required to reject a request." }, 400);
    }
    const { data: result, error } = await admin.rpc("refund_case_reject", {
      p_case_id: row.id,
      p_admin_id: userId,
      p_reason: note,
    });
    if (error) {
      console.error("refund reject failed", error.message);
      return json({ error: "The decision could not be recorded." }, 500);
    }
    const payload = result as { success?: boolean; error?: string; duplicate?: boolean } | null;
    if (!payload?.success) {
      return json({ error: payload?.error ?? "The decision could not be recorded." }, 409);
    }
    const updated = (await loadCase(admin, ref)) ?? row;

    await notifyCustomerOfCase(admin, {
      caseId: row.id,
      userId: row.user_id,
      publicRef: row.public_ref,
      status: "Declined",
      dedupeKey: "status:declined",
      message: "We reviewed your request and could not approve it.",
      note,
    });

    return json({ case: updated, message: "Request rejected and recorded." });
  }

  // ---- Approve ------------------------------------------------------------
  if (row.kind === "credits") {
    const { data: result, error } = await admin.rpc("refund_execute_credit_restore", {
      p_case_id: row.id,
      p_admin_id: userId,
      p_source: "refund",
    });
    if (error) {
      console.error("credit restoration failed", error.message);
      return json({ error: "The credits could not be restored." }, 500);
    }
    const payload = result as
      | { success?: boolean; error?: string; duplicate?: boolean; balance?: number }
      | null;
    if (!payload?.success) {
      if (payload?.error === "already_restored") {
        const updated = (await loadCase(admin, ref)) ?? row;
        return json(
          { error: "Credits for this transaction were already restored.", case: updated },
          409
        );
      }
      return json({ error: payload?.error ?? "The credits could not be restored." }, 409);
    }

    const updated = (await loadCase(admin, ref)) ?? row;
    await notifyCustomerOfCase(admin, {
      caseId: row.id,
      userId: row.user_id,
      publicRef: row.public_ref,
      status: "Refund completed",
      dedupeKey: "status:completed",
      message: "We approved your request and the credits have been returned to your balance.",
      note: note || null,
    });
    return json({
      case: updated,
      message: `Approved. ${row.credits_requested ?? 0} credits restored.`,
      duplicate: payload.duplicate === true,
      balance: payload.balance ?? null,
    });
  }

  // ---- Approve money / subscription --------------------------------------
  const provider = refundProvider();
  const canExecute = provider.isConfigured() && provider.capabilities.initiate_refund;

  if (!canExecute) {
    const { data: result, error } = await admin.rpc("refund_case_record_provider_decision", {
      p_case_id: row.id,
      p_admin_id: userId,
      p_state: "awaiting_provider",
      p_provider: provider.id === "unconfigured" ? null : provider.id,
      p_provider_refund_id: null,
      p_note: note || "Approved; awaiting a verified payment provider.",
    });
    if (error) {
      console.error("provider decision record failed", error.message);
      return json({ error: "The decision could not be recorded." }, 500);
    }
    void result;
    const updated = (await loadCase(admin, ref)) ?? row;
    await notifyCustomerOfCase(admin, {
      caseId: row.id,
      userId: row.user_id,
      publicRef: row.public_ref,
      status: "Approved — awaiting payment provider",
      dedupeKey: "status:awaiting_provider",
      message:
        "We approved your request. The money has not moved yet: it will be issued once a verified payment provider is connected.",
      note: note || null,
    });
    return json({
      case: updated,
      message:
        "Approved and recorded as awaiting the payment provider. No money has moved.",
      moneyMoved: false,
    });
  }

  // A provider exists and claims it can refund. Ask it, and believe only what
  // it returns — an error is never mapped to "completed".
  const refundResult = await provider.initiateRefund({
    caseRef: row.public_ref,
    reference: row.charge_key ?? row.public_ref,
    amountCents: row.amount_cents ?? 0,
    currency: row.currency,
    idempotencyKey: `refundcase:${row.public_ref}`,
    reason: row.reason_code,
  });

  const state =
    refundResult.state === "executed" && refundResult.providerRefundId
      ? "completed"
      : refundResult.state === "failed"
        ? "processing_failed"
        : refundResult.state === "pending"
          ? "approved_processing"
          : "awaiting_provider";

  const { error: recordError } = await admin.rpc("refund_case_record_provider_decision", {
    p_case_id: row.id,
    p_admin_id: userId,
    p_state: state,
    p_provider: provider.id,
    p_provider_refund_id: refundResult.providerRefundId ?? null,
    p_note: note || (refundResult.error ?? null),
  });
  if (recordError) {
    console.error("provider state record failed", recordError.message);
    return json({ error: "The provider answered, but the result could not be recorded." }, 500);
  }

  const updated = (await loadCase(admin, ref)) ?? row;
  await notifyCustomerOfCase(admin, {
    caseId: row.id,
    userId: row.user_id,
    publicRef: row.public_ref,
    status:
      state === "completed"
        ? "Refund completed"
        : state === "processing_failed"
          ? "Processing failed"
          : "Approved — processing",
    dedupeKey: `status:${state}`,
    message:
      state === "completed"
        ? "The refund has been issued by the payment provider."
        : state === "processing_failed"
          ? "The payment provider could not complete the refund. The team has been alerted."
          : "Your refund has been approved and is being processed.",
    note: note || null,
  });

  return json({
    case: updated,
    message:
      state === "completed"
        ? "Provider confirmed the refund."
        : state === "processing_failed"
          ? "Provider failed the refund; recorded as processing failed."
          : "Recorded with the provider.",
    moneyMoved: state === "completed",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const userId = await authenticate(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const admin = adminClient();
  if (!(await isAdmin(admin, userId))) {
    return json({ error: "Forbidden" }, 403);
  }

  const body = await readJsonBody(req);
  if (!body) return json({ error: "Invalid JSON body" }, 400);
  const action = String(body.action ?? "list");

  try {
    if (action === "list") {
      const status = typeof body.status === "string" ? body.status : "open";
      let query = admin
        .from("refund_cases")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (status === "open") query = query.in("status", ACTIVE_STATUSES);
      else if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) {
        console.error("refund list failed", error.message);
        return json({ error: "Could not read refund cases." }, 500);
      }
      const rows = (data ?? []) as CaseRow[];
      return json({
        cases: rows,
        counts: {
          open: rows.filter((r) => ACTIVE_STATUSES.includes(r.status)).length,
          total: rows.length,
        },
      });
    }

    if (action === "get") {
      const ref = typeof body.ref === "string" ? body.ref.trim() : "";
      const row = await loadCase(admin, ref);
      if (!row) return json({ error: "That case does not exist." }, 404);
      return json(await caseDetail(admin, row));
    }

    if (action === "decide") return await handleDecide(admin, userId, body);

    if (action === "retry_notification") {
      const ref = typeof body.ref === "string" ? body.ref.trim() : "";
      const row = await loadCase(admin, ref);
      if (!row) return json({ error: "That case does not exist." }, 404);
      // Manual retry on one case: include notifications that already exhausted
      // their automatic attempts. This sends mail only; it never moves money.
      const result = await retryDueNotifications(admin, {
        caseId: row.id,
        limit: 5,
        includeFailed: true,
      });
      return json({ ...result, case: (await loadCase(admin, ref)) ?? row });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("refund-admin error", error instanceof Error ? error.name : error);
    return json({ error: "The action could not be completed." }, 500);
  }
});
