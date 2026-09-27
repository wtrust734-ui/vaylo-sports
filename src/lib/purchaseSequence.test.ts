// Ordering guard for the money path in `process-purchase`.
//
// Why this test exists: the function used to write the `user_purchases`
// entitlement row FIRST and check the athlete's credit balance second. A refused
// unlock therefore returned 402 *and* left the entitlement behind — and because
// the apps decide "unlocked" by whether that row exists, an athlete who could not
// afford the unlock got the feature anyway on the next page load.
//
// A live test caught it (a 20-credit account was refused at 29 credits, then
// showed two `injury_management` rows). It is invisible to `tsc`, to lint and to
// the app build, so it is asserted here instead: in this file the affordability
// check must come before the insert, and the insert's failure paths must roll
// back. Cheap, and it fails loudly if the order is ever reversed again.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  path.resolve(__dirname, "../../supabase/functions/process-purchase/index.ts"),
  "utf8",
);

describe("process-purchase ordering", () => {
  it("checks affordability before writing the entitlement row", () => {
    const affordabilityAt = SOURCE.indexOf("if (cost > availableCredits)");
    const insertAt = SOURCE.indexOf('.from("user_purchases")\n        .insert(');

    expect(affordabilityAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(-1);
    expect(affordabilityAt).toBeLessThan(insertAt);
  });

  it("returns 402 for an unaffordable basket rather than proceeding", () => {
    expect(SOURCE).toMatch(/Not enough credits for \$\{productId\} \(need \$\{cost\}\)/);
    expect(SOURCE).toMatch(/status: 402/);
  });

  it("rolls the entitlement back if the grant fails after the insert", () => {
    // Declared once, right after the insert id is captured.
    expect(SOURCE).toMatch(/const rollBackPurchase = async \(\) =>/);
    // Called on the race path, the price-read failure and a failed coin grant.
    const calls = SOURCE.match(/await rollBackPurchase\(\);/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it("spends credits through the database routine, never a client-supplied price", () => {
    expect(SOURCE).toMatch(/rpc\("spend_credits"/);
    expect(SOURCE).toMatch(/rpc\("credit_cost"/);
    expect(SOURCE).not.toMatch(/item\.price_cents/);
  });
});
