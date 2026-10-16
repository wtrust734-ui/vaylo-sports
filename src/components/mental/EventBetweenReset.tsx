import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Pause, Play, Wind } from "lucide-react";
import { BREATH_CYCLE_SECONDS, BREATH_LABELS, RESET_MINUTES, type EventSlot } from "@/lib/eventMode";
import { hapticTap } from "@/lib/haptics";

type Props = {
  cueWords: string[];
  pinnedCue: string;
  next: EventSlot | null;
  onBreathe: () => void;
  onExit: () => void;
};

const fmtClock = (seconds: number) =>
  `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

/**
 * The gap between events, which is where a competition day is actually won or
 * lost: too long to sit still, too short for another session.
 *
 * A reset timer the athlete chooses (3 to 15 minutes), the pinned cue word in
 * front of them so the walk back is not a blank screen, and one tap into the
 * guided breath. The countdown ends on zero and says what to do next rather
 * than simply stopping.
 */
const EventBetweenReset = ({ cueWords, pinnedCue, next, onBreathe, onExit }: Props) => {
  const [minutes, setMinutes] = useState<number>(5);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          setRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const start = (mins = minutes) => {
    hapticTap();
    setMinutes(mins);
    setRemaining(mins * 60);
    setRunning(true);
  };

  const cue = pinnedCue || cueWords[0] || "";
  const started = remaining > 0 || running;
  const cycles = Math.max(1, Math.round(minutes * 60 / BREATH_CYCLE_SECONDS));

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-5 pb-24 pt-[var(--vaylo-screen-top)]">
      <div className="flex w-full max-w-sm items-center gap-3">
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={onExit}
          className="flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary"
        >
          <ArrowLeft size={18} aria-hidden /> Back
        </motion.button>
        {next && (
          <span className="ml-auto text-xs text-muted-foreground">
            Next: {next.name} at {next.time}
          </span>
        )}
      </div>

      <h2 className="mt-6 text-lg font-display font-bold">Between events</h2>
      <p className="mt-1 text-center text-xs text-muted-foreground">
        Stay warm, stay calm, and hold one thought. Then go again.
      </p>

      {cue && (
        <div className="mt-6 rounded-2xl border-2 border-primary/40 bg-primary/10 px-8 py-5">
          <p className="text-[11px] uppercase tracking-wider text-primary font-semibold">Your cue</p>
          <p className="mt-1 text-3xl font-display font-black text-primary">{cue}</p>
        </div>
      )}

      {!started ? (
        <>
          <p className="mt-8 text-xs text-muted-foreground">How long until you need to move?</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2 min-w-0">
            {RESET_MINUTES.map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => start(mins)}
                className={`min-h-11 rounded-xl border px-5 text-sm font-semibold ${
                  minutes === mins ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground"
                }`}
              >
                {mins} min
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="mt-8 text-5xl font-display font-black tabular-nums text-primary" role="timer">
            {fmtClock(remaining)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            About {cycles} guided breaths at 4 in · 2 hold · 6 out · 2 hold
          </p>
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => { hapticTap(); setRunning(!running); }}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-card px-5 text-sm font-semibold text-foreground"
            >
              {running ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
              {running ? "Pause" : "Resume"}
            </button>
            <button
              type="button"
              onClick={() => start()}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-card px-5 text-sm font-semibold text-muted-foreground"
            >
              Reset
            </button>
          </div>
        </>
      )}

      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onClick={onBreathe}
        className="mt-8 flex min-h-11 items-center gap-2 rounded-xl bg-gradient-primary px-6 font-semibold text-primary-foreground"
      >
        <Wind size={16} aria-hidden /> {BREATH_LABELS[0]} — guided breath
      </motion.button>

      {remaining === 0 && started && !running && (
        <p className="mt-4 text-center text-sm font-semibold text-primary" role="status">
          Reset done — {next ? `head towards ${next.name}.` : "check the list for your next event."}
        </p>
      )}
    </div>
  );
};

export default EventBetweenReset;
