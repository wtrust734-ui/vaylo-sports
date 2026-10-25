import { useEffect, useState } from "react";
import { localDateKey } from "@/lib/dates";
import { motion } from "framer-motion";
import { Flame, Plus, Sparkles, Trash2, TrendingUp } from "lucide-react";
import { lsGet, lsSet } from "@/lib/localStore";
import { formatShortDate } from "@/i18n/format";
import { parsePbText, formatPbValue, type ParsedPb } from "@/lib/pbEntry";
import PersonalBestCard, { type PersonalBestCardData } from "@/components/PersonalBestCard";
import { Textarea } from "@/components/ui/textarea";

interface PB {
  id: string;
  metric: string;
  value: number;
  unit: string;
  date: string;
  history: { date: string; value: number }[];
}

const KEY = "vaylo_pbs_v1";

/**
 * PERSONAL BESTS — say what you did, and the wall works out the rest.
 *
 * This page used to ask for three fields (metric / value / unit), which is a
 * form for somebody who already knows how the app stores a record. The athlete
 * knows the sentence — "5K in 22:14", "bench press 120 kg", "20 pull ups" — so
 * that is what they type. src/lib/pbEntry.ts parses it, and the card below is
 * what a genuine improvement earns.
 */
const PBs = () => {
  const [pbs, setPbs] = useState<PB[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [card, setCard] = useState<PersonalBestCardData | null>(null);

  useEffect(() => { setPbs(lsGet(KEY, [])); }, []);
  const save = (list: PB[]) => { setPbs(list); lsSet(KEY, list); };

  const preview: ParsedPb | null = text.trim() ? parsePbText(text) : null;

  const add = () => {
    const parsed = parsePbText(text);
    if (!parsed) {
      setError("We couldn't read that. Try \"5K in 22:14\", \"bench press 120 kg\" or \"20 pull ups\".");
      return;
    }

    const existing = pbs.find((p) => p.metric.toLowerCase() === parsed.metric.toLowerCase());
    const today = localDateKey();

    if (existing) {
      const better = parsed.lowerIsBetter ? parsed.value < existing.value : parsed.value > existing.value;
      if (!better) {
        setError(
          `Not a new best — your ${existing.metric} PB is ${formatPbValue(existing)}. ` +
          `A ${parsed.lowerIsBetter ? "faster" : "higher"} effort is what replaces it.`,
        );
        return;
      }

      const updated: PB = {
        ...existing,
        value: parsed.value,
        unit: parsed.unit,
        date: today,
        history: [...existing.history, { date: today, value: parsed.value }].slice(-30),
      };
      save(pbs.map((p) => (p.id === existing.id ? updated : p)));
      setCard({
        metric: existing.metric,
        display: parsed.display,
        date: formatShortDate(`${today}T00:00:00`),
        previousDisplay: formatPbValue(existing),
      });
    } else {
      const entry: PB = {
        id: crypto.randomUUID(),
        metric: parsed.metric,
        value: parsed.value,
        unit: parsed.unit,
        date: today,
        history: [{ date: today, value: parsed.value }],
      };
      save([entry, ...pbs]);
      setCard({
        metric: parsed.metric,
        display: parsed.display,
        date: formatShortDate(`${today}T00:00:00`),
        previousDisplay: null,
      });
    }

    setText("");
    setError("");
  };

  const remove = (id: string) => save(pbs.filter((p) => p.id !== id));

  return (
    <div className="min-h-screen bg-background pb-24">
      {card && <PersonalBestCard card={card} onClose={() => setCard(null)} />}

      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <p className="text-[12px] uppercase tracking-widest text-energy font-semibold flex items-center gap-1.5"><Flame size={12} /> Records</p>
        <h1 className="text-2xl font-display font-bold mt-1">Personal Bests</h1>
        <p className="text-sm text-muted-foreground mt-1">Wall of records. Say what you did and we'll work out the rest.</p>
      </div>

      <div className="px-5 mb-5 bg-gradient-card border border-energy/30 rounded-2xl p-4">
        <label htmlFor="pb-text" className="text-xs uppercase tracking-wider text-energy font-semibold mb-2 flex items-center gap-1.5">
          <Plus size={12} /> What was your PB?
        </label>
        <Textarea
          id="pb-text"
          rows={2}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError("");
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") add();
          }}
          placeholder={'Say it how you would: "5K in 22:14", "bench press 120 kg", "20 pull ups"'}
          className="min-h-[76px] text-[15px]"
          aria-describedby="pb-hint"
        />
        <p id="pb-hint" className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Any sport, any measure — a distance and a clock, a weight, a jump, reps. We'll read the sentence and store the best.
        </p>

        {preview && (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
            <Sparkles size={13} className="shrink-0 text-primary" />
            <span className="min-w-0 truncate text-muted-foreground">
              We read <strong className="text-foreground">{preview.metric}</strong> · <strong className="text-primary">{preview.display}</strong>
            </span>
          </div>
        )}

        {error && <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">{error}</p>}

        <button
          type="button"
          onClick={add}
          disabled={!text.trim()}
          className="w-full mt-3 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl text-sm shadow-glow disabled:opacity-50"
        >
          Save PB
        </button>
      </div>

      <div className="px-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {pbs.length === 0 && <p className="text-sm text-muted-foreground text-center py-8 col-span-2">No PBs yet — log your first record.</p>}
        {pbs.map((p) => {
          const max = Math.max(...p.history.map((h) => h.value));
          const min = Math.min(...p.history.map((h) => h.value));
          const range = max - min || 1;
          const points = p.history.map((h, i) => `${(i / Math.max(p.history.length - 1, 1)) * 100},${100 - ((h.value - min) / range) * 100}`).join(" ");
          return (
            <motion.div key={p.id} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] uppercase tracking-wider text-muted-foreground truncate">{p.metric}</p>
                  <p className="text-3xl font-display font-bold text-primary mt-1 break-words">
                    {formatPbValue(p)}
                  </p>
                  {/* `p.date` is a bare day key, and `new Date("2026-10-05")`
                      parses as UTC midnight — which west of UTC renders as the
                      previous day. A personal best is dated the day it happened
                      where it happened, so the local-midnight form is used. */}
                  <p className="text-[12px] text-muted-foreground mt-1">{formatShortDate(`${p.date}T00:00:00`)}</p>
                </div>
                <button onClick={() => remove(p.id)} aria-label={`Remove ${p.metric} PB`} className="p-1.5 text-destructive hover:bg-destructive/10 rounded-lg"><Trash2 size={14} /></button>
              </div>
              <svg viewBox="0 0 100 100" className="w-full h-16 mt-3" preserveAspectRatio="none" aria-hidden>
                <polyline fill="none" stroke="hsl(var(--primary))" strokeWidth="2" points={points} />
              </svg>
              <div className="flex items-center gap-1 text-[12px] text-success mt-1"><TrendingUp size={10} /> {p.history.length} entries</div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default PBs;
