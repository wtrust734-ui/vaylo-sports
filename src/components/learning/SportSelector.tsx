import { motion } from "framer-motion";
import { Apple, Brain, Crosshair, Dumbbell, Footprints, Map, Moon, ShieldCheck, Zap, type LucideIcon } from "lucide-react";
import { LEARNING_CATEGORIES, LESSONS, SPORTS, categoryFor } from "@/lib/learningContent";

const ICONS: Record<string, LucideIcon> = { Crosshair, Dumbbell, Zap, Moon, Apple, Brain, ShieldCheck, Map, Footprints };

/** Horizontal-scrolling (mobile) / wrapped (desktop) sport selector chips. */
export function SportSelector({ selected, onSelect }: { selected: string; onSelect: (sport: string) => void }) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {SPORTS.map((sport) => {
        const active = sport === selected;
        return (
          <button
            key={sport}
            onClick={() => onSelect(sport)}
            aria-pressed={active}
            className={`press shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
              active
                ? "bg-electric-purple text-white shadow-glow-primary"
                : "border border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {sport}
          </button>
        );
      })}
    </div>
  );
}

/** Nine topic cards with icon, description and live article counts. */
export function CategoryGrid({ counts, onSelect }: { counts: Record<string, number>; onSelect: (categoryId: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {LEARNING_CATEGORIES.map((category, index) => {
        const Icon = ICONS[category.icon] ?? Dumbbell;
        const count = counts[category.id] ?? 0;
        return (
          <motion.button
            key={category.id}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: index * 0.03, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onSelect(category.id)}
            className="press min-h-40 rounded-2xl border border-border bg-card/70 p-4 text-start transition-colors hover:border-electric-purple/50"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-electric-purple/10">
              <Icon size={18} className="text-electric-purple" />
            </span>
            <h2 className="mt-4 text-sm font-bold">{category.label}</h2>
            <p className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">{category.description}</p>
            <span className="mt-3 block text-[11px] font-semibold text-electric-purple">{count || "New"} lessons</span>
          </motion.button>
        );
      })}
    </div>
  );
}

/** Compute per-category article counts (legacy categories mapped). */
export const buildCategoryCounts = (): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const lesson of LESSONS) {
    const category = categoryFor(lesson);
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
};
