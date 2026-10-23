// ============================================================================
// REFUND-REQUEST — the customer-facing half of the refund system
// ----------------------------------------------------------------------------
// Actions:
//   options  the transactions this athlete may ask about, with eligibility
//   submit   open a case; the server decides, never the browser
//   case     one own case plus its customer-safe timeline
//   escalate ask for a human after an automatic rejection
//
// Everything that matters is re-derived here: which charge, how much, whether a
// service was delivered, whether credits were already restored, and whether a
// provider exists. The request contributes a reason, optional words and target
// ids — never an amount, a status or an eligibility claim.
//
// Execution split:
//   * Verified failed AI job  → credit restoration runs through
//     refund_execute_credit_restore() (atomic, ledger-keyed, duplicate-proof).
//   * Everything uncertain    → persistent case + administrator e-mail + secure
//     link. Money never moves from this function.
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { authenticate, json, readJsonBody, throttled } from "../_shared/guard.ts";
import {
  applyVelocityFlag,
  evaluateRefundRequest,
  initialStatus,
  isAiServiceFeature,
  reasonByCode,
  reasonsForSource,
  type RefundFacts,
  type RefundSourceType,
} from "../_shared/refundPolicy.ts";
import { providerCanRefund, refundProvider } from "../_shared/refundProvider.ts";
import {
  adminReviewRecipient,
  buildAdminReviewEmail,
  buildCustomerEmail,
} from "../_shared/refundEmail.ts";
import { notifyNow } from "../_shared/refundNotify.ts";
import { CREDIT_GRANTS } from "../_shared/moneyCatalog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACTIVE_STATUSES = ["submitted", "under_review", "approved_processing", "awaiting_provider"];
/** Hard bound on open cases; separate from the review-only velocity flag. */
const MAX_OPEN_CASES = 5;
const MAX_SUBMISSIONS_PER_DAY = 12;
const MAX_DETAILS = 2000;

// Default `SupabaseClient` generics: `ReturnType<typeof createClient>`
// instantiates the schema as `never` and makes every `.from(...)` a type error.
type Admin = SupabaseClient;

type CaseRow = {
  id: string;
  public_ref: string;
  user_id: string;
  kind: string;
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
  admin_note: string | null;
  provider: string | null;
  provider_refund_id: string | null;
  provider_state: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  completed_at: string | null;
};

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** RF-261023-XXXX — short, unambiguous on a phone, not a secret. */
function newPublicRef(now = new Date()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes)
    .map((b) => (b % 36).toString(36))
    .join("")
    .toUpperCase();
  const stamp =
    String(now.getUTCFullYear()).slice(2) +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0");
  return `RF-${stamp}-${suffix}`;
}

function isRefundSource(source: string | null | undefined): boolean {
  return (source ?? "").toLowerCase().startsWith("refund");
}

/** Fields a customer may see. Admin notes and internal facts stay out. */
function customerCase(row: CaseRow) {
  return {
    ref: row.public_ref,
    kind: row.kind,
    sourceType: row.source_type,
    reasonCode: row.reason_code,
    details: row.details,
    feature: row.feature,
    credits: row.credits_requested,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    resolution: row.resolution,
    decisionNote: row.resolution === "rejected" ? row.admin_note : null,
    escalationRules: row.escalation_rules,
    canEscalate: row.status === "declined" && row.resolution === "auto_rejected",
    providerState: row.provider_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
    completedAt: row.completed_at,
  };
}

/** The timeline text a customer can see. Internal rule ids stay in the case JSON. */
const CUSTOMER_EVENTS: Record<string, string> = {
  submitted: "Request submitted",
  auto_rejected: "Declined automatically — you can ask for a human review",
  escalated_to_review: "Sent for review by the team",
  escalated_by_customer: "You asked for a human review",
  credits_restored: "Credits returned to your balance",
  rejected: "Request declined",
  provider_state_awaiting_provider: "Approved — waiting for the payment provider",
  provider_state_approved_processing: "Approved — processing",
  provider_state_processing_failed: "Processing failed — the team has been alerted",
  provider_state_completed: "Refund completed",
  rejected_already_restored: "Credits for this transaction were already returned",
};

async function customerEmailFor(adminClient: Admin, userId: string): Promise<string | null> {
  try {
    const { data } = await adminClient.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

async function notifyCustomer(
  adminClient: Admin,
  row: CaseRow,
  dedupeKey: string,
  customerMessage: string,
  note?: string | null
): Promise<void> {
  const email = await customerEmailFor(adminClient, row.user_id);
  if (!email) return;
  const mail = buildCustomerEmail({
    publicRef: row.public_ref,
    status: row.status,
    customerMessage,
    note: note ?? null,
  });
  await notifyNow(adminClient, {
    caseId: row.id,
    kind: "customer_update",
    dedupeKey,
    recipient: email,
    subject: mail.subject,
    body: mail.text,
  });
}

async function notifyAdminOfReview(adminClient: Admin, row: CaseRow): Promise<void> {
  const mail = buildAdminReviewEmail({
    public_ref: row.public_ref,
    kind: row.kind,
    source_type: row.source_type,
    status: row.status,
    reason_code: row.reason_code,
    details: row.details,
    feature: row.feature,
    credits_requested: row.credits_requested,
    amount_cents: row.amount_cents,
    currency: row.currency,
    escalation_rules: row.escalation_rules,
    created_at: row.created_at,
  });
  await notifyNow(adminClient, {
    caseId: row.id,
    kind: "admin_review",
    dedupeKey: "admin_review",
    recipient: adminReviewRecipient(),
    subject: mail.subject,
    body: mail.text,
  });
  // The link is logged as the case ref only; the full URL is in the mail.
  console.log(`refund review case ${row.public_ref} mailed to ${adminReviewRecipient()}`);
}

/** Facts loaded from the database for one charge, exactly as the engine wants them. */
async function loadChargeFacts(
  adminClient: Admin,
  userId: string,
  chargeId: string
): Promise<{
  charge: {
    id: string;
    amount: number;
    feature: string | null;
    source: string;
    idempotencyKey: string | null;
    createdAt: string;
  } | null;
  job: { status: "started" | "delivered" | "failed"; errorCode: string | null; startedAt: string; finishedAt: string | null } | null;
  jobId: string | null;
  priorRestorations: number;
  anotherActiveCase: boolean;
}> {
  const { data: txn } = await adminClient
    .from("credit_transactions")
    .select("id, amount, feature, source, idempotency_key, created_at")
    .eq("id", chargeId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!txn) {
    return { charge: null, job: null, jobId: null, priorRestorations: 0, anotherActiveCase: false };
  }

  const row = txn as {
    id: string;
    amount: number;
    feature: string | null;
    source: string;
    idempotency_key: string | null;
    created_at: string;
  };

  const chargeKey = row.idempotency_key;
  let job: { status: "started" | "delivered" | "failed"; errorCode: string | null; startedAt: string; finishedAt: string | null } | null = null;
  let jobId: string | null = null;

  if (chargeKey) {
    const { data: jobRow } = await adminClient
      .from("service_jobs")
      .select("id, status, error_code, started_at, finished_at")
      .eq("user_id", userId)
      .eq("charge_key", chargeKey)
      .maybeSingle();
    const typed = jobRow as
      | { id: string; status: "started" | "delivered" | "failed"; error_code: string | null; started_at: string; finished_at: string | null }
      | null;
    if (typed) {
      jobId = typed.id;
      job = {
        status: typed.status,
        errorCode: typed.error_code,
        startedAt: typed.started_at,
        finishedAt: typed.finished_at,
      };
    }
  }

  // Credits already back for this charge, counted two ways:
  //   * a completed refund case for the same charge, and
  //   * the automatic refund ledger row (`refund:<charge key>`) written by the
  //     AI functions when they failed. The second is the common case and must
  //     not be missed just because no case exists.
  let priorRestorations = 0;
  if (chargeKey) {
    const { count: completed } = await adminClient
      .from("refund_cases")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("charge_key", chargeKey)
      .eq("status", "completed");
    priorRestorations += completed ?? 0;

    const { count: autoRefund } = await adminClient
      .from("credit_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("idempotency_key", `refund:${chargeKey}`);
    if ((autoRefund ?? 0) > 0) priorRestorations += 1;

    const { count: active } = await adminClient
      .from("refund_cases")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("charge_key", chargeKey)
      .in("status", ACTIVE_STATUSES);
    return {
      charge: {
        id: row.id,
        amount: Number(row.amount),
        feature: row.feature,
        source: row.source,
        idempotencyKey: chargeKey,
        createdAt: row.created_at,
      },
      job,
      jobId,
      priorRestorations,
      anotherActiveCase: (active ?? 0) > 0,
    };
  }

  return {
    charge: {
      id: row.id,
      amount: Number(row.amount),
      feature: row.feature,
      source: row.source,
      idempotencyKey: null,
      createdAt: row.created_at,
    },
    job,
    jobId,
    priorRestorations,
    anotherActiveCase: false,
  };
}

/**
 * Unspent purchased credits. Conservative: all spending is treated as coming
 * out of the purchased pool first, so the estimate can only under-state what is
 * left, never over-state it. Newest purchases are considered first.
 */
function allocateUnusedCredits(
  ledger: Array<{ amount: number; source: string }>,
  purchases: Array<{ id: string; product_id: string; purchased_at: string }>
): Map<string, { granted: number | null; unused: number | null }> {
  const purchasedTotal = ledger
    .filter((l) => l.amount > 0 && l.source === "purchase")
    .reduce((sum, l) => sum + l.amount, 0);
  const spentTotal = ledger
    .filter((l) => l.amount < 0 && !isRefundSource(l.source) && l.source !== "unlimited_plan")
    .reduce((sum, l) => sum + Math.abs(l.amount), 0);

  let pool = Math.max(0, Math.min(purchasedTotal, purchasedTotal - spentTotal));
  const out = new Map<string, { granted: number | null; unused: number | null }>();
  const newestFirst = [...purchases].sort(
    (a, b) => Date.parse(b.purchased_at) - Date.parse(a.purchased_at)
  );
  for (const purchase of newestFirst) {
    const granted = CREDIT_GRANTS[purchase.product_id] ?? null;
    if (granted == null) {
      out.set(purchase.id, { granted: null, unused: null });
      continue;
    }
    const unused = Math.min(granted, pool);
    pool -= unused;
    out.set(purchase.id, { granted, unused });
  }
  return out;
}

async function handleOptions(adminClient: Admin, userId: string): Promise<Response> {
  const [balanceRes, ledgerRes, jobsRes, purchasesRes, casesRes, subRes] = await Promise.all([
    adminClient.from("profiles").select("credits, infinite_credits").eq("user_id", userId).maybeSingle(),
    adminClient
      .from("credit_transactions")
      .select("id, amount, reason, feature, source, created_at, idempotency_key")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(300),
    adminClient
      .from("service_jobs")
      .select("id, feature, charge_key, status, error_code, started_at, finished_at")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(300),
    adminClient
      .from("user_purchases")
      .select("id, product_id, product_type, price_cents, currency, purchased_at, provider_reference")
      .eq("user_id", userId)
      .order("purchased_at", { ascending: false })
      .limit(100),
    adminClient
      .from("refund_cases")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    adminClient
      .from("subscriptions")
      .select("plan_type, status, started_at, expires_at, purchase_token")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const ledger = (ledgerRes.data ?? []) as Array<{
    id: string;
    amount: number;
    reason: string;
    feature: string | null;
    source: string;
    created_at: string;
    idempotency_key: string | null;
  }>;
  const jobs = (jobsRes.data ?? []) as Array<{
    id: string;
    feature: string;
    charge_key: string | null;
    status: "started" | "delivered" | "failed";
    started_at: string;
    finished_at: string | null;
  }>;
  const purchases = (purchasesRes.data ?? []) as Array<{
    id: string;
    product_id: string;
    product_type: string;
    price_cents: number;
    currency: string;
    purchased_at: string;
    provider_reference: string | null;
  }>;
  const cases = (casesRes.data ?? []) as CaseRow[];
  const jobByCharge = new Map(jobs.filter((j) => j.charge_key).map((j) => [j.charge_key!, j]));
  const caseByCharge = new Map<string, CaseRow>();
  for (const c of cases) {
    if (c.charge_key && !caseByCharge.has(c.charge_key)) caseByCharge.set(c.charge_key, c);
  }
  const unused = allocateUnusedCredits(ledger, purchases);

  const provider = refundProvider();
  const providerReady = providerCanRefund();

  const charges = ledger
    .filter(
      (l) =>
        l.amount < 0 &&
        !isRefundSource(l.source) &&
        l.source !== "unlimited_plan" &&
        isAiServiceFeature(l.feature)
    )
    .slice(0, 60)
    .map((l) => {
      const job = l.idempotency_key ? jobByCharge.get(l.idempotency_key) : undefined;
      const existing = l.idempotency_key ? caseByCharge.get(l.idempotency_key) : undefined;
      const alreadyRefundedByLedger = ledger.some(
        (r) => l.idempotency_key && r.idempotency_key === `refund:${l.idempotency_key}`
      );
      return {
        id: l.id,
        feature: l.feature,
        reason: l.reason,
        credits: Math.abs(l.amount),
        createdAt: l.created_at,
        jobStatus: job?.status ?? null,
        alreadyRefunded: alreadyRefundedByLedger || existing?.status === "completed",
        existingCase: existing ? { ref: existing.public_ref, status: existing.status } : null,
        reasons: existing ? [] : reasonsForSource("ai_service").map((r) => r.code),
      };
    });

  return json({
    balance: {
      credits: Number(balanceRes.data?.credits ?? 0),
      infinite: !!balanceRes.data?.infinite_credits,
    },
    charges,
    purchases: purchases.map((p) => {
      const u = unused.get(p.id) ?? { granted: null, unused: null };
      return {
        id: p.id,
        productId: p.product_id,
        productType: p.product_type,
        priceCents: p.price_cents,
        currency: p.currency,
        purchasedAt: p.purchased_at,
        creditsGranted: u.granted,
        creditsUnused: u.unused,
        refundable: u.granted != null,
        existingCase:
          cases.find((c) => c.purchase_id === p.id && ACTIVE_STATUSES.includes(c.status))
            ? {
                ref: cases.find((c) => c.purchase_id === p.id && ACTIVE_STATUSES.includes(c.status))!
                  .public_ref,
                status: cases.find((c) => c.purchase_id === p.id && ACTIVE_STATUSES.includes(c.status))!
                  .status,
              }
            : null,
        reasons: reasonsForSource("credit_purchase").map((r) => r.code),
      };
    }),
    subscription: subRes.data
      ? {
          planType: subRes.data.plan_type,
          status: subRes.data.status,
          startedAt: subRes.data.started_at,
          expiresAt: subRes.data.expires_at,
          reasons: reasonsForSource("subscription").map((r) => r.code),
        }
      : null,
    cases: cases.map(customerCase),
    provider: { id: provider.id, refundsEnabled: providerReady },
    moneyExecutionEnabled: providerReady,
  });
}

async function casesCreatedInLastDay(adminClient: Admin, userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await adminClient
    .from("refund_cases")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  return count ?? 0;
}

async function handleSubmit(
  adminClient: Admin,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const sourceTypeRaw = String(body.sourceType ?? "");
  const sourceTypes: RefundSourceType[] = [
    "ai_service",
    "credit_purchase",
    "subscription",
    "duplicate_charge",
    "unauthorized",
    "other",
  ];
  if (!sourceTypes.includes(sourceTypeRaw as RefundSourceType)) {
    return json({ error: "Choose what the request is about." }, 400);
  }
  const sourceType = sourceTypeRaw as RefundSourceType;

  const reason = reasonByCode(String(body.reasonCode ?? ""));
  if (!reason || !reason.appliesTo.includes(sourceType)) {
    return json({ error: "Choose a reason that applies to this transaction." }, 400);
  }

  const details = typeof body.details === "string" ? body.details.trim().slice(0, MAX_DETAILS) : "";
  if ((reason.requiresDetails || sourceType === "duplicate_charge" || sourceType === "unauthorized") && details.length < 10) {
    return json({ error: "Please add a sentence or two about what happened." }, 400);
  }

  const submissionKey =
    typeof body.submissionKey === "string" ? body.submissionKey.trim().slice(0, 120) : "";
  if (submissionKey.length < 8) return json({ error: "Missing submission key." }, 400);

  const chargeId = isUuid(body.chargeId) ? body.chargeId : null;
  const purchaseId = isUuid(body.purchaseId) ? body.purchaseId : null;

  // Reuse of a submission key is a retry, not a new request.
  const { data: existingByKey } = await adminClient
    .from("refund_cases")
    .select("*")
    .eq("user_id", userId)
    .eq("submission_key", submissionKey)
    .maybeSingle();
  if (existingByKey) {
    const row = existingByKey as CaseRow;
    return json({ duplicate: true, case: customerCase(row) }, 200);
  }

  const openCount = await casesCreatedInLastDay(adminClient, userId);
  if (openCount >= MAX_SUBMISSIONS_PER_DAY) {
    return json(
      { error: "You have opened many requests today. Contact support if you need help right now." },
      429
    );
  }
  const { count: activeCount } = await adminClient
    .from("refund_cases")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ACTIVE_STATUSES);
  if ((activeCount ?? 0) >= MAX_OPEN_CASES) {
    return json(
      { error: "You already have several requests open. We will reply to those first." },
      429
    );
  }

  // ------------------------------------------------------------------------
  // Facts — loaded here, never taken from the client
  // ------------------------------------------------------------------------
  let facts: RefundFacts;
  let chargeKey: string | null = null;
  let chargeTransactionId: string | null = null;
  let purchaseIdValue: string | null = null;
  let serviceJobId: string | null = null;
  let feature: string | null = null;
  let currency = "USD";
  let purchaseProviderReference: string | null = null;
  let subscriptionFacts = null as RefundFacts["subscription"];

  const isChargeRequest =
    sourceType === "ai_service" || sourceType === "duplicate_charge" || (!purchaseId && !!chargeId);

  if (isChargeRequest) {
    if (!chargeId) return json({ error: "Choose the transaction you are asking about." }, 400);
    const loaded = await loadChargeFacts(adminClient, userId, chargeId);
    if (!loaded.charge) return json({ error: "That transaction was not found on this account." }, 404);
    if (loaded.charge.amount >= 0) {
      return json({ error: "That entry is not a credit charge." }, 400);
    }
    chargeKey = loaded.charge.idempotencyKey;
    chargeTransactionId = loaded.charge.id;
    serviceJobId = loaded.jobId;
    feature = loaded.charge.feature;
    facts = {
      sourceType,
      reasonCode: reason.code,
      details: details || null,
      charge: loaded.charge,
      job: loaded.job,
      purchase: null,
      subscription: null,
      priorRestorations: loaded.priorRestorations,
      anotherActiveCase: loaded.anotherActiveCase,
      provider: { canInitiateRefund: providerCanRefund(), providerId: refundProvider().id },
      submissionsLast24h: openCount,
    };
  } else if (sourceType === "credit_purchase" || sourceType === "unauthorized" || sourceType === "other") {
    if (!purchaseId) return json({ error: "Choose the purchase you are asking about." }, 400);
    const { data: purchase } = await adminClient
      .from("user_purchases")
      .select("id, product_id, product_type, price_cents, currency, purchased_at, provider_reference")
      .eq("id", purchaseId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!purchase) return json({ error: "That purchase was not found on this account." }, 404);

    const { data: ledgerRows } = await adminClient
      .from("credit_transactions")
      .select("amount, source")
      .eq("user_id", userId)
      .limit(1000);
    const { data: purchaseRows } = await adminClient
      .from("user_purchases")
      .select("id, product_id, purchased_at")
      .eq("user_id", userId)
      .limit(200);
    const allocation = allocateUnusedCredits(
      (ledgerRows ?? []) as Array<{ amount: number; source: string }>,
      (purchaseRows ?? []) as Array<{ id: string; product_id: string; purchased_at: string }>
    ).get(purchase.id) ?? { granted: null, unused: null };

    const { count: priorMoneyCases } = await adminClient
      .from("refund_cases")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("purchase_id", purchase.id)
      .eq("status", "completed");
    const { count: openMoneyCases } = await adminClient
      .from("refund_cases")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("purchase_id", purchase.id)
      .in("status", ACTIVE_STATUSES);

    purchaseIdValue = purchase.id;
    currency = purchase.currency;
    purchaseProviderReference = purchase.provider_reference;
    facts = {
      sourceType,
      reasonCode: reason.code,
      details: details || null,
      charge: null,
      job: null,
      purchase: {
        id: purchase.id,
        productId: purchase.product_id,
        productType: purchase.product_type,
        priceCents: Number(purchase.price_cents),
        currency: purchase.currency,
        purchasedAt: purchase.purchased_at,
        providerReference: purchase.provider_reference,
        creditsGranted: allocation.granted,
        creditsUnused: allocation.unused,
      },
      subscription: null,
      priorRestorations: priorMoneyCases ?? 0,
      anotherActiveCase: (openMoneyCases ?? 0) > 0,
      provider: { canInitiateRefund: providerCanRefund(), providerId: refundProvider().id },
      submissionsLast24h: openCount,
    };
  } else {
    const { data: sub } = await adminClient
      .from("subscriptions")
      .select("plan_type, status, started_at, expires_at, purchase_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (!sub) return json({ error: "There is no subscription on this account." }, 404);
    subscriptionFacts = {
      planType: sub.plan_type,
      status: sub.status,
      startedAt: sub.started_at,
      expiresAt: sub.expires_at,
      purchaseToken: sub.purchase_token,
    };
    facts = {
      sourceType,
      reasonCode: reason.code,
      details: details || null,
      charge: null,
      job: null,
      purchase: null,
      subscription: subscriptionFacts,
      priorRestorations: 0,
      anotherActiveCase: false,
      provider: { canInitiateRefund: providerCanRefund(), providerId: refundProvider().id },
      submissionsLast24h: openCount,
    };
  }

  const decision = applyVelocityFlag(evaluateRefundRequest(facts), openCount);

  const publicRef = newPublicRef();
  const status = initialStatus(decision);
  const insertRow = {
    public_ref: publicRef,
    user_id: userId,
    kind: decision.kind,
    source_type: sourceType,
    reason_code: reason.code,
    details: details || null,
    charge_transaction_id: chargeTransactionId,
    charge_key: chargeKey,
    purchase_id: purchaseIdValue,
    service_job_id: serviceJobId,
    feature,
    credits_requested: decision.credits,
    amount_cents: decision.amountCents,
    currency,
    status,
    resolution:
      decision.outcome === "auto_reject" ? "auto_rejected" : null,
    escalation_rules: decision.rules,
    eligibility: {
      decision: {
        outcome: decision.outcome,
        kind: decision.kind,
        credits: decision.credits,
        amountCents: decision.amountCents,
        rules: decision.rules,
        summary: decision.summary,
        providerActionRequired: decision.providerActionRequired,
      },
      facts: {
        charge_amount: facts.charge?.amount ?? null,
        job_status: facts.job?.status ?? null,
        purchase_id: purchaseIdValue,
        provider_configured: facts.provider.canInitiateRefund,
        provider: facts.provider.providerId,
        has_purchase_provider_reference: !!purchaseProviderReference,
      },
      can_escalate: true,
    },
    submission_key: submissionKey,
    decided_at: decision.outcome === "auto_reject" ? new Date().toISOString() : null,
    completed_at: decision.outcome === "auto_reject" ? new Date().toISOString() : null,
  };

  const { data: inserted, error: insertError } = await adminClient
    .from("refund_cases")
    .insert(insertRow)
    .select("*")
    .maybeSingle();

  if (insertError || !inserted) {
    // The partial unique indexes are the race guard. Whichever request lost,
    // answer with the case that won instead of creating a second one.
    if ((insertError as { code?: string } | null)?.code === "23505") {
      const { data: winner } = await adminClient
        .from("refund_cases")
        .select("*")
        .eq("user_id", userId)
        .eq("charge_key", chargeKey ?? "__none__")
        .in("status", ACTIVE_STATUSES)
        .maybeSingle();
      if (winner) return json({ duplicate: true, case: customerCase(winner as CaseRow) }, 200);
      return json({ duplicate: true }, 200);
    }
    console.error("refund case insert failed", insertError?.message);
    return json({ error: "The request could not be saved. Please try again." }, 500);
  }

  let caseRow = inserted as CaseRow;

  await adminClient.from("refund_case_events").insert({
    case_id: caseRow.id,
    actor_type: "user",
    actor_id: userId,
    event: "submitted",
    detail: {
      reason_code: reason.code,
      source_type: sourceType,
      outcome: decision.outcome,
      rules: decision.rules,
    },
  });

  if (decision.outcome === "auto_credit_restore") {
    const { data: restore, error: restoreError } = await adminClient.rpc(
      "refund_execute_credit_restore",
      { p_case_id: caseRow.id, p_admin_id: null, p_source: "refund" }
    );
    const result = restore as { success?: boolean; error?: string; balance?: number } | null;
    if (restoreError || !result?.success) {
      console.error(
        `refund restore failed for ${caseRow.public_ref}:`,
        restoreError?.message ?? result?.error
      );
      await adminClient
        .from("refund_cases")
        .update({
          status: "processing_failed",
          resolution: "restore_failed",
          escalation_rules: [...new Set([...decision.rules, "restore_failed"])],
        })
        .eq("id", caseRow.id);
      await adminClient.from("refund_case_events").insert({
        case_id: caseRow.id,
        actor_type: "system",
        event: "processing_failed",
        detail: { error: result?.error ?? restoreError?.message ?? "unknown" },
      });
      const { data: failed } = await adminClient
        .from("refund_cases")
        .select("*")
        .eq("id", caseRow.id)
        .maybeSingle();
      caseRow = (failed ?? caseRow) as CaseRow;
      await notifyAdminOfReview(adminClient, caseRow);
      return json(
        {
          case: customerCase(caseRow),
          message:
            "We could not return the credits automatically. The case has been sent to the team.",
        },
        202
      );
    }

    const { data: done } = await adminClient
      .from("refund_cases")
      .select("*")
      .eq("id", caseRow.id)
      .maybeSingle();
    caseRow = (done ?? caseRow) as CaseRow;
    await notifyCustomer(
      adminClient,
      caseRow,
      "status:completed",
      decision.customerMessage
    );
    return json(
      {
        case: customerCase(caseRow),
        message: decision.customerMessage,
        balance: result?.balance ?? null,
      },
      201
    );
  }

  if (decision.outcome === "auto_reject") {
    await notifyCustomer(adminClient, caseRow, "status:declined", decision.customerMessage);
    return json(
      {
        case: customerCase(caseRow),
        message: decision.customerMessage,
        canEscalate: true,
      },
      201
    );
  }

  // Review: the durable case exists before the mail is attempted.
  await adminClient.from("refund_case_events").insert({
    case_id: caseRow.id,
    actor_type: "system",
    event: "escalated_to_review",
    detail: { rules: decision.rules },
  });
  await notifyAdminOfReview(adminClient, caseRow);
  await notifyCustomer(
    adminClient,
    caseRow,
    "status:submitted",
    "Your request has been received and is with the team. We will update this case."
  );

  return json(
    {
      case: customerCase(caseRow),
      message: "Your request is with the team. You can follow it in Purchases & refunds.",
    },
    201
  );
}

async function handleCase(
  adminClient: Admin,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  if (!ref) return json({ error: "Missing case reference." }, 400);
  const { data: row } = await adminClient
    .from("refund_cases")
    .select("*")
    .eq("public_ref", ref)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return json({ error: "That request was not found." }, 404);
  const { data: events } = await adminClient
    .from("refund_case_events")
    .select("event, actor_type, detail, created_at")
    .eq("case_id", (row as CaseRow).id)
    .order("created_at", { ascending: true });
  const timeline = ((events ?? []) as Array<{ event: string; actor_type: string; created_at: string }>)
    .filter((e) => CUSTOMER_EVENTS[e.event])
    .map((e) => ({
      label: CUSTOMER_EVENTS[e.event],
      actor: e.actor_type,
      at: e.created_at,
    }));
  return json({ case: customerCase(row as CaseRow), timeline });
}

async function handleEscalate(
  adminClient: Admin,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  if (!ref) return json({ error: "Missing case reference." }, 400);
  const { data: current } = await adminClient
    .from("refund_cases")
    .select("*")
    .eq("public_ref", ref)
    .eq("user_id", userId)
    .maybeSingle();
  if (!current) return json({ error: "That request was not found." }, 404);
  const row = current as CaseRow;

  if (row.status !== "declined" || row.resolution !== "auto_rejected") {
    return json(
      { error: "This request has already been decided by a person and cannot be re-opened here." },
      409
    );
  }

  const { data: updated, error } = await adminClient
    .from("refund_cases")
    .update({
      status: "under_review",
      resolution: null,
      decided_at: null,
      completed_at: null,
      escalation_rules: [...new Set([...row.escalation_rules, "customer_requested_human_review"])],
    })
    .eq("id", row.id)
    .eq("status", "declined")
    .select("*")
    .maybeSingle();

  if (error || !updated) {
    return json({ error: "The request could not be re-opened. Please try again." }, 409);
  }

  const updatedRow = updated as CaseRow;
  await adminClient.from("refund_case_events").insert({
    case_id: row.id,
    actor_type: "user",
    actor_id: userId,
    event: "escalated_by_customer",
    detail: { previous_resolution: row.resolution },
  });
  await notifyAdminOfReview(adminClient, updatedRow);

  return json({
    case: customerCase(updatedRow),
    message: "A person will look at this request. Nothing has been charged again.",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const userId = await authenticate(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);
  if (throttled(userId)) {
    return json({ error: "Too many requests. Wait a moment and try again." }, 429);
  }

  const body = await readJsonBody(req);
  if (!body) return json({ error: "Invalid JSON body" }, 400);

  const action = String(body.action ?? "options");
  const adminClient = admin();

  try {
    if (action === "options") return await handleOptions(adminClient, userId);
    if (action === "submit") return await handleSubmit(adminClient, userId, body);
    if (action === "case") return await handleCase(adminClient, userId, body);
    if (action === "escalate") return await handleEscalate(adminClient, userId, body);
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("refund-request error", error instanceof Error ? error.name : error);
    return json({ error: "The request could not be completed. Please try again." }, 500);
  }
});
