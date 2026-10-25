import { Sparkles } from "lucide-react";
import { featureLabel, creditCost, type FeatureCostKey } from "@/lib/credits";
import { useRecommendedUnlock } from "@/hooks/useRecommendedUnlock";

/**
 * "Picked for you" — one line of merchandising driven by the athlete's sport
 * family: endurance sees the AI calorie scan, skill/strength see video form
 * analysis, combat sees the Mental Gym, team sees Injury Management. Hidden
 * entirely when there's no signal (unknown sport) or the recommendation isn't
 * a priced feature.
 *
 * It carries a credit price and no currency: the credit cost is what the unlock
 * actually asks for, and the old branch that formatted a local price compared
 * the result against "$0.00" to decide which of its two identical arms to take.
 */
const FamilyPickBanner = () => {
  const rec = useRecommendedUnlock();

  if (!rec) return null;
  const label = featureLabel(rec.feature as FeatureCostKey);
  const price = creditCost(rec.feature as FeatureCostKey, 1);

  return (
    <div className="mx-5 mb-4 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
        <Sparkles size={15} className="text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Picked for you</p>
        <p className="truncate text-sm font-semibold">{label}</p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{rec.why}</p>
      </div>
      <span className="shrink-0 rounded-xl bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">
        {price} credits
      </span>
    </div>
  );
};

export default FamilyPickBanner;
