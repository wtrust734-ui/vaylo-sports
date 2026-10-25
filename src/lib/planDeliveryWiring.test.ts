// ============================================================================
// PLAN DELIVERY WIRING — a plan that does not save is work lost
// ----------------------------------------------------------------------------
// A training plan is built on the device now, so nothing is charged for it; the
// same is not true of the nutrition plan below, which is still written by a
// charged provider call. In BOTH cases the plan exists in memory before it hits
// the database, and the insert is the one step that can lose it.
//
// Three things must hold for each:
//   1. the insert is attempted more than once, because the plan is in memory and
//      the failure is usually transient;
//   2. when it still fails, the athlete is told NOT to create the plan again —
//      for nutrition that would charge a second time, for training it would
//      replace the plan rather than recover it — and is pointed at support;
//   3. that message comes before any success toast, so the screen can never show
//      a success for a plan that is not in the database.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.resolve(__dirname, "../.." + p), "utf8");

const training = read("/src/pages/Training.tsx");
const nutrition = read("/src/pages/Nutrition.tsx");

describe("a plan the athlete paid for is either saved or reported", () => {
  it("retries the insert instead of giving up on the first failure", () => {
    // Two attempts of the same row: the plan data is already in hand, so the
    // only cost of a retry is a moment.
    expect(training).toMatch(/for\s*\(let attempt = 1; attempt <= 2; attempt\+\+\)/);
    expect(training).toContain(".insert(planRow)");
  });

  it("tells the athlete not to re-create the plan, in the branch that gives up", () => {
    // Scoped to the failing branch, not the whole file. A file-wide search is
    // satisfied by a comment — and this file is mostly comments — so the three
    // phrases are only evidence when they sit in the code that runs after the
    // insert has failed and before the function returns.
    const failureBranch = training.indexOf("Your plan was written but could not be saved");
    expect(failureBranch, "the plan-not-saved branch is gone").toBeGreaterThan(-1);
    const branch = training.slice(failureBranch, training.indexOf("return;", failureBranch));

    expect(branch).toMatch(/do not create it again/i);
    expect(branch).toMatch(/second time/i);
    // ...and where to go to get the credits back, since the client cannot
    // refund a charge itself (credits_grant is service-role only).
    expect(branch).toMatch(/contact support/i);
  });

  it("never reaches the success toast when the save failed", () => {
    const failureBranch = training.indexOf("Your plan was written but could not be saved");
    // The success toast is the one after the plan has been opened; it prints a
    // different sentence for a limiter plan, which is why the anchor is the
    // `setupSource` branch rather than a single title string.
    const successToast = training.indexOf("Limiter plan created — opening it now.");

    expect(failureBranch).toBeGreaterThan(-1);
    expect(successToast).toBeGreaterThan(failureBranch);
    // The failure branch has to leave the function before the success path can
    // run — a toast alone would still let the wizard close on a missing plan.
    expect(training.slice(failureBranch, successToast)).toMatch(/return;/);
  });

  it("pins equivalent no-recreation, support, and failure-before-success handling for nutrition plans", () => {
    const failureBranch = nutrition.indexOf("Your plan was written but not saved");
    const successToast = nutrition.indexOf('title: "Your plan is ready 🥗"');
    expect(failureBranch).toBeGreaterThan(-1);
    expect(successToast).toBeGreaterThan(failureBranch);
    const failureWindow = nutrition.slice(failureBranch, successToast);
    expect(failureWindow).toMatch(/do not generate it again/i);
    expect(failureWindow).toMatch(/second time/i);
    expect(failureWindow).toMatch(/contact support/i);
    expect(failureWindow).toMatch(/return;/);
  });
});
