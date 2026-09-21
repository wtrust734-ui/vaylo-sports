import { useEffect, useState } from "react";
import { localDateKey } from "@/lib/dates";
import { motion } from "framer-motion";
import { Flame, Plus, Trash2, TrendingUp } from "lucide-react";
import { lsGet, lsSet } from "@/lib/localStore";
import { triggerMilestone } from "@/components/MilestoneCelebration";

interface PB {
  id: string;
  metric: string;
  value: number;
  unit: string;
  date: string;
  history: { date: string; value: number }[];
}

const KEY = "vaylo_pbs_v1";

const PBs = () => {
  const [pbs, setPbs] = useState<PB[]>([]);
  const [form, setForm] = useState({ metric: "", value: "", unit: "" });
  const [confetti, setConfetti] = useState(false);

  useEffect(() => { setPbs(lsGet(KEY, [])); }, []);
  const save = (l: PB[]) => { setPbs(l); lsSet(KEY, l); };

  const add = () => {
    if (!form.metric || !form.value) return;
    const existing = pbs.find(p => p.metric.toLowerCase() === form.metric.toLowerCase());
    const val = parseFloat(form.value);
    const today = localDateKey();
    if (existing) {
      const updated: PB = { ...existing, value: val, date: today, unit: form.unit || existing.unit,
        history: [...existing.history, { date: today, value: val }].slice(-30) };
      save(pbs.map(p => p.id === existing.id ? updated : p));
    } else {
      const np: PB = { id: crypto.randomUUID(), metric: form.metric, value: val, unit: form.unit, date: today,
        history: [{ date: today, value: val }] };
      save([np, ...pbs]);
      triggerMilestone("first_pb");
    }
    setForm({ metric: "", value: "", unit: "" });
    setConfetti(true); setTimeout(() => setConfetti(false), 1200);
  };

  const remove = (id: string) => save(pbs.filter(p => p.id !== id));

  return (
    <div className="min-h-screen bg-background pb-24">
      {confetti && (
        <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
          {Array.from({ length: 30 }).map((_, i) => (
            <motion.div key={i} initial={{ y: 0, x: 0, opacity: 1 }}
              animate={{ y: -200 - Math.random() * 200, x: (Math.random() - 0.5) * 400, opacity: 0 }}
              transition={{ duration: 1.2 }}
              className="absolute text-2xl">🎉</motion.div>
          ))}
        </div>
      )}
      <div className="px-5 pt-14 pb-4">
        <p className="text-[11px] uppercase tracking-widest text-energy font-semibold flex items-center gap-1.5"><Flame size={12} /> Records</p>
        <h1 className="text-2xl font-display font-bold mt-1">Personal Bests</h1>
        <p className="text-sm text-muted-foreground mt-1">Wall of records. Add manually or auto-detect from workouts.</p>
      </div>

      <div className="px-5 mb-5 bg-gradient-card border border-energy/30 rounded-2xl p-4">
        <p className="text-xs uppercase tracking-wider text-energy font-semibold mb-2 flex items-center gap-1.5"><Plus size={12} /> Log PB</p>
        <div className="grid grid-cols-3 gap-2">
          <input placeholder="Metric (e.g. 5K)" value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value })}
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Value" type="number" step="any" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })}
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Unit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm" />
        </div>
        <button onClick={add} className="w-full mt-2 bg-gradient-primary text-primary-foreground font-semibold py-2 rounded-lg text-sm shadow-glow">
          Save PB
        </button>
      </div>

      <div className="px-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {pbs.length === 0 && <p className="text-sm text-muted-foreground text-center py-8 col-span-2">No PBs yet — log your first record.</p>}
        {pbs.map(p => {
          const max = Math.max(...p.history.map(h => h.value));
          const min = Math.min(...p.history.map(h => h.value));
          const range = max - min || 1;
          const points = p.history.map((h, i) => `${(i / Math.max(p.history.length - 1, 1)) * 100},${100 - ((h.value - min) / range) * 100}`).join(" ");
          return (
            <motion.div key={p.id} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{p.metric}</p>
                  <p className="text-3xl font-display font-bold text-primary mt-1">{p.value}<span className="text-sm text-muted-foreground ml-1">{p.unit}</span></p>
                  <p className="text-[10px] text-muted-foreground mt-1">{new Date(p.date).toLocaleDateString()}</p>
                </div>
                <button onClick={() => remove(p.id)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded-lg"><Trash2 size={14} /></button>
              </div>
              <svg viewBox="0 0 100 100" className="w-full h-16 mt-3" preserveAspectRatio="none">
                <polyline fill="none" stroke="hsl(var(--primary))" strokeWidth="2" points={points} />
              </svg>
              <div className="flex items-center gap-1 text-[10px] text-success mt-1"><TrendingUp size={10} /> {p.history.length} entries</div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default PBs;
