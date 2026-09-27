// Unit tests for the global top-up store: request/resolve lifecycle,
// concurrent-request folding, and subscriber notification.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  completeTopUp,
  dismissTopUp,
  getTopUpState,
  planForRequest,
  requestCreditTopUp,
  resetTopUpStore,
  subscribeTopUp,
  type TopUpOutcome,
} from "./topUpStore";

afterEach(() => resetTopUpStore());

describe("requestCreditTopUp", () => {
  it("opens the sheet and resolves purchased on completion", async () => {
    const promise = requestCreditTopUp({ shortfall: 20, reasonLabel: "AI plan" });
    expect(getTopUpState().open).toBe(true);
    expect(getTopUpState().request?.shortfall).toBe(20);

    completeTopUp(null);
    const outcome = await promise;
    expect(outcome.purchased).toBe(true);
    expect(outcome.dismissed).toBe(false);
    expect(getTopUpState().open).toBe(false);
  });

  it("resolves dismissed on dismiss and clears state", async () => {
    const promise = requestCreditTopUp({ shortfall: 8 });
    dismissTopUp(null);
    const outcome = await promise;
    expect(outcome.dismissed).toBe(true);
    expect(outcome.purchased).toBe(false);
    expect(getTopUpState().open).toBe(false);
    expect(getTopUpState().request).toBeNull();
  });

  it("notifies subscribers on every state change", async () => {
    const listener = vi.fn();
    const unsub = subscribeTopUp(listener);
    const promise: Promise<TopUpOutcome> = requestCreditTopUp({ shortfall: 5 });
    expect(listener).toHaveBeenCalledTimes(1);
    completeTopUp(null);
    await promise;
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsub = subscribeTopUp(listener);
    unsub();
    requestCreditTopUp({ shortfall: 5 });
    dismissTopUp(null);
    expect(listener).not.toHaveBeenCalled();
  });

  it("folds a second request into the open sheet and never leaves the first caller hanging", async () => {
    const first = requestCreditTopUp({ shortfall: 10 });
    const second = requestCreditTopUp({ shortfall: 30 });

    // The visible request takes the larger shortfall.
    expect(getTopUpState().request?.shortfall).toBe(30);

    const firstOutcome = await first;
    expect(firstOutcome.purchased).toBe(false); // folded away, not hung

    completeTopUp(null);
    const secondOutcome = await second;
    expect(secondOutcome.purchased).toBe(true);
  });

  it("resolves nothing after reset (no dangling listeners)", () => {
    requestCreditTopUp({ shortfall: 5 });
    resetTopUpStore();
    expect(getTopUpState().open).toBe(false);
    expect(getTopUpState().request).toBeNull();
  });
});

describe("planForRequest", () => {
  it("returns null for empty requests and non-positive shortfalls", () => {
    expect(planForRequest(null)).toBeNull();
    expect(planForRequest({ shortfall: 0 })).toBeNull();
    expect(planForRequest({ shortfall: -3 })).toBeNull();
  });

  it("plans for a positive shortfall", () => {
    const plan = planForRequest({ shortfall: 60 });
    expect(plan?.cheapest?.total).toBeGreaterThanOrEqual(60);
  });
});
