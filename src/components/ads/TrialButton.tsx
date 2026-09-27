import { useState } from "react";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";

/**
 * One-tap 7-day Unlimited trial for the paywall.
 *
 * The moment of desire (a locked feature) is exactly when a "no commitment"
 * offer converts. grant_unlimited_trial() enforces one-trial-per-account
 * server-side; on success the subscription context refreshes and the paywall
 * simply closes on the unlocked feature.
 */
export default function TrialButton({
  className = "",
  onSuccess,
  onError,
}: {
  className?: string;
  onSuccess?: () => void;
  onError?: (msg: string) => void;
}) {
  const { session } = useAuth();
  const { refresh, isActive, isLifetime } = useSubscription();
  const [busy, setBusy] = useState(false);

  // Already on any plan/trial — nothing to offer.
  if (!session || isActive || isLifetime) return null;

  const start = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("grant_unlimited_trial" as never, { p_days: 7 } as never);
    setBusy(false);
    const res = (data ?? null) as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) {
      const code = res?.error ?? error?.message ?? "trial_failed";
      const msg =
        code === "already_subscribed" ? "You already have a plan."
        : code === "trial_already_used" ? "You've already used your free trial."
        : "Couldn't start the trial. Please try again.";
      onError?.(msg);
      return;
    }
    await refresh();
    onSuccess?.();
  };

  return (
    <button
      onClick={start}
      disabled={busy}
      className={`w-full flex items-center justify-center gap-2 rounded-2xl border border-energy/50 bg-energy/10 py-3 text-sm font-bold text-energy transition-opacity hover:bg-energy/20 disabled:opacity-60 ${className}`}
    >
      <Sparkles className="h-4 w-4" />
      {busy ? "Starting…" : "Try Unlimited free for 7 days"}
    </button>
  );
}
