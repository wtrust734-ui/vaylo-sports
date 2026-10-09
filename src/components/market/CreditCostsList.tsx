import { motion } from "framer-motion";
import { Zap, Lock, Sparkles, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { creditCost } from "@/lib/credits";
import { FEATURE_LABELS } from "@/config/credits";
import { UNLOCK_CATALOG, PER_USE_ROUTES } from "@/config/unlocks";

/**
 * What credits buy — and the way to buy it.
 *
 * This used to be a list of prices with no actions at all: six one-off unlocks
 * and every per-use feature, priced, inert. An athlete read "Cross-Sport
 * Analysis 15", tapped it, and nothing happened — because nothing was wired.
 * A price that leads nowhere is worse than no price: it teaches the athlete the
 * shop is broken.
 *
 * So every row here does something now:
 *
 *   * one-off unlocks open the Unlocks tab, where the purchase actually happens
 *     (one purchase path, not two — see UnlocksSection for why);
 *   * per-use features open the screen that spends them, and only keys with a
 *     real screen are listed (PER_USE_ROUTES in src/config/unlocks.ts).
 *
 * Prices come from creditCost(), which merges the remote `economy_config`
 * overrides, so the number shown is the number the server will charge.
 */
export default function CreditCostsList({ onOpenUnlocks }: { onOpenUnlocks?: () => void }) {
  const navigate = useNavigate();

  const Row = ({
    label,
    price,
    actionLabel,
    onClick,
  }: {
    label: string;
    price: number;
    actionLabel: string;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 border-b border-border/60 py-2 text-start last:border-0 active:opacity-70"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-foreground/85">{label}</span>
        <span className="text-[11px] text-muted-foreground">{actionLabel}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-primary">
        <Zap size={11} /> {price}
        <ChevronRight size={12} className="text-muted-foreground" />
      </span>
    </button>
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
      <p className="mt-1 text-[12px] text-muted-foreground">
        Credits never expire. Tap anything below to go and buy it.
      </p>

      <div className="mt-3">
        <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-muted-foreground">
          <Lock size={10} /> One-off unlocks — yours forever
        </p>
        {UNLOCK_CATALOG.map((entry) => (
          <Row
            key={entry.product}
            label={entry.label}
            price={creditCost(entry.costKey)}
            actionLabel="Buy in Unlocks"
            onClick={() => (onOpenUnlocks ? onOpenUnlocks() : navigate("/market"))}
          />
        ))}
      </div>

      <div className="mt-4">
        <p className="mb-1 text-[12px] font-bold uppercase tracking-wider text-muted-foreground">
          Per use
        </p>
        {PER_USE_ROUTES.map(({ key, route, routeLabel }) => (
          <Row
            key={key}
            label={FEATURE_LABELS[key]}
            price={creditCost(key)}
            actionLabel={`Spend it in ${routeLabel}`}
            onClick={() => navigate(route)}
          />
        ))}
      </div>
    </motion.div>
  );
}
