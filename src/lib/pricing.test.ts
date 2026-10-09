// ============================================================================
// PRICING AUDIT — re-derives every feature's margin and fails if one loses money
// ----------------------------------------------------------------------------
// The economy has three numbers that have to agree for the app to make money on
// every use:
//
//   1. what a credit is worth in cash  (worst case: the best-value pack)
//   2. what a feature costs in credits (FEATURE_COSTS)
//   3. what the feature's AI call costs us, at most (API_COST_CEILING_USD)
//
// The first two are exact. The third is a CEILING — an over-estimate of a
// provider price, because no provider is deployed and none has ever been
// measured. So the test does not ask "is the margin positive"; it asks "is the
// margin at least MIN_MARGIN_MULTIPLE times the ceiling", which is the only
// question that survives being wrong about the ceiling.
//
// A feature whose margin is below its floor fails the suite. That is the point:
// the previous price for form_analysis_unlock (54) broke even after ~34 uses of
// a product that is sold once, and nothing in the suite noticed.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  AI_USAGE_FEATURES,
  API_COST_CEILING_USD,
  CREDIT_PACKS,
  FEATURE_COSTS,
  FEATURE_LABELS,
  GOOGLE_PLAY_TAKE,
  MIN_MARGIN_MULTIPLE,
  REGIONAL_TIERS,
  WORST_CASE_USD_PER_CREDIT,
  type FeatureCostKey,
} from "@/config/credits";

/** Revenue in USD from spending `credits`, at the worst-case credit value. */
const revenueFor = (credits: number): number => credits * WORST_CASE_USD_PER_CREDIT;

/** The metered features: every key with a declared cost ceiling. */
const meteredKeys = Object.keys(API_COST_CEILING_USD) as (keyof typeof API_COST_CEILING_USD)[];

describe("credit economy — worst-case revenue per credit", () => {
  /**
   * Every rate a real buyer can pay, NET of the store's cut: the default ladder
   * plus all four tiers.
   *
   * NET is the change that matters. This used to divide the price straight into
   * the credit count, which described what the BUYER paid and then treated it
   * as what WE received. Google Play keeps 30%, so every margin the suite
   * certified was a third larger than reality — a feature could clear the floor
   * here and still be thin after the cut. The floor has to be measured against
   * the money that actually arrives, so the take is subtracted here.
   */
  const netRate = (priceCents: number, credits: number, bonus?: number) =>
    ((priceCents / 100) * (1 - GOOGLE_PLAY_TAKE)) / (credits + (bonus || 0));

  const allRates = [
    ...CREDIT_PACKS.map((p) => netRate(p.price_cents, p.credits, p.bonus)),
    ...REGIONAL_TIERS.flatMap((t) => t.packs.map((p) => netRate(p.price_cents, p.credits, p.bonus))),
  ];
  const worst = Math.min(...allRates);
  const defaultBest = Math.min(
    ...CREDIT_PACKS.map((p) => netRate(p.price_cents, p.credits, p.bonus)),
  );

  it("is derived from the worst ACTIVE regional tier, not the default ladder", () => {
    // The pack ladder is regional (pricing_tiers / REGIONAL_TIERS): price_cents
    // are USD cents in every tier, so tier D sells the biggest pack at $9.99.
    // `worst` is now NET of GOOGLE_PLAY_TAKE. The constant must be at or below
    // the real worst rate: below is the conservative direction (0.0105 is a
    // rounded-down 0.010595); ABOVE it would overstate revenue in every margin
    // calculation below, which is the one way this audit could lie in the
    // flattering direction.
    expect(WORST_CASE_USD_PER_CREDIT).toBeLessThanOrEqual(worst);
    // ...but not so far below that it is stale. If any tier's pack is
    // repriced, the constant has to move with it.
    expect(WORST_CASE_USD_PER_CREDIT).toBeGreaterThan(worst * 0.99);
    // The worst tier must genuinely be below the default ladder — if this
    // fails, the tier table has lost its cheap tiers and the whole derivation
    // needs rethinking rather than a smaller constant.
    expect(worst).toBeLessThan(defaultBest);
  });

  it("the default ladder is exactly tier A (client mirror of pricing_tiers)", () => {
    // CREDIT_PACKS is what a build with no database says; pricing_tiers tier A
    // is what the database actually sells in the default markets. If the two
    // drift, every place that shows a default price is lying.
    const tierA = REGIONAL_TIERS.find((t) => t.code === "A");
    expect(tierA, "tier A is missing from REGIONAL_TIERS").toBeTruthy();
    expect(tierA!.packs.length).toBe(CREDIT_PACKS.length);
    for (const a of tierA!.packs) {
      const local = CREDIT_PACKS.find((p) => p.id === a.id);
      expect(local, `CREDIT_PACKS has no ${a.id}`).toBeTruthy();
      expect(local!.credits).toBe(a.credits);
      expect(local!.bonus).toBe(a.bonus);
      expect(local!.price_cents).toBe(a.price_cents);
    }
  });

  it("counts the bonus credits, which are what make the big packs cheap", () => {
    const best = CREDIT_PACKS.reduce((a, b) =>
      netRate(a.price_cents, a.credits, a.bonus) <
      netRate(b.price_cents, b.credits, b.bonus)
        ? a
        : b,
    );
    // The cheapest per-credit pack is the one with the largest bonus. If that
    // ever stops being true, the worst-case assumption is aimed at the wrong pack.
    expect(best.bonus).toBeGreaterThan(0);
  });

  it("makes the biggest pack the best value, so spending more is always rewarded", () => {
    // The ladder is the retention mechanic. If cost per credit stopped falling,
    // there would be no reason to buy the big pack and the top of the ladder
    // would be dead weight on screen.
    const rates = CREDIT_PACKS.map((p) => netRate(p.price_cents, p.credits, p.bonus));
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i], `pack at index ${i} must be cheaper per credit than the one below it`)
        .toBeLessThan(rates[i - 1]);
    }
  });

  it("makes the biggest pack the best value in EVERY tier, not just the default one", () => {
    // (Both of these hold for the same reason: the credit value the whole price
    // book is derived from has to be a rate a real buyer can actually pay.)
    // The per-step fall above is asserted only for the default ladder (tier A),
    // because one tier does not have it: inside tier D, Boost is a better deal
    // per credit than Popular and Power. That exception is written down in the
    // header of src/config/credits.ts and is a pricing decision, not a bug to
    // patch from here.
    //
    // What must hold everywhere — and is the only thing the margin floor
    // depends on — is that no smaller pack beats the BIGGEST one per credit. If
    // that ever fails, WORST_CASE_USD_PER_CREDIT is aimed at the wrong pack and
    // every price derived from it is overstated in the flattering direction.
    for (const tier of REGIONAL_TIERS) {
      const priced = tier.packs.map((p) => ({
        id: p.id,
        rate: netRate(p.price_cents, p.credits, p.bonus),
      }));
      const biggest = priced[priced.length - 1];
      for (const pack of priced.slice(0, -1)) {
        expect(
          pack.rate,
          `tier ${tier.code}: ${pack.id} is a better deal per credit than ${biggest.id}`,
        ).toBeGreaterThan(biggest.rate);
      }
    }
  });
});

describe("credit economy — every metered feature clears its cost", () => {
  for (const key of meteredKeys) {
    const ceiling = API_COST_CEILING_USD[key];
    // Not every metered key is a spendable feature (form_analysis is charged as
    // a feature key; the rest map 1:1).
    const cost = FEATURE_COSTS[key as FeatureCostKey];

    it(`${key} costs ${cost} credits and clears ${MIN_MARGIN_MULTIPLE}x its $${ceiling} ceiling`, () => {
      expect(cost, `${key} must be a real feature key`).toBeTypeOf("number");
      const revenue = revenueFor(cost);
      expect(
        revenue,
        `${key}: ${cost} credits = $${revenue.toFixed(4)} revenue vs $${ceiling} ceiling`,
      ).toBeGreaterThanOrEqual(ceiling * MIN_MARGIN_MULTIPLE);
    });
  }

  it("charges for the AI nutrition plan, and declares what that call costs us", () => {
    // This assertion used to be the exact opposite: nutrition_plan_week was the
    // one priced feature with NO provider call (the plan just stored the macro
    // targets the athlete typed in), so a ceiling would have been a made-up
    // cost justifying a higher price.
    //
    // Since 2026-10-09 the plan is written by the model
    // (generate-nutrition-plan -> OpenAI), so the key MUST carry a ceiling and
    // MUST be in the metered list — the generic loop above then measures its
    // 8x floor automatically. A price rise without a ceiling is exactly the
    // failure this pair of assertions exists to catch.
    expect(API_COST_CEILING_USD).toHaveProperty("nutrition_plan_week");
    expect(AI_USAGE_FEATURES).toContain("nutrition_plan_week");
    expect(FEATURE_COSTS.nutrition_plan_week).toBeGreaterThan(0);
  });

  it("keeps the AI nutrition plan cheaper than the training plan it sits beside", () => {
    // Both are AI-written, both are sold per week, and the nutrition plan is
    // the smaller output. If it ever cost as much as a training-plan week the
    // pricing would be indefensible, and the Nutrition Pack (30, once) — which
    // makes both the scan and the plan free for good — would stop being the
    // obvious buy.
    expect(FEATURE_COSTS.nutrition_plan_week).toBeLessThan(FEATURE_COSTS.training_plan_week);
    // The pack (free scans, free plans, for good) has to be worth more than one
    // week of plans or nobody would buy it...
    expect(FEATURE_COSTS.nutrition_pack_unlock).toBeGreaterThan(FEATURE_COSTS.nutrition_plan_week);
    // ...and cheaper than four, or a fortnight of planning would be the better
    // deal and the unlock would never sell.
    expect(FEATURE_COSTS.nutrition_pack_unlock).toBeLessThan(FEATURE_COSTS.nutrition_plan_week * 4);
  });
});

describe("credit economy — the flat-rate unlock is not a loss-maker", () => {
  it("form_analysis_unlock break-even is beyond any realistic use", () => {
    // One payment, unlimited photo analyses. Break-even = price / per-call cost.
    const unlockRevenue = revenueFor(FEATURE_COSTS.form_analysis_unlock);
    const perCallCeiling = API_COST_CEILING_USD.form_analysis;
    const breakEven = unlockRevenue / perCallCeiling;
    // 75 analyses of your own form is already implausible for one athlete; the
    // old 54-credit price broke even at 34, which is not.
    expect(breakEven).toBeGreaterThan(75);
  });

  it("is still the cheaper route for a heavy user, so it remains sellable", () => {
    // If the unlock cost more than paying per call for any realistic number of
    // analyses, nobody would buy it and the price would be pointless.
    const unlock = FEATURE_COSTS.form_analysis_unlock;
    const perCall = FEATURE_COSTS.form_analysis;
    const analysesWhereUnlockWins = Math.ceil(unlock / perCall);
    expect(analysesWhereUnlockWins).toBeLessThanOrEqual(8);
  });
});

describe("credit economy — spendable keys all resolve", () => {
  // Mirrors public.credit_cost(), which RAISES on an unknown key. A key that
  // exists in the client but not in economy_config.feature_costs produces a 500
  // from credits_spend() instead of a 402 with a shortfall — which is exactly
  // what happened to the ai-analyze "form_analysis" key.
  const MIRRORED_IN_DB = [
    "archetype_view",
    "development_trajectory",
    "cross_sport_unlock",
    "training_plan_week",
    // The two AI plan-edit prices. Added with the migration
    // 20261009120000_plan_edit_ai_cost.sql, which is the one place they exist
    // in the database — if that migration is not applied, these two keys raise
    // inside credit_cost() and every edit 500s instead of charging.
    "plan_edit",
    "plan_edit_full",
    "limiter_fix_plan",
    "form_analysis",
    "form_analysis_unlock",
    "video_form_analysis",
    "injury_management_unlock",
    "calorie_scan",
    "nutrition_plan_week",
    "nutrition_pack_unlock",
    "mental_gym_unlock",
    "vaylo_coach_message",
    "weekly_coach_review",
    "tactical_prep",
    "learning_unlock",
    "streak_shield",
  ] as const;

  it("every feature key the client can spend has a label", () => {
    for (const key of MIRRORED_IN_DB) {
      expect(FEATURE_COSTS[key], `${key} missing from FEATURE_COSTS`).toBeTypeOf("number");
      expect(FEATURE_LABELS[key], `${key} missing from FEATURE_LABELS`).toBeTruthy();
    }
  });

  it("declares exactly the keys the database is expected to hold", () => {
    // Guards against a key being added to the type but not to the price table
    // (which would be `undefined` at runtime and spend NaN credits).
    const declared = Object.keys(FEATURE_COSTS).sort();
    expect(declared).toEqual([...MIRRORED_IN_DB].sort());
  });
});
