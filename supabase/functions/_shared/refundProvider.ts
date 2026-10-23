// ============================================================================
// REFUND PROVIDER — the seam Google Play (or any store) plugs into later
// ----------------------------------------------------------------------------
// Refund policy, the credit ledger, the admin dashboard, email approvals and the
// in-app screens know nothing about a store. They talk to this interface. When
// Google Play Billing is ready, only this file grows a working implementation;
// nothing above it is rewritten.
//
// What is REAL today:
//   * `verifyPurchase()` reuses `_shared/playBilling.ts`, which verifies a
//     purchase token against the Play Developer API using the configured
//     service account. That is a genuine verification call, not a stub.
//   * `isConfigured()` reflects the actual secrets and the explicit
//     REFUND_MONETARY_ENABLED gate.
//
// What is deliberately NOT real today:
//   * `initiateRefund()` returns `unavailable` with a machine-readable code.
//     The Play Developer API path for issuing refunds is not implemented in
//     this codebase, and a fake success here would be the worst possible bug:
//     the dashboard would say "refunded" while the athlete's money stayed put.
//   * `getRefundStatus()`, `handleNotification()` and `reconcileEntitlements()`
//     likewise report `unsupported` until their provider work exists.
//
// The contract a future implementation must satisfy is written down in
// docs/REFUNDS.md §"Google Play integration contract".
// ============================================================================

import { verifyPlayPurchase, type PlayReceipt } from "./playBilling.ts";

export type ProviderCapability =
  | "verify_purchase"
  | "transaction_state"
  | "initiate_refund"
  | "refund_status"
  | "notifications"
  | "subscription_reconcile";

export interface ProviderCapabilities {
  verify_purchase: boolean;
  transaction_state: boolean;
  initiate_refund: boolean;
  refund_status: boolean;
  notifications: boolean;
  subscription_reconcile: boolean;
}

export interface ProviderPurchaseRef {
  /** Store-side reference: Play purchase token, order id, etc. */
  reference: string;
  productId?: string | null;
  packageName?: string | null;
}

export type ProviderTransactionStatus =
  | "purchased"
  | "pending"
  | "cancelled"
  | "refunded"
  | "unknown";

export interface ProviderTransaction {
  ok: boolean;
  status: ProviderTransactionStatus;
  productId?: string;
  purchaseTime?: string;
  /** Raw provider identifiers safe to store for reconciliation. */
  providerReference?: string;
  error?: string;
  code?: ProviderErrorCode;
}

export type ProviderErrorCode =
  | "provider_not_configured"
  | "provider_refund_not_integrated"
  | "provider_unsupported_operation"
  | "provider_rejected"
  | "provider_unreachable";

export interface MonetaryRefundRequest {
  caseRef: string;
  /** Store transaction reference being refunded. */
  reference: string;
  amountCents: number;
  currency: string;
  /**
   * Idempotency key the provider should honour where it supports one. It is
   * derived from the case, so a retried approval can never refund twice at a
   * provider that accepts idempotent requests.
   */
  idempotencyKey: string;
  reason: string;
}

export type ProviderRefundState =
  | "executed"
  | "pending"
  | "failed"
  | "unavailable"
  | "unsupported";

export interface ProviderRefundResult {
  ok: boolean;
  state: ProviderRefundState;
  providerRefundId?: string;
  /** True when the provider has definitively not moved money. */
  noMoneyMoved: boolean;
  error?: string;
  code?: ProviderErrorCode;
}

export interface ProviderNotificationResult {
  ok: boolean;
  handled: boolean;
  state?: ProviderTransactionStatus;
  code?: ProviderErrorCode;
  error?: string;
}

export interface ProviderReconcileResult {
  ok: boolean;
  entitlementsChanged: boolean;
  code?: ProviderErrorCode;
  error?: string;
}

export interface RefundProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  /** True when credentials AND the monetary-refund gate are both present. */
  isConfigured(): boolean;
  verifyPurchase(ref: ProviderPurchaseRef): Promise<ProviderTransaction>;
  getTransactionState(ref: ProviderPurchaseRef): Promise<ProviderTransaction>;
  initiateRefund(req: MonetaryRefundRequest): Promise<ProviderRefundResult>;
  getRefundStatus(providerRefundId: string): Promise<ProviderRefundResult>;
  handleNotification(payload: unknown): Promise<ProviderNotificationResult>;
  reconcileEntitlements(userId: string): Promise<ProviderReconcileResult>;
}

// ---------------------------------------------------------------------------
// Gates and environment
// ---------------------------------------------------------------------------

// globalThis rather than a bare `Deno`: this module is imported by app-side
// tests, and `src` compiles without a Deno lib. Outside Deno there is no
// environment, so every gate below reads as "not configured" — fail closed.
function env(name: string): string {
  try {
    const deno = (globalThis as {
      Deno?: { env?: { get(key: string): string | undefined } };
    }).Deno;
    return (deno?.env?.get(name) ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * Monetary refunds are OFF unless the operator explicitly enables them AND a
 * provider is configured. Both conditions are checked server-side; there is no
 * client flag, query parameter or environment default that turns them on.
 */
export function monetaryRefundsEnabled(): boolean {
  return env("REFUND_MONETARY_ENABLED") === "true";
}

export function configuredRefundProviderId(): string | null {
  const id = env("REFUND_PROVIDER").toLowerCase();
  return id || null;
}

// ---------------------------------------------------------------------------
// Google Play
// ---------------------------------------------------------------------------

export const GOOGLE_PLAY_PROVIDER_ID = "google_play";

/**
 * Google Play refund capabilities as this codebase can actually honour them.
 *
 * Verification is real; refund initiation is not implemented. `capabilities`
 * says so explicitly, and `initiateRefund()` re-checks it, so the admin edge
 * function can decide "awaiting provider" without guessing from an error string.
 */
export class GooglePlayRefundProvider implements RefundProvider {
  readonly id = GOOGLE_PLAY_PROVIDER_ID;
  readonly capabilities: ProviderCapabilities = {
    verify_purchase: true,
    transaction_state: true,
    initiate_refund: false,
    refund_status: false,
    notifications: false,
    subscription_reconcile: false,
  };

  private credentials(): { email: string; key: string; packageName: string } | null {
    const email = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    const key = env("GOOGLE_PRIVATE_KEY");
    const packageName = env("GOOGLE_ANDROID_PACKAGE_NAME");
    if (!email || !key || !packageName) return null;
    return { email, key, packageName };
  }

  isConfigured(): boolean {
    return (
      configuredRefundProviderId() === GOOGLE_PLAY_PROVIDER_ID &&
      this.credentials() !== null &&
      monetaryRefundsEnabled()
    );
  }

  /** Credentials present even if monetary refunds are switched off. */
  canVerify(): boolean {
    return configuredRefundProviderId() === GOOGLE_PLAY_PROVIDER_ID && this.credentials() !== null;
  }

  async verifyPurchase(ref: ProviderPurchaseRef): Promise<ProviderTransaction> {
    const creds = this.credentials();
    if (!creds) {
      return {
        ok: false,
        status: "unknown",
        code: "provider_not_configured",
        error: "Google Play credentials are not configured.",
      };
    }
    try {
      const receipt: PlayReceipt | null = ref.productId
        ? { productId: ref.productId, packageName: ref.packageName ?? creds.packageName }
        : null;
      const result = await verifyPlayPurchase(ref.reference, receipt, {
        serviceAccountEmail: creds.email,
        privateKey: creds.key,
        packageName: creds.packageName,
      });
      if (result.ok && result.purchase) {
        return {
          ok: true,
          status: "purchased",
          productId: result.purchase.productId,
          purchaseTime: result.purchase.purchasedAt,
          providerReference: result.purchase.purchaseToken,
        };
      }
      if (result.reversed) {
        return { ok: true, status: "refunded", error: result.error };
      }
      return { ok: false, status: "unknown", error: result.error };
    } catch (error) {
      return {
        ok: false,
        status: "unknown",
        code: "provider_unreachable",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getTransactionState(ref: ProviderPurchaseRef): Promise<ProviderTransaction> {
    return this.verifyPurchase(ref);
  }

  async initiateRefund(_req: MonetaryRefundRequest): Promise<ProviderRefundResult> {
    // Never fake this. The Play refund path is a console/Orders-API operation
    // that this project has not integrated; reporting success would tell an
    // administrator money moved when it did not.
    return {
      ok: false,
      state: "unsupported",
      noMoneyMoved: true,
      code: "provider_refund_not_integrated",
      error:
        "Google Play refund execution is not integrated. Record the decision as awaiting provider until the Orders API path is implemented and verified.",
    };
  }

  async getRefundStatus(_providerRefundId: string): Promise<ProviderRefundResult> {
    return {
      ok: false,
      state: "unsupported",
      noMoneyMoved: true,
      code: "provider_unsupported_operation",
      error: "Provider refund-status lookup is not implemented.",
    };
  }

  async handleNotification(_payload: unknown): Promise<ProviderNotificationResult> {
    return {
      ok: false,
      handled: false,
      code: "provider_unsupported_operation",
      error: "Real-time developer notifications are not implemented for refunds.",
    };
  }

  async reconcileEntitlements(_userId: string): Promise<ProviderReconcileResult> {
    return {
      ok: false,
      entitlementsChanged: false,
      code: "provider_unsupported_operation",
      error: "Subscription entitlement reconciliation against Play is not implemented.",
    };
  }
}

// ---------------------------------------------------------------------------
// The provider with nothing behind it
// ---------------------------------------------------------------------------

/**
 * Used when no provider is configured. Every monetary operation says exactly
 * that, and `noMoneyMoved` is always true — the one claim this class is allowed
 * to make with certainty.
 */
export class UnconfiguredRefundProvider implements RefundProvider {
  readonly id = "unconfigured";
  readonly capabilities: ProviderCapabilities = {
    verify_purchase: false,
    transaction_state: false,
    initiate_refund: false,
    refund_status: false,
    notifications: false,
    subscription_reconcile: false,
  };

  isConfigured(): boolean {
    return false;
  }

  async verifyPurchase(_ref: ProviderPurchaseRef): Promise<ProviderTransaction> {
    return {
      ok: false,
      status: "unknown",
      code: "provider_not_configured",
      error: "No payment provider is connected.",
    };
  }

  async getTransactionState(_ref: ProviderPurchaseRef): Promise<ProviderTransaction> {
    return this.verifyPurchase(_ref);
  }

  async initiateRefund(_req: MonetaryRefundRequest): Promise<ProviderRefundResult> {
    return {
      ok: false,
      state: "unavailable",
      noMoneyMoved: true,
      code: "provider_not_configured",
      error: "No payment provider is connected; monetary refunds cannot be executed.",
    };
  }

  async getRefundStatus(_providerRefundId: string): Promise<ProviderRefundResult> {
    return {
      ok: false,
      state: "unavailable",
      noMoneyMoved: true,
      code: "provider_not_configured",
      error: "No payment provider is connected.",
    };
  }

  async handleNotification(_payload: unknown): Promise<ProviderNotificationResult> {
    return {
      ok: false,
      handled: false,
      code: "provider_not_configured",
      error: "No payment provider is connected.",
    };
  }

  async reconcileEntitlements(_userId: string): Promise<ProviderReconcileResult> {
    return {
      ok: false,
      entitlementsChanged: false,
      code: "provider_not_configured",
      error: "No payment provider is connected.",
    };
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * The provider the refund engine should use right now.
 *
 * Only Google Play is wired, and only as a verifier. Anything else configured in
 * REFUND_PROVIDER resolves to the unconfigured provider rather than silently
 * attempting a provider the codebase does not know — an unknown id must never
 * be treated as "probably works".
 */
export function refundProvider(): RefundProvider {
  if (configuredRefundProviderId() === GOOGLE_PLAY_PROVIDER_ID) {
    return new GooglePlayRefundProvider();
  }
  return new UnconfiguredRefundProvider();
}

/** True when money can actually be moved by the configured provider. */
export function providerCanRefund(): boolean {
  const provider = refundProvider();
  return provider.isConfigured() && provider.capabilities.initiate_refund;
}
