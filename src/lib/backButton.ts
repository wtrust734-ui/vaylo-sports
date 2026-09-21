// ============================================================================
// BACK BUTTON STACK
// ----------------------------------------------------------------------------
// On Android the hardware/gesture back button is the main way out of an
// overlay. Without this, pressing back with a bottom sheet open would leave the
// page instead of closing the sheet — which feels broken in a native shell
// (and on the web it is simply the browser back button).
//
// Overlays (BottomSheet and friends) push a handler while they are open; the
// native bridge below drains the top-most one first, then falls back to normal
// navigation. Pure data structure, no React and no Capacitor import, so it is
// safe to ship in the web build where nothing ever calls consumeBackPress().
// ============================================================================

export type BackHandler = () => void;

const handlers: BackHandler[] = [];

/** Registers a handler; call the returned function to unregister. */
export function pushBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

/**
 * Gives the back press to the most recently opened overlay.
 * Returns true when something consumed it.
 *
 * A handler stays on the stack until it unregisters (via the function returned
 * by pushBackHandler), so an overlay that intercepts a press without closing —
 * a two-step confirm, for example — can claim the next press as well.
 */
export function consumeBackPress(): boolean {
  const handler = handlers[handlers.length - 1];
  if (!handler) return false;
  handler();
  return true;
}

export const hasBackHandler = () => handlers.length > 0;

/** Test helper — never called by app code. */
export const clearBackHandlers = () => {
  handlers.length = 0;
};
