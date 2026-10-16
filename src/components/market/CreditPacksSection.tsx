import { motion } from "framer-motion";
import { Zap, Sparkles, Star, Flame, ShoppingCart } from "lucide-react";
import ProductFacts from "./ProductFacts";
import { formatLocalPrice, type CreditPack } from "@/lib/creditEconomy";
import { savingsLabelVs, totalCredits, valueExampleLines } from "@/lib/marketValue";

type Props = {
  packs: CreditPack[];
  currency: string;
  loading: boolean;
  /** Omitted for under-18s (and for an unknown date of birth), because buying is adult-only. When it is absent the card shows the price — the cost of a credit should never be a mystery — but the buy button is visibly disabled and says why, instead of being a live-looking button that does nothing. */
  onAdd?: (pack: CreditPack) => void;
  /**
   * Direct two-tap purchase (confirm sheet → Buy now). The DEFAULT path for a
   * single pack: the basket used to be mandatory, and for one fungible pack it
   * is three surfaces to say "yes, buy this". Absent → the card falls back to
   * the basket exactly as before.
   */
  onBuy?: (pack: CreditPack) => void;
  /** Display-ready price in the athlete's currency (closed-test aware). */
  priceLabel?: (cents: number) => string;
};

export default function CreditPacksSection({ packs, currency, loading, onAdd, onBuy, priceLabel }: Props) {
  const canBuy = typeof onAdd === "function" || typeof onBuy === "function";
  const fmt = priceLabel ?? ((cents: number) => formatLocalPrice(cents, currency));
  // The ladder's entry price, for the honest "less per credit than Starter"
  // line on every larger pack. Measured against the displayed list, so a
  // regional tier's own pricing is what the saving is computed from.
  const starter = packs[0];
  if (loading) {
    return <div className="px-5 py-10 text-center text-xs text-muted-foreground">Loading credit packs…</div>;
  }

  return (
    <div className="px-5 space-y-3">
      {/* Friendly, low-friction intro — frames the purchase as adding to an existing journey, not starting one */}

      <p className="text-xs text-muted-foreground">
        Keep your training data growing. Credit packs are one‑off top‑ups that never expire and unlock every premium feature across Vaylo Sports.
      </p>

      {/* What credits DO, quoted from the real price table (FEATURE_COSTS).
          An abstract pack number ("25 credits") is not a decision; "a coach
          review costs 10" is. Derived from config, so the shop can never
          quote a price the charge path disagrees with. */}
      <div className="rounded-2xl border border-border bg-card/60 px-3.5 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">What credits buy</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {valueExampleLines().join(" · ")}
        </p>
      </div>

      {/* Highlight the value ladder with a subtle callout */}
      <div className="flex items-center gap-2 mb-2">
        <Star size={12} className="text-energy" />
        <span className="text-[11px] font-medium text-energy tracking-wider">Better value higher up — each larger pack costs less per credit</span>
      </div>

      {packs.map((pack, i) => {
        const total = totalCredits(pack);
        const perCredit = pack.price_cents / Math.max(1, total);
        const highlight = pack.popular || pack.best_value;
        const savings = i > 0 && starter ? savingsLabelVs(starter, pack, "credit") : null;
        return (
          <motion.div
            key={pack.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 + i * 0.05, type: "spring", stiffness: 210, damping: 24 }}
            className={`relative overflow-hidden rounded-3xl ${
              pack.popular
                ? "p-[1px] bg-primary/40"
                : pack.best_value
                ? "p-[1px] bg-energy/40"
                : "p-[1px] bg-border"
            }`}
          >
            {/* Badge that speaks for itself */}
            {highlight && (
              <span
                className={`absolute right-4 top-4 z-10 rounded-full border px-2.5 py-1 text-[12px] font-bold ${pack.popular ? "border-border bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"}`}
              >
                {pack.popular ? (
                  <>
                    <Star size={9} className="mr-1 inline" /> MOST POPULAR
                  </>
                ) : (
                  <>
                    <Flame size={9} className="mr-1 inline" /> BEST VALUE
                  </>
                )}
              </span>
            )}

            <div className="rounded-[22px] bg-card p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                  <Zap size={28} className="text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-3xl font-bold">{pack.credits}</span>
                    <span className="text-xs text-muted-foreground">credits</span>
                  </div>
                  {pack.bonus > 0 && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-energy/30 bg-energy/15 px-2 py-0.5">
                      <Sparkles size={10} className="text-energy" />
                      <span className="text-[12px] font-bold text-energy">+{pack.bonus} bonus</span>
                    </span>
                  )}
                  {pack.label && (
                    <p className="mt-1 text-[12px] uppercase tracking-wider text-muted-foreground">{pack.label}</p>
                  )}
                  {savings && (
                    <p className="mt-1 text-[12px] font-semibold text-energy">{savings}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-2xl font-bold text-foreground">{fmt(pack.price_cents)}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {formatLocalPrice(Math.round(perCredit * 100) / 100, currency)} / credit
                  </p>
                </div>
              </div>

              <ProductFacts
                receive={`${total} credits added instantly${pack.bonus > 0 ? ` (${pack.credits} + ${pack.bonus} bonus)` : ""}`}
                expires="Never expires"
                renews="One‑off purchase — nothing renews"
                lifetime="Credits stay in your balance until you spend them"
                designedFor="Athletes who want to top up only when they need to"
              />

              {canBuy ? (
                <>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => (onBuy ?? onAdd)?.(pack)}
                    className="mt-3 w-full rounded-2xl bg-primary py-3 font-bold text-primary-foreground shadow-sm"
                  >
                    {typeof onBuy === "function" ? (
                      <>Buy now · {fmt(pack.price_cents)}</>
                    ) : (
                      <>Add to basket · {fmt(pack.price_cents)}</>
                    )}
                  </motion.button>
                  {typeof onBuy === "function" && typeof onAdd === "function" && (
                    <button
                      type="button"
                      onClick={() => onAdd(pack)}
                      className="mt-1.5 flex w-full items-center justify-center gap-1.5 py-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ShoppingCart size={11} /> Add to basket instead
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  disabled
                  className="mt-3 w-full rounded-2xl bg-primary py-3 font-bold text-primary-foreground opacity-50 shadow-sm"
                >
                  <span className="text-muted-foreground">Purchases are 18+ only</span>
                </button>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}