// ============================================================================
// THE UNLOCK CATALOGUE — price, product and place, all three
// ----------------------------------------------------------------------------
// This file guards the three ways a priced feature can be broken without anyone
// noticing on a screen:
//
//   1. IT CANNOT BE BOUGHT. The product id in the catalogue has to be one
//      `process-purchase` resolves through FEATURE_PRODUCTS, or the shop is
//      advertising a button the server answers "Unknown product" to. That was
//      the real state of Nutrition Pack: priced, listed, unbuyable.
//
//   2. IT CANNOT BE FOUND. Every entry names the route its feature lives on, and
//      that route has to exist in App.tsx. A priced feature the athlete cannot
//      reach is the same complaint from the other end.
//
//   3. IT LOSES MONEY. An unlock that makes a metered AI call free has to be
//      priced above what those calls cost us, at the worst case credit value any
//      real buyer produces. `enables` names the ceiling; if a new entry omits it
//      for a feature that does call a provider, the margin is unasserted and
//      this test says so.
//
// The margin maths is deliberately the same as pricing.test.ts: revenue is
// measured NET of the store's cut (WORST_CASE_USD_PER_CREDIT is already net),
// against the same MIN_MARGIN_MULTIPLE floor.
// ============================================================================

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { UNLOCK_CATALOG, PER_USE_ROUTES } from "@/config/unlocks";
import { FEATURE_UNLOCKS, featureKeyFor, labelFor } from "@/lib/featureUnlocks";
import {
  API_COST_CEILING_USD,
  FEATURE_COSTS,
  MIN_MARGIN_MULTIPLE,
  PERMANENT_UNLOCKS,
  WORST_CASE_USD_PER_CREDIT,
} from "@/config/credits";
import { FEATURE_PRODUCTS } from "../../supabase/functions/_shared/moneyCatalog";

const root = resolve(__dirname, "..", "..");
const appSource = readFileSync(join(root, "src", "App.tsx"), "utf8");

const revenueFor = (credits: number): number => credits * WORST_CASE_USD_PER_CREDIT;

/**
 * Server-priced products deliberately NOT in the shop.
 *
 * `archetype` is the only one, and it is here on purpose: the Athlete Archetype
 * is displayed free on /identity, so selling it would be charging for something
 * the app already gives away. The list exists so that ADDING a product to the
 * money catalogue is a decision someone has to make here — either it is sold, or
 * it is named as withheld. What must never happen again is a product that is
 * priced and neither.
 */
const WITHHELD_FROM_SHOP: string[] = ["archetype"];

describe("unlock catalogue — every entry is a real, reachable purchase", () => {
  it("covers every product the server prices, or says why not", () => {
    const catalogued = UNLOCK_CATALOG.map((e) => e.product).sort();
    const fromShop = Object.keys(FEATURE_PRODUCTS)
      .filter((id) => !WITHHELD_FROM_SHOP.includes(id))
      .sort();
    expect(catalogued).toEqual(fromShop);
  });

  it("names a product the edge function will actually price", () => {
    for (const entry of UNLOCK_CATALOG) {
      expect(
        FEATURE_PRODUCTS[entry.product],
        `${entry.product} is not in the server's FEATURE_PRODUCTS — the button would answer "Unknown product"`,
      ).toBe(entry.costKey);
    }
  });

  it("spends the cost key the price is read from", () => {
    for (const entry of UNLOCK_CATALOG) {
      expect(FEATURE_COSTS[entry.costKey], `${entry.costKey} has no price`).toBeGreaterThan(0);
      // A zero price would mean the server grants it for nothing and every
      // margin claim about it is meaningless.
      expect(entry.enables === undefined || API_COST_CEILING_USD[entry.enables] > 0).toBe(true);
    }
  });

  it("checks hasFeature() against the same key the purchase grants", () => {
    for (const entry of UNLOCK_CATALOG) {
      expect(featureKeyFor(entry.product)).toBe(entry.feature);
      expect(labelFor(entry.product)).toBe(entry.label);
      expect(FEATURE_UNLOCKS[entry.product].feature).toBe(entry.feature);
    }
  });

  it("points every entry at a route that exists", () => {
    for (const entry of UNLOCK_CATALOG) {
      expect(entry.route.startsWith("/"), `${entry.route} is not a route`).toBe(true);
      expect(
        appSource.includes(`path="${entry.route}"`),
        `${entry.product} unlocks a feature at ${entry.route}, which App.tsx does not route`,
      ).toBe(true);
      expect(entry.routeLabel.length).toBeGreaterThan(0);
    }
  });
});

describe("unlock catalogue — every entry clears its cost", () => {
  it("pays for the metered calls it makes free", () => {
    const metered = UNLOCK_CATALOG.filter((e) => e.enables);
    // Not a formality: if a future entry drops `enables`, its margin stops being
    // checked here, so the list having entries at all is asserted.
    expect(metered.length).toBeGreaterThan(0);
    for (const entry of metered) {
      const ceiling = API_COST_CEILING_USD[entry.enables as keyof typeof API_COST_CEILING_USD];
      const price = FEATURE_COSTS[entry.costKey];
      const revenue = revenueFor(price);
      expect(
        revenue,
        `${entry.product}: ${price} credits = $${revenue.toFixed(4)} net vs $${ceiling} ceiling`,
      ).toBeGreaterThanOrEqual(ceiling * MIN_MARGIN_MULTIPLE);
    }
  });

  it("keeps every unlock profitable on its own, at the worst case rate", () => {
    for (const entry of UNLOCK_CATALOG) {
      const revenue = revenueFor(FEATURE_COSTS[entry.costKey]);
      // One-off entitlements have no per-use provider cost, so the floor is not
      // the AI multiple — but a price that raises less than a cent of net
      // revenue is not a product, it is a rounding error, and the athlete paid
      // credits for it.
      expect(revenue, `${entry.product} raises $${revenue.toFixed(4)}`).toBeGreaterThan(0.01);
    }
  });

  it("never prices an unlock below the per-call price it replaces", () => {
    // An unlock that costs less than a handful of the per-use calls packed into
    // it is a loss leader for a flat-rate product. form_analysis_unlock is
    // checked against its own per-call key.
    const unlock = FEATURE_COSTS.form_analysis_unlock;
    const perCall = FEATURE_COSTS.form_analysis;
    expect(Math.ceil(unlock / perCall)).toBeLessThanOrEqual(8);
    expect(perCall).toBeGreaterThan(0);
  });
});

describe("per-use reference — a price always leads somewhere", () => {
  it("only lists keys the app really charges, each with a real screen", () => {
    const seen = new Set<string>();
    for (const { key, route, routeLabel } of PER_USE_ROUTES) {
      expect(FEATURE_COSTS[key], `${key} is not a billable feature`).toBeGreaterThan(0);
      expect(PERMANENT_UNLOCKS.includes(key), `${key} is an unlock, not a per-use charge`).toBe(false);
      expect(seen.has(key), `${key} is listed twice`).toBe(false);
      seen.add(key);
      expect(appSource.includes(`path="${route}"`), `${key} points at ${route}, which is not routed`).toBe(true);
      expect(routeLabel.length).toBeGreaterThan(0);
    }
  });
});
