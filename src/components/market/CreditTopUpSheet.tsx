import { useEffect, useMemo, useState } from "react";
import { Zap, Sparkles, X, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { appHref } from "@/lib/routerBase";
import {
  purchaseItems,
  isPaymentsUnavailable,
  isFreeGrantUnavailable,
  PAYMENTS_UNAVAILABLE_MESSAGE,
  FREE_GRANT_UNAVAILABLE_MESSAGE,
} from "@/lib/billing";
import { freeCreditsActive, CLOSED_TESTING } from "@/config/closedTesting";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";
import { formatLocalPrice } from "@/lib/creditEconomy";
import { useDisplayCurrency } from "@/hooks/useDisplayCurrency";
import { formatNumber } from "@/i18n/format";
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
  const currency = useDisplayCurrency();

  useEffect(() => subscribeTopUp(() => force((n) => n + 1)), []);

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
      // No payment provider yet is not a failure of this sheet, and saying
      // "Purchase failed" over the top of a gap the athlete was trying to close
      // is the worst version of this screen.
      if (isPaymentsUnavailable(result)) {
        toast({ title: "Top-ups aren't available yet", description: PAYMENTS_UNAVAILABLE_MESSAGE });
        completeTopUp(null);
        return;
      }
      // Closed-test switch and server secret disagree — nothing was charged.
      // The athlete is left in the sheet so they can retry once it is on.
      if (isFreeGrantUnavailable(result)) {
        toast({ title: "Free credits aren't on yet", description: FREE_GRANT_UNAVAILABLE_MESSAGE });
        return;
      }
      toast({
        title: result.cancelled ? "Purchase cancelled" : "Purchase failed",
        description: result.cancelled ? undefined : result.error,
        variant: "destructive",
      });
      return;
    }
    hapticSuccess();
    await refreshProfile();
    const wasFree = result.data?.free === true;
    toast({
      title: `+${formatNumber(offer.total)} credits${wasFree ? " — free" : ""}`,
      description: wasFree
        ? `Nothing was charged — ${CLOSED_TESTING.label.toLowerCase()}. Pick up right where you left off.`
        : request.reasonLabel ? "Pick up right where you left off." : undefined,
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
          {formatNumber(offer.total)} credits
        </span>
        {offer.bonus > 0 && (
          <span className="rounded-full bg-energy/15 px-2 py-0.5 text-[12px] font-bold uppercase tracking-wider text-energy">
            incl. {offer.bonus} bonus
          </span>
        )}
        {kind === "upgrade" && (
          <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[12px] font-bold uppercase tracking-wider text-primary">
            Better value
          </span>
        )}
        <span className={`${kind === "upgrade" ? "" : "ml-auto"} text-sm font-bold tabular-nums`}>
          {freeCreditsActive()
            ? <><span className="text-success">Free</span> <s className="text-muted-foreground font-normal text-[12px]">{formatLocalPrice(offer.price_cents, currency)}</s></>
            : formatLocalPrice(offer.price_cents, currency)}
        </span>
      </div>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        {kind === "cheapest"
          ? `Covers your ${formatNumber(request.shortfall)} credit gap${offer.leftover > 0 ? ` with ${formatNumber(offer.leftover)} left over` : ""}.`
          // Not "per dollar": the price above is in the athlete's own currency,
          // so naming one currency under it is wrong for everyone else. The
          // rate is what is actually better here, not the denomination.
          : `${formatNumber(offer.total)} credits to spend — a better rate per credit.`}
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
          // A bottom sheet on phones, so the buy button needs the home inset —
          // `p-5` alone left it under the gesture bar.
          className="w-full max-w-md rounded-t-3xl border border-white/[0.08] bg-card p-5 pb-[max(1.25rem,var(--vaylo-inset-bottom))] shadow-electric sm:rounded-3xl"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/15">
                <Zap size={18} className="text-primary" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold">
                  {formatNumber(request.shortfall)} more credits needed
                </h3>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
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
              <p className="rounded-2xl border border-border bg-card/60 p-3.5 text-[12px] text-muted-foreground">
                That gap is larger than any single pack — the Market has the full ladder.
              </p>
            )}
            {plan?.upgrade && renderOffer(plan.upgrade, "upgrade")}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
              <ShieldCheck size={12} className="text-emerald-400" />
              {freeCreditsActive() ? CLOSED_TESTING.label : "Price verified server-side at purchase"}
            </span>
            <a
              href={appHref("/market")}
              className="inline-flex items-center gap-1 text-[12px] font-bold uppercase tracking-wider text-primary hover:underline"
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
