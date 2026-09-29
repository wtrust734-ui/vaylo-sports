import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissKeyboard, isKeyboardVisible } from "./keyboard";

/**
 * The keyboard-dependent paths cannot be exercised in a browser test without a
 * real soft keyboard, so the two pieces of logic that can be — and that were
 * both wrong at least once during this work — are pinned here.
 *
 * `isKeyboardVisible` decides whether Android back should close the keyboard
 * before it navigates. A false positive means back does nothing; a false
 * negative means back navigates away while the athlete is mid-sentence.
 */

/** Replace `visualViewport` with a stub reporting a given visible height. */
const stubViewport = (visibleHeight: number, offsetTop = 0) => {
  const listeners: Record<string, (() => void)[]> = {};
  const vv = {
    height: visibleHeight,
    offsetTop,
    addEventListener: (type: string, fn: () => void) => {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
  };
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true, writable: true });
  return vv;
};

const clearViewport = () => {
  Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true, writable: true });
};

describe("isKeyboardVisible", () => {
  afterEach(clearViewport);

  it("is false with no visualViewport at all", () => {
    clearViewport();
    expect(isKeyboardVisible()).toBe(false);
  });

  it("is false when the viewport has not shrunk", () => {
    stubViewport(window.innerHeight);
    expect(isKeyboardVisible()).toBe(false);
  });

  it("is false for a small shrink, which is browser chrome moving", () => {
    // A collapsing mobile URL bar is tens of pixels, not hundreds. Treating it
    // as a keyboard would make Android back swallow the first press.
    stubViewport(window.innerHeight - 40);
    expect(isKeyboardVisible()).toBe(false);
  });

  it("is true once the viewport shrinks past the tolerance", () => {
    stubViewport(window.innerHeight - 300);
    expect(isKeyboardVisible()).toBe(true);
  });
});

describe("dismissKeyboard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("blurs a focused text input, which is what actually hides the keyboard", () => {
    document.body.innerHTML = '<input id="a" />';
    const input = document.getElementById("a") as HTMLInputElement;
    input.focus();

    expect(dismissKeyboard()).toBe(true);
    expect(document.activeElement).not.toBe(input);
  });

  it("blurs a focused textarea", () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const ta = document.getElementById("t") as HTMLTextAreaElement;
    ta.focus();

    expect(dismissKeyboard()).toBe(true);
    expect(document.activeElement).not.toBe(ta);
  });

  it("reports false when nothing focusable is focused", () => {
    document.body.innerHTML = '<button id="b">x</button>';
    (document.getElementById("b") as HTMLButtonElement).focus();

    // A button keeps no keyboard up, so there is nothing to dismiss and back
    // should fall through to the overlay/navigation handlers.
    expect(dismissKeyboard()).toBe(false);
  });

  it("reports false rather than throwing when focus is on the body", () => {
    document.body.innerHTML = "<p>text</p>";
    (document.activeElement as HTMLElement)?.blur();
    expect(() => dismissKeyboard()).not.toThrow();
    expect(dismissKeyboard()).toBe(false);
  });
});
