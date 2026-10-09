// ============================================================================
// PLAN DELIVERY WIRING — a charged plan that does not save is money lost
// ----------------------------------------------------------------------------
// `generate-plan` charges before it writes a word, and the client is what stores
// the finished plan. That split has one bad window: the function returns a plan
// the athlete has paid for, and the insert into `training_plans` fails — leaving
// a charge with nothing behind it. This is the failure the athlete reported
// ("it took my credits and did not give me a plan"), so the contract is pinned
// here across both files rather than trusted to review.
//
// Three things must hold:
//   1. the insert is attempted more than once, because the plan is in memory and
//      the failure is usually transient;
//   2. when it still fails, the athlete is told NOT to create the plan again —
//      which would charge a second time — and is pointed at support;
//   3. that message comes before any success toast, so the screen can never show
//      "Plan Created!" for a plan that is not in the database.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.resolve(__dirname, "../.." + p), "utf8");

const training = read("/src/pages/Training.tsx");

describe("a plan the athlete paid for is either saved or reported", () => {
  it("retries the insert instead of giving up on the first failure", () => {
    // Two attempts of the same row: the plan data is already in hand, so the
    // only cost of a retry is a moment.
    const attempts = training.match(/\.insert\(planRow\)/g) ?? [];
    expect(attempts.length).toBeGreaterThanOrEqual(2);
  });

  it("tells the athlete not to re-create the plan, because that charges again", () => {
    expect(training).toMatch(/do not create it again/i);
    expect(training).toMatch(/second time/i);
    // ...and where to go to get the credits back, since the client cannot
    // refund a charge itself (credits_grant is service-role only).
    expect(training).toMatch(/contact support/i);
  });

  it("never reaches the success toast when the save failed", () => {
    const failureBranch = training.indexOf("Your plan was written but not saved");
    const successToast = training.indexOf('title: "Plan Created!');

    expect(failureBranch).toBeGreaterThan(-1);
    expect(successToast).toBeGreaterThan(failureBranch);
    // The failure branch has to leave the function before the success path can
    // run — a toast alone would still let the wizard close on a missing plan.
    expect(training.slice(failureBranch, successToast)).toMatch(/return;/);
  });
});
