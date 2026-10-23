// ============================================================================
// REFUND SYSTEM — behaviour and contract tests
// ----------------------------------------------------------------------------
// Two kinds of assertion live here:
//
//   1. BEHAVIOURAL tests of the pieces that are pure: the decision engine, the
//      e-mail builder and the provider adapter. These run the real code with
//      fixtures, so a rule change that quietly starts paying twice fails here.
//   2. CONTRACT tests over the SQL migration, the edge functions and the two
//      screens. The database functions cannot run in CI without a live project,
//      so their guards (service-role-only, row locks, provider-refund-id before
//      'completed', unique submission keys) are asserted against the source —
//      the same pattern dbSecurityMigration.test.ts uses for RLS.
//
// No test here issues a refund, touches a real transaction, or claims that
// money moved. The monetary path is exercised only through the adapter's
// explicit "unavailable"/"unsupported" answers.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AI_SERVICE_FEATURES,
  RULES,
  REFUND_STATUS_LABELS,
  VELOCITY_REVIEW_THRESHOLD,
  applyVelocityFlag,
  evaluateRefundRequest,
  estimateUnusedPurchaseValueCents,
  estimateUnusedPurchasedCredits,
  initialStatus,
  isAiServiceFeature,
  reasonsForSource,
  type RefundFacts,
} from "../../supabase/functions/_shared/refundPolicy";
import {
  adminReviewLink,
  buildAdminReviewEmail,
  buildCustomerEmail,
} from "../../supabase/functions/_shared/refundEmail";
import {
  GooglePlayRefundProvider,
  UnconfiguredRefundProvider,
  providerCanRefund,
} from "../../supabase/functions/_shared/refundProvider";
import { AI_USAGE_FEATURES } from "@/config/credits";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8").replace(/\r\n?/g, "\n");

const MIGRATION = "supabase/migrations/20261023120000_refunds_core.sql";
const REQUEST = "supabase/functions/refund-request/index.ts";
const ADMIN = "supabase/functions/refund-admin/index.ts";
const NOTIFY = "supabase/functions/_shared/refundNotify.ts";
const USER_PAGE = "src/pages/PurchasesRefunds.tsx";
const ADMIN_PAGE = "src/pages/AdminRefunds.tsx";

const ISO = "2026-10-23T10:00:00.000Z";

const charge = (amount = -45, key = "ai:u1:job-1") => ({
  id: "11111111-1111-4111-8111-111111111111",
  amount,
  feature: "video_form_analysis",
  source: "ai_service",
  idempotencyKey: key,
  createdAt: ISO,
});

const job = (status: "started" | "delivered" | "failed") => ({
  status,
  errorCode: status === "failed" ? "provider_timeout" : null,
  startedAt: ISO,
  finishedAt: status === "started" ? null : ISO,
});

const purchase = (over: Partial<ReturnType<typeof basePurchase>> = {}) => ({
  ...basePurchase(),
  ...over,
});

function basePurchase() {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    productId: "pack_120",
    productType: "credits",
    priceCents: 999,
    currency: "USD",
    purchasedAt: ISO,
    providerReference: null,
    creditsGranted: 120,
    creditsUnused: 100,
  };
}

const facts = (over: Partial<RefundFacts> = {}): RefundFacts => ({
  sourceType: "ai_service",
  reasonCode: "ai_not_delivered",
  details: null,
  charge: charge(),
  job: job("failed"),
  purchase: null,
  subscription: null,
  priorRestorations: 0,
  anotherActiveCase: false,
  provider: { canInitiateRefund: false, providerId: null },
  submissionsLast24h: 0,
  ...over,
});

// ---------------------------------------------------------------------------
// 1. Credit restoration
// ---------------------------------------------------------------------------

describe("credit restoration for a verified failed AI job", () => {
  it("restores exactly what the charge took, never an amount from the request", () => {
    const decision = evaluateRefundRequest(facts());
    expect(decision.outcome).toBe("auto_credit_restore");
    expect(decision.credits).toBe(45);
    expect(decision.kind).toBe("credits");
    expect(initialStatus(decision)).toBe("approved_processing");
    expect(decision.rules).toContain(RULES.AI_JOB_FAILED);
    expect(decision.providerActionRequired).toBe(false);
  });

  it("uses the debit magnitude even for an oddly shaped ledger row", () => {
    const decision = evaluateRefundRequest(facts({ charge: charge(-8) }));
    expect(decision.credits).toBe(8);
  });

  it("does not invent a restoration when the failed job has no charge", () => {
    const decision = evaluateRefundRequest(facts({ charge: null }));
    expect(decision.outcome).toBe("review");
    expect(decision.credits).toBeNull();
    expect(decision.rules).toContain(RULES.CHARGE_VERIFICATION);
  });

  it("refuses to restore from a charge that took nothing (Unlimited plan)", () => {
    const decision = evaluateRefundRequest(facts({ charge: charge(0) }));
    expect(decision.outcome).toBe("auto_reject");
    expect(decision.credits).toBe(0);
    expect(decision.rules).toContain(RULES.NOTHING_CHARGED);
  });
});

describe("duplicate restoration prevention", () => {
  it("declines a second restoration for the same charge", () => {
    const decision = evaluateRefundRequest(facts({ priorRestorations: 1 }));
    expect(decision.outcome).toBe("auto_reject");
    expect(decision.credits).toBe(0);
    expect(decision.rules).toContain(RULES.ALREADY_RESTORED);
  });

  it("declines a second request while another case is open, without calling it fraud", () => {
    const decision = evaluateRefundRequest(facts({ anotherActiveCase: true }));
    expect(decision.outcome).toBe("auto_reject");
    expect(decision.escalatable).toBe(false);
    expect(decision.rules).toContain(RULES.ACTIVE_CASE_EXISTS);
    expect(decision.summary).not.toMatch(/fraud|abuse/i);
  });
});

// ---------------------------------------------------------------------------
// 2. A delivered service
// ---------------------------------------------------------------------------

describe("a successfully delivered AI service", () => {
  it("is not ordinarily refundable", () => {
    const decision = evaluateRefundRequest(facts({ job: job("delivered"), reasonCode: "ai_incomplete" }));
    expect(decision.outcome).toBe("auto_reject");
    expect(decision.credits).toBe(0);
    expect(initialStatus(decision)).toBe("declined");
    expect(decision.rules).toContain(RULES.AI_JOB_DELIVERED);
  });

  it("still admits a human review, so a statutory claim is never dismissed by code", () => {
    const decision = evaluateRefundRequest(facts({ job: job("delivered") }));
    expect(decision.escalatable).toBe(true);
    expect(decision.customerMessage).toMatch(/not normally refundable/i);
    expect(decision.customerMessage).toMatch(/human review/i);
  });

  it("is never converted to a rejection by the duplicate-history flag", () => {
    // There is no lifetime cap: history is a review flag, not a verdict.
    const decision = applyVelocityFlag(
      evaluateRefundRequest(facts({ job: job("delivered") })),
      VELOCITY_REVIEW_THRESHOLD + 3
    );
    expect(decision.outcome).toBe("auto_reject");
    expect(decision.rules).toContain(RULES.VELOCITY);
  });
});

describe("an unproven outcome", () => {
  it("sends a started job to review instead of pretending it failed", () => {
    const decision = evaluateRefundRequest(facts({ job: job("started") }));
    expect(decision.outcome).toBe("review");
    expect(decision.rules).toContain(RULES.AI_JOB_UNVERIFIED);
  });

  it("sends a charge with no job row to review rather than inventing delivery", () => {
    const decision = evaluateRefundRequest(facts({ job: null }));
    expect(decision.outcome).toBe("review");
    expect(decision.rules).toContain(RULES.AI_JOB_MISSING);
    expect(initialStatus(decision)).toBe("under_review");
  });
});

// ---------------------------------------------------------------------------
// 3. Money: unused purchased credits
// ---------------------------------------------------------------------------

describe("unused purchased credits", () => {
  it("is recorded for review with an amount derived from the purchase", () => {
    const decision = evaluateRefundRequest(
      facts({
        sourceType: "credit_purchase",
        reasonCode: "credits_unused",
        charge: null,
        job: null,
        purchase: purchase(),
      })
    );
    expect(decision.kind).toBe("money");
    expect(decision.outcome).toBe("review");
    // 100 of 120 credits unused out of 999¢ → 832¢, never more than the price.
    expect(decision.amountCents).toBe(832);
    expect(decision.providerActionRequired).toBe(true);
    expect(decision.rules).toContain(RULES.PROVIDER_UNAVAILABLE);
    expect(decision.customerMessage).toMatch(/no money moves until a payment provider/i);
  });

  it("never claims a refund was executed", () => {
    const decision = evaluateRefundRequest(
      facts({ sourceType: "credit_purchase", reasonCode: "credits_unused", charge: null, job: null, purchase: purchase() })
    );
    expect(decision.summary).not.toMatch(/refunded|completed|paid/i);
    expect(initialStatus(decision)).not.toBe("completed");
  });

  it("refuses when every purchased credit was spent", () => {
    const decision = evaluateRefundRequest(
      facts({
        sourceType: "credit_purchase",
        reasonCode: "credits_unused",
        charge: null,
        job: null,
        purchase: purchase({ creditsUnused: 0 }),
      })
    );
    expect(decision.outcome).toBe("auto_reject");
    expect(decision.rules).toContain(RULES.PURCHASE_FULLY_USED);
  });

  it("sends an unmatched purchase to review instead of inventing one", () => {
    const decision = evaluateRefundRequest(
      facts({ sourceType: "credit_purchase", reasonCode: "purchase_not_delivered", charge: null, job: null, purchase: null })
    );
    expect(decision.outcome).toBe("review");
    expect(decision.rules).toContain(RULES.PURCHASE_UNVERIFIED);
    expect(decision.amountCents).toBeNull();
  });

  it("estimates unused credits conservatively and never below zero", () => {
    expect(estimateUnusedPurchasedCredits({ creditsGranted: 120, creditsConsumedAfterPurchase: 30 })).toBe(90);
    expect(estimateUnusedPurchasedCredits({ creditsGranted: 120, creditsConsumedAfterPurchase: 500 })).toBe(0);
    expect(estimateUnusedPurchasedCredits({ creditsGranted: null, creditsConsumedAfterPurchase: 5 })).toBe(0);
    expect(estimateUnusedPurchaseValueCents({ priceCents: 999, creditsGranted: 0, creditsUnused: 10 })).toBe(0);
    expect(
      estimateUnusedPurchaseValueCents({ priceCents: 999, creditsGranted: 120, creditsUnused: 120 })
    ).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// 4. Duplicate, unauthorised and subscription cases
// ---------------------------------------------------------------------------

describe("duplicate and unauthorised claims", () => {
  for (const sourceType of ["duplicate_charge", "unauthorized"] as const) {
    it(`never rejects a ${sourceType} claim automatically`, () => {
      const decision = evaluateRefundRequest(
        facts({ sourceType, reasonCode: "purchase_unauthorised", charge: null, job: null, purchase: purchase() })
      );
      expect(decision.outcome).toBe("review");
      expect(decision.rules).toContain(RULES.DUPLICATE_OR_UNAUTHORISED);
      expect(decision.customerMessage).toMatch(/nothing has been dismissed/i);
    });
  }
});

describe("subscription refunds", () => {
  it("is held for provider reconciliation, never auto-completed", () => {
    const decision = evaluateRefundRequest(
      facts({
        sourceType: "subscription",
        reasonCode: "subscription_refund",
        charge: null,
        job: null,
        subscription: {
          planType: "pro",
          status: "active",
          startedAt: ISO,
          expiresAt: ISO,
          purchaseToken: "token",
        },
      })
    );
    expect(decision.outcome).toBe("review");
    expect(decision.providerActionRequired).toBe(true);
    expect(initialStatus(decision)).toBe("under_review");
  });
});

// ---------------------------------------------------------------------------
// 5. Status vocabulary and reason catalog
// ---------------------------------------------------------------------------

describe("customer-facing statuses", () => {
  it("uses the exact statuses the app and the website describe", () => {
    expect(REFUND_STATUS_LABELS.submitted).toBe("Submitted");
    expect(REFUND_STATUS_LABELS.under_review).toBe("Under review");
    expect(REFUND_STATUS_LABELS.approved_processing).toBe("Approved — processing");
    expect(REFUND_STATUS_LABELS.completed).toBe("Refund completed");
    expect(REFUND_STATUS_LABELS.declined).toBe("Declined");
    expect(REFUND_STATUS_LABELS.processing_failed).toBe("Processing failed");
  });

  it("maps decisions onto statuses without skipping the honest waiting state", () => {
    expect(initialStatus({ outcome: "review" } as never)).toBe("under_review");
    expect(REFUND_STATUS_LABELS.awaiting_provider).toMatch(/Awaiting payment provider/);
  });
});

describe("reason catalog", () => {
  it("offers AI reasons for AI charges and money reasons for purchases", () => {
    const ai = reasonsForSource("ai_service").map((r) => r.code);
    expect(ai).toContain("ai_not_delivered");
    expect(ai).toContain("ai_incomplete");
    expect(ai).not.toContain("credits_unused");

    const purchaseReasons = reasonsForSource("credit_purchase").map((r) => r.code);
    expect(purchaseReasons).toContain("credits_unused");
    expect(purchaseReasons).not.toContain("ai_not_delivered");
  });

  it("keeps the AI feature list equal to the app's charged features", () => {
    expect([...AI_SERVICE_FEATURES].sort()).toEqual([...AI_USAGE_FEATURES].sort());
    expect(isAiServiceFeature("video_form_analysis")).toBe(true);
    expect(isAiServiceFeature("cosmetic_purchase")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. E-mail, secure link and duplicate sends
// ---------------------------------------------------------------------------

describe("administrator review e-mail", () => {
  beforeEach(() => {
    // appOrigin()/adminReviewRecipient() read Deno.env; the test supplies an
    // empty environment so the fallbacks (documented, existing config) apply.
    (globalThis as unknown as { Deno: unknown }).Deno = {
      env: { get: () => undefined },
    };
  });

  const mail = () =>
    buildAdminReviewEmail({
      public_ref: "RF-261023-AB12",
      kind: "credits",
      source_type: "ai_service",
      status: "under_review",
      reason_code: "ai_incomplete",
      details: "the report cut off after the first set",
      feature: "video_form_analysis",
      credits_requested: 45,
      amount_cents: null,
      currency: "USD",
      escalation_rules: [RULES.AI_JOB_UNVERIFIED],
      created_at: ISO,
    });

  it("names the case in the subject and the body", () => {
    const { subject, text } = mail();
    expect(subject).toContain("[Refund review]");
    expect(subject).toContain("RF-261023-AB12");
    expect(text).toContain("RF-261023-AB12");
    expect(text).toContain("45 credits");
    expect(text).toContain(RULES.AI_JOB_UNVERIFIED);
  });

  it("links to the authenticated case page — and says opening it decides nothing", () => {
    const { text } = mail();
    expect(text).toContain("/admin/refunds?case=RF-261023-AB12");
    expect(text).toMatch(/Nothing is refunded by opening that page/i);
    expect(adminReviewLink("RF-1")).toBe("https://vaylo-sports-app.netlify.app/admin/refunds?case=RF-1");
  });

  it("carries no purchase token, provider reference or admin note", () => {
    const { text } = mail();
    expect(text).not.toMatch(/purchase_token|purchaseToken|provider_refund_id/i);
    expect(text).not.toMatch(/card|pan\b/i);
  });

  it("tells the customer where the case lives", () => {
    const { subject, text } = buildCustomerEmail({
      publicRef: "RF-261023-AB12",
      status: "Refund completed",
      customerMessage: "The credits are back in your balance.",
    });
    expect(subject).toContain("RF-261023-AB12");
    expect(text).toContain("Purchases & refunds");
    expect(text).toContain("Refund completed");
  });
});

describe("notification durability", () => {
  const notify = read(NOTIFY);

  it("deduplicates one notification per case/kind/key at the database level", () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS refund_notifications_dedupe_uniq/);
    expect(sql).toMatch(/\(case_id, kind, dedupe_key\)/);
  });

  it("claims a row before sending, so concurrent retries cannot double-mail", () => {
    expect(notify).toMatch(/\.eq\("status", "pending"\)/);
    expect(notify).toMatch(/return "skipped"/);
  });

  it("keeps the case when mail fails, with bounded retries", () => {
    expect(notify).toMatch(/email_not_configured/);
    expect(notify).toMatch(/MAX_NOTIFICATION_ATTEMPTS/);
    expect(notify).toMatch(/next_attempt_at/);
    // The request handler must persist the case before it mails anything.
    const req = read(REQUEST);
    const insertAt = req.indexOf('.from("refund_cases")\n    .insert(insertRow)');
    const mailAt = req.indexOf("await notifyAdminOfReview(adminClient, caseRow)");
    expect(insertAt).toBeGreaterThan(-1);
    expect(mailAt).toBeGreaterThan(insertAt);
  });
});

// ---------------------------------------------------------------------------
// 7. Provider adapter
// ---------------------------------------------------------------------------

describe("provider adapter", () => {
  it("reports the unconfigured provider honestly and never says money moved", async () => {
    const provider = new UnconfiguredRefundProvider();
    expect(provider.isConfigured()).toBe(false);
    const result = await provider.initiateRefund({
      caseRef: "RF-1",
      reference: "pack_120",
      amountCents: 999,
      currency: "USD",
      idempotencyKey: "refundcase:RF-1",
      reason: "credits_unused",
    });
    expect(result.state).toBe("unavailable");
    expect(result.ok).toBe(false);
    expect(result.noMoneyMoved).toBe(true);
    expect(result.code).toBe("provider_not_configured");
  });

  it("Google Play verifies purchases but does not pretend to execute refunds", async () => {
    const provider = new GooglePlayRefundProvider();
    expect(provider.capabilities.verify_purchase).toBe(true);
    expect(provider.capabilities.initiate_refund).toBe(false);
    const result = await provider.initiateRefund({
      caseRef: "RF-2",
      reference: "token",
      amountCents: 499,
      currency: "USD",
      idempotencyKey: "refundcase:RF-2",
      reason: "credits_unused",
    });
    expect(result.state).toBe("unsupported");
    expect(result.noMoneyMoved).toBe(true);
    expect(result.code).toBe("provider_refund_not_integrated");
  });

  it("keeps monetary refunds disabled with no configuration", () => {
    expect(providerCanRefund()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Database contract (source assertions; see the file header)
// ---------------------------------------------------------------------------

describe("refund migration guards", () => {
  const sql = read(MIGRATION);

  it("lets only the service role execute the ledger operations", () => {
    for (const fn of [
      "refund_execute_credit_restore",
      "refund_case_reject",
      "refund_case_record_provider_decision",
    ]) {
      expect(sql).toContain(`FUNCTION public.${fn}`);
    }
    expect(sql).toMatch(/auth\.jwt\(\) ->> 'role'[^<]*<> 'service_role'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.refund_execute_credit_restore\(uuid, uuid, text\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.refund_execute_credit_restore\(uuid, uuid, text\) TO service_role/);
  });

  it("serialises restorations per charge and keys the grant from the charge", () => {
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/'refundcase:' \|\| COALESCE\(v_case\.charge_key, v_case\.public_ref\)/);
  });

  it("cannot mark a monetary refund completed without a provider reference", () => {
    expect(sql).toMatch(/IF p_state = 'completed' AND NULLIF\(btrim\(COALESCE\(p_provider_refund_id, ''\)\), ''\) IS NULL THEN/);
    expect(sql).toMatch(/A provider refund reference is required to complete a monetary refund/);
  });

  it("makes user refund rows read-only and admin rows readable by role only", () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.refund_cases FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/CREATE POLICY "Users can read their own refund cases" ON public\.refund_cases/);
    expect(sql).toMatch(/USING \(public\.has_role\(auth\.uid\(\), 'admin'\)\)/);
    // No INSERT/UPDATE/DELETE policy for a user on any refund table.
    expect(sql).not.toMatch(/FOR INSERT TO authenticated/);
    expect(sql).not.toMatch(/FOR UPDATE TO authenticated/);
  });

  it("grants column-level reads so admin notes and eligibility stay private", () => {
    expect(sql).toMatch(/GRANT SELECT \(\s*id, public_ref, user_id/);
    expect(sql).not.toMatch(/GRANT SELECT ON public\.refund_cases TO authenticated/);
    expect(sql).not.toMatch(/GRANT SELECT ON public\.refund_case_events TO authenticated/);
    expect(sql).toMatch(/GRANT SELECT \(id, case_id, actor_type, event, detail, created_at\)/);
  });

  it("has one active case per charge and one case per submission key", () => {
    expect(sql).toMatch(/refund_cases_one_active_per_charge/);
    expect(sql).toMatch(/refund_cases_submission_key_uniq/);
    expect(sql).toMatch(/'submitted', 'under_review', 'approved_processing', 'awaiting_provider'/);
  });

  it("schedules the outbox retry through Vault, not a secret in cron.job", () => {
    expect(sql).toMatch(/refund_trigger_notification_retry/);
    expect(sql).toMatch(/refund_cron_secret/);
    expect(sql).toMatch(/'refund-notify-retry'/);
    expect(sql).toMatch(/\*\/15 \* \* \* \*/);
    expect(sql).toMatch(/x-cron-secret/);
  });

  it("records the service outcome beside the charge", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.service_jobs/);
    expect(sql).toMatch(/status IN \('started', 'delivered', 'failed'\)/);
    expect(sql).toMatch(/service_jobs_charge_key_uniq/);
  });
});

describe("edge-function guards", () => {
  it("re-derives facts and trusts no amount or status from the client", () => {
    const src = read(REQUEST);
    expect(src).toMatch(/loadChargeFacts\(/);
    expect(src).not.toMatch(/body\.credits/);
    expect(src).not.toMatch(/body\.amountCents/);
    expect(src).not.toMatch(/body\.status/);
    expect(src).toMatch(/isUuid\(body\.chargeId\)/);
  });

  it("reuses a submission key instead of opening a second case", () => {
    const src = read(REQUEST);
    expect(src).toMatch(/eq\("submission_key", submissionKey\)/);
    expect(src).toMatch(/duplicate: true/);
  });

  it("checks the administrator role server-side before any action", () => {
    const src = read(ADMIN);
    expect(src).toMatch(/rpc\("has_role", \{ _user_id: userId, _role: "admin" \}\)/);
    expect(src).toMatch(/json\(\{ error: "Forbidden" \}, 403\)/);
    expect(src).toMatch(/if \(!ACTIVE_STATUSES\.includes\(row\.status\)\)/);
  });

  it("never reports a provider failure as a completed refund", () => {
    const src = read(ADMIN);
    expect(src).toMatch(/refundResult\.state === "executed" && refundResult\.providerRefundId/);
    expect(src).toMatch(/\? "completed"/);
    expect(src).toMatch(/refundResult\.state === "failed"/);
    expect(src).toMatch(/moneyMoved: false/);
  });

  it("requires a reason before rejecting", () => {
    const src = read(ADMIN);
    expect(src).toMatch(/A reason is required to reject a request/);
    expect(src).toMatch(/p_reason: note/);
  });
});

// ---------------------------------------------------------------------------
// 9. The screens that expose all of this
// ---------------------------------------------------------------------------

describe("in-app Purchases & refunds screen", () => {
  const src = read(USER_PAGE);

  it("is wired to the refund function, not a local balance", () => {
    expect(src).toMatch(/loadRefundOptions\(/);
    expect(src).toMatch(/submitRefund\(/);
    expect(src).toMatch(/escalateRefundCase\(/);
    expect(src).toMatch(/submissionKey/);
  });

  it("offers only the reasons the server returned for that transaction", () => {
    expect(src).toMatch(/selectedCharge\?\.reasons/);
    expect(src).toMatch(/selectedPurchase\?\.reasons/);
    expect(src).toMatch(/reasonByCode/);
  });

  it("states that money cannot move before a provider exists", () => {
    expect(src).toMatch(/no money can move until a payment provider is connected/);
  });

  it("shows the escalated case and the human-review route after a decline", () => {
    expect(src).toMatch(/canEscalate/);
    expect(src).toMatch(/Ask for a human review/);
  });

  it("is reachable from the account area and by route", () => {
    expect(read("src/pages/Profile.tsx")).toMatch(/Purchases & refunds/);
    expect(read("src/pages/Profile.tsx")).toMatch(/\/settings\/purchases/);
    expect(read("src/App.tsx")).toMatch(/path="\/settings\/purchases" element=\{<PurchasesRefunds \/>\}/);
  });
});

describe("administrator desk", () => {
  const src = read(ADMIN_PAGE);

  it("is a private route behind the admin gate", () => {
    expect(read("src/App.tsx")).toMatch(
      /path="\/admin\/refunds" element=\{<RequireAdmin><AdminRefunds \/><\/RequireAdmin>\}/
    );
  });

  it("shows the facts a decision needs", () => {
    for (const label of [
      "Case ID",
      "User ID",
      "Transaction reference",
      "Transaction type",
      "Requested",
      "Reason",
      "Service delivery",
      "Credits already restored",
      "Previous refunds",
      "Why this needs a person",
    ]) {
      expect(src).toContain(label);
    }
  });

  it("requires a deliberate confirmation for both decisions", () => {
    expect(src).toMatch(/Confirm approve/);
    expect(src).toMatch(/Confirm reject/);
    expect(src).toMatch(/rejectReason\.trim\(\)\.length < 3/);
  });

  it("says when approval did not move money", () => {
    expect(src).toMatch(/res\.moneyMoved === false/);
    expect(src).toMatch(/awaiting the payment provider/);
  });
});

// ---------------------------------------------------------------------------
// 10. The public website explains the same flow
// ---------------------------------------------------------------------------

describe("public refund instructions", () => {
  const legal = read("legal/refunds.html");
  const support = read("site/pages/support.mjs");

  it("names the in-app route and the case reference", () => {
    expect(legal).toMatch(/Purchases &amp; refunds/);
    expect(legal).toMatch(/RF-261023-AB12/);
    expect(support).toMatch(/How to request a refund/);
    expect(support).toMatch(/Profile &rarr; Purchases &amp; refunds/);
  });

  it("describes the real statuses and the admin review", () => {
    for (const status of ["Submitted", "Under review", "Approved &mdash; processing", "Refund completed", "Declined", "Processing failed"]) {
      expect(legal).toContain(status);
    }
    expect(support).toMatch(/a person is deciding/i);
  });

  it("still says buying is switched off and never promises money has moved", () => {
    expect(legal).toMatch(/not currently switched on/i);
    expect(legal).toMatch(/no money has\s+moved/i);
  });

  it("remains a description, with no second refund engine", () => {
    expect(support).not.toMatch(/refund-request|refund-admin/);
    expect(legal).not.toMatch(/refund-request|refund-admin/);
  });
});
