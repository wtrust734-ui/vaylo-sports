import { describe, expect, it } from "vitest";
import {
  MIN_VISIBLE_SAVINGS_PCT,
  savingsLabelVs,
  savingsPctVs,
  totalCoins,
  totalCredits,
  valueExampleLines,
  PLAN_EXAMPLE_WEEKS,
} from "./marketValue";
import { CREDIT_PACKS, FEATURE_COSTS } from "@/config/credits";
import { COIN_BUNDLES } from "@/config/coins";

// The Starter tier and the largest tier of the real credit ladder.
const starter = CREDIT_PACKS[0];
const elite = CREDIT_PACKS[CREDIT_PACKS.length - 1];

describe("market value math", () => {
  it("totals credits and coins including bonus", () => {
    expect(totalCredits({ credits: 25, bonus: 5, price_cents: 249 })).toBe(30);
    expect(totalCoins({ coins: 300, bonus: 30, price_cents: 599 })).toBe(330);
  });

  it("measures the real ladder's saving against its entry tier", () => {
    // Tier A: Starter 249c/30 = 8.30c per credit; Elite 2499c/660 = 3.79c.
    const pct = savingsPctVs(starter, elite);
    expect(pct).not.toBeNull();
    expect(pct!).toBeGreaterThan(50);
    // And the label names the tier it measured against.
    const label = savingsLabelVs(starter, elite, "credit");
    expect(label).toMatch(/less per credit than Starter/);
  });

  it("says nothing when the bigger tier is not cheaper", () => {
    expect(savingsPctVs(elite, starter)).toBeNull();
    expect(savingsPctVs(starter, starter)).toBeNull();
    expect(savingsLabelVs(elite, starter, "credit")).toBeNull();
  });

  it("stays quiet below the visible-savings floor", () => {
    // A 3% "saving" is badge noise that teaches buyers to ignore badges.
    const tiny = savingsPctVs(
      { credits: 100, price_cents: 1000 },
      { credits: 100, price_cents: 970 },
    );
    expect(tiny).not.toBeNull();
    expect(tiny!).toBeLessThan(MIN_VISIBLE_SAVINGS_PCT);
    expect(
      savingsLabelVs({ credits: 100, price_cents: 1000 }, { credits: 100, price_cents: 970 }, "credit"),
    ).toBeNull();
  });

  it("holds the coin ladder's monotonic promise", () => {
    for (let i = 1; i < COIN_BUNDLES.length; i++) {
      const prev = COIN_BUNDLES[i - 1];
      const cur = COIN_BUNDLES[i];
      expect(
        cur.price_cents / totalCoins(cur),
        `${cur.id} must cost less per Coin than ${prev.id}`,
      ).toBeLessThan(prev.price_cents / totalCoins(prev));
    }
  });
  it("holds the credit ladder's monotonic promise", () => {
    for (let i = 1; i < CREDIT_PACKS.length; i++) {
      const prev = CREDIT_PACKS[i - 1];
      const cur = CREDIT_PACKS[i];
      expect(
        cur.price_cents / totalCredits(cur),
        `${cur.id} must cost less per credit than ${prev.id}`,
      ).toBeLessThan(prev.price_cents / totalCredits(prev));
    }
  });


  it("quotes feature prices from the real config, never from copy", () => {
    const lines = valueExampleLines().join(" ");
    // Every number in the example lines must be derivable from FEATURE_COSTS:
    // if the charge path moves and this file is not regenerated, this fails
    // loudly instead of the shop quietly quoting a stale price.
    expect(lines).toContain(String(FEATURE_COSTS.training_plan_week * PLAN_EXAMPLE_WEEKS));
    expect(lines).toContain(String(FEATURE_COSTS.video_form_analysis));
    expect(lines).toContain(String(FEATURE_COSTS.weekly_coach_review));
    expect(lines).toContain(String(FEATURE_COSTS.nutrition_plan_week));
  });
});
