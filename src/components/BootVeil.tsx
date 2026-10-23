import { useEffect, useState } from "react";
import logo from "@/assets/logo.jpg";
import { isConfigBootFailure, isConfigKeyMissing } from "@/lib/startup";

/**
 * BootVeil — one continuous surface from the first frame to the first usable one.
 *
 * The old sequence had three cuts in a row: the blank document painted before
 * the CSS arrived, then a full-screen VayloLoader ("Preparing your performance
 * space") while i18n initialised, then a *second*, differently-dressed veil on
 * top of the already-rendered home screen. Every step was a hard cut, which is
 * what read as an unsmooth open.
 *
 * This replaces all of them with a single surface:
 *
 *   * The timeline is module-level and starts at first JS execution, so the
 *     veil main.tsx paints as the very first frame and the veil App.tsx mounts
 *     are the same surface with the same clock — remounting changes nothing the
 *     athlete can see.
 *   * It only starts fading when the app signals `markBootReady()`, i.e. when a
 *     real content frame exists underneath — so it never crossfades into a
 *     half-loaded screen. AppLayout holds it while its own profile gate is up;
 *     routes without that gate are released by App's time cap instead.
 *   * A hard stop guarantees it always leaves, even if boot never signals (a
 *     route we did not account for, a crash under the veil). Nobody gets trapped
 *     behind a splash screen.
 *   * It sits above the route loaders (z-[200] vs their z-[100]) so nothing can
 *     pop over it mid-fade, fades on opacity only (compositor, no layout), stops
 *     eating taps the moment the fade begins, and collapses under
 *     prefers-reduced-motion.
 *
 * It is also the app's boot status for assistive tech: role="status" with a
 * screen-reader-only line, since main.tsx no longer renders a second loader.
 */

const MIN_DWELL_MS = 650;
const FADE_MS = 500;
const HARD_STOP_MS = 4000;
const REDUCED_DWELL_MS = 120;

type Phase = "held" | "fading" | "gone";

/** First JS execution ≈ the first frame this app controls. */
const bootedAt = Date.now();

let phase: Phase = "held";
/** True while an unmounted-gate screen (AppLayout's profile loader) is up. */
let gated = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const prefersReduced = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Start the fade once minimum dwell has passed. Idempotent. */
function release(): void {
  if (phase !== "held") return;
  const reduce = prefersReduced();
  const wait = Math.max(0, bootedAt + (reduce ? REDUCED_DWELL_MS : MIN_DWELL_MS) - Date.now());
  const fadeMs = reduce ? 0 : FADE_MS;
  window.setTimeout(() => {
    if (phase !== "held") return;
    phase = "fading";
    emit();
  }, wait);
  window.setTimeout(
    () => {
      if (phase !== "gone") {
        phase = "gone";
        emit();
      }
    },
    wait + fadeMs + 40,
  );
}

/**
 * The app's first real content frame exists (or is as ready as it will get):
 * release the veil. Safe to call from anywhere, any number of times.
 */
export function markBootReady(): void {
  release();
}

/**
 * A genuinely blocking screen (a profile gate, a bootstrap spinner) is about to
 * render underneath. Tells App's time cap to stand down so the veil stays up
 * until that screen signals it is done, instead of crossfading into a spinner.
 */
export function holdBootVeil(): void {
  gated = true;
}

/** Whether something is currently holding the veil open. */
export const bootVeilGated = (): boolean => gated;

// Hard stop: if nothing ever signals, the veil still leaves rather than
// trapping the athlete on a splash screen after a boot failure.
if (typeof window !== "undefined") {
  window.setTimeout(() => {
    if (phase !== "gone") {
      phase = "gone";
      emit();
    }
  }, HARD_STOP_MS);
}

export default function BootVeil() {
  const [, setTick] = useState(0);
  const [fatal, setFatal] = useState<boolean | null>(null);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Defer until the hydration effect has had a chance to fail: if it settles
    // without an error, leave boot alone; if it sets a fatal diagnostic, surface
    // it underneath the veil without waiting for the hard stop.
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      if (isConfigBootFailure()) {
        setFatal(true);
        // Peel the veil immediately so the diagnostic is visible; it has its own
        // retry affordance and does not rely on the hard stop.
        if (phase === "held") {
          phase = "gone";
          emit();
        }
      }
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  if (fatal) {
    return (
      <ConfigBootFailureScreen />
    );
  }

  if (phase === "gone") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-boot-veil
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#05070f]"
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
        // Let the athlete touch the app the instant the fade begins.
        pointerEvents: phase === "fading" ? "none" : "auto",
      }}
    >
      <span className="sr-only">Loading Vaylo Sports</span>
      <img
        src={logo}
        alt=""
        draggable={false}
        className="h-16 w-16 rounded-2xl object-cover ring-1 ring-white/10"
      />
      <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.32em] text-sky-200/70">
        Vaylo Sports
      </p>
    </div>
  );
}

function ConfigBootFailureScreen() {
  return (
    <div
      role="alert"
      data-boot-fatal
      className="fixed inset-0 z-[210] flex flex-col items-center justify-center p-6 bg-[#05070f] text-center"
    >
      <h1 className="text-lg font-bold tracking-tight text-white">
        App could not start
      </h1>
      <p className="mt-3 max-w-sm text-sm text-white/70">
        We could not reach the app’s backend. The loading screen will not disappear until this is fixed.
      </p>
      <p className="mt-2 text-xs text-white/50">
        {isConfigKeyMissing()
          ? "This app is missing its backend key. It cannot reach the server until that is fixed."
          : "This app could not reach its backend. The loading screen will not disappear until that is fixed."}
      </p>
      <div className="mt-6 flex flex-col gap-3 w-full max-w-[260px]">
        <button
          type="button"
          className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15"
          onClick={() => {
            try {
              window.location.reload();
            } catch {
              // reload() can throw in some webviews; re-navigating to the same
              // URL is the reload fallback, written as replace() because
              // assigning href to itself is the same statement in worse clothes.
              window.location.replace(window.location.href);
            }
          }}
        >
          Retry
        </button>
        <p className="text-[11px] text-white/40 leading-relaxed">
          If this keeps happening on a device you own, the app may need to be reinstalled or the build may need its backend configuration fixed.
        </p>
      </div>
      <p className="mt-3 text-[11px] text-white/30" aria-label="No keys or tokens are shown on this screen">
        No keys or tokens are shown on this screen.
      </p>
    </div>
  );
}
