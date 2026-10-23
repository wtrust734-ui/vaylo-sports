// ============================================================================
// REFUND POLICY — the deterministic decision engine
// ----------------------------------------------------------------------------
// Every refund decision in Vaylo Sports is made by this file, on facts the
// server loaded itself. There is no model call here and no client-supplied
// eligibility: the caller hands in the charge row, the service-job row and the
// purchase row that the edge function already re-read with the service role,
// and this module answers with one of three outcomes:
//
//   auto_credit_restore  a verified failure with credits to return; safe to pay
//   review               a human must decide (missing proof, money, subscription)
//   auto_reject          provably ineligible (nothing was charged / delivered)
//
// Rules are exposed by id so the administrator dashboard can print exactly the
// rule that escalated a case instead of a vague "needs review". The engine is
// pure and synchronous on purpose: `refundPolicy.test.ts` exercises every branch
// with fixtures, so the rules that decide money are testable without a database.
//
// Two boundaries worth stating because they are easy to violate later:
//
//   1. A previous refund is NOT evidence of fraud. There is no lifetime cap and
//      no "second request is suspicious" rule. The only history the engine uses
//      is whether THIS charge was already restored, which is a duplicate guard,
//      not a character judgement. Velocity raises a review flag, never a reject.
//   2. A delivered AI service is not auto-refundable, but the case is always
//      escalatable to a human. Refusing an ordinary refund is a policy decision;
//      it must never be the last word on a statutory claim. `escalatable` is
//      true on every auto-reject.
// ============================================================================

export type RefundKind = "credits" | "money" | "subscription";

export type RefundSourceType =
  | "ai_service"
  | "credit_purchase"
  | "subscription"
  | "duplicate_charge"
  | "unauthorized"
  | "other";

/** The exact statuses the customer sees, plus the two internal ones. */
export type RefundStatus =
  | "submitted"
  | "under_review"
  | "approved_processing"
  | "completed"
  | "declined"
  | "processing_failed"
  | "awaiting_provider";

export type ServiceJobStatus = "started" | "delivered" | "failed";

/** Labels are customer-facing; the app and the website both render these. */
export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  approved_processing: "Approved — processing",
  completed: "Refund completed",
  declined: "Declined",
  processing_failed: "Processing failed",
  awaiting_provider: "Awaiting payment provider",
};

/** Statuses after which no further decision can be made. */
export const TERMINAL_STATUSES: RefundStatus[] = ["completed", "declined"];

export function isTerminalStatus(status: RefundStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface RefundReason {
  code: string;
  label: string;
  /** Which transaction kinds offer this reason. */
  appliesTo: RefundSourceType[];
  /** The operation the reason asks for, before eligibility is considered. */
  kind: RefundKind;
  /** Extra facts an administrator needs; the UI asks for details. */
  requiresDetails?: boolean;
  /** One line the customer sees under the option. */
  hint: string;
}

/**
 * The reason catalog. Deliberately small: one entry per real situation the app
 * can prove, plus "other". A long list of near-duplicates makes the customer
 * choose a label that then decides the wrong policy branch.
 */
export const REFUND_REASONS: RefundReason[] = [
  {
    code: "ai_not_delivered",
    label: "The AI service failed or never delivered",
    appliesTo: ["ai_service"],
    kind: "credits",
    hint: "Credits are returned automatically when the failure is verified.",
  },
  {
    code: "ai_incomplete",
    label: "The AI result was incomplete or unusable",
    appliesTo: ["ai_service"],
    kind: "credits",
    requiresDetails: true,
    hint: "A person reviews incomplete results; a blank or cut-off report is the usual case.",
  },
  {
    code: "ai_duplicate_charge",
    label: "I was charged more than once for the same request",
    appliesTo: ["ai_service", "duplicate_charge"],
    kind: "credits",
    hint: "We check the ledger for a second debit before returning anything.",
  },
  {
    code: "credits_unused",
    label: "I bought credits and have not used them",
    appliesTo: ["credit_purchase"],
    kind: "money",
    hint: "Unused purchased credits can be put forward for a money refund.",
  },
  {
    code: "purchase_not_delivered",
    label: "The purchase was never delivered",
    appliesTo: ["credit_purchase", "other"],
    kind: "money",
    requiresDetails: true,
    hint: "We check what the purchase granted before deciding.",
  },
  {
    code: "purchase_unauthorised",
    label: "This purchase was not made by me",
    appliesTo: ["unauthorized", "credit_purchase", "subscription"],
    kind: "money",
    requiresDetails: true,
    hint: "These always go to a person; nothing is dismissed automatically.",
  },
  {
    code: "subscription_refund",
    label: "I want my subscription refunded",
    appliesTo: ["subscription"],
    kind: "subscription",
    hint: "Subscription money is held by the store; a person reviews the request.",
  },
  {
    code: "other",
    label: "Something else",
    appliesTo: ["other", "ai_service", "credit_purchase", "subscription", "duplicate_charge", "unauthorized"],
    kind: "credits",
    requiresDetails: true,
    hint: "A person reads this and decides.",
  },
];

export function reasonsForSource(sourceType: RefundSourceType): RefundReason[] {
  return REFUND_REASONS.filter((r) => r.appliesTo.includes(sourceType));
}

export function reasonByCode(code: string): RefundReason | null {
  return REFUND_REASONS.find((r) => r.code === code) ?? null;
}

// ---------------------------------------------------------------------------
// Facts the edge function loads (never the browser)
// ---------------------------------------------------------------------------

export interface RefundChargeFacts {
  id: string;
  /** Signed ledger amount; a debit is negative. */
  amount: number;
  feature: string | null;
  source: string;
  idempotencyKey: string | null;
  createdAt: string;
}

export interface RefundJobFacts {
  status: ServiceJobStatus;
  errorCode: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface RefundPurchaseFacts {
  id: string;
  productId: string;
  productType: string;
  priceCents: number;
  currency: string;
  purchasedAt: string;
  providerReference: string | null;
  /** Credits this purchase granted, when the catalog knows them. */
  creditsGranted: number | null;
  /** Unspent part of those credits, computed from the ledger (never the client). */
  creditsUnused: number | null;
}

export interface RefundSubscriptionFacts {
  planType: string;
  status: string;
  startedAt: string | null;
  expiresAt: string | null;
  purchaseToken: string | null;
}

export interface RefundProviderFacts {
  /** True only when a verified provider is configured AND refunds are enabled. */
  canInitiateRefund: boolean;
  providerId: string | null;
}

export interface RefundFacts {
  sourceType: RefundSourceType;
  reasonCode: string;
  details: string | null;
  charge: RefundChargeFacts | null;
  job: RefundJobFacts | null;
  purchase: RefundPurchaseFacts | null;
  subscription: RefundSubscriptionFacts | null;
  /** Completed credit restorations recorded against this same charge. */
  priorRestorations: number;
  /** Another non-terminal case exists for this charge. */
  anotherActiveCase: boolean;
  provider: RefundProviderFacts;
  /** Cases the user opened in the last 24h (a review flag, never a reject). */
  submissionsLast24h: number;
  now?: string;
}

export type RefundOutcome = "auto_credit_restore" | "review" | "auto_reject";

export interface RefundDecision {
  outcome: RefundOutcome;
  kind: RefundKind;
  /** Credits to restore, derived from the charge — never from the request. */
  credits: number | null;
  /** Money to put forward, derived from the purchase — never from the request. */
  amountCents: number | null;
  currency: string;
  /** Rule ids that produced this decision, in evaluation order. */
  rules: string[];
  /** Administrator-facing explanation. */
  summary: string;
  /** Customer-facing explanation of the immediate outcome. */
  customerMessage: string;
  /** True when a human can still look at an automatic rejection. */
  escalatable: boolean;
  /** True when the operation needs a payment provider before money can move. */
  providerActionRequired: boolean;
}

const HOUR_MS = 60 * 60 * 1000;

/** Submitted cases are never silently rewritten; this is the initial status. */
export function initialStatus(decision: RefundDecision): RefundStatus {
  switch (decision.outcome) {
    case "auto_credit_restore":
      return "approved_processing";
    case "auto_reject":
      return "declined";
    default:
      return "under_review";
  }
}

/**
 * Credits a purchase still has available. Conservative and derived from the
 * ledger: grant amount minus consumption recorded after the purchase, floored
 * at zero. It is an estimate used to present an amount to a human — never an
 * automatic payout, because monetary refunds stay review-only until a provider
 * exists.
 */
export function estimateUnusedPurchasedCredits(input: {
  creditsGranted: number | null;
  creditsConsumedAfterPurchase: number;
}): number {
  const granted = Math.max(0, Math.floor(input.creditsGranted ?? 0));
  const consumed = Math.max(0, Math.floor(input.creditsConsumedAfterPurchase));
  return Math.max(0, granted - consumed);
}

/** Money value of the unused part, rounded down to whole cents. */
export function estimateUnusedPurchaseValueCents(input: {
  priceCents: number;
  creditsGranted: number | null;
  creditsUnused: number | null;
}): number {
  const granted = Math.max(0, Math.floor(input.creditsGranted ?? 0));
  const unused = Math.max(0, Math.floor(input.creditsUnused ?? 0));
  if (granted <= 0 || unused <= 0 || input.priceCents <= 0) return 0;
  // Nothing was used: the whole price, not a floating-point cent short of it.
  if (unused >= granted) return input.priceCents;
  const perCredit = input.priceCents / granted;
  // +1e-9 absorbs binary floating point only (999/120*120 is 998.999…); it is
  // far smaller than a cent, so it cannot round a genuine fraction up.
  return Math.max(0, Math.min(input.priceCents, Math.floor(perCredit * unused + 1e-9)));
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Features charged per AI use. Mirrors AI_USAGE_FEATURES in src/config/credits.ts;
 * a test asserts the two lists stay equal, because a feature missing here would
 * be shown as "not an AI service" in the refund picker while still charging.
 */
export const AI_SERVICE_FEATURES: string[] = [
  "vaylo_coach_message",
  "weekly_coach_review",
  "calorie_scan",
  "nutrition_review",
  "video_form_analysis",
  "tactical_prep",
  "training_plan_week",
  "plan_edit",
  "plan_edit_full",
  "development_trajectory",
  "archetype_view",
  "form_analysis",
  "limiter_fix_plan",
  "training_insight",
  "injury_plan",
];

export function isAiServiceFeature(feature: string | null | undefined): boolean {
  return !!feature && AI_SERVICE_FEATURES.includes(feature);
}

/** Rule ids. Exported so the admin dashboard and tests share the vocabulary. */
export const RULES = {
  AI_JOB_FAILED: "ai_job_failed_verified",
  AI_JOB_DELIVERED: "ai_job_delivered",
  AI_JOB_UNVERIFIED: "ai_job_unverified",
  AI_JOB_MISSING: "ai_job_missing",
  NOTHING_CHARGED: "nothing_charged",
  ALREADY_RESTORED: "already_restored",
  ACTIVE_CASE_EXISTS: "active_case_exists",
  AMOUNT_MISMATCH: "amount_mismatch",
  PROVIDER_UNAVAILABLE: "provider_not_connected",
  PURCHASE_UNVERIFIED: "purchase_unverified",
  PURCHASE_FULLY_USED: "purchase_fully_used",
  PURCHASE_ALREADY_REFUNDED: "purchase_already_refunded",
  SUBSCRIPTION_PROVIDER: "subscription_requires_provider",
  DUPLICATE_OR_UNAUTHORISED: "duplicate_or_unauthorised_review",
  DETAILS_REQUIRED: "details_required",
  VELOCITY: "submission_velocity_review",
  CHARGE_VERIFICATION: "charge_verification_incomplete",
} as const;

export function evaluateRefundRequest(facts: RefundFacts): RefundDecision {
  const reason = reasonByCode(facts.reasonCode);
  const nowMs = facts.now ? Date.parse(facts.now) : Date.now();
  const rules: string[] = [];
  const add = (rule: string) => {
    if (!rules.includes(rule)) rules.push(rule);
  };

  const kind: RefundKind = reason?.kind ?? "credits";
  const base = {
    kind,
    credits: null as number | null,
    amountCents: null as number | null,
    currency: facts.purchase?.currency ?? "USD",
    rules,
    escalatable: true,
    providerActionRequired: false,
  };

  if (facts.anotherActiveCase) {
    add(RULES.ACTIVE_CASE_EXISTS);
    return {
      ...base,
      outcome: "auto_reject",
      summary:
        "Another open case already exists for this transaction. The existing case must be decided before a second request is accepted.",
      customerMessage: "This transaction already has an open request — we are working on it.",
      escalatable: false,
    };
  }

  // ---- Credit cases: an AI charge that may not have delivered --------------
  if (facts.sourceType === "ai_service" || (kind === "credits" && facts.charge)) {
    const charge = facts.charge;

    // A verified failure: the automatic refund path already established that
    // the provider call failed. Only here is restoring credits automatic.
    if (facts.job?.status === "failed") {
      add(RULES.AI_JOB_FAILED);
      if (!charge) {
        add(RULES.CHARGE_VERIFICATION);
        return {
          ...base,
          outcome: "review",
          summary: "The service job is marked failed but the matching charge could not be loaded.",
          customerMessage: "We are checking this request by hand.",
        };
      }
      const credits = Math.abs(Math.min(0, charge.amount));
      if (credits <= 0) {
        add(RULES.NOTHING_CHARGED);
        return {
          ...base,
          outcome: "auto_reject",
          credits: 0,
          summary: "The failed job has no charge to restore (an Unlimited plan or a zero-price call).",
          customerMessage: "No credits were taken for this request, so there is nothing to return.",
        };
      }
      if (facts.priorRestorations > 0) {
        add(RULES.ALREADY_RESTORED);
        return {
          ...base,
          outcome: "auto_reject",
          credits: 0,
          summary: "This charge was already restored by an earlier refund.",
          customerMessage: "The credits for this request have already been returned.",
        };
      }
      return {
        ...base,
        outcome: "auto_credit_restore",
        credits,
        summary: `Verified failure: ${credits} credits are being returned through the ledger (grant key derived from the charge).`,
        customerMessage: `${credits} credits are on their way back to your balance.`,
      };
    }

    // Delivered: not ordinarily refundable. Always escalatable.
    if (facts.job?.status === "delivered") {
      add(RULES.AI_JOB_DELIVERED);
      return {
        ...base,
        outcome: "auto_reject",
        credits: 0,
        summary:
          "The AI service was delivered. Policy does not refund a completed service, but the case can be escalated to a person.",
        customerMessage:
          "This AI result was delivered, so it is not normally refundable. You can still ask for a human review.",
      };
    }

    // Started (no outcome recorded) or no job row at all: delivery cannot be
    // proven either way. Do not invent a result; send it to a person.
    add(facts.job ? RULES.AI_JOB_UNVERIFIED : RULES.AI_JOB_MISSING);
    if (!charge) add(RULES.CHARGE_VERIFICATION);
    return {
      ...base,
      outcome: "review",
      summary: facts.job
        ? "The charge exists but the service job has no recorded outcome, so delivery is unverified."
        : "The charge predates the service-job ledger, so delivery cannot be verified automatically.",
      customerMessage: "A person is checking what happened with this AI request.",
    };
  }

  // ---- Money cases: purchased credits -------------------------------------
  if (kind === "money") {
    if (facts.sourceType === "duplicate_charge" || facts.sourceType === "unauthorized") {
      add(RULES.DUPLICATE_OR_UNAUTHORISED);
      return {
        ...base,
        outcome: "review",
        amountCents: facts.purchase?.priceCents ?? null,
        summary:
          "A duplicate or unauthorised-charge claim needs a person: the claim is never rejected automatically.",
        customerMessage: "A person is reviewing this — nothing has been dismissed.",
        providerActionRequired: true,
      };
    }

    const purchase = facts.purchase;
    if (!purchase) {
      add(RULES.PURCHASE_UNVERIFIED);
      return {
        ...base,
        outcome: "review",
        summary: "No matching purchase record was found; a person must reconcile it.",
        customerMessage: "We could not match this to a purchase yet — a person is looking at it.",
        providerActionRequired: true,
      };
    }
    if (purchase.providerReference && purchase.creditsUnused === null) {
      add(RULES.PURCHASE_UNVERIFIED);
    }

    if ((purchase.creditsUnused ?? 0) <= 0 && (purchase.creditsGranted ?? 0) > 0) {
      add(RULES.PURCHASE_FULLY_USED);
      return {
        ...base,
        outcome: "auto_reject",
        amountCents: 0,
        summary: "Every credit from this purchase has been spent.",
        customerMessage:
          "All of the credits from this purchase have been used, so there is no unused balance to refund.",
      };
    }

    const amountCents = estimateUnusedPurchaseValueCents({
      priceCents: purchase.priceCents,
      creditsGranted: purchase.creditsGranted,
      creditsUnused: purchase.creditsUnused,
    }) || purchase.priceCents;

    add(RULES.PROVIDER_UNAVAILABLE);
    return {
      ...base,
      outcome: "review",
      amountCents,
      summary: `Unused-credit money refund for ${purchase.productId}: up to ${amountCents}¢.`,
      customerMessage:
        "We have recorded your request. A person reviews it; no money moves until a payment provider is connected.",
      providerActionRequired: true,
    };
  }

  // ---- Subscriptions ------------------------------------------------------
  add(RULES.SUBSCRIPTION_PROVIDER);
  add(RULES.PROVIDER_UNAVAILABLE);
  return {
    ...base,
    outcome: "review",
    summary: "Subscription refunds are held by the store; the case is recorded for a person and provider reconciliation.",
    customerMessage:
      "We have recorded your request. Subscription money is held by the store, so a person will review it with you.",
    providerActionRequired: true,
  };
}

// ---------------------------------------------------------------------------
// Velocity / abuse signals — review flags only
// ---------------------------------------------------------------------------

/** At most this many submissions in a rolling day before a human looks. */
export const VELOCITY_REVIEW_THRESHOLD = 5;

/**
 * Adds the velocity rule to a decision that is already going to review. It is
 * intentionally NOT able to turn a case into a rejection: a burst of refund
 * requests is a reason to look, not a finding of fraud.
 */
export function applyVelocityFlag(decision: RefundDecision, submissionsLast24h: number): RefundDecision {
  if (submissionsLast24h < VELOCITY_REVIEW_THRESHOLD) return decision;
  if (decision.rules.includes(RULES.VELOCITY)) return decision;
  const rules = [...decision.rules, RULES.VELOCITY];
  if (decision.outcome === "review") {
    return {
      ...decision,
      rules,
      summary: `${decision.summary} ${submissionsLast24h} requests were opened in the last 24 hours, which warrants a look.`,
    };
  }
  return { ...decision, rules };
}
