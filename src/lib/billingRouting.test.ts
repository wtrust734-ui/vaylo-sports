import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayBillingAdapter, PlayPurchase } from "./playBillingAdapter";

const state = vi.hoisted(() => ({ free: true, enabled: true, platform: "android" }));
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/config/closedTesting", () => ({
  freeCreditsActive: () => state.free,
  CLOSED_TESTING: { label: "Free during closed testing" },
}));
vi.mock("@/config/billing", () => ({ get STORE_BILLING_ENABLED() { return state.enabled; } }));
vi.mock("@/lib/platform", () => ({
  getPlatform: () => state.platform,
  isNative: () => state.platform !== "web",
}));
vi.mock("@/lib/demoMode", () => ({ DEMO_MODE: false, demoGrant: vi.fn() }));

import { purchaseItems, restorePurchases, isStoreBilling } from "./billing";
import { registerPlayBillingAdapter } from "./playBillingAdapter";

const purchase: PlayPurchase = {
  productId: "pack_25", packageName: "com.vaylosports.app", purchaseToken: "synthetic-purchase-token",
};
let adapter: PlayBillingAdapter;

beforeEach(() => {
  state.free = true;
  state.enabled = true;
  state.platform = "android";
  invoke.mockReset().mockResolvedValue({ data: { success: true }, error: null });
  adapter = {
    purchase: vi.fn().mockResolvedValue({ cancelled: false, purchase }),
    restore: vi.fn().mockResolvedValue([purchase]),
    finish: vi.fn().mockResolvedValue(undefined),
  };
  registerPlayBillingAdapter(adapter);
});

describe("closed testing", () => {
  it("keeps native purchases free even if the future store switch is enabled", async () => {
    const items = [{ product_id: "pack_25" }, { product_id: "infinite_lifetime" }];
    expect((await purchaseItems(items, { reference: "unused-order-id" })).ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("process-purchase", {
      body: { items, platform: "android", closed_testing: true },
    });
    expect(adapter.purchase).not.toHaveBeenCalled();
    expect(isStoreBilling()).toBe(false);
  });

  it("does not contact the store for restore", async () => {
    expect((await restorePurchases()).ok).toBe(false);
    expect(adapter.restore).not.toHaveBeenCalled();
  });

  it("ships with the real store switch disabled", async () => {
    const config = await vi.importActual<typeof import("@/config/billing")>("@/config/billing");
    expect(config.STORE_BILLING_ENABLED).toBe(false);
  });
});

describe("future Play adapter", () => {
  beforeEach(() => { state.free = false; });

  it("sends the purchase token and receipt to the server before confirming with Play", async () => {
    const events: string[] = [];
    invoke.mockImplementation(async () => { events.push("verify-and-grant"); return { data: {}, error: null }; });
    vi.mocked(adapter.finish).mockImplementation(async () => { events.push("finish"); });
    expect((await purchaseItems([{ product_id: "pack_25" }])).ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("process-purchase", {
      body: {
        items: [{ product_id: "pack_25" }], platform: "android",
        verification: {
          reference: purchase.purchaseToken,
          receipt: JSON.stringify({ packageName: purchase.packageName, productId: purchase.productId }),
        },
      },
    });
    expect(events).toEqual(["verify-and-grant", "finish"]);
  });

  it("fails clearly when the adapter has not been installed", async () => {
    registerPlayBillingAdapter(null);
    expect((await purchaseItems([{ product_id: "pack_25" }])).ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not send credit unlocks to Play", async () => {
    expect((await purchaseItems([{ product_id: "mental_gym" }])).ok).toBe(true);
    expect(adapter.purchase).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("process-purchase", {
      body: { items: [{ product_id: "mental_gym" }], platform: "android" },
    });
  });

  it("refuses mixed baskets before starting a store purchase", async () => {
    expect((await purchaseItems([{ product_id: "pack_25" }, { product_id: "mental_gym" }])).ok).toBe(false);
    expect(adapter.purchase).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not grant or finish a cancelled purchase", async () => {
    vi.mocked(adapter.purchase).mockResolvedValue({ cancelled: true });
    expect((await purchaseItems([{ product_id: "pack_25" }])).cancelled).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(adapter.finish).not.toHaveBeenCalled();
  });

  it("refuses a mismatched product or missing token before invoking the server", async () => {
    for (const value of [{ ...purchase, productId: "pack_500" }, { ...purchase, purchaseToken: "" }]) {
      vi.mocked(adapter.purchase).mockResolvedValue({ cancelled: false, purchase: value });
      expect((await purchaseItems([{ product_id: "pack_25" }])).ok).toBe(false);
    }
    expect(invoke).not.toHaveBeenCalled();
    expect(adapter.finish).not.toHaveBeenCalled();
  });

  it("does not finish a purchase the server refused", async () => {
    invoke.mockResolvedValue({ data: { error: "Receipt rejected" }, error: null });
    expect((await purchaseItems([{ product_id: "pack_25" }])).ok).toBe(false);
    expect(adapter.finish).not.toHaveBeenCalled();
  });

  it("keeps a successful grant successful if store confirmation needs a retry", async () => {
    vi.mocked(adapter.finish).mockRejectedValue(new Error("offline"));
    const result = await purchaseItems([{ product_id: "pack_25" }]);
    expect(result.ok).toBe(true);
    expect(result.data?.store_confirmation_pending).toBe(true);
  });

  it("re-verifies restored tokens without treating a duplicate row as delivery proof", async () => {
    const error = Object.assign(new Error("Already applied"), {
      context: new Response(JSON.stringify({ error: "Already applied", duplicate: true }), { status: 409 }),
    });
    invoke.mockResolvedValue({ data: null, error });
    expect((await restorePurchases()).ok).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(adapter.finish).not.toHaveBeenCalled();
  });

  it("confirms a restored purchase only after a successful server grant", async () => {
    expect((await restorePurchases()).data?.restored).toBe(1);
    expect(adapter.finish).toHaveBeenCalledWith(purchase);
  });

  it("never selects Play on web or iOS", () => {
    for (const platform of ["web", "ios"]) {
      state.platform = platform;
      expect(isStoreBilling()).toBe(false);
    }
  });
});
