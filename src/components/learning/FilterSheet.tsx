import { Button } from "@/components/ui/button";
import BottomSheet from "@/components/ui/bottom-sheet";
import { LEARNING_CATEGORIES, SPORTS } from "@/lib/learningContent";

export interface LearningFilters {
  category: string;
  difficulty: string;
  time: string;
  type: string;
}

export const DEFAULT_FILTERS: LearningFilters = { category: "All", difficulty: "All", time: "All", type: "All" };

const OPTIONS: Record<keyof LearningFilters, { label: string; values: string[] }> = {
  category: { label: "Topic", values: ["All", ...LEARNING_CATEGORIES.map((item) => item.id)] },
  difficulty: { label: "Difficulty", values: ["All", "Beginner", "Developing", "Intermediate", "Advanced"] },
  time: { label: "Reading time", values: ["All", "Quick", "Under 8 min"] },
  type: { label: "Content type", values: ["All", "Article", "Guide", "Quick Learn", "Technique", "Explainer"] },
};

/** Learning filters — mobile-first bottom sheet with a sticky Apply action. */
export function FilterSheet({
  open,
  filters,
  onClose,
  onChange,
}: {
  open: boolean;
  filters: LearningFilters;
  onClose: () => void;
  onChange: (next: LearningFilters) => void;
}) {
  const activeCount = Object.values(filters).filter((value) => value !== "All").length;
  void SPORTS;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      z="z-[60]"
      size="lg"
      title="Filter learning"
      headerRight={
        activeCount > 0 ? (
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_FILTERS })}
            className="mr-1 self-center text-xs font-semibold text-electric-purple"
          >
            Clear all
          </button>
        ) : undefined
      }
      footer={
        <Button className="w-full" onClick={onClose}>
          Show {activeCount ? "results" : "everything"}
        </Button>
      }
    >
      {(Object.keys(OPTIONS) as Array<keyof LearningFilters>).map((key) => (
        <div key={key} className="mb-5 last:mb-0">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{OPTIONS[key].label}</p>
          <div className="flex flex-wrap gap-2">
            {OPTIONS[key].values.map((value) => {
              const active = filters[key] === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onChange({ ...filters, [key]: value })}
                  aria-pressed={active}
                  className={`rounded-full px-3 py-2 text-xs font-semibold transition-colors ${
                    active ? "bg-electric-purple text-white" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </BottomSheet>
  );
}
