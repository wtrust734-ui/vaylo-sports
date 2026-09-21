import { useState } from "react";
import { motion } from "framer-motion";
import { Heart, Zap, Check } from "lucide-react";
import { lsGet, lsSet, isoDate } from "@/lib/localStore";

interface Entry { date: string; mood: number; energy: number }
const KEY = "vaylo_mood_energy_v1";
const MOODS = ["😞", "😕", "😐", "🙂", "😄"];

export const getMoodEnergy = () => lsGet<Entry[]>(KEY, []);

const MoodEnergyWidget = () => {
  const today = isoDate();
  const all = getMoodEnergy();
  const existing = all.find(e => e.date === today);
  const [mood, setMood] = useState(existing?.mood ?? 3);
  const [energy, setEnergy] = useState(existing?.energy ?? 6);
  const [saved, setSaved] = useState(!!existing);

  const save = () => {
    const next = [{ date: today, mood, energy }, ...all.filter(e => e.date !== today)].slice(0, 180);
    lsSet(KEY, next);
    setSaved(true);
  };

  const lowFlag = mood <= 2 || energy <= 3;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="mx-5 mb-4 bg-card border border-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-primary font-semibold flex items-center gap-1.5">
            <Heart size={11} /> Daily Check-In
          </p>
          <h3 className="font-display font-bold text-lg mt-0.5">How are you today?</h3>
        </div>
        {saved && <Check className="text-success" size={20} />}
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Mood</p>
          <div className="flex justify-between gap-1">
            {MOODS.map((m, i) => (
              <button key={i} onClick={() => { setMood(i + 1); setSaved(false); }}
                className={`flex-1 text-2xl py-2 rounded-xl border ${mood === i + 1 ? "border-primary bg-primary/10" : "border-border bg-muted"}`}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Zap size={11} /> Energy {energy}/10</p>
          <input type="range" min={1} max={10} value={energy} onChange={e => { setEnergy(Number(e.target.value)); setSaved(false); }}
            className="w-full accent-primary" />
        </div>
        {lowFlag && (
          <div className="text-xs bg-warning/10 border border-warning/30 text-warning rounded-xl p-2.5">
            Low readings detected. We'll suggest a recovery-leaning session for today.
          </div>
        )}
        {!saved && (
          <button onClick={save} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl text-sm">
            Log Check-In
          </button>
        )}
      </div>
    </motion.div>
  );
};

export default MoodEnergyWidget;
