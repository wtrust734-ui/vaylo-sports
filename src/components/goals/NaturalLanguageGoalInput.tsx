import { useState } from "react";
import { localDateKey } from "@/lib/dates";
import { Sparkles, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Parsed {
  title: string;
  metric_unit?: string;
  target_value?: number;
  start_value?: number;
  deadline?: string;
  category: string;
  milestones: { week: number; target: string }[];
}

// Lightweight regex parser. Works fully offline; deterministic.
const parse = (raw: string): Parsed => {
  const text = raw.toLowerCase().trim();
  // distance / time goals
  const distMatch = text.match(/(\d+(\.\d+)?)\s?(k|km|mile|miles|m)\b/);
  const timeMatch = text.match(/(\d+):(\d{2})|(\d+)\s?(min|minute|minutes|sec|s)\b/);
  const dateMatch = text.match(/by\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s?(\d{1,2})?/);
  const monthMap: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  let deadline: string | undefined;
  if (dateMatch) {
    const m = monthMap[dateMatch[1]];
    const now = new Date();
    const y = m < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear();
    deadline = localDateKey(new Date(y, m, dateMatch[2] ? parseInt(dateMatch[2]) : 15));
  }
  let target_value: number | undefined;
  let metric_unit: string | undefined;
  if (timeMatch) {
    if (timeMatch[1]) { target_value = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]); metric_unit = "seconds"; }
    else { target_value = parseInt(timeMatch[3]); metric_unit = timeMatch[4].startsWith("min") ? "minutes" : "seconds"; }
  } else if (distMatch) {
    target_value = parseFloat(distMatch[1]);
    metric_unit = distMatch[3].startsWith("m") && distMatch[3] !== "m" ? "mi" : (distMatch[3] === "m" ? "m" : "km");
  }
  const weeksToGo = deadline ? Math.max(1, Math.round((+new Date(deadline) - Date.now()) / (7 * 86400000))) : 8;
  const milestones = Array.from({ length: Math.min(weeksToGo, 8) }).map((_, i) => ({
    week: i + 1,
    target: `Build week ${i + 1}: progressive overload toward ${target_value ?? "target"}${metric_unit ? " " + metric_unit : ""}`,
  }));
  return {
    title: raw.trim(),
    metric_unit, target_value, start_value: 0, deadline,
    category: "performance",
    milestones,
  };
};

const NaturalLanguageGoalInput = ({ onCreated }: { onCreated?: () => void }) => {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [busy, setBusy] = useState(false);

  const handleParse = () => {
    if (!text.trim()) return;
    setParsed(parse(text));
  };

  const handleSave = async () => {
    if (!user || !parsed) return;
    setBusy(true);
    const { error } = await supabase.from("outcome_goals").insert({
      user_id: user.id,
      title: parsed.title,
      category: parsed.category,
      metric_unit: parsed.metric_unit,
      start_value: parsed.start_value ?? 0,
      target_value: parsed.target_value,
      current_value: parsed.start_value ?? 0,
      deadline: parsed.deadline,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Goal locked in with auto-plan.");
    setText(""); setParsed(null);
    onCreated?.();
  };

  return (
    <div className="mb-5 bg-gradient-card border border-electric-purple/30 rounded-2xl p-4">
      <p className="text-[11px] uppercase tracking-widest text-electric-purple font-semibold flex items-center gap-1.5">
        <Sparkles size={12} /> Natural Language Goal
      </p>
      <div className="flex gap-2 mt-2">
        <input value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleParse()}
          placeholder='e.g. "I want to run a 5k in under 25 minutes by July"'
          className="min-w-0 flex-1 bg-muted border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        <button onClick={handleParse} className="px-4 py-2.5 rounded-xl bg-gradient-primary text-primary-foreground font-semibold text-sm">Parse</button>
      </div>
      {parsed && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="mt-3 bg-background/40 border border-border rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <Chip label="Target" value={parsed.target_value ? `${parsed.target_value} ${parsed.metric_unit || ""}` : "—"} />
            <Chip label="Deadline" value={parsed.deadline || "—"} />
            <Chip label="Category" value={parsed.category} />
            <Chip label="Plan" value={`${parsed.milestones.length} weekly milestones`} />
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Auto-generated weekly plan</summary>
            <ul className="mt-2 space-y-1 ml-4 list-disc">
              {parsed.milestones.map(m => <li key={m.week}>Week {m.week}: {m.target}</li>)}
            </ul>
          </details>
          <button onClick={handleSave} disabled={busy}
            className="w-full bg-primary text-primary-foreground font-semibold py-2 rounded-lg text-sm flex items-center justify-center gap-2">
            {busy && <Loader2 size={14} className="animate-spin" />} Save Goal & Plan
          </button>
        </motion.div>
      )}
    </div>
  );
};

const Chip = ({ label, value }: { label: string; value: string }) => (
  <span className="px-2 py-1 rounded-md bg-muted border border-border">
    <span className="text-muted-foreground">{label}:</span> <span className="font-semibold text-foreground">{value}</span>
  </span>
);

export default NaturalLanguageGoalInput;
