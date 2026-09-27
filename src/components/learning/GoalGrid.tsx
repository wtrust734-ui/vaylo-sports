import { motion } from "framer-motion";
import { Target } from "lucide-react";
import { LEARNING_GOALS } from "@/lib/learningContent";

/** Learn-by-goal selector cards; selecting one reveals matched content below. */
export function GoalGrid({ selected, onSelect }: { selected: string | null; onSelect: (goalId: string | null) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {LEARNING_GOALS.map((goal, index) => {
        const active = goal.id === selected;
        return (
          <motion.button
            key={goal.id}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: index * 0.03, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(active ? null : goal.id)}
            aria-pressed={active}
            className={`press rounded-2xl border p-5 text-start transition-colors ${
              active ? "border-electric-purple bg-electric-purple/10" : "border-border bg-card hover:border-electric-purple/40"
            }`}
          >
            <span className={`grid h-9 w-9 place-items-center rounded-xl ${active ? "bg-electric-purple text-white" : "bg-electric-purple/10 text-electric-purple"}`}>
              <Target size={17} />
            </span>
            <h3 className="mt-4 font-bold">{goal.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{goal.description}</p>
          </motion.button>
        );
      })}
    </div>
  );
}
