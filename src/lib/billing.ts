//============================================================================
// BILLING — ONE SEAM FOR WEB AND GOOGLE PLAY BILLING
// ----------------------------------------------------------------------------
// Today every purchase goes to the `process-purchase` edge function, which
// grants credits/coins/unlocks server-side.
//
// Store rules: Google requires digital goods in the Android app to be sold
// through Play Billing, so once the Capacitor shell ships the *client* buys
// through Play first and the *server* verifies the purchase token against the
// Google Play Developer API before granting (see
// supabase/functions/_shared/playBilling.ts). This module is the single place
// that changes:
//
//   web    → invoke process-purchase directly (current behaviour, unchanged)
//   store  → buy through the Play Billing plugin, then invoke process-purchase
//            with the purchase token + receipt so the server can verify it
//
// A future native plugin implements playBillingAdapter.ts. Closed testing
// always uses the free server path. See CAPACITOR.md §3 for activation steps.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { getPlatform, isNative } from "@/lib/platform";
import { freeCreditsActive, CLOSED_TESTING } from "@/config/closedTesting";
import { DEMO_MODE, demoGrant } from "@/lib/demoMode";
import { UNLOCK_CATALOG } from "@/config/unlocks";
import { getPlayBillingAdapter, type PlayPurchase } from "@/lib/playBillingAdapter";
import { STORE_BILLING_ENABLED } from "@/config/billing";

export { STORE_BILLING_ENABLED } from "@/config/billing";

export interface PurchaseItem {
  product_id: string;
  product_type?: string;
  product_name?: string;
  /** Display only — the server always re-reads the real price from its tables. */
  price_cents?: number;
}

export interface PurchaseVerification {
  /** Google Play purchase token — used for idempotency server-side. */
  reference: string;
  /** JSON receipt { packageName, productId } for server-side verification. */
  receipt?: string;
}

export interface PurchaseResult {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
  data?: {
    credits_added?: number;
    bonus_added?: number;
    coins_added?: number;
    infinite?: boolean;
    [key: string]: unknown;
  };
}

/**
 * True when the server refused because no payment provider is wired yet, rather
 * than because anything went wrong.
 *
 * Until Play Billing (or a web provider) is live, process-purchase refuses
 * every product priced in cents with `code: "payments_not_available"`. That is
 * a fact about the app, not a failure, and the difference matters at the three
 * call sites that would otherwise shout "Purchase failed" with a red toast the
 * first time an athlete tries to spend money.
 */
export const isPaymentsUnavailable = (result: PurchaseResult): boolean =>
  !result.ok && (result.data as { code?: string } | undefined)?.code === "payments_not_available";

export const PAYMENTS_UNAVAILABLE_MESSAGE =
  "Purchases aren't available yet. Credits you earn in the app still unlock Mental Gym, Form Analysis, Injury Management and Event Packs.";

/**
 * True when the server refused because the closed-test switch is on but the
 * server's `PAYMENT_MODE` secret is not set to `free`. The two switches have to
 * agree (see src/config/closedTesting.ts); when they do not, the client is
 * showing "free" while the server is charging-or-refusing, and the athlete must
 * be told plainly rather than shown a red failure.
 */
export const isFreeGrantUnavailable = (result: PurchaseResult): boolean =>
  !result.ok && (result.data as { code?: string } | undefined)?.code === "free_grant_unavailable";

export const FREE_GRANT_UNAVAILABLE_MESSAGE =
  "Free credits aren't switched on for this build yet. Please try again shortly — nothing has been charged.";

/**
 * Label to show beside a price. While the closed test runs this is "Free"
 * rather than the money, because showing a price that will not be charged is a
 * lie the athlete can see through at the basket.
 */
export const priceLabelFor = (formattedPrice: string): string =>
  freeCreditsActive() ? CLOSED_TESTING.label : formattedPrice;

export interface BillingProvider {
  id: "web" | "store";
  label: string;
  available: () => boolean;
  purchase: (items: PurchaseItem[], verification?: PurchaseVerification) => Promise<PurchaseResult>;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error ?? "Purchase failed");

/**
 * Pull a message and the rest of the body out of a failed function call.
 *
 * supabase-js rejects with a FunctionsHttpError whose `context` is the Response,
 * so the body has to be read off it — it is a stream, not a string, and
 * JSON.parse of one throws. Exported and unit-tested (billing.test.ts) because
 * the failure mode is invisible: nothing throws, the athlete just reads
 * "[object ReadableStream]".
 */
export async function readPurchaseError(
  error: unknown,
  fallback: string
): Promise<{ message: string; detail: Record<string, unknown> }> {
  const message = error instanceof Error ? error.message : fallback;
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return { message, detail: {} };
  // clone(): the stream is one-shot and the caller may still want the original.
  const text = await context.clone().text().catch(() => "");
  if (!text) return { message, detail: {} };
  try {
    const parsed = JSON.parse(text) as { error?: string; [key: string]: unknown };
    return { message: parsed.error ?? message, detail: parsed };
  } catch {
    return { message: text, detail: {} };
  }
}

/** Shared edge-function call — the same endpoint and body the app already used. */
async function invokePurchase(
  items: PurchaseItem[],
  verification?: PurchaseVerification
): Promise<PurchaseResult> {
  const { data, error } = await supabase.functions.invoke("process-purchase", {
    body: {
      items,
      platform: getPlatform(),
      // While the closed test runs, tell the server the client believes this is
      // a free grant. The server does NOT trust this flag on its own: it is
      // only honoured when PAYMENT_MODE=free is set as a secret, which is the
      // authority. Sending it means the two switches have to agree, so neither
      // a stale client nor a forgotten secret can silently start charging (or
      // silently stop). See src/config/closedTesting.ts.
      ...(freeCreditsActive() ? { closed_testing: true } : {}),
      ...(!freeCreditsActive() && verification ? { verification } : {}),
    },
  });

  if (error) {
    const { message, detail } = await readPurchaseError(error, "Purchase failed");
    return { ok: false, error: message, data: detail };
  }

  const payload = (data ?? {}) as { error?: string };
  if (payload.error) return { ok: false, error: payload.error };
  return { ok: true, data: payload as PurchaseResult["data"] };
}

const webProvider: BillingProvider = {
  id: "web",
  label: "Web checkout",
  available: () => true,
  purchase: (items, verification) => invokePurchase(items, verification),
};

async function applyStorePurchase(purchase: PlayPurchase): Promise<PurchaseResult> {
  if (!purchase.productId?.trim() || !purchase.packageName?.trim() || !purchase.purchaseToken?.trim()) {
    return { ok: false, error: "The store did not return a complete purchase." };
  }
  const result = await invokePurchase([{ product_id: purchase.productId }], {
    reference: purchase.purchaseToken,
    receipt: JSON.stringify({ packageName: purchase.packageName, productId: purchase.productId }),
  });
  // A duplicate row alone does not prove its grant completed. Leave failed
  // replays unconfirmed until the server can return a delivery receipt.
  return result;
}

const storeProvider: BillingProvider = {
  id: "store",
  label: "Google Play Billing",
  available: () => !freeCreditsActive() && STORE_BILLING_ENABLED && getPlatform() === "android",
  purchase: async (items) => {
    if (items.length !== 1) {
      return { ok: false, error: "Store purchases are one product at a time." };
    }
    const adapter = getPlayBillingAdapter();
    if (!adapter) {
      return { ok: false, error: "Google Play billing has not been configured in this build." };
    }
    try {
      const outcome = await adapter.purchase(items[0].product_id);
      if (outcome.cancelled === true) return { ok: false, cancelled: true, error: "Purchase cancelled." };
      if (outcome.purchase.productId !== items[0].product_id) {
        return { ok: false, error: "The store returned a different product." };
      }
      const result = await applyStorePurchase(outcome.purchase);
      if (!result.ok) return result;
      try {
        await adapter.finish(outcome.purchase);
      } catch {
        // Delivery succeeded. Restore can retry the store confirmation safely.
        return { ...result, data: { ...result.data, store_confirmation_pending: true } };
      }
      return result;
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  },
};

/** The provider that should handle the next purchase on this device. */
export function activeBilling(): BillingProvider {
  return storeProvider.available() ? storeProvider : webProvider;
}

/**
 * Buys one or more products. Call sites use this instead of touching the edge
 * function directly, so switching to store billing is a one-line change here.
 */
export async function purchaseItems(
  items: PurchaseItem[],
  verification?: PurchaseVerification
): Promise<PurchaseResult> {
  if (items.length === 0) return { ok: false, error: "Empty basket" };
  if (DEMO_MODE) {
    // Clone build (docs/WEB-CLONE.md): every purchase is free and granted
    // locally — no Play Billing, no edge function, no charge. Feature unlocks
    // read the grant back through hasFeature(); credit and coin packs change
    // no balance, because credits are non-functional in the clone.
    demoGrant(items.map((i) => i.product_id));
    return { ok: true, data: { demo_free: true } };
  }
  const creditProducts = new Set<string>(UNLOCK_CATALOG.map((entry) => entry.product));
  if (items.every((item) => creditProducts.has(item.product_id))) {
    return invokePurchase(items);
  }
  if (isStoreBilling() && items.some((item) => creditProducts.has(item.product_id))) {
    return { ok: false, error: "Buy feature unlocks separately from store products." };
  }
  return activeBilling().purchase(items, verification);
}

/**
 * True when purchases go through Play Billing rather than web checkout. UI that
 * only makes sense on a device ("Restore purchases") keys off this.
 */
export const isStoreBilling = () => storeProvider.available();

/**
 * Asks Google Play to replay the athlete's previous transactions.
 *
 * The adapter returns purchases; each token is verified by the server before
 * its store confirmation is retried. Unavailable during closed testing.
 */
export async function restorePurchases(): Promise<PurchaseResult> {
  if (!storeProvider.available()) {
    return { ok: false, error: "Restore is only available in the app build." };
  }
  const adapter = getPlayBillingAdapter();
  if (!adapter) {
    return { ok: false, error: "Google Play billing has not been configured in this build." };
  }
  try {
    const purchases = await adapter.restore();
    for (const purchase of purchases) {
      const result = await applyStorePurchase(purchase);
      if (!result.ok) return result;
      await adapter.finish(purchase);
    }
    return { ok: true, data: { restored: purchases.length } };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

/** Diagnostics for a hidden/debug screen. */
export const billingStatus = () => ({
  platform: getPlatform(),
  provider: activeBilling().id,
  storeEnabled: STORE_BILLING_ENABLED,
  adapterInstalled: getPlayBillingAdapter() !== null,
  native: isNative(),
});
