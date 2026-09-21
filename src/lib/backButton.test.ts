import { describe, it, expect, beforeEach } from "vitest";
import { clearBackHandlers, consumeBackPress, hasBackHandler, pushBackHandler } from "./backButton";

describe("back button stack", () => {
  beforeEach(() => clearBackHandlers());

  it("reports nothing to consume when empty", () => {
    expect(hasBackHandler()).toBe(false);
    expect(consumeBackPress()).toBe(false);
  });

  it("gives the press to the most recently opened overlay", () => {
    const order: string[] = [];
    pushBackHandler(() => order.push("sheet"));
    pushBackHandler(() => order.push("dialog"));

    expect(consumeBackPress()).toBe(true);
    expect(order).toEqual(["dialog"]); // top-most only

    // A handler stays on the stack until it unregisters — an overlay that
    // intercepts a press (rather than closing) can claim the next one too.
    expect(consumeBackPress()).toBe(true);
    expect(order).toEqual(["dialog", "dialog"]);
  });

  it("falls through to the overlay underneath once the top one closes", () => {
    const order: string[] = [];
    pushBackHandler(() => order.push("sheet"));
    const closeDialog = pushBackHandler(() => order.push("dialog"));

    consumeBackPress();
    closeDialog(); // dialog closed → its effect cleanup runs
    consumeBackPress();

    expect(order).toEqual(["dialog", "sheet"]);
  });

  it("stops consuming once the overlay unregisters", () => {
    const remove = pushBackHandler(() => {});
    expect(hasBackHandler()).toBe(true);
    remove();
    expect(hasBackHandler()).toBe(false);
    expect(consumeBackPress()).toBe(false);
  });

  it("unregisters only the handler it created", () => {
    const stale = pushBackHandler(() => {});
    pushBackHandler(() => {});
    stale();
    stale(); // double-unregister must not remove a live handler
    expect(hasBackHandler()).toBe(true);
    expect(consumeBackPress()).toBe(true);
    expect(hasBackHandler()).toBe(true);
  });
});
