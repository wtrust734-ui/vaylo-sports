/**
 * ScreenFallback — the placeholder shown while a route's JS chunk arrives.
 *
 * It deliberately replaces the old full-screen VayloLoader here. A route chunk
 * is typically a few KB and arrives in tens of milliseconds; covering the whole
 * viewport with a logo, a spinner and a marketing line for that long reads as a
 * screen *transition* rather than a load, which is exactly the "Loading your
 * next screen" interstitial that was being reported as slow tab switching.
 *
 * Rules it follows:
 *   * It is inline, never `fixed`, so it occupies normal flow and cannot trap
 *     the user behind an overlay.
 *   * It keeps the screen's own top gutter, so the content that replaces it
 *     does not jump.
 *   * It is announced once (`role="status"`) instead of on every tick.
 */
const ScreenFallback = () => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="px-5"
    style={{ paddingTop: "var(--vaylo-screen-top)" }}
  >
    <span className="sr-only">Loading…</span>
    <div aria-hidden className="animate-pulse">
      <div className="h-6 w-40 rounded-full bg-white/[0.07]" />
      <div className="mt-3 h-3.5 w-64 max-w-full rounded-full bg-white/[0.045]" />
      <div className="mt-6 space-y-3">
        <div className="h-24 rounded-2xl bg-white/[0.035]" />
        <div className="h-24 rounded-2xl bg-white/[0.03]" />
        <div className="h-16 rounded-2xl bg-white/[0.025]" />
      </div>
    </div>
  </div>
);

export default ScreenFallback;
