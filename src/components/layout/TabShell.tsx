import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import ScreenFallback from "@/components/ScreenFallback";

/**
 * TabShell — the four bottom-navigation roots, kept alive.
 *
 * Why this exists
 * ---------------
 * Switching tabs used to unmount the outgoing screen and mount the incoming
 * one. That had three visible costs, all of them reported:
 *
 *   1. Every tab switch re-ran the page's queries from scratch, so a returning
 *      tab showed a spinner where it had data a second earlier.
 *   2. The route chunk was fetched behind a full-screen loader, so the app's
 *      own navigation appeared to "leave" the app.
 *   3. Scroll position and in-page state (an open filter, a half-typed note)
 *      were destroyed by simply looking at another tab — the thing mobile users
 *      notice first, because on a real app the tab bar is not a page reload.
 *
 * So the four roots are mounted once, on first visit, and then hidden rather
 * than unmounted. Detail screens (everything that is not a tab root) keep the
 * ordinary router behaviour: they mount and unmount normally, because holding
 * every one of ~50 detail screens alive is a memory leak with extra steps.
 *
 * The transition
 * --------------
 * A two-phase crossfade, both phases compositor-only (opacity on a panel that
 * already exists — never transform, see the note on the <section> below):
 *
 *   phase 1  the OUTGOING panel is still the one in layout, and fades out over
 *            `--vaylo-nav-fade-out` (120ms).
 *   phase 2  at the end of that, the swap and the outgoing `hidden` happen in
 *            one commit, and the INCOMING panel fades in over
 *            `--vaylo-nav-fade` (240ms) on an ease-out curve.
 *
 * 360ms end to end, and the previous 160ms single fade was the "too quick, not
 * smooth" complaint: the old screen blinked out of existence in a single frame,
 * so the eye saw a flash of bare background and then a 160ms fade — two
 * separate events rather than one movement. Sequencing them means the app is
 * never empty, and the single continuous 120ms+240ms is read as one gesture.
 *
 * Why the phases do not overlap
 * ----------------------------
 * A real crossfade wants both panels stacked and both semi-transparent at
 * once. That is not available here without a real regression: the document is
 * the scroll container, so two panels in flow would double the page height, and
 * absolutely positioning the outgoing one would make it a containing block for
 * `position: fixed` — which would silently re-anchor every fixed composer and
 * in-page sheet inside it. Phasing avoids both. The cost is a 120ms dip to the
 * background colour in the middle, which at these durations reads as a
 * crossfade rather than a blink.
 *
 * `prefers-reduced-motion` collapses both phases to zero, so the switch becomes
 * an instant swap instead of a shortened animation.
 *
 * `hidden` is doing real work below, not decoration: it takes the inactive
 * panels out of the accessibility tree, out of the tab order and out of layout
 * at once, which `opacity: 0` alone would not do.
 */

type Tab = {
  path: string;
  /** Component, lazy so a tab's chunk is fetched only if the tab is opened. */
  Screen: React.LazyExoticComponent<React.ComponentType>;
  /**
   * The same dynamic import, held separately so the chunk can be warmed at
   * idle without mounting the screen. `lazy()` and this call the same module
   * specifier, so the second one to run resolves from Vite's module cache —
   * this is a cache warm, not a second download.
   */
  preload: () => Promise<unknown>;
};

const TABS: Tab[] = [
  { path: "/", Screen: lazy(() => import("@/pages/Index")), preload: () => import("@/pages/Index") },
  { path: "/train", Screen: lazy(() => import("@/pages/Train")), preload: () => import("@/pages/Train") },
  {
    path: "/perform",
    Screen: lazy(() => import("@/pages/Perform")),
    preload: () => import("@/pages/Perform"),
  },
  {
    path: "/profile",
    Screen: lazy(() => import("@/pages/Profile")),
    preload: () => import("@/pages/Profile"),
  },
];

const FADE_OUT_MS = 130;

/** The tab whose root path is exactly this pathname, or undefined. */
export const activeTabPath = (pathname: string): string | undefined =>
  TABS.find((t) => t.path === pathname)?.path;

export const isTabRoot = (pathname: string): boolean => activeTabPath(pathname) !== undefined;

/**
 * Reduced motion is a *behaviour* switch here, not a CSS one: the phase-1
 * dwell is a JS timer, and the reduced-motion media query cannot cancel it. Left
 * uncancelled, an athlete who has asked for less motion would still wait 120ms
 * of a blank page on every single tab tap.
 */
const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const TabShell = () => {
  const location = useLocation();
  const [mounted, setMounted] = useState<string[]>([location.pathname]);
  /** The tab the router is on. Drives semantics, not paint. */
  const [activePath, setActivePath] = useState<string | null>(location.pathname);
  /**
   * The panel that currently occupies the page. Usually identical to
   * `activePath`; during a switch it is still the OUTGOING one, which is the
   * entire point of the two-phase crossfade. This is the only thing that
   * decides `hidden`.
   */
  const [shownPath, setShownPath] = useState<string | null>(location.pathname);
  const [leaving, setLeaving] = useState(false);
  // Per-tab scroll memory. The document is the scroll container (the tab bar is
  // fixed, not a scroller), so hiding a panel collapses the page height and the
  // browser would otherwise leave the user at the top of the last tab they
  // looked at — or worse, at the clamped scroll offset of a shorter page.
  const scrollMemory = useRef<Record<string, number>>({});
  const lastPath = useRef(location.pathname);
  // Mirrors of state, for the effect below: this effect must run on the route
  // changing and not on its own state changing, or the fade would re-arm
  // itself forever.
  const shownRef = useRef<string | null>(location.pathname);
  // The panel that is already fully faded out, if any. A second tap arriving
  // inside phase 1 must not start a fresh 120ms dwell on a panel the athlete
  // can already see nothing of — that is 120ms of blank page for no reason.
  const spentRef = useRef<string | null>(null);
  const landingPath = useRef(location.pathname);

  useEffect(() => {
    const previous = lastPath.current;
    const next = location.pathname;
    const target = activeTabPath(next);

    // Tab → tab: remember where the outgoing tab was, so returning to it lands
    // where it was left. Only done between tab roots, so detail screens keep
    // the router's own scroll behaviour on push and pop.
    if (previous !== next && activeTabPath(previous) && target) {
      scrollMemory.current[previous] = window.scrollY;
    }
    lastPath.current = next;

    // A detail screen, or a sign-out. Nothing to cross-fade to: the panels all
    // go at once and the route's own screen takes over.
    if (!target) {
      setActivePath(null);
      setShownPath(null);
      setLeaving(false);
      shownRef.current = null;
      return;
    }

    setActivePath(target);
    if (!mounted.includes(target)) setMounted((prev) => [...prev, target]);

    // The swap. Hidden, layout and the scroll offset all change together, so
    // the browser never paints a frame with the new panel at the old tab's
    // scroll position.
    const commit = () => {
      shownRef.current = target;
      spentRef.current = null;
      setShownPath(target);
      setLeaving(false);
      // Always settle the offset, including the first visit: a tab that has
      // never been used opens at the top, and a tab being returned to opens
      // where the athlete left it. Skipping the scroll when there is no memory
      // would leave the incoming screen at the previous screen's offset, which
      // on a long page looks like the app dropped you in the middle of it.
      const y = scrollMemory.current[target] ?? 0;
      const raf = requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "auto" }));
      return () => cancelAnimationFrame(raf);
    };

    // First visit of this tab, a return from a detail screen (nothing is on
    // screen to fade out), an already-spent panel, or reduced motion: swap now.
    const hasSomethingToFade = shownRef.current !== null && shownRef.current !== target;
    if (!hasSomethingToFade || shownRef.current === spentRef.current || prefersReducedMotion()) {
      commit();
      return;
    }

    spentRef.current = shownRef.current;
    setLeaving(true);
    const timer = window.setTimeout(commit, FADE_OUT_MS);
    return () => window.clearTimeout(timer);
    // Intentionally not depending on `mounted`, `shownPath` or `leaving`: this
    // effect is armed by the route changing, and every state setter inside it
    // would otherwise re-arm the transition it just performed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Warm the other three tab chunks once the browser is idle.
  //
  // This is the last remaining way a tab switch can still feel like the app
  // left and came back: a tab opened for the first time still had to download
  // its route chunk, and until it did, the panel showed the full-screen
  // ScreenFallback instead of a screen. Four tabs is a small, fixed set and
  // they are the app's primary navigation, so the chunks are worth having
  // before the athlete asks for them.
  //
  // Idle-time rather than on-tap, so the downloads never compete with the
  // screen being read. `saveData` opts out: on a metered connection the
  // athlete has already said they would rather not.
  useEffect(() => {
    // Which tab the athlete landed on. Read through a ref so the effect can
    // stay mount-only, which is the point: this warms the *other* three once
    // per mount, not on every navigation.
    const landing = landingPath.current;
    const warm = () => {
      TABS.forEach((t) => {
        if (t.path !== landing) void t.preload().catch(() => undefined);
      });
    };
    if (
      typeof navigator === "undefined" ||
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
    ) {
      return;
    }
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(warm, { timeout: 5000 });
      return () => w.cancelIdleCallback?.(id);
    }
    // Safari and anything without requestIdleCallback: a short timer is the
    // closest equivalent that still lands well after first paint.
    const id = window.setTimeout(warm, 2500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <>
      {TABS.filter((t) => mounted.includes(t.path)).map(({ path, Screen }) => {
        const shown = path === shownPath;
        return (
          <section
            key={path}
            id={`tab-panel-${path === "/" ? "home" : path.slice(1)}`}
            data-active={shown && !leaving}
            data-leaving={shown && leaving}
            hidden={!shown}
            aria-hidden={path === activePath ? undefined : true}
            /* No transform class here on purpose. `translateZ(0)` would make
               this section a containing block for `position: fixed`, and these
               screens contain fixed elements (composers, in-page sheets, the
               floating action pills). An opacity animation is already handled
               by the compositor, so the layer promotion is not needed — and it
               would silently re-anchor every fixed child to the panel. */
            className="nav-fade"
          >
            <Suspense fallback={<ScreenFallback />}>
              <Screen />
            </Suspense>
          </section>
        );
      })}
    </>
  );
};

export default TabShell;
