import { useMemo, useState } from "react";
import { ArrowRightLeft, Check, Coins, Loader2, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import BottomSheet from "@/components/ui/bottom-sheet";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLocalPrice } from "@/hooks/useLocalPrice";
import { formatNumber } from "@/i18n/format";
import {
  purchaseItems,
  isPaymentsUnavailable,
  isFreeGrantUnavailable,
  PAYMENTS_UNAVAILABLE_MESSAGE,
  FREE_GRANT_UNAVAILABLE_MESSAGE,
} from "@/lib/billing";
import { freeCreditsActive, CLOSED_TESTING } from "@/config/closedTesting";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";
import { COINS_PER_CREDIT } from "@/config/coins";
import { planTopUp, type BundleOffer } from "@/lib/topUp";

interface Props {
  open: boolean;
  onClose: () => void;
  /** How many coins the athlete is short of. */
  gap: number;
  /** What they were trying to buy, for the copy. */
  itemName?: string;
  /** True when the one-time first-purchase bundle is still unused. */
  firstPurchaseAvailable?: boolean;
}

/**
 * A bundle price in the athlete's own currency — shared with the cosmetics
 * tab's quick buy (see @/hooks/useLocalPrice), which needs the same answer.
 */
const usePrice = useLocalPrice;

/**
 * Shown at the moment an athlete cannot afford a cosmetic. Sells the cheapest
 * bundle that closes the gap, mentions a better-value upgrade when there is one,
 * and offers converting credits as the alternative.
 */
export default function CoinTopUpSheet({
  open,
  onClose,
  gap,
  itemName,
  firstPurchaseAvailable = false,
}: Props) {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const price = usePrice(user?.id);

  const credits = profile?.credits ?? 0;
  const plan = useMemo(
    () => planTopUp(gap, credits, firstPurchaseAvailable),
    [gap, credits, firstPurchaseAvailable]
  );

  const buy = async (offer: BundleOffer) => {
    setBusy(offer.id);
    // Goes through the billing seam so store billing can replace web checkout
    // later without touching this screen. Same endpoint, same payload.
    const result = await purchaseItems([
      {
        product_id: offer.id,
        product_type: "coins",
        product_name: offer.label,
        price_cents: offer.price_cents,
      },
    ]);
    setBusy(null);
    if (!result.ok) {
      if (!result.cancelled) hapticWarning();
      if (isPaymentsUnavailable(result)) {
        toast({ title: "Top-ups aren't available yet", description: PAYMENTS_UNAVAILABLE_MESSAGE });
        onClose();
        return;
      }
      // Closed-test switch and server secret disagree — nothing was charged.
      if (isFreeGrantUnavailable(result)) {
        toast({ title: "Free coins aren't on yet", description: FREE_GRANT_UNAVAILABLE_MESSAGE });
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
      title: `${formatNumber(offer.total)} Coins added${wasFree ? " — free" : ""}`,
      description: wasFree
        ? `Nothing was charged — ${CLOSED_TESTING.label.toLowerCase()}.`
        : itemName ? `You can afford ${itemName} now.` : undefined,
    });
    onClose();
  };

  const convert = async () => {
    if (!plan.convertCredits) return;
    setBusy("convert");
    const { data, error } = await supabase.rpc("convert_credits_to_coins" as never, {
      p_credits: plan.convertCredits,
    } as never);
    setBusy(null);
    if (error) {
      hapticWarning();
      toast({ title: "Conversion failed", description: error.message, variant: "destructive" });
      return;
    }
    // Report what the server actually granted, not the gap we asked it to close.
    const awarded = (data as { awarded?: number } | null)?.awarded ?? gap;
    hapticSuccess();
    await refreshProfile();
    toast({ title: `Converted ${plan.convertCredits} credits → ${formatNumber(awarded)} Coins` });
    onClose();
  };

  const renderOffer = (offer: BundleOffer, highlight: "cheapest" | "upgrade") => (
    <button
      key={offer.id}
      type="button"
      onClick={() => buy(offer)}
      disabled={busy !== null}
      className={`w-full rounded-2xl border p-3.5 text-start transition-colors active:scale-[0.99] disabled:opacity-60 ${
        highlight === "cheapest"
          ? "border-energy/50 bg-energy/10"
          : "border-border bg-card/60 hover:border-energy/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <Coins size={15} className="text-energy shrink-0" />
        <span className="font-display text-sm font-bold">
          {formatNumber(offer.total)} Coins
        </span>
        {offer.bonus > 0 && (
          <span className="text-[12px] font-bold uppercase tracking-wider text-energy">
            incl. {formatNumber(offer.bonus)} bonus
          </span>
        )}
        {offer.first_purchase_only && (
          <span className="ml-auto rounded-full bg-primary/20 px-2 py-0.5 text-[12px] font-bold uppercase tracking-wider text-primary">
            One time
          </span>
        )}
        <span className={`${offer.first_purchase_only ? "" : "ml-auto"} text-sm font-bold tabular-nums`}>
          {freeCreditsActive()
            ? <><span className="text-success">Free</span> <s className="text-muted-foreground font-normal text-[12px]">{price(offer.price_cents)}</s></>
            : price(offer.price_cents)}
        </span>
      </div>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        {highlight === "cheapest"
          ? `Closes your ${formatNumber(gap)} Coin gap${
              offer.leftover > 0 ? ` with ${formatNumber(offer.leftover)} left over` : ""
            }.`
          : `Better value per Coin, and ${formatNumber(offer.total)} Coins to spend.`}
      </p>
    </button>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="md"
      leading={
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-energy/30 bg-energy/15">
          <Coins size={17} className="text-energy" />
        </div>
      }
      title={`${formatNumber(gap)} more Coins needed`}
      subtitle={itemName ? `${itemName} costs more Coins than you have.` : "Top up to unlock it now."}
    >
            <div className="space-y-2">
              {plan.cheapest ? (
                renderOffer(plan.cheapest, "cheapest")
              ) : (
                <p className="rounded-2xl border border-border bg-card/60 p-3.5 text-[12px] text-muted-foreground">
                  No bundle covers that gap yet — the Market has the full ladder.
                </p>
              )}
              {plan.upgrade && renderOffer(plan.upgrade, "upgrade")}
            </div>

            {plan.convertCredits !== null && (
              <button
                type="button"
                onClick={convert}
                disabled={busy !== null}
                className="mt-2 flex w-full items-center gap-2 rounded-2xl border border-border bg-card/60 p-3.5 text-start transition-colors hover:border-primary/40 disabled:opacity-60"
              >
                <ArrowRightLeft size={15} className="shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    Or convert {plan.convertCredits} credits
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    Instant — you have {formatNumber(credits)} credits (1 credit = {COINS_PER_CREDIT} Coins).
                  </p>
                </div>
                {busy === "convert" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Check size={15} className="text-muted-foreground" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                onClose();
                navigate("/market");
              }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              <Sparkles size={12} /> See all bundles in the Market
            </button>
    </BottomSheet>
  );
}
