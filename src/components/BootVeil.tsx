import { useEffect, useState } from "react";
import logo from "@/assets/logo.jpg";

/**
 * BootVeil — the smooth handoff between loading and loaded.
 *
 * Before this, the boot sequence ended in a hard cut: the native splash and
 * the React loader vanished the instant the app mounted, so the home screen
 * popped in with no transition — the abruptness that reads as "opens too
 * fast". A native launch instead holds its brand mark a beat and then
 * crossfades into the app.
 *
 * So this veil paints the same foundation colour the splash and loader use
 * (#05070f, seamless with both) over everything, holds for a minimum dwell
 * so the launch reads as intentional rather than a flicker, then fades out
 * on the compositor (opacity only) and unmounts. It blocks taps while up,
 * like any launch screen, and collapses to nearly nothing under
 * prefers-reduced-motion.
 */
const MIN_DWELL_MS = 1000;
const FADE_MS = 600;

type Phase = "held" | "fading" | "gone";

export default function BootVeil() {
  const [phase, setPhase] = useState<Phase>("held");

  useEffect(() => {
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dwell = reduce ? 150 : MIN_DWELL_MS;
    const fade = reduce ? 0 : FADE_MS;
    const fadeTimer = window.setTimeout(() => setPhase("fading"), dwell);
    const goneTimer = window.setTimeout(() => setPhase("gone"), dwell + fade + 50);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(goneTimer);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden
      data-boot-veil
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#05070f]"
      style={{
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
      }}
    >
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
