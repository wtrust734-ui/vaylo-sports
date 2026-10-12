import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Play, RotateCcw, X } from "lucide-react";
import {
  BREATH_CYCLE_SECONDS,
  BREATH_LABELS,
  BREATH_PHASES,
  BREATH_RUN_SECONDS,
  breathPhaseAt,
} from "@/lib/eventMode";
import { hapticTap } from "@/lib/haptics";

type Props = { onExit: () => void };

/** Scale targets per phase: in and its hold are expanded, out and its hold are not. */
const SCALE = [1.45, 1.45, 0.72, 0.72];

/**
 * The guided breath an athlete actually follows at a competition.
 *
 * The old version was a line of text reading "4 in… 4 hold… 4 out… 4 hold…" —
 * a description of breathing rather than breathing. This is a circle that
 * expands and contracts on the same calm pacing as the Quick Reset preset
 * (src/components/mental/BreathingTool.tsx), with the phase named and counted
 * down, and a single haptic tap at each change so it can be followed with eyes
 * closed. The run ends after four full cycles rather than mid-exhale.
 */
const EventBreathing = ({ onExit }: Props) => {
  const [running, setRunning] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const phase = breathPhaseAt(elapsed);
  const lastPhase = useRef(phase.index);
  const finished = elapsed >= BREATH_RUN_SECONDS;

  useEffect(() => {
    if (!running || finished) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running, finished]);

  useEffect(() => {
    if (finished) setRunning(false);
  }, [finished]);

  // Haptic on every phase change — the one cue that works without looking.
  useEffect(() => {
    if (!running) return;
    if (lastPhase.current !== phase.index) {
      lastPhase.current = phase.index;
      hapticTap();
    }
  }, [phase.index, running]);

  const restart = () => {
    lastPhase.current = 0;
    setElapsed(0);
    setRunning(true);
  };

  const cycles = Math.floor(elapsed / BREATH_CYCLE_SECONDS);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 pb-24">
      <div className="flex w-full max-w-sm items-center justify-between">
        <h2 className="text-lg font-display font-bold">Breathe with me</h2>
        <button
          type="button"
          onClick={onExit}
          aria-label="Close breathing"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <motion.div
        animate={{ scale: running ? SCALE[phase.index] : 1 }}
        transition={{ duration: running ? BREATH_PHASES[phase.index] : 0.3, ease: "easeInOut" }}
        className="mt-10 flex h-48 w-48 items-center justify-center rounded-full border-2 border-primary bg-primary/10"
        aria-hidden
      >
        <div className="text-center">
          <p className="text-sm font-display font-bold text-primary">
            {running ? BREATH_LABELS[phase.index] : finished ? "Done" : "Paused"}
          </p>
          {running && (
            <p className="mt-1 text-3xl font-display font-black tabular-nums text-primary">{phase.remaining}</p>
          )}
        </div>
      </motion.div>

      {/* Screen readers get the same instruction as the circle. */}
      <p className="mt-6 text-center text-sm text-muted-foreground" role="status">
        {running ? `${BREATH_LABELS[phase.index]} for ${phase.remaining}` : "Breathing paused"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Cycles: {cycles} of 4</p>

      <div className="mt-8 flex gap-2">
        {finished ? (
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={restart}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground"
          >
            <RotateCcw size={16} aria-hidden /> Again
          </motion.button>
        ) : (
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => { hapticTap(); setRunning(!running); }}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground"
          >
            <Play size={16} aria-hidden /> {running ? "Pause" : "Resume"}
          </motion.button>
        )}
      </div>
    </div>
  );
};

export default EventBreathing;
