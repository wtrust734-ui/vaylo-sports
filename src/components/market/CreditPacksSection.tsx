import { motion } from "framer-motion";
import { Zap, Sparkles, Star, Flame } from "lucide-react";
import ProductFacts from "./ProductFacts";
import { formatLocalPrice, type CreditPack } from "@/lib/creditEconomy";

type Props = {
  packs: CreditPack[];
  currency: string;
  loading: boolean;
  onAdd: (pack: CreditPack) => void;
};

export default function CreditPacksSection({ packs, currency, loading, onAdd }: Props) {
  if (loading) {
    return <div className="px-5 py-10 text-center text-xs text-muted-foreground">Loading credit packs…</div>;
  }

  return (
    <div className="px-5 space-y-3">
      <p className="text-xs text-muted-foreground">
        A one-off top-up of credits. Buy as many as you like — nothing renews and nothing expires.
      </p>

      {packs.map((pack, i) => {
        const total = pack.credits + (pack.bonus || 0);
        const perCredit = pack.price_cents / Math.max(1, total);
        const highlight = pack.popular || pack.best_value;
        return (
          <motion.div
            key={pack.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 + i * 0.05, type: "spring", stiffness: 210, damping: 24 }}
            className={`relative overflow-hidden rounded-3xl ${
              pack.popular
                ? "p-[1.5px] bg-gradient-to-br from-primary via-electric-purple to-primary shadow-glow"
                : pack.best_value
                ? "p-[1.5px] bg-gradient-to-br from-energy via-electric-purple to-primary"
                : "p-[1px] bg-border"
            }`}
          >
            {highlight && (
              <span
                className={`absolute right-4 top-4 z-10 rounded-full px-2.5 py-1 text-[9px] font-bold text-primary-foreground ${
                  pack.popular ? "bg-gradient-primary shadow-glow" : "bg-gradient-to-r from-energy to-electric-purple"
                }`}
              >
                {pack.popular ? (
                  <><Star size={9} className="mr-1 inline" /> MOST POPULAR</>
                ) : (
                  <><Flame size={9} className="mr-1 inline" /> BEST VALUE</>
                )}
              </span>
            )}

            <div className="rounded-[22px] bg-card p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-electric-purple/15">
                  <Zap size={28} className="text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-3xl font-bold">{pack.credits}</span>
                    <span className="text-xs text-muted-foreground">credits</span>
                  </div>
                  {pack.bonus > 0 && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-energy/30 bg-gradient-to-r from-energy/25 to-electric-purple/25 px-2 py-0.5">
                      <Sparkles size={10} className="text-energy" />
                      <span className="text-[11px] font-bold text-energy">+{pack.bonus} bonus</span>
                    </span>
                  )}
                  {pack.label && (
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{pack.label}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-2xl font-bold text-gradient-electric">
                    {formatLocalPrice(pack.price_cents, currency)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatLocalPrice(Math.round(perCredit * 100) / 100, currency)} / credit
                  </p>
                </div>
              </div>

              <ProductFacts
                receive={`${total} credits added instantly${pack.bonus > 0 ? ` (${pack.credits} + ${pack.bonus} bonus)` : ""}`}
                expires="Never expires"
                renews="One-off purchase — nothing renews"
                lifetime="Credits stay in your balance until you spend them"
                designedFor="Athletes who want to top up only when they need to"
              />

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => onAdd(pack)}
                className="mt-3 w-full rounded-2xl bg-gradient-primary py-3 font-bold text-primary-foreground shadow-glow"
              >
                Add to basket · {formatLocalPrice(pack.price_cents, currency)}
              </motion.button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
