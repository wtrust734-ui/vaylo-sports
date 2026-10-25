import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Share2, X } from "lucide-react";
import { shareWithInvite } from "@/lib/share";
import { formatRaceTime, TIER_META } from "@/lib/eventTrophies";

// ============================================================================
// PB CELEBRATION CARD — what the athlete sees right after they log a session
// ----------------------------------------------------------------------------
// Log a timed distance event (5K, 10K ride, 1K swim…) and this card shows:
//   * the time just logged, as a PB when it beats the athlete's previous best
//     on that event,
//   * the Bronze/Silver/Gold trophies the time earned, when it earned any.
// It never appears for a plain gym session or a Football match: the server RPC
// (claim_event_trophies) answers empty for anything that is not a timed
// distance event, and this component is only mounted when there is something
// to celebrate.
//
// Fired from the log-save flow in Workouts.tsx via `triggerPbCelebration`.
// ============================================================================

export interface PbCelebrationTrophy {
  reward_id: string;
  tier: string;
  name: string;
}

export interface PbCelebrationData {
  /** The matched event, e.g. "Running · 5K". */
  eventLabel: string;
  /** The time just logged, in seconds. */
  timeSeconds: number;
  /** True when this time beats the athlete's previous best on this event. */
  isPb: boolean;
  /** The previous best, when there was one. */
  previousSeconds: number | null;
  /** Trophies the server granted for this log (empty when none earned). */
  trophies: PbCelebrationTrophy[];
}

// ============================================================================
// SELF-MOUNTING TRIGGER — the card that could never appear
// ----------------------------------------------------------------------------
// This component used to rely on someone rendering <PBCelebration /> in the
// app shell. Nobody did: the save flow dispatched its event faithfully, no
// listener existed anywhere, and the celebration was written, wired and
// invisible. A component that exists only to answer one window event should
// not depend on a global mount point that a refactor can silently drop (the
// same failure the app-shell rewrite of 2026-10-17 caused by replacing the
// entry file outright).
//
// So the trigger mounts the listener itself: first call creates a detached
// container + React root, commits the component synchronously, and only then
// dispatches the event — so the listener provably exists before the event it
// is listening for. The root lives for the session; idle, the component
// renders nothing.
// ============================================================================

const ROOT_ID = "vaylo-pb-celebration-root";
let celebrationRoot: Root | null = null;

const ensureMounted = () => {
  if (celebrationRoot) return;
  let container = document.getElementById(ROOT_ID);
  if (!container) {
    container = document.createElement("div");
    container.id = ROOT_ID;
    document.body.appendChild(container);
  }
  celebrationRoot = createRoot(container);
};

/** Fire a celebration from the save flow. Mounts the card on first use. */
export const triggerPbCelebration = (data: PbCelebrationData) => {
  ensureMounted();
  // flushSync commits the listener before the dispatch below; a plain render
  // is concurrent and could still be pending when the event fires, which is
  // exactly how an event-with-no-listener happens.
  flushSync(() => celebrationRoot?.render(<PBCelebration />));
  window.dispatchEvent(new CustomEvent("vaylo:pb-celebration", { detail: data }));
};

const TrophyMedal = ({ tier }: { tier: string }) => {
  const meta = TIER_META[tier as keyof typeof TIER_META];
  if (!meta) return null;
  return (
    <motion.div
      initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 18 }}
      className="flex flex-col items-center gap-1.5 px-3"
    >
      <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2 shadow-lg"
        style={{ backgroundColor: `${meta.color}22`, borderColor: meta.color }}>
        🏆
      </div>
      <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
        {meta.label}
      </span>
    </motion.div>
  );
};

const Confetti = () => (
  <>
    {Array.from({ length: 60 }).map((_, i) => {
      const left = Math.random() * 100;
      const delay = Math.random() * 0.4;
      const dur = 1.6 + Math.random() * 1.2;
      const colors = ["bg-primary", "bg-electric-purple", "bg-energy", "bg-success"];
      const c = colors[i % colors.length];
      return (
        <motion.span key={i}
          initial={{ y: -20, x: `${left}vw`, opacity: 1, rotate: 0 }}
          animate={{ y: "110vh", rotate: 720 }}
          transition={{ delay, duration: dur, ease: "easeIn" }}
          className={`fixed top-0 w-2 h-3 ${c} rounded-sm z-[91] pointer-events-none`} />
      );
    })}
  </>
);

const PBCelebration = () => {
  const [data, setData] = useState<PbCelebrationData | null>(null);

  useEffect(() => {
    const fn = (e: Event) => {
      const detail = (e as CustomEvent).detail as PbCelebrationData;
      if (!detail?.eventLabel) return;
      setData(detail);
    };
    window.addEventListener("vaylo:pb-celebration", fn);
    return () => window.removeEventListener("vaylo:pb-celebration", fn);
  }, []);

  const share = async () => {
    if (!data) return;
    const pbLine = data.isPb
      ? `New ${data.eventLabel} PB: ${formatRaceTime(data.timeSeconds)}!`
      : `${data.eventLabel}: ${formatRaceTime(data.timeSeconds)}`;
    const trophyNames = data.trophies.map((t) => TIER_META[t.tier as keyof typeof TIER_META]?.label).filter(Boolean);
    const text = trophyNames.length
      ? `🏅 Vaylo Sports — ${pbLine} Earned the ${trophyNames.join(" + ")} ${data.trophies.length === 1 ? "trophy" : "trophies"}!`
      : `🏃 Vaylo Sports — ${pbLine}`;
    await shareWithInvite({ title: data.isPb ? "New PB!" : data.eventLabel, text });
  };

  return (
    <AnimatePresence>
      {data && (
        <>
          {(data.isPb || data.trophies.length > 0) && <Confetti />}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-background/90 backdrop-blur-xl flex items-center justify-center p-6">
            <motion.div
              initial={{ scale: 0.6, opacity: 0, y: 40 }} animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 22 }}
              className="relative w-full max-w-md bg-gradient-card border border-energy/40 rounded-3xl p-8 text-center shadow-glow">
              <button onClick={() => setData(null)} aria-label="Close"
                className="absolute top-3 right-3 p-2 text-muted-foreground hover:text-foreground"><X size={18} /></button>

              <p className="text-[12px] uppercase tracking-widest text-energy font-semibold">{data.eventLabel}</p>

              {/* THE TIME — the whole point of the card. Big, unmistakable, and
                  flagged as a PB only when it actually is one. */}
              <p className="text-5xl font-display font-bold text-primary mt-2 tabular-nums">
                {formatRaceTime(data.timeSeconds)}
              </p>

              {data.isPb ? (
                <p className="text-sm font-semibold text-primary mt-2">
                  🚀 New Personal Best
                  {data.previousSeconds !== null && (
                    <span className="text-muted-foreground font-normal block mt-0.5 text-[12px]">
                      Previous best: {formatRaceTime(data.previousSeconds)}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mt-2">
                  Logged — previous best: {data.previousSeconds !== null ? formatRaceTime(data.previousSeconds) : "—"}
                </p>
              )}

              {data.trophies.length > 0 && (
                <div className="mt-5">
                  <p className="text-[12px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
                    {data.trophies.length === 1 ? "Trophy earned" : "Trophies earned"}
                  </p>
                  <div className="flex justify-center">
                    {data.trophies.map((t) => <TrophyMedal key={t.reward_id} tier={t.tier} />)}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">Added to your Trophy Case.</p>
                </div>
              )}

              {data.trophies.length === 0 && !data.isPb && (
                <p className="text-[12px] text-muted-foreground mt-4">
                  Earn a Bronze/Silver/Gold trophy by beating the threshold times on this event.
                </p>
              )}

              <button onClick={share}
                className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-primary text-primary-foreground font-semibold shadow-glow">
                <Share2 size={16} /> Share
              </button>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default PBCelebration;
