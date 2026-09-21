import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, Wind, ArrowLeft } from "lucide-react";

interface Props {
  cueWords: string[];
  onExit: () => void;
}

const reminders = [
  "Control the controllables.",
  "Process over outcome.",
  "Trust your training.",
];

const RaceMode = ({ cueWords, onExit }: Props) => {
  const [countdownTotal, setCountdownTotal] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [inputMin, setInputMin] = useState("5");
  const [showBreathing, setShowBreathing] = useState(false);
  const timerRef = useRef<number | null>(null);

  const startTimer = () => {
    const secs = parseInt(inputMin) * 60;
    if (isNaN(secs) || secs <= 0) return;
    setCountdownTotal(secs);
    setRemaining(secs);
    setRunning(true);
  };

  useEffect(() => {
    if (!running) return;
    timerRef.current = window.setInterval(() => {
      setRemaining(r => {
        if (r <= 1) { setRunning(false); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running]);

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header with back button */}
      <div className="px-5 pt-14 pb-3 flex items-center gap-3">
        <motion.button onClick={onExit} whileTap={{ scale: 0.9 }}
          className="flex items-center gap-1.5 text-sm text-primary font-semibold">
          <ArrowLeft size={18} /> Back to Mental Gym
        </motion.button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-5 pb-24">
        {/* Timer */}
        {!running && remaining === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center mb-8">
            <h2 className="text-lg font-display font-bold mb-1">Event Mode</h2>
            <p className="text-xs text-muted-foreground mb-4">Set countdown (minutes)</p>
            <input value={inputMin} onChange={e => setInputMin(e.target.value)} type="number" min={1} max={120}
              className="w-24 text-center bg-muted border border-border rounded-xl px-4 py-3 text-2xl font-display font-bold mb-4" />
            <motion.button whileTap={{ scale: 0.97 }} onClick={startTimer}
              className="flex items-center gap-2 bg-primary text-primary-foreground font-semibold py-3 px-10 rounded-xl mx-auto">
              <Play size={18} /> Start
            </motion.button>
          </motion.div>
        ) : (
          <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="text-center mb-8">
            <motion.p key={remaining} className="text-6xl font-display font-black text-primary tabular-nums">
              {fmt(remaining)}
            </motion.p>
            <div className="flex gap-3 mt-4 justify-center">
              <button onClick={() => setRunning(!running)}
                className="flex items-center gap-1 text-sm font-semibold text-muted-foreground bg-card border border-border rounded-xl px-4 py-2">
                {running ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}
              </button>
            </div>
          </motion.div>
        )}

        {/* Cue Words */}
        {cueWords.length > 0 && (
          <div className="flex gap-4 mb-8 flex-wrap justify-center">
            {cueWords.map((w, i) => (
              <motion.div key={w} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.15 }}
                className="bg-primary/10 border-2 border-primary/40 rounded-2xl px-6 py-4">
                <span className="text-2xl font-display font-black text-primary">{w}</span>
              </motion.div>
            ))}
          </div>
        )}

        {/* Quick breathing */}
        <button onClick={() => setShowBreathing(!showBreathing)}
          className="flex items-center gap-2 text-xs text-primary font-semibold bg-primary/5 border border-primary/20 rounded-xl px-4 py-2 mb-6">
          <Wind size={14} /> {showBreathing ? "Hide" : "Quick Breath"}
        </button>
        <AnimatePresence>
          {showBreathing && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="text-sm text-muted-foreground text-center">4 in… 4 hold… 4 out… 4 hold…</motion.p>
          )}
        </AnimatePresence>

        {/* Focus reminders */}
        <div className="mt-6 space-y-2 w-full max-w-sm">
          {reminders.map((r, i) => (
            <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 + i * 0.2 }}
              className="text-center text-xs text-muted-foreground/60 italic">
              {r}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default RaceMode;
