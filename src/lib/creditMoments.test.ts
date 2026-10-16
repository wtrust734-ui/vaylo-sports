import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

/**
 * Credit-moment honesty contracts.
 *
 * These three pop-ups are the surfaces an athlete sees while deciding whether
 * to spend money. The rules below are the ones that keep them persuasive
 * without being manipulative — and each rule exists because a previous
 * version of one of these files broke it:
 *
 *  - CreditWarning advertised "use code LOW15 for 15% off!" — a discount with
 *    no redemption mechanism anywhere in the app. Invented offers are the
 *    fastest way to lose an athlete who is already hesitating, and this file
 *    keeps the fake-code class of bug out for good.
 *  - PromoPopup hardcoded US-dollar prices ($12.99/mo etc.) that drifted from
 *    the app's real GBP catalogue and per-credit feature pricing. Prices must
 *    come from the single source of truth (config/subscriptionPlans +
 *    creditCost), never a literal.
 *  - StreakShield and PromoPopup pulsed their icons on an infinite loop,
 *    behind text the athlete is trying to read. Urgency motion is allowed as
 *    a one-shot entrance; permanent animation loops over money surfaces read
 *    as pressure to close without reading.
 */

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "components", "ads");

/** Strip block and line comments: the contracts below are about what
 *  compiles and renders, and the files deliberately document the old
 *  fake-code and invented-price bugs in prose (that history is why the
 *  rule exists). Block-comment stripping requires replacing the comment
 *  delimiters; line comments end at newline. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const source = (name: string): string => stripComments(readFileSync(join(dir, name), "utf8"));

describe("credit-moment honesty contracts", () => {
  it("CreditWarning never invents a promo code or a discount", () => {
    const src = source("CreditWarning.tsx");
    expect(src).not.toMatch(/Use code|% off/i);
    expect(src).not.toContain("LOW15");
  });

  it("PromoPopup shows no literal dollar prices — the catalogue feeds the copy", () => {
    const src = source("PromoPopup.tsx");
    for (const price of ["$12.99", "$4.99", "$3.99", "$2.99"]) {
      expect(src).not.toContain(price);
    }
    expect(src).toContain("UNLIMITED_PLAN");
    expect(src).toContain("creditCost(");
  });

  it("money surfaces do not loop an animation forever", () => {
    for (const name of ["CreditWarning.tsx", "StreakShield.tsx", "PromoPopup.tsx"]) {
      expect(source(name), name).not.toContain("repeat: Infinity");
    }
  });

  it("CreditWarning routes the shortfall through the top-up planner with a real reason", () => {
    const src = source("CreditWarning.tsx");
    expect(src).toContain("requestCreditTopUp");
    expect(src).toContain("reasonLabel");
    expect(src).toContain("creditCost");
  });

  it("StreakShield offers the free path before the paid one", () => {
    const src = source("StreakShield.tsx");
    expect(src).toContain("Log today's session");
    expect(src).toContain("useSpendWithTopUp");
    // The dismiss is a plain statement, not a threat to the streak.
    expect(src).toContain("Not tonight");
    expect(src).not.toContain("Let it break");
  });
});
