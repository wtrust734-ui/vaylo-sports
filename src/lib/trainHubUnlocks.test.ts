// ============================================================================
// TRAIN-HUB UNLOCK WIRING — bought unlocks open from the hub, not the Market
// ----------------------------------------------------------------------------
// The complaint: buying Mental Gym still meant a trip to the Market to find
// it. The contract: the Train hub (bottom bar -> Train) lists Mental Gym,
// Injury Management and Nutrition directly. The two unlocks wear a lock until
// hasFeature() says owned; Nutrition is a standard tab and is never locked.
// The /nutrition page itself carries both the plan builder and the AI calorie
// scan, so the hub entry is the whole feature, not a teaser.
// Same pattern as breakBannerWiring: behaviour spans files, pinned across them.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.resolve(__dirname, "../.." + p), "utf8");

describe("bought unlocks open from the Train hub", () => {
  const train = read("/src/pages/Train.tsx");

  it("lists nutrition, mental gym and injury management direct from the hub", () => {
    for (const route of ['path: "/nutrition"', 'path: "/mental"', 'path: "/injury"']) {
      expect(train, `Train hub must link ${route}`).toContain(route);
    }
    // No detour through the shop: the tiles go to the features themselves.
    expect(train).not.toContain('path: "/market"');
  });

  it("locks the bought unlocks until owned, and never locks nutrition", () => {
    expect(train).toContain('locked: !hasFeature("mental_gym")');
    expect(train).toContain('locked: !hasFeature("injury_management")');
    const nutritionLine = train.split("\n").find((l) => l.includes('path: "/nutrition"')) ?? "";
    expect(nutritionLine).not.toContain("locked");
  });

  it("shows the same lock preview on the Recover hub tiles", () => {
    const recover = read("/src/pages/Recover.tsx");
    expect(recover).toContain('locked: !hasFeature("mental_gym")');
    expect(recover).toContain('locked: !hasFeature("injury_management")');
  });

  it("renders the lock on the tile itself, without needing new strings", () => {
    const hub = read("/src/components/layout/HubPage.tsx");
    expect(hub).toContain("locked?: boolean");
    expect(hub).toContain("<Lock");
  });
});

describe("nutrition is one tab: plan builder plus calorie scan", () => {
  const nutrition = read("/src/pages/Nutrition.tsx");

  it("builds the nutrition plan and runs the AI scan from the same page", () => {
    // The plan builder is now a questionnaire that calls the generator, and the
    // GENERATOR charges the week server-side — so the page must still state the
    // price without spending the credits itself (charging twice for one plan is
    // the failure this guards).
    expect(nutrition).toContain("NutritionPlanWizard");
    expect(nutrition).toContain('invoke("generate-nutrition-plan"');
    expect(nutrition).toContain("runScan");
    expect(nutrition).toContain('creditCost("nutrition_plan_week"');
    expect(nutrition).toContain('creditCost("calorie_scan"');
    expect(nutrition).not.toContain('spendWithTopUp("nutrition_plan_week"');
  });
});
