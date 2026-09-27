import { Sparkles } from "lucide-react";
import { featureLabel, creditCost, type FeatureCostKey } from "@/lib/credits";
import { useRecommendedUnlock } from "@/hooks/useRecommendedUnlock";
import { formatLocalPrice } from "@/lib/creditEconomy";
import { useEffect, useState } from "react";

/**
 * "Picked for you" — one line of merchandising driven by the athlete's sport
 * family: endurance sees the Nutrition Pack, skill/strength see Form Analysis,
 * combat sees the Mental Gym, team sees Injury Management. Hidden entirely when
 * there's no signal (unknown sport) or the recommendation isn't a priced feature.
 */
const FamilyPickBanner = ({ currency = "USD" }: { currency?: string }) => {
  const rec = useRecommendedUnlock();
  const [cost, setCost] = useState<number | null>(null);

  useEffect(() => {
    if (!rec) return;
    // Costs are remote-configurable; creditCost() reads the merged cache.
    void import("@/lib/credits").then(({ loadFeatureCosts }) =>
      loadFeatureCosts().then((all) => {
        const c = all[rec.feature as FeatureCostKey];
        if (typeof c === "number") setCost(c);
      }).catch(() => { /* banner still renders without the price */ })
    );
  }, [rec]);

  if (!rec) return null;
  const label = featureLabel(rec.feature as FeatureCostKey);
  const price = creditCost(rec.feature as FeatureCostKey, 1);

  return (
    <div className="mx-5 mb-4 flex items-center gap-3 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
        <Sparkles size={15} className="text-primary-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wider text-primary">Picked for you</p>
        <p className="truncate text-sm font-semibold">{label}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{rec.why}</p>
      </div>
      <span className="shrink-0 rounded-xl bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">
        {cost != null ? `${price} credits` : formatLocalPrice(0, currency) === "$0.00" ? `${price} credits` : `${price} credits`}
      </span>
    </div>
  );
};

export default FamilyPickBanner;
