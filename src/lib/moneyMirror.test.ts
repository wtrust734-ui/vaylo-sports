// Guards the generated money catalog that the edge functions import at boot.
//
// Why this test exists: `supabase/functions/**` is not covered by any tsconfig,
// so a broken identifier in the generated mirror is invisible to `tsc`, to lint
// and to the app build. It is only discovered at runtime — and because this file
// is imported at module scope, a bad reference throws on worker start, which
// Supabase reports as a bare `WORKER_ERROR` on *every* request. That is exactly
// what happened to `process-purchase`: `ONE_TIME_PRODUCTS` referenced
// `FIRST_PURCHASE.id` after that const was renamed to `FIRST_PURCHASE_BUNDLE`, so
// checkout returned `{"code":"WORKER_ERROR"}` for everything, including an empty
// basket. Simply importing the module here fails the suite instead.

import { describe, expect, it } from "vitest";

import {
  COIN_GRANTS,
  COINS_PER_CREDIT,
  CREDIT_GRANTS,
  FIRST_PURCHASE_BUNDLE,
  ONE_TIME_PRODUCTS,
  PRODUCT_PRICES,
} from "../../supabase/functions/_shared/moneyCatalog";

describe("generated money catalog", () => {
  it("evaluates without a module-level error and names real products", () => {
    expect(ONE_TIME_PRODUCTS).toContain(FIRST_PURCHASE_BUNDLE.id);
    expect(ONE_TIME_PRODUCTS.length).toBeGreaterThan(0);
  });

  it("states the same credit→coin rate the database uses", () => {
    expect(COINS_PER_CREDIT).toBe(7.5);
  });

  it("prices every product it is willing to grant", () => {
    for (const [id, credits] of Object.entries(CREDIT_GRANTS)) {
      expect(credits, `${id} should grant credits`).toBeGreaterThan(0);
      expect(PRODUCT_PRICES[id], `${id} should have a list price`).toBeTypeOf("number");
    }
    for (const [id, coins] of Object.entries(COIN_GRANTS)) {
      expect(coins, `${id} should grant coins`).toBeGreaterThan(0);
      expect(PRODUCT_PRICES[id], `${id} should have a list price`).toBeTypeOf("number");
    }
  });
});
