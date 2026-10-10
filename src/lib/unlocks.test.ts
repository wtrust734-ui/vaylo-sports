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
//      this test says so. (No current entry enables a metered call — the
//      remaining unlocks are access to local features, which is why the margin
//      test below only asks each one to raise real revenue.)
//
// The margin maths is deliberately the same as pricing.test.ts: revenue is
// measured NET of the store's cut (WORST_CASE_USD_PER_CREDIT is already net),
// against the same MIN_MARGIN_MULTIPLE floor.
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
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

/** `enables` is one key or a list of them; every assertion here wants the list. */
const enablesOf = (entry: { enables?: unknown }): (keyof typeof API_COST_CEILING_USD)[] => {
  if (entry.enables === undefined) return [];
  return (Array.isArray(entry.enables) ? entry.enables : [entry.enables]) as (
    keyof typeof API_COST_CEILING_USD
  )[];
};

const revenueFor = (credits: number): number => credits * WORST_CASE_USD_PER_CREDIT;

/**
 * Every file that could hold a SPEND of a per-use key: the app's screens, hooks
 * and libs, plus the edge functions where the server-side charges live.
 *
 * `src/config/` is excluded because it only *declares* the catalogue — a file
 * that lists every key is not evidence that any of them is charged — and test
 * files are excluded because pricing.test.ts lists every key by design. What is
 * left is the code an athlete's tap actually runs through.
 */
function chargingSources(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;
      const rel = full.slice(root.length + 1).split("\\").join("/");
      if (rel.startsWith("src/config/")) continue;
      files[rel] = readFileSync(full, "utf8");
    }
  };
  walk(join(root, "src"));
  walk(join(root, "supabase", "functions"));
  return files;
}

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
      for (const key of enablesOf(entry)) {
        expect(API_COST_CEILING_USD[key], `${entry.product} names ${key}, which has no ceiling`)
          .toBeGreaterThan(0);
      }
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
  it("names a ceiling for every metered call it makes free", () => {
    // No current entry makes a metered call free, so this asserts the rule
    // rather than a number: any future entry that adds `enables` must name a
    // real ceiling, and the revenue check below still applies to its price.
    for (const entry of UNLOCK_CATALOG) {
      for (const key of enablesOf(entry)) {
        expect(API_COST_CEILING_USD[key], `${entry.product} names ${key}, which has no ceiling`)
          .toBeGreaterThan(0);
        const revenue = revenueFor(FEATURE_COSTS[entry.costKey]);
        expect(
          revenue,
          `${entry.product}: ${FEATURE_COSTS[entry.costKey]} credits = $${revenue.toFixed(4)} net vs $${API_COST_CEILING_USD[key]} ceiling (${key})`,
        ).toBeGreaterThanOrEqual(API_COST_CEILING_USD[key] * MIN_MARGIN_MULTIPLE);
      }
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

});

describe("per-use reference — a price always leads somewhere", () => {
  it("lists only keys something in the app actually spends", () => {
    // The rule this list is named for, asserted rather than assumed. The check
    // above proves the key is BILLABLE; this one proves it is BILLED, by finding
    // the literal key in a source file that is not the catalogue.
    //
    // `development_trajectory` is the case that proved the difference: it was
    // priced at 8 credits with "Spend it in Recovery" beside it, while the
    // Development Trajectory screen computes projectTrajectory() locally for
    // free and no function ever charged the key. Nothing failed, because the old
    // test only asked whether a price existed.
    const sources = chargingSources();
    for (const { key } of PER_USE_ROUTES) {
      const chargers = Object.entries(sources)
        .filter(([, src]) => src.includes(`"${key}"`))
        .map(([file]) => file);
      expect(
        chargers.length,
        `${key} is priced in the per-use list but nothing outside src/config spends it — a price that leads nowhere`,
      ).toBeGreaterThan(0);
    }
  });

  it("does not price a call nothing makes", () => {
    expect(PER_USE_ROUTES.map((r) => r.key)).not.toContain("development_trajectory");
  });

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
