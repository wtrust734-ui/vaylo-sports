// ============================================================================
// COACH PLAN CARD — one plan, priced by the server, buyable
// ----------------------------------------------------------------------------
// The only place in the app that buys a plan, so the Coaching tab and the
// Marketplace cannot drift into two different purchase flows.
//
// The two numbers on the card are labelled, and the labelling is the point:
//
//   "You pay £6.00"        the listing's price plus the platform fee
//   "£5.00 to the coach"   the price the coach set, exactly
//
// A single price with a footnote would leave a buyer unsure whether the coach
// sees the whole thing, and a coach unable to explain to a client what they
// charge. Both numbers come from `marketplace_quote()` on the server — the card
// never does the arithmetic itself.
//
// Buying is: check the wallet, top it up through Google Play if it is short, then
// spend. The top-up and the purchase are deliberately two separate presses. A
// button that buys credits and immediately spends them is one tap away from
// taking money somebody did not agree to spend on the plan they were looking at.
// ============================================================================

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, ShoppingBag, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatMinorUnits, type CoachPriceQuote } from "@/config/coachMarketplace";
import {
  buyCoachPlan,
  fetchCoachWallet,
  topUpCoachingCredits,
  type CoachCreditPack,
  type CoachPlan,
} from "@/lib/coachMarketplace";

const isUnavailable = (code?: string) =>
  code === "payments_not_available" || code === "store_unavailable" || code === "play_not_configured";

export default function CoachPlanCard({
  plan,
  coachName,
  onBought,
}: {
  plan: CoachPlan;
  coachName?: string | null;
  onBought?: () => void;
}) {
  const [quote, setQuote] = useState<CoachPriceQuote | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [packs, setPacks] = useState<CoachCreditPack[]>([]);
  const [showTopUp, setShowTopUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [topUpBusy, setTopUpBusy] = useState<string | null>(null);

  const refresh = async () => {
    const wallet = await fetchCoachWallet(plan.id);
    setBalance(wallet.balance_cents);
    setQuote(wallet.quote);
    setPacks(wallet.packs);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  const gross = quote?.grossCents ?? null;
  const short = gross !== null && balance !== null && balance < gross;

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    const result = await buyCoachPlan(plan.id);
    setBusy(false);

    if (!result.ok) {
      if (result.code === "insufficient_credits") {
        setShowTopUp(true);
        toast.info(result.error ?? "Add coaching credits to buy this plan.");
        return;
      }
      if (isUnavailable(result.code)) {
        toast.info(result.error ?? "This plan cannot be bought yet.");
        return;
      }
      toast.error(result.error ?? "That purchase could not be completed.");
      return;
    }

    if (result.balance_cents !== undefined) setBalance(result.balance_cents);
    if (result.reused) {
      toast.info("You had already bought this plan — nothing further was charged.");
    } else {
      toast.success(
        `Bought. ${formatMinorUnits(result.gross_cents ?? 0, plan.currency)} paid, ` +
          `${formatMinorUnits(result.net_cents ?? 0, plan.currency)} to the coach.`,
      );
    }
    onBought?.();
  };

  const topUp = async (pack: CoachCreditPack) => {
    if (topUpBusy) return;
    setTopUpBusy(pack.id);
    const result = await topUpCoachingCredits(pack.id);
    setTopUpBusy(null);

    if (!result.ok) {
      if (result.cancelled) return;
      if (isUnavailable(result.code)) {
        toast.info(result.error ?? "Coaching credits are not on sale yet.");
        return;
      }
      toast.error(result.error ?? "That top-up did not complete.");
      return;
    }
    setBalance(result.balance_cents ?? null);
    toast.success(
      `${formatMinorUnits(result.credited_cents ?? pack.credit_cents, pack.currency)} of coaching credits added.`,
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border border-border bg-card transition hover:border-primary/40"
    >
      <div className="p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-electric-purple">
          {plan.weeks ? `${plan.weeks}-week plan` : plan.category}
        </p>
        <h3 className="mt-1 line-clamp-1 font-semibold">{plan.title}</h3>
        {coachName && <p className="text-[12px] text-muted-foreground">with {coachName}</p>}
        {plan.description && (
          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{plan.description}</p>
        )}

        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="font-display text-lg font-bold">
              {gross !== null ? formatMinorUnits(gross, plan.currency) : "—"}
            </p>
            <p className="text-[12px] text-muted-foreground">
              {quote
                ? `${formatMinorUnits(quote.netCents, plan.currency)} to the coach`
                : "price loading…"}
            </p>
          </div>
          <div className="text-[12px] text-muted-foreground">
            {plan.sales_count} sold
            {plan.rating != null && plan.rating > 0 && (
              <span className="ml-2 inline-flex items-center gap-1">
                <Star className="h-3 w-3 text-energy" /> {plan.rating.toFixed(1)}
              </span>
            )}
          </div>
        </div>

        {balance !== null && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Your coaching credits: {formatMinorUnits(balance, plan.currency)}
          </p>
        )}

        <Button className="mt-3 w-full" disabled={busy} onClick={() => void buy()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buy this plan"}
        </Button>

        {short && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            You need a little more in coaching credits before you can buy this one.
          </p>
        )}

        <button
          type="button"
          onClick={() => setShowTopUp((open) => !open)}
          className="mt-2 w-full text-center text-[12px] text-muted-foreground underline"
        >
          {showTopUp ? "Hide coaching credits" : "Add coaching credits"}
        </button>
      </div>

      {showTopUp && (
        <div className="border-t border-border bg-muted/20 p-4">
          <p className="flex items-center gap-2 text-[12px] font-semibold">
            <ShoppingBag size={13} /> Coaching credits
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            One credit is one penny. Credits are bought through Google Play in the app, and are spent
            on a coach's plan at the price the coach set. They are not Vaylo credits and cannot be
            spent on AI features.
          </p>
          <div className="mt-3 space-y-2">
            {packs.map((pack) => (
              <div key={pack.id} className="flex items-center justify-between gap-2">
                <span className="text-sm">{formatMinorUnits(pack.price_cents, pack.currency)}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={topUpBusy !== null}
                  onClick={() => void topUp(pack)}
                >
                  {topUpBusy === pack.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
