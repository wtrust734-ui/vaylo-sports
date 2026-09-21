import { motion } from "framer-motion";
import { Coins, Infinity as InfinityIcon, CalendarClock, Crown, RefreshCw } from "lucide-react";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { isStoreBilling, restorePurchases } from "@/lib/billing";

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const STATUS_LABEL: Record<string, string> = {
  free: "Free",
  trial: "Trial",
  active: "Renewing",
  cancelled: "Cancelled",
  expired: "Expired",
};

export default function AccountSubscriptionCard({ compact = false }: { compact?: boolean }) {
  const { entitlements, isActive, hasUnlimitedCredits, isLifetime, claimRefill, cancel, loading } =
    useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const isFree = !isActive || entitlements.plan_key === "free";
  // Both stores require a visible restore path for builds that sell IAP. It only
  // renders once store billing is switched on (never in the web build), because
  // there is nothing to restore until purchases come from the store.
  const canRestore = isStoreBilling();

  const restore = async () => {
    setBusy(true);
    const result = await restorePurchases();
    setBusy(false);
    if (result.ok) {
      toast({
        title: "Restore requested",
        description: "Anything you've already bought will be re-applied to your account.",
      });
    } else {
      toast({ title: "Couldn't restore purchases", description: result.error, variant: "destructive" });
    }
  };

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: ok });
    } catch (e: any) {
      toast({ title: "Something went wrong", description: e?.message, variant: "destructive" });
    }
    setBusy(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Current plan</p>
          <div className="flex items-center gap-2 mt-1">
            {hasUnlimitedCredits ? (
              <InfinityIcon className="h-5 w-5 text-electric-purple" />
            ) : (
              <Coins className="h-5 w-5 text-energy" />
            )}
            <h3 className="text-xl font-bold">{loading ? "…" : entitlements.plan_label}</h3>
            {isLifetime && (
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide bg-electric-purple/15 text-electric-purple px-2 py-0.5 rounded-full">
                <Crown className="h-3 w-3" /> Lifetime
              </span>
            )}
          </div>
        </div>
        {!isFree && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-muted px-2 py-1 rounded-full">
            {isLifetime ? "Owned" : STATUS_LABEL[entitlements.status] || entitlements.status}
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-muted/40 p-3">
          <p className="text-[11px] text-muted-foreground">Credit balance</p>
          <p className="text-lg font-bold">
            {hasUnlimitedCredits ? "Unlimited" : entitlements.credits}
          </p>
        </div>
        {entitlements.monthly_credit_allowance > 0 && (
          <div className="rounded-2xl bg-muted/40 p-3">
            <p className="text-[11px] text-muted-foreground">Monthly allowance</p>
            <p className="text-lg font-bold">{entitlements.monthly_credit_allowance}</p>
          </div>
        )}
        {entitlements.monthly_credit_allowance > 0 && (
          <div className="rounded-2xl bg-muted/40 p-3">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> Next refill
            </p>
            <p className="text-sm font-semibold">{fmtDate(entitlements.next_refill_at)}</p>
          </div>
        )}
        {!isLifetime && !isFree && (
          <div className="rounded-2xl bg-muted/40 p-3">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              {entitlements.cancel_at_period_end ? "Access until" : "Renews"}
            </p>
            <p className="text-sm font-semibold">
              {fmtDate(entitlements.renews_at || entitlements.expires_at)}
            </p>
          </div>
        )}
      </div>

      {!compact && (
        <div className="mt-4 flex flex-wrap gap-2">
          {isFree ? (
            <Button className="flex-1 h-10" onClick={() => navigate("/subscription")}>
              See plans
            </Button>
          ) : (
            <>
              {entitlements.monthly_credit_allowance > 0 && (
                <Button
                  variant="outline"
                  className="flex-1 h-10"
                  disabled={busy}
                  onClick={() => run(claimRefill, "Credit refill checked")}
                >
                  Check refill
                </Button>
              )}
              {!isLifetime && !entitlements.cancel_at_period_end && (
                <Button
                  variant="ghost"
                  className="h-10 text-muted-foreground"
                  disabled={busy}
                  onClick={() => run(cancel, "Subscription cancelled")}
                >
                  Cancel plan
                </Button>
              )}
            </>
          )}
          {canRestore && (
            <Button
              variant="ghost"
              className="h-10 text-muted-foreground"
              disabled={busy}
              onClick={restore}
            >
              Restore purchases
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
}
