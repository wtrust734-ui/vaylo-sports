// ============================================================================
// SCROLL RESTORATION
// ----------------------------------------------------------------------------
// The single most reliable way to make a web app feel like a website on a
// phone is to navigate between screens and keep the old scroll offset.
//
// You scroll a third of the way down the leaderboard, tap a row, and land on a
// profile page already scrolled past its own header — with no way to explain
// why. Every native app behaves the other way round: a new screen starts at the
// top, and going *back* returns you to where you were. Neither happened here,
// because react-router deliberately leaves scroll alone.
//
// Fixing that needs the navigation direction, not just the path: on POP the
// athlete expects their place to have been kept, on PUSH they expect the top.
// Keying off the path alone gets this backwards for every back press.
//
// Hash links are the exception — `#section` has to scroll to the anchor, and a
// reset would fight it.
// ============================================================================

import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** How many entries to remember. Deep enough for a real drill-down. */
const MAX_ENTRIES = 40;

export function ScrollRestoration() {
  const { pathname, key, hash } = useLocation();
  const navigationType = useNavigationType();

  // path -> scroll offset, so a POP can put the athlete back where they were.
  const positions = useRef(new Map<string, number>());
  // The key we last scrolled for, so a re-render at the same location is a
  // no-op rather than a snap back to the top mid-interaction.
  const lastKey = useRef<string | null>(null);
  // The screen we are leaving, so a POP knows whose offset to save. A ref, not
  // state: writing it must not itself re-trigger this effect.
  const lastPath = useRef<string>("");

  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;

    // Leaving the previous screen: record where the athlete was, so coming
    // back lands in the same place.
    if (navigationType === "POP") {
      positions.current.set(lastPath.current, window.scrollY);
    }
    lastPath.current = pathname;

    // A hash target (an in-page anchor) is not a scroll reset.
    if (hash) {
      const target = document.getElementById(hash.slice(1));
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }

    if (navigationType === "POP") {
      const remembered = positions.current.get(pathname);
      if (typeof remembered === "number") {
        // The new screen has not laid out yet, so restoring immediately would
        // clamp to 0 on any route whose content arrives asynchronously. One
        // frame later is enough for the DOM to have its height.
        requestAnimationFrame(() => window.scrollTo(0, remembered));
        return;
      }
    }

    // PUSH (and any POP we have no memory of): start at the top, with no
    // animation. A native transition is instantaneous; scrolling up smoothly
    // reads as the page animating under the athlete.
    window.scrollTo(0, 0);

    // Keep the map bounded — an athlete who taps through 200 rows should not
    // grow it without limit for the life of the session.
    if (positions.current.size > MAX_ENTRIES) {
      const oldest = positions.current.keys().next().value;
      if (oldest !== undefined) positions.current.delete(oldest);
    }
  }, [pathname, key, hash, navigationType]);

  return null;
}
