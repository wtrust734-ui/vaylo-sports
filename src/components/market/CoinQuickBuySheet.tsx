import { useState } from "react";
import { ArrowLeft, Coins, Loader2 } from "lucide-react";
import BottomSheet from "@/components/ui/bottom-sheet";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useLocalPrice } from "@/hooks/useLocalPrice";
import { formatNumber } from "@/i18n/format";
import {
  isFreeGrantUnavailable,
  isPaymentsUnavailable,
  priceLabelFor,
  FREE_GRANT_UNAVAILABLE_MESSAGE,
  PAYMENTS_UNAVAILABLE_MESSAGE,
  purchaseItems,
} from "@/lib/billing";
import { CLOSED_TESTING, freeCreditsActive } from "@/config/closedTesting";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";
import { COIN_BUNDLES, FIRST_PURCHASE_BUNDLE, type CoinBundleConfig } from "@/config/coins";

// ============================================================================
// COIN QUICK BUY — buy coins from wherever the athlete is standing
// ----------------------------------------------------------------------------
// The Market exists and keeps its full ladder, but the moment an athlete is
// mid-cosmetic and short on coins, sending them to another tab through a
// basket is a detour that loses the sale. This sheet is the two-tap version
// the cosmetics tab asked for: pick a bundle, confirm ("Are you sure you want
// to buy?"), press Buy now — coins land, no basket, no navigation.
//
// The purchase itself still runs through lib/billing's seam (process-purchase,
// Play Billing later without touching this file), so nothing here invents a
// second payment path — only a shorter walk to the same one.
// ============================================================================

interface Props {
  open: boolean;
  onClose: () => void;
  /** True while the one-time first-purchase bundle is still unused. */
  firstPurchaseAvailable?: boolean;
}

export default function CoinQuickBuySheet({ open, onClose, firstPurchaseAvailable = false }: Props) {
  const { user, refreshProfile } = useAuth();
  const { toast } = useToast();
  const price = useLocalPrice(user?.id);
  const [selected, setSelected] = useState<CoinBundleConfig | null>(null);
  const [busy, setBusy] = useState(false);

  const bundles: CoinBundleConfig[] = firstPurchaseAvailable
    ? [FIRST_PURCHASE_BUNDLE, ...COIN_BUNDLES]
    : COIN_BUNDLES;
  const total = selected ? selected.coins + selected.bonus : 0;

  const close = () => {
    setSelected(null);
    onClose();
  };

  const buy = async () => {
    if (!selected || busy) return;
    setBusy(true);
    const result = await purchaseItems([
      {
        product_id: selected.id,
        product_type: "coins",
        product_name: selected.label,
        price_cents: selected.price_cents,
      },
    ]);
    setBusy(false);
    if (!result.ok) {
      if (!result.cancelled) hapticWarning();
      if (isPaymentsUnavailable(result)) {
        toast({ title: "Purchases aren't available yet", description: PAYMENTS_UNAVAILABLE_MESSAGE });
        close();
        return;
      }
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
      title: `${formatNumber(total)} Coins added${wasFree ? " — free" : ""}`,
      description: wasFree ? `Nothing was charged — ${CLOSED_TESTING.label.toLowerCase()}.` : undefined,
    });
    close();
  };

  return (
    <BottomSheet
      open={open}
      onClose={close}
      size="md"
      leading={
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-energy/30 bg-energy/15">
          <Coins size={17} className="text-energy" />
        </div>
      }
      title={selected ? "Are you sure you want to buy?" : "Buy Coins"}
      subtitle={
        selected
          ? `${formatNumber(total)} Coins for ${priceLabelFor(price(selected.price_cents))}.`
          : "Coins are yours instantly — no basket, no detour."
      }
    >
      {selected === null ? (
        <div className="space-y-2">
          {bundles.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelected(b)}
              disabled={busy}
              className="w-full rounded-2xl border border-border bg-card/60 p-3.5 text-start transition-colors hover:border-energy/40 active:scale-[0.99] disabled:opacity-60"
            >
              <div className="flex items-center gap-2">
                <Coins size={15} className="text-energy shrink-0" />
                <span className="font-display text-sm font-bold">
                  {formatNumber(b.coins + b.bonus)} Coins
                </span>
                {b.bonus > 0 && (
                  <span className="text-[12px] font-bold uppercase tracking-wider text-energy">
                    incl. {formatNumber(b.bonus)} bonus
                  </span>
                )}
                {b.id === FIRST_PURCHASE_BUNDLE.id && (
                  <span className="ml-auto rounded-full bg-primary/20 px-2 py-0.5 text-[12px] font-bold uppercase tracking-wider text-primary">
                    One time
                  </span>
                )}
                <span className={`${b.id === FIRST_PURCHASE_BUNDLE.id ? "" : "ml-auto"} text-sm font-bold tabular-nums`}>
                  {freeCreditsActive() ? (
                    <>
                      <span className="text-success">Free</span>{" "}
                      <s className="text-muted-foreground font-normal text-[12px]">{price(b.price_cents)}</s>
                    </>
                  ) : (
                    price(b.price_cents)
                  )}
                </span>
              </div>
              {b.best_value && (
                <p className="mt-1 text-[12px] text-muted-foreground">Best value per Coin.</p>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-2xl border border-energy/40 bg-energy/10 p-4 text-center">
            <Coins size={26} className="mx-auto text-energy" />
            <p className="mt-2 font-display text-2xl font-black tabular-nums">
              {formatNumber(total)}
            </p>
            <p className="text-[12px] font-bold uppercase tracking-wider text-energy">Coins</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {priceLabelFor(price(selected.price_cents))}
              {selected.bonus > 0 ? ` · includes ${formatNumber(selected.bonus)} bonus` : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={buy}
            disabled={busy}
            className="w-full rounded-2xl bg-gradient-electric py-3 text-sm font-black uppercase tracking-wider text-white shadow-glow-electric active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="mx-auto animate-spin" /> : "Buy now"}
          </button>
          <button
            type="button"
            onClick={() => setSelected(null)}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-border bg-card/60 py-2.5 text-[12px] font-bold uppercase tracking-wider text-muted-foreground disabled:opacity-60"
          >
            <ArrowLeft size={13} /> Not now
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
