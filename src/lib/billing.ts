// ============================================================================
// BILLING — ONE SEAM FOR WEB AND STORE PURCHASES
// ----------------------------------------------------------------------------
// Today every purchase goes to the `process-purchase` edge function, which
// grants credits/coins/unlocks server-side.
//
// Store rules for a mobile app: Apple and Google require digital goods to be
// sold through their in-app purchase systems, so once the Capacitor shell ships
// the *client* has to collect a store receipt first and the *server* has to
// verify it. This module is the single place that changes:
//
//   web    → invoke process-purchase directly (current behaviour, unchanged)
//   store  → buy through the store plugin, then invoke process-purchase WITH the
//            verification payload so the server can check it
//
// Nothing here pretends the store integration exists: with no plugin installed
// `storeProvider.available()` is false and the web path is used, exactly as now.
// See CAPACITOR.md for the wiring steps.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { getPlatform, isNative, loadPlugin } from "@/lib/platform";

/** Flip to true only once the store plugin + server verifier are in place. */
export const STORE_BILLING_ENABLED = false;

export interface PurchaseItem {
  product_id: string;
  product_type?: string;
  product_name?: string;
  /** Display only — the server always re-reads the real price from its tables. */
  price_cents?: number;
}

export interface PurchaseVerification {
  /** Store transaction id / purchase token — used for idempotency server-side. */
  reference: string;
  /** Raw receipt payload for server-side verification. */
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

export interface BillingProvider {
  id: "web" | "store";
  label: string;
  available: () => boolean;
  purchase: (items: PurchaseItem[], verification?: PurchaseVerification) => Promise<PurchaseResult>;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error ?? "Purchase failed");

/** Shared edge-function call — the same endpoint and body the app already used. */
async function invokePurchase(
  items: PurchaseItem[],
  verification?: PurchaseVerification
): Promise<PurchaseResult> {
  const { data, error } = await supabase.functions.invoke("process-purchase", {
    body: {
      items,
      platform: getPlatform(),
      ...(verification ? { verification } : {}),
    },
  });

  if (error) {
    // supabase-js wraps non-2xx responses; surface the server's message.
    const context = (error as { context?: { body?: string } }).context;
    let message = error.message;
    if (context?.body) {
      try {
        message = JSON.parse(context.body)?.error ?? message;
      } catch {
        message = context.body || message;
      }
    }
    return { ok: false, error: message };
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

interface StoreBillingPlugin {
  purchase: (options: { productId: string }) => Promise<{
    transactionId?: string;
    receipt?: string;
    cancelled?: boolean;
  }>;
  restore?: () => Promise<unknown>;
}

const storeProvider: BillingProvider = {
  id: "store",
  label: "App Store / Play Billing",
  available: () => STORE_BILLING_ENABLED && isNative(),
  purchase: async (items) => {
    if (items.length !== 1) {
      return { ok: false, error: "Store purchases are one product at a time." };
    }
    const plugin = await loadPlugin<StoreBillingPlugin>("in-app-purchases");
    if (!plugin?.purchase) {
      return { ok: false, error: "Store billing plugin is not installed in this build." };
    }
    try {
      const result = await plugin.purchase({ productId: items[0].product_id });
      if (result?.cancelled) return { ok: false, cancelled: true, error: "Purchase cancelled." };
      if (!result?.transactionId) {
        return { ok: false, error: "The store did not return a transaction id." };
      }
      // The server verifies this receipt before granting anything.
      return invokePurchase(items, { reference: result.transactionId, receipt: result.receipt });
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
  return activeBilling().purchase(items, verification);
}

/**
 * True when purchases go through the store rather than web checkout. UI that
 * only makes sense on a device ("Restore purchases") keys off this.
 */
export const isStoreBilling = () => storeProvider.available();

/**
 * Asks the store to replay the athlete's previous transactions.
 *
 * Both stores require a visible restore path for IAP builds. The store replays
 * receipts and the **server** must re-verify them through
 * `verifyStorePurchase()` before granting anything — restoring is not a trust
 * shortcut, which is why this only reports whether the store call succeeded.
 * Currently unavailable on the web build, where the button is not shown.
 */
export async function restorePurchases(): Promise<PurchaseResult> {
  if (!storeProvider.available()) {
    return { ok: false, error: "Restore is only available in the app build." };
  }
  const plugin = await loadPlugin<StoreBillingPlugin>("in-app-purchases");
  if (!plugin?.restore) {
    return { ok: false, error: "Store billing plugin is not installed in this build." };
  }
  try {
    await plugin.restore();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

/** Diagnostics for a hidden/debug screen. */
export const billingStatus = () => ({
  platform: getPlatform(),
  provider: activeBilling().id,
  storeEnabled: STORE_BILLING_ENABLED,
  native: isNative(),
});

