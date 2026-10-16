import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import BottomSheet from "@/components/ui/bottom-sheet";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  FREE_GRANT_UNAVAILABLE_MESSAGE,
  PAYMENTS_UNAVAILABLE_MESSAGE,
  isFreeGrantUnavailable,
  isPaymentsUnavailable,
  purchaseItems,
} from "@/lib/billing";
import { CLOSED_TESTING } from "@/config/closedTesting";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";

// ============================================================================
// PURCHASE CONFIRM SHEET — the two-tap buy for anything in the Market
// ----------------------------------------------------------------------------
// The Market used to route every single item through the basket: tap "Add to
// basket", watch a panel open, press "Checkout". For a fungible digital pack
// that is three surfaces to say one thing — "yes, buy this" — and every extra
// step is a place to change your mind. This sheet is the short version the
// cosmetics tab already proved out: tap Buy → see exactly what you get and
// what it costs → "Buy now". The basket remains for anyone who wants a cart;
// this is the default path for a single pack.
//
// The purchase still runs through lib/billing's seam (process-purchase now,
// Play Billing later) — this sheet only shortens the walk, never the checks.
// ============================================================================

export interface ConfirmablePurchase {
  productId: string;
  productType: "credits" | "coins" | "offer";
  /** Display name, e.g. "Popular pack" or "920 Coins". */
  name: string;
  /** What lands after purchase, e.g. "+165 credits added instantly". */
  getsLine: string;
  /** Display-ready price, already formatted in the athlete's currency and run
   *  through priceLabelFor by the caller (the Market owns currency + closed-test
   *  labelling; the sheet must never format money itself). */
  priceLabel: string;
  /** USD cents for the wire payload — display only; the server re-reads the
   *  authoritative price from its own tables (process-purchase). */
  priceCents: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  item: ConfirmablePurchase | null;
  /** Called after a successful purchase, for analytics/refresh wiring. */
  onPurchased?: (item: ConfirmablePurchase) => void;
}

export default function PurchaseConfirmSheet({ open, onClose, item, onPurchased }: Props) {
  const { refreshProfile } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  // A sheet left open across a selection change must not keep the old item's
  // spinner state.
  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  const close = () => {
    setBusy(false);
    onClose();
  };

  const buy = async () => {
    if (!item || busy) return;
    setBusy(true);
    // Through the billing seam — same endpoint, same payload as the basket.
    const result = await purchaseItems([
      {
        product_id: item.productId,
        product_type: item.productType,
        product_name: item.name,
        price_cents: item.priceCents,
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
      title: wasFree ? "Added — free during closed testing" : "Purchase complete! 🎉",
      description: wasFree
        ? `Nothing was charged — ${CLOSED_TESTING.label.toLowerCase()}.`
        : item.getsLine,
    });
    if (onPurchased) onPurchased(item);
    close();
  };

  return (
    <BottomSheet
      open={open}
      onClose={close}
      size="md"
      title={item ? "Are you sure you want to buy?" : "Buy"}
      subtitle={item ? item.name : undefined}
    >
      {item && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-primary/40 bg-primary/10 p-4 text-center">
            <p className="font-display text-2xl font-black">{item.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{item.getsLine}</p>
            <p className="mt-3 font-display text-xl font-bold tabular-nums">
              {item.priceLabel}
            </p>
          </div>

          <button
            type="button"
            onClick={buy}
            disabled={busy}
            className="w-full rounded-2xl bg-primary py-3 text-sm font-black uppercase tracking-wider text-primary-foreground shadow-sm active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="mx-auto animate-spin" /> : "Buy now"}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-border bg-card/60 py-2.5 text-[12px] font-bold uppercase tracking-wider text-muted-foreground disabled:opacity-60"
          >
            <ArrowLeft size={13} /> Not now
          </button>

          <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck size={11} /> Never expires · nothing renews
          </p>
        </div>
      )}
    </BottomSheet>
  );
}
