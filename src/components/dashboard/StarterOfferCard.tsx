import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Zap, ShieldCheck, Timer, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";
import { formatLocalPrice } from "@/lib/creditEconomy";
import { useStarterOffer } from "@/hooks/useStarterOffer";

/**
 * The Welcome Bundle — a new athlete's first purchase moment, shown on the
 * dashboard only while the 72h window is open and only until it is claimed.
 * The price/grant displayed come from the special_offers row; the purchase is
 * enforced one-per-account server-side.
 */
const StarterOfferCard = () => {
  const { state, purchasing, purchase } = useStarterOffer();
  const { toast } = useToast();
  const [currency, setCurrency] = useState("USD");
  const [claimed, setClaimed] = useState(false);

  // Region price formatting only — the server charges its own stored price.
  useEffect(() => {
    let alive = true;
    import("@/lib/creditEconomy").then(({ detectRegion }) =>
      detectRegion().then((r) => {
        if (alive) setCurrency(r.currency);
      }).catch(() => { /* USD fallback */ })
    );
    return () => {
      alive = false;
    };
  }, []);

  if (claimed || state.status !== "eligible") return null;

  const { info, hoursLeft } = state;

  const buy = async () => {
    const result = await purchase();
    if (!result.ok) {
      hapticWarning();
      toast({
        title: result.alreadyClaimed ? "Already claimed" : "Couldn't complete the purchase",
        description: result.alreadyClaimed ? "The welcome bundle is one per account." : result.error,
        variant: "destructive",
      });
      return;
    }
    hapticSuccess();
    setClaimed(true);
    toast({
      title: `Welcome bundle claimed — +${result.creditsGranted.toLocaleString()} credits 🎉`,
      description: "Spend them on plans, analysis and coaching anywhere in the app.",
    });
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-4 sm:px-5 pb-5 sm:pb-6" aria-label="Welcome bundle"
    >
      <div className="relative overflow-hidden rounded-2xl p-[1.5px] bg-gradient-to-br from-primary via-electric-purple to-energy shadow-glow">
        <div className="rounded-[calc(1rem-1px)] bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 to-energy/20">
              <Zap size={20} className="text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-sm font-bold">{info.title}</h3>
                <span className="inline-flex items-center gap-1 rounded-full border border-energy/30 bg-energy/10 px-2 py-0.5 text-[10px] font-bold text-energy">
                  <Timer size={9} /> {Math.max(1, Math.ceil(hoursLeft))}h left
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {info.description ?? "New-athlete bundle — one per account."}
              </p>
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <ShieldCheck size={11} className="text-emerald-400" />
                One per account · price verified at checkout
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-display text-xl font-bold text-gradient-electric">
                {info.priceCents != null ? formatLocalPrice(info.priceCents, currency) : "—"}
              </p>
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => void buy()}
                disabled={purchasing}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-primary px-3.5 py-2 text-xs font-bold text-primary-foreground shadow-glow disabled:opacity-60"
              >
                {purchasing ? <Timer size={12} className="animate-pulse" /> : <Check size={12} />}
                {purchasing ? "Processing…" : "Claim"}
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
};

export default StarterOfferCard;
