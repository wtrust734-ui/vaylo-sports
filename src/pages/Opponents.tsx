import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Swords, Plus, Trash2, Link as LinkIcon, Check } from "lucide-react";
import { lsGet, lsSet } from "@/lib/localStore";

interface Opponent {
  id: string;
  name: string;
  team: string;
  sport: string;
  strengths: string;
  weaknesses: string;
  notes: string;
  media: string[];
  checklist: { id: string; text: string; done: boolean }[];
}

const KEY = "vaylo_opponents_v1";

const defaultChecklist = () => [
  { id: "1", text: "Review last 3 match footage", done: false },
  { id: "2", text: "Identify key threat player", done: false },
  { id: "3", text: "Plan set-piece response", done: false },
  { id: "4", text: "Visualise game plan", done: false },
];

const Opponents = () => {
  const [list, setList] = useState<Opponent[]>([]);
  const [editing, setEditing] = useState<Opponent | null>(null);

  useEffect(() => { setList(lsGet(KEY, [])); }, []);
  const save = (l: Opponent[]) => { setList(l); lsSet(KEY, l); };

  const create = () => {
    const o: Opponent = { id: crypto.randomUUID(), name: "New Opponent", team: "", sport: "", strengths: "", weaknesses: "", notes: "", media: [], checklist: defaultChecklist() };
    save([o, ...list]); setEditing(o);
  };
  const update = (o: Opponent) => { save(list.map(x => x.id === o.id ? o : x)); setEditing(o); };
  const remove = (id: string) => { save(list.filter(o => o.id !== id)); setEditing(null); };

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-14 pb-4 flex items-start justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-destructive font-semibold flex items-center gap-1.5"><Swords size={12} /> Scouting</p>
          <h1 className="text-2xl font-display font-bold mt-1">Opponents</h1>
          <p className="text-sm text-muted-foreground mt-1">Build dossiers. Walk in prepared.</p>
        </div>
        <button onClick={create} className="bg-gradient-primary text-primary-foreground font-semibold px-3 py-2 rounded-lg text-xs flex items-center gap-1 shadow-glow">
          <Plus size={14} /> New
        </button>
      </div>

      <div className="px-5 grid sm:grid-cols-2 gap-3">
        {list.length === 0 && <p className="text-sm text-muted-foreground text-center py-8 col-span-2">No opponent dossiers yet.</p>}
        {list.map(o => (
          <motion.button key={o.id} onClick={() => setEditing(o)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="text-left bg-card border border-border rounded-2xl p-4 hover:border-destructive/30">
            <p className="text-[11px] text-muted-foreground">{o.team || "—"}</p>
            <h3 className="font-display font-bold">{o.name}</h3>
            <p className="text-xs text-muted-foreground mt-1">{o.sport || "—"}</p>
            <div className="text-[10px] text-success mt-2">{o.checklist.filter(c => c.done).length}/{o.checklist.length} prep done</div>
          </motion.button>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur p-4 overflow-y-auto" onClick={() => setEditing(null)}>
          <motion.div initial={{ y: 20 }} animate={{ y: 0 }} onClick={e => e.stopPropagation()}
            className="max-w-lg mx-auto bg-card border border-border rounded-2xl p-5 space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-xs uppercase tracking-wider text-primary font-semibold">Dossier</p>
              <button onClick={() => remove(editing.id)} className="text-destructive"><Trash2 size={14} /></button>
            </div>
            <input value={editing.name} onChange={e => update({ ...editing, name: e.target.value })} placeholder="Opponent name"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <input value={editing.team} onChange={e => update({ ...editing, team: e.target.value })} placeholder="Team / club"
                className="bg-muted border border-border rounded-lg px-3 py-2 text-sm" />
              <input value={editing.sport} onChange={e => update({ ...editing, sport: e.target.value })} placeholder="Sport"
                className="bg-muted border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <textarea value={editing.strengths} onChange={e => update({ ...editing, strengths: e.target.value })} placeholder="Strengths"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm" rows={2} />
            <textarea value={editing.weaknesses} onChange={e => update({ ...editing, weaknesses: e.target.value })} placeholder="Weaknesses"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm" rows={2} />
            <textarea value={editing.notes} onChange={e => update({ ...editing, notes: e.target.value })} placeholder="Free-text notes"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm" rows={3} />
            <div>
              <p className="text-xs font-semibold mb-1 flex items-center gap-1"><LinkIcon size={12} /> Video / image links</p>
              {editing.media.map((m, i) => (
                <div key={i} className="flex gap-2 mb-1">
                  <input value={m} onChange={e => { const nm = [...editing.media]; nm[i] = e.target.value; update({ ...editing, media: nm }); }}
                    className="flex-1 bg-muted border border-border rounded-lg px-3 py-1.5 text-xs" />
                  <button onClick={() => update({ ...editing, media: editing.media.filter((_, j) => j !== i) })} className="text-destructive text-xs">×</button>
                </div>
              ))}
              <button onClick={() => update({ ...editing, media: [...editing.media, ""] })} className="text-xs text-primary">+ Add link</button>
            </div>
            <div>
              <p className="text-xs font-semibold mb-1">Pre-competition checklist</p>
              {editing.checklist.map(c => (
                <button key={c.id} onClick={() => update({ ...editing, checklist: editing.checklist.map(x => x.id === c.id ? { ...x, done: !x.done } : x) })}
                  className={`w-full flex items-center gap-2 text-xs p-2 rounded-lg border mb-1 ${c.done ? "bg-success/10 border-success/30 line-through" : "bg-muted border-border"}`}>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${c.done ? "bg-success border-success" : "border-border"}`}>
                    {c.done && <Check size={10} className="text-success-foreground" />}
                  </div>
                  {c.text}
                </button>
              ))}
            </div>
            <button onClick={() => setEditing(null)} className="w-full bg-primary text-primary-foreground font-semibold py-2 rounded-lg text-sm">Done</button>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default Opponents;
