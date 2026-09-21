import { motion } from "framer-motion";
import { Zap, Lock, Sparkles } from "lucide-react";
import { FEATURE_COSTS, FEATURE_LABELS, PERMANENT_UNLOCKS, type FeatureCostKey } from "@/config/credits";

/**
 * Browsable reference of what credits unlock. Purely informational — unlocking
 * still happens inside each feature, so the shop stays uncluttered.
 */
export default function CreditCostsList({ costs }: { costs?: Partial<Record<FeatureCostKey, number>> }) {
  const cost = (k: FeatureCostKey) => costs?.[k] ?? FEATURE_COSTS[k];
  const keys = Object.keys(FEATURE_COSTS) as FeatureCostKey[];
  const unlocks = keys.filter((k) => PERMANENT_UNLOCKS.includes(k));
  const perUse = keys.filter((k) => !PERMANENT_UNLOCKS.includes(k));

  const Row = ({ k }: { k: FeatureCostKey }) => (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0">
      <span className="min-w-0 truncate text-xs text-foreground/85">{FEATURE_LABELS[k]}</span>
      <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-primary">
        <Zap size={11} /> {cost(k)}
      </span>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="rounded-2xl border border-border bg-gradient-card p-4"
    >
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-primary" />
        <h4 className="font-display text-sm font-bold">What credits unlock</h4>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Credits never expire. You unlock each feature from inside its own tab.
      </p>

      <div className="mt-3">
        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <Lock size={10} /> One-off unlocks — yours forever
        </p>
        {unlocks.map((k) => <Row key={k} k={k} />)}
      </div>

      <div className="mt-4">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Per use
        </p>
        {perUse.map((k) => <Row key={k} k={k} />)}
      </div>
    </motion.div>
  );
}
