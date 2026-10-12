import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, ListChecks } from "lucide-react";
import {
  CHECKLIST_ITEMS,
  CHECKLIST_TOTAL,
  checklistCount,
  isChecklistComplete,
  nextChecklistItem,
  readChecklist,
  writeChecklist,
} from "@/lib/eventMode";
import { hapticTap } from "@/lib/haptics";

/**
 * The six things that have to be true before a start line.
 *
 * Ticks are written straight back to the day's key, so a phone that is locked in
 * a bag between events reopens with the same list. A new calendar day starts
 * empty (eventMode.checklistKey), because a checklist carried over from
 * yesterday is a checklist nobody believes.
 */
const EventChecklist = () => {
  const [ticks, setTicks] = useState<Record<string, boolean>>(() => readChecklist());
  useEffect(() => { writeChecklist(ticks); }, [ticks]);

  const done = checklistCount(ticks);
  const complete = isChecklistComplete(ticks);
  const nextItem = nextChecklistItem(ticks);

  const toggle = (id: string) => {
    hapticTap();
    setTicks((prev) => {
      const updated = { ...prev };
      if (updated[id]) delete updated[id];
      else updated[id] = true;
      return updated;
    });
  };

  return (
    <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <ListChecks size={16} className="text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">Before you start</h2>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            complete ? "bg-emerald-500/10 text-emerald-300" : "bg-primary/10 text-primary"
          }`}
        >
          {done} of {CHECKLIST_TOTAL} ready
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {nextItem ? `Next: ${nextItem.label}` : "Everything is ready — go and compete."}
      </p>

      <ul className="mt-3 space-y-1.5">
        {CHECKLIST_ITEMS.map((item) => {
          const ticked = !!ticks[item.id];
          return (
            <li key={item.id}>
              <motion.button
                type="button"
                whileTap={{ scale: 0.99 }}
                aria-pressed={ticked}
                onClick={() => toggle(item.id)}
                className={`flex min-h-11 w-full items-start gap-3 rounded-xl border p-2.5 text-left transition-colors ${
                  ticked ? "border-primary/40 bg-primary/10" : "border-border bg-background hover:border-primary/30"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${
                    ticked ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent"
                  }`}
                  aria-hidden
                >
                  <Check size={13} />
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-semibold ${ticked ? "text-primary" : ""}`}>{item.label}</span>
                  <span className="block text-[11px] leading-tight text-muted-foreground">{item.hint}</span>
                </span>
              </motion.button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default EventChecklist;
