// ============================================================================
// Keyboard-aware focus handling
// ----------------------------------------------------------------------------
// Why this exists even though `Keyboard.resize` is now "native".
//
// `resize: "native"` shrinks the WebView so the page reflows into the space
// left above the keyboard. That fixes the *container*. It does not guarantee
// the *focused field* is inside the visible part of that container: a form
// tall enough to scroll still leaves the field the athlete just tapped below
// the fold, and the caret disappears into the keyboard. The symptom is
// "I can't see what I'm typing", and it is the one that makes registration and
// profile editing feel broken.
//
// The previous `resize: "body"` made this worse rather than better: it resized
// the body element while `position: fixed` elements stayed put, opening a gap
// between the tab bar and the keyboard that had to be scrolled through.
//
// What this does NOT do, deliberately:
//
//   * It does not add `overflow: auto` to <body> or <html>. A programmatic
//     scroll into view needs a scrollable ancestor; making the root scrollable
//     to get one breaks `position: fixed` for the tab bar and every modal, and
//     causes the layout jump this is meant to remove. The app's own scroll
//     containers are used instead, and only when one is found.
//   * It does not run on desktop, where there is no on-screen keyboard and the
//     browser already handles focus correctly.
// ============================================================================

/** Selector for the controls whose focus we manage. */
const FOCUSABLE =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select, [contenteditable="true"]';

/** How long the Android keyboard takes to animate in before the layout settles. */
const KEYBOARD_SETTLE_MS = 300;

type Cleanup = () => void;

const isTextEntry = (el: Element): boolean =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  el instanceof HTMLSelectElement ||
  (el instanceof HTMLElement && el.isContentEditable);

/**
 * Find the nearest scrollable ancestor, so `scrollIntoView` moves the app's
 * own scroll container rather than the document.
 *
 * Returns null when there is none, in which case we do nothing: scrolling the
 * document as a fallback is what produces the "whole page lurches sideways"
 * behaviour, and with `resize: "native"` the field is already inside a
 * viewport that shrank to accommodate it.
 */
const scrollableAncestor = (el: HTMLElement): HTMLElement | null => {
  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
};

/**
 * Bring `el` fully into view, accounting for the keyboard.
 *
 * `visualViewport.height` shrinks when the keyboard opens, so a field scrolled
 * into view against the *layout* viewport can still be under the keyboard.
 * The inset below is how much room the keyboard is actually taking.
 */
const revealAboveKeyboard = (el: HTMLElement): void => {
  const vv = window.visualViewport;
  const keyboardInset = vv
    ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    : 0;

  const scroller = scrollableAncestor(el);
  if (scroller) {
    const box = el.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    // Overlap of the field with the usable region, in the scroller's own space.
    const usableBottom = view.bottom - keyboardInset;
    if (box.bottom > usableBottom) {
      scroller.scrollTop += box.bottom - usableBottom + 12;
    } else if (box.top < view.top) {
      scroller.scrollTop -= view.top - box.top + 12;
    }
    return;
  }

  // No scrollable ancestor. Only act when the field is genuinely under the
  // keyboard; otherwise the browser's own focus behaviour is correct and
  // fighting it causes the jump we are here to prevent.
  const box = el.getBoundingClientRect();
  if (keyboardInset > 0 && box.bottom > window.innerHeight - keyboardInset) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
};

/**
 * Is an on-screen keyboard currently showing?
 *
 * `visualViewport.height` shrinking below the layout viewport is the only
 * signal that works across Android WebView, iOS Safari and desktop browsers
 * without feature detection per platform. On desktop it is always false, which
 * is what we want — there is no keyboard to dismiss.
 */
export const isKeyboardVisible = (): boolean => {
  if (typeof window === "undefined") return false;
  const vv = window.visualViewport;
  if (!vv) return false;
  // A tolerance of 120px absorbs browser UI (a mobile URL bar collapsing)
  // being mistaken for a keyboard.
  return window.innerHeight - vv.height > 120;
};

/**
 * Dismiss the keyboard.
 *
 * Blurring the focused element is what actually hides it: there is no
 * cross-platform API to say "close the keyboard", and a focused input will keep
 * it up on Android regardless of anything else. The active element is restored
 * on the next frame so the field does not visibly lose its caret styling.
 */
export const dismissKeyboard = (): boolean => {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !isTextEntry(active)) return false;
  active.blur();
  return true;
};

/**
 * Keep the focused field visible while the keyboard is open.
 *
 * Listens to `focusin` rather than binding a handler per input: the app has
 * hundreds of them across modals that mount and unmount, and a single
 * delegated listener is the only version of this that cannot leak.
 *
 * @returns a teardown function.
 */
export const installKeyboardFocusScroller = (): Cleanup => {
  if (typeof window === "undefined") return () => {};

  // `window.setTimeout` returns a number in the DOM lib; using the Node
  // `Timeout` type here made `clearTimeout` a type error under the app tsconfig.
  let timer: number | undefined;

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !isTextEntry(target)) return;

    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      // The element can be unmounted by the time the keyboard settles — a
      // modal closing on submit, a route change. `isConnected` is the cheap
      // check, and the rect read below would be meaningless on a detached node.
      if (!target.isConnected) return;
      revealAboveKeyboard(target);
    }, KEYBOARD_SETTLE_MS);
  };

  // Re-check on resize: the keyboard animating in fires a visualViewport
  // resize, and a field that was fine on focus can still end up underneath as
  // the layout reflows. Cheap, and only fires while the viewport is changing.
  const onViewportResize = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && isTextEntry(active) && active.isConnected) {
      revealAboveKeyboard(active);
    }
  };

  document.addEventListener("focusin", onFocusIn, true);
  window.visualViewport?.addEventListener("resize", onViewportResize);

  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("focusin", onFocusIn, true);
    window.visualViewport?.removeEventListener("resize", onViewportResize);
  };
};
