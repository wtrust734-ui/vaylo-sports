import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, RotateCcw } from "lucide-react";

const presets = [
  { id: "box", label: "Box Breathing", phases: [4, 4, 4, 4], labels: ["Breathe In", "Hold", "Breathe Out", "Hold"] },
  { id: "calm", label: "Calm Breathing", phases: [4, 0, 6, 0], labels: ["Breathe In", "", "Breathe Out", ""] },
  { id: "quick", label: "Quick Reset", phases: [2, 1, 3, 1], labels: ["In", "Hold", "Out", "Hold"] },
];

const BreathingTool = () => {
  const [preset, setPreset] = useState(presets[0]);
  const [running, setRunning] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [cycles, setCycles] = useState(0);
  const timerRef = useRef<number | null>(null);
  const totalTime = useRef(0);

  const start = () => {
    setRunning(true);
    setCycles(0);
    setPhaseIdx(0);
    totalTime.current = 0;
    const dur = preset.phases[0];
    setCountdown(dur);
  };

  const stop = () => {
    setRunning(false);
    setPhaseIdx(0);
    setCountdown(0);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  useEffect(() => {
    if (!running) return;
    timerRef.current = window.setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          setPhaseIdx(p => {
            let next = p + 1;
            // skip zero-duration phases
            while (next < preset.phases.length && preset.phases[next] === 0) next++;
            if (next >= preset.phases.length) {
              next = 0;
              while (preset.phases[next] === 0) next++;
              setCycles(cy => cy + 1);
            }
            setCountdown(preset.phases[next]);
            return next;
          });
          return 0;
        }
        return c - 1;
      });
      totalTime.current += 1;
      // Auto-stop quick reset after 30s
      if (preset.id === "quick" && totalTime.current >= 30) {
        stop();
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running, preset]);

  const isInhale = phaseIdx === 0;
  const isExhale = phaseIdx === 2;
  const scale = running ? (isInhale ? 1.4 : isExhale ? 0.7 : 1.1) : 1;
  const currentLabel = running ? preset.labels[phaseIdx] : "Ready";

  return (
    <div className="flex flex-col items-center px-5">
      {/* Preset selector */}
      <div className="flex gap-2 mb-8 w-full">
        {presets.map(p => (
          <button key={p.id} onClick={() => { if (!running) setPreset(p); }}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
              preset.id === p.id ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground"
            }`}>{p.label}</button>
        ))}
      </div>

      {/* Breathing circle */}
      <motion.div
        animate={{ scale }}
        transition={{ duration: running ? preset.phases[phaseIdx] : 0.3, ease: "easeInOut" }}
        className="w-40 h-40 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center mb-6"
      >
        <AnimatePresence mode="wait">
          <motion.div key={currentLabel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="text-center">
            <p className="text-sm font-display font-bold text-primary">{currentLabel}</p>
            {running && <p className="text-2xl font-display font-black text-primary mt-1">{countdown}</p>}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <p className="text-xs text-muted-foreground mb-6">Cycles: {cycles}</p>

      {!running ? (
        <motion.button whileTap={{ scale: 0.97 }} onClick={start}
          className="flex items-center gap-2 bg-primary text-primary-foreground font-semibold py-3 px-10 rounded-xl">
          <Play size={18} /> Start
        </motion.button>
      ) : (
        <motion.button whileTap={{ scale: 0.97 }} onClick={stop}
          className="flex items-center gap-2 bg-destructive/10 text-destructive font-semibold py-3 px-10 rounded-xl">
          <Pause size={18} /> Stop
        </motion.button>
      )}
    </div>
  );
};

export default BreathingTool;
