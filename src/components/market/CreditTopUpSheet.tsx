import { useEffect, useMemo, useState } from "react";
import { Zap, Sparkles, X, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { purchaseItems } from "@/lib/billing";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";
import { formatLocalPrice } from "@/lib/creditEconomy";
import { useToast } from "@/hooks/use-toast";
import { planCreditTopUp, type CreditPackOffer } from "@/lib/creditTopUp";
import {
  completeTopUp,
  dismissTopUp,
  getTopUpState,
  subscribeTopUp,
} from "@/lib/topUpStore";

/**
 * The global credit top-up sheet — mounted once in the app shell.
 * Opens wherever code calls requestCreditTopUp(); closes with a resolved
 * outcome so the calling screen can retry the blocked action.
 */
const CreditTopUpSheet = () => {
  const { refreshProfile } = useAuth();
  const { toast } = useToast();
  const [, force] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [region, setRegion] = useState<{ currency: string }>({ currency: "USD" });

  useEffect(() => subscribeTopUp(() => force((n) => n + 1)), []);

  useEffect(() => {
    let alive = true;
    import("@/lib/creditEconomy").then(({ detectRegion }) =>
      detectRegion().then((r) => {
        if (alive) setRegion({ currency: r.currency });
      }).catch(() => { /* USD fallback */ })
    );
    return () => { alive = false; };
  }, []);

  const { open, request } = getTopUpState();
  const plan = useMemo(() => (open && request ? planCreditTopUp(request.shortfall) : null), [open, request]);

  if (!open || !request) return null;

  const buy = async (offer: CreditPackOffer) => {
    setBusyId(offer.id);
    const result = await purchaseItems([
      {
        product_id: offer.id,
        product_type: "credits",
        product_name: offer.label,
      },
    ]);
    setBusyId(null);
    if (!result.ok) {
      if (!result.cancelled) hapticWarning();
      toast({
        title: result.cancelled ? "Purchase cancelled" : "Purchase failed",
        description: result.cancelled ? undefined : result.error,
        variant: "destructive",
      });
      return;
    }
    hapticSuccess();
    await refreshProfile();
    toast({
      title: `+${offer.total.toLocaleString()} credits`,
      description: request.reasonLabel ? "Pick up right where you left off." : undefined,
    });
    completeTopUp(plan);
  };

  const renderOffer = (offer: CreditPackOffer, kind: "cheapest" | "upgrade") => (
    <motion.button
      key={offer.id}
      type="button"
      whileTap={{ scale: 0.98 }}
      onClick={() => void buy(offer)}
      disabled={busyId !== null}
      className={`w-full rounded-2xl border p-4 text-left transition-colors disabled:opacity-60 ${
        kind === "cheapest"
          ? "border-primary/50 bg-primary/10"
          : "border-border bg-card/60 hover:border-primary/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <Zap size={15} className="shrink-0 text-primary" />
        <span className="font-display text-sm font-bold">
          {offer.total.toLocaleString()} credits
        </span>
        {offer.bonus > 0 && (
          <span className="rounded-full bg-energy/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-energy">
            incl. {offer.bonus} bonus
          </span>
        )}
        {kind === "upgrade" && (
          <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
            Better value
          </span>
        )}
        <span className={`${kind === "upgrade" ? "" : "ml-auto"} text-sm font-bold tabular-nums`}>
          {formatLocalPrice(offer.price_cents, region.currency)}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {kind === "cheapest"
          ? `Covers your ${request.shortfall.toLocaleString()} credit gap${offer.leftover > 0 ? ` with ${offer.leftover.toLocaleString()} left over` : ""}.`
          : `${offer.total.toLocaleString()} credits to spend — more credits per dollar.`}
      </p>
    </motion.button>
  );

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
        onClick={() => dismissTopUp(plan)}
      >
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-t-3xl border border-white/[0.08] bg-card p-5 shadow-electric sm:rounded-3xl"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/15">
                <Zap size={18} className="text-primary" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold">
                  {request.shortfall.toLocaleString()} more credits needed
                </h3>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {request.reasonLabel
                    ? `Top up to finish: ${request.reasonLabel}.`
                    : "Top up now and pick up where you left off."}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismissTopUp(plan)}
              className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-2">
            {plan?.cheapest ? (
              renderOffer(plan.cheapest, "cheapest")
            ) : (
              <p className="rounded-2xl border border-border bg-card/60 p-3.5 text-[11px] text-muted-foreground">
                That gap is larger than any single pack — the Market has the full ladder.
              </p>
            )}
            {plan?.upgrade && renderOffer(plan.upgrade, "upgrade")}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
              <ShieldCheck size={12} className="text-emerald-400" />
              Price verified server-side at purchase
            </span>
            <a
              href="/market"
              className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:underline"
            >
              <Sparkles size={11} /> All packs
            </a>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default CreditTopUpSheet;
