// ============================================================================
// MOTION TOKENS
// ----------------------------------------------------------------------------
// One place for every duration, easing curve and spring, so screens feel like
// the same app instead of a collection of one-off numbers.
//
// Backwards compatible: `DURATION.medium` and `EASE.out` were already used by
// <Reveal> and the archived <StaggerList>, so they remain part of the API.
//
// Everything that animates should use these, and the helpers degrade to a plain
// fade when the athlete has "reduce motion" enabled.
// ============================================================================

import type { Transition, Variants, Easing } from "framer-motion";

/** Seconds. `fast` is for taps, `medium`/`base` for content, `slow` for screens. */
export const DURATION = {
  instant: 0,
  fast: 0.16,
  medium: 0.24,
  /** Alias of `medium`, for readability at call sites. */
  base: 0.24,
  slow: 0.42,
} as const;

type Bezier = [number, number, number, number];

export const EASE = {
  /** Standard "arrives and settles" curve. */
  out: [0.16, 1, 0.3, 1] as Bezier,
  in: [0.4, 0, 1, 1] as Bezier,
  inOut: [0.4, 0, 0.2, 1] as Bezier,
} as const satisfies Record<string, Easing>;

export const SPRING = {
  /** Immediate feedback: buttons, chips, toggles. */
  snappy: { type: "spring", stiffness: 420, damping: 30, mass: 0.7 } as Transition,
  /** Panels and sheets arriving. */
  settle: { type: "spring", stiffness: 320, damping: 30 } as Transition,
  /** Large surfaces / celebratory movement. */
  gentle: { type: "spring", stiffness: 200, damping: 26 } as Transition,
} as const;

/** Backdrop for any overlay. */
export const overlayMotion = (reduced: boolean) => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: reduced ? 0 : DURATION.fast },
});

/** Panels that rise from the bottom on mobile and settle in on desktop. */
export const panelMotion = (reduced: boolean) =>
  reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { y: "100%" },
        animate: { y: 0 },
        exit: { y: "100%" },
        transition: SPRING.settle,
      };

/** Centered dialog variant (no travel, just a soft scale). */
export const dialogMotion = (reduced: boolean) =>
  reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, scale: 0.97 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.97 },
        transition: { duration: DURATION.base, ease: EASE.out },
      };

/** Staggered list rows — the app's standard "cards arriving" feel. */
export const listItemMotion = (index: number, reduced: boolean) =>
  reduced
    ? {}
    : {
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0 },
        transition: { delay: 0.02 + Math.min(index, 8) * 0.04, ease: EASE.out },
      };

/** Shared variants for containers that fade their children in. */
export const fadeInVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DURATION.base } },
};
