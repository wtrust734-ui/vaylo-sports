import { UserRound } from "lucide-react";
import HumanCoaches from "@/components/coach/HumanCoaches";
import ProductFacts from "./ProductFacts";
import { formatLocalPrice } from "@/lib/creditEconomy";

export const COACH_SESSION_PRICES = { 30: 4500, 60: 8000 } as const;

/** Human coaching is deliberately kept separate from credits and subscriptions. */
export default function CoachingSection({ currency = "USD" }: { currency?: string }) {
  return (
    <div className="px-5 space-y-3">
      <div className="rounded-2xl border border-border bg-gradient-card p-4">
        <div className="flex items-center gap-2">
          <UserRound size={16} className="text-primary" />
          <h4 className="font-display text-sm font-bold">Human Coaching</h4>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Live one-to-one video sessions with a real coach. Paid per session — credits are never used here.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-border bg-muted/20 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">30 minutes</p>
            <p className="font-display text-xl font-bold text-gradient-electric">
              {formatLocalPrice(COACH_SESSION_PRICES[30], currency)}
            </p>
            <p className="text-[10px] text-muted-foreground">focused review</p>
          </div>
          <div className="rounded-2xl border border-primary/50 bg-primary/5 p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">60 minutes</p>
            <p className="font-display text-xl font-bold text-gradient-electric">
              {formatLocalPrice(COACH_SESSION_PRICES[60], currency)}
            </p>
            <p className="text-[10px] text-muted-foreground">full session</p>
          </div>
        </div>
        <ProductFacts
          receive="A scheduled live video session with the coach you pick"
          expires="Your booking applies to that session only"
          renews="Never renews — you book each session yourself"
          lifetime="No — coaching is booked session by session"
          designedFor="Athletes who want human feedback alongside the AI coach"
        />
      </div>

      <HumanCoaches currency={currency} />
    </div>
  );
}
