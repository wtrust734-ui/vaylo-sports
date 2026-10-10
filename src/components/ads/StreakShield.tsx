import { useEffect, useRef, useState } from "react";
import { localDateKey, localDateKeyDaysAgo } from "@/lib/dates";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { spendCredits, creditCost, spendErrorMessage } from "@/lib/credits";
import { useSpendWithTopUp } from "@/hooks/useSpendWithTopUp";


const DISMISS_KEY = "vaylo_shield_dismissed_date";
const SHIELD_KEY = "vaylo_shield_active_until";

/**
 * Detects when the user is at risk of losing their daily streak (no recovery log
 * or workout logged today after 6pm local) and offers a Streak Shield for credits.
 */
const StreakShield = () => {
  const { user, profile, refreshProfile } = useAuth();
  const [show, setShow] = useState(false);
  const [buying, setBuying] = useState(false);
  const [atRisk, setAtRisk] = useState(false);
  const spendWithTopUp = useSpendWithTopUp();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user) return;
    const todayStr = localDateKey();
    if (localStorage.getItem(DISMISS_KEY) === todayStr) return;
    if (localStorage.getItem(SHIELD_KEY) === todayStr) return;

    (async () => {
      const hour = new Date().getHours();
      if (hour < 18) return;
      const [{ data: recent }, { data: todayLog }] = await Promise.all([
        supabase.from("recovery_logs").select("log_date").eq("user_id", user.id)
          .gte("log_date", localDateKeyDaysAgo(7))
          .order("log_date", { ascending: false }).limit(7),
        supabase.from("recovery_logs").select("id").eq("user_id", user.id).eq("log_date", todayStr).maybeSingle(),
      ]);
      const hasHistory = (recent?.length ?? 0) >= 2;
      if (hasHistory && !todayLog) {
        setAtRisk(true);
        setTimeout(() => setShow(true), 4000);
      }
    })();
  }, [user]);

  const dismiss = () => {
    setShow(false);
    localStorage.setItem(DISMISS_KEY, localDateKey());
  };

  const buyShield = async () => {
    if (!user) return;
    setBuying(true);
    const todayKey = localDateKey();
    // Insufficient credits open the top-up sheet; a purchase retries the same
    // idempotent spend, so the shield still lands with one tap.
    const spend = await spendWithTopUp("streak_shield", { idempotencyKey: `shield:${user.id}:${todayKey}` });
    setBuying(false);
    if (!spend.success) { if (spend.dismissedTopUp) toast.error(spendErrorMessage("streak_shield", spend)); return; }
    localStorage.setItem(SHIELD_KEY, localDateKey());
    await refreshProfile?.();
    toast.success("🛡️ Streak Shield activated — your streak is safe for today.");
    setShow(false);
  };

  /**
   * A modal has to behave like one. It has a `role` and an `aria-modal` now, so
   * it also needs the two things those attributes promise: Escape closes it, and
   * focus starts inside it and goes back where it came from. Before this the
   * only way out was a mouse — the 18px X was the one control on offer.
   */
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
    // Deliberately `[show]` only: `dismiss` is re-created every render, and
    // re-running this on each render would re-steal focus. The directive that
    // used to sit here was suppressing a warning the rule does not actually
    // raise for this effect, which the lint run pointed out.
  }, [show]);

  if (!atRisk || !show) return null;
  const SHIELD_COST = creditCost("streak_shield");
  const canAfford = (profile?.credits ?? 0) >= SHIELD_COST;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[65] bg-black/75 backdrop-blur-sm flex items-center justify-center px-6">
        <motion.div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="streak-shield-title" initial={{ scale: 0.85, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.85, y: 20 }}
          className="bg-card border border-energy/40 rounded-2xl p-6 max-w-sm w-full shadow-electric relative">
          {/* 44px, and named: it was an 18px square with no accessible name,
              which a screen reader announced as just "button". */}
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="absolute end-2 top-2 flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground active:opacity-70"
          >
            <X size={18} aria-hidden />
          </button>
          <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
            className="w-16 h-16 rounded-2xl bg-energy/15 border border-energy/30 flex items-center justify-center mx-auto mb-4">
            <Flame size={32} className="text-energy" />
          </motion.div>
          <h3 id="streak-shield-title" className="font-display font-bold text-xl text-center">Your streak is in danger</h3>
          <p className="text-sm text-muted-foreground text-center mt-1.5">
            You haven't logged anything today. Use a <span className="text-energy font-semibold">Streak Shield</span> to protect tonight's streak.
          </p>
          <div className="mt-4 p-3 rounded-xl bg-energy/10 border border-energy/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-energy" />
              <span className="text-sm font-semibold">Streak Shield</span>
            </div>
            <span className="text-sm font-display font-bold">{SHIELD_COST} credits</span>
          </div>
          <motion.button whileTap={{ scale: 0.97 }} disabled={buying} onClick={buyShield}
            className="w-full mt-4 bg-gradient-to-r from-energy to-energy/70 text-background font-bold py-3 rounded-xl shadow-glow disabled:opacity-50">
            {buying ? "Activating…" : canAfford ? "Protect my streak" : `Top up ${SHIELD_COST - (profile?.credits ?? 0)} credits & protect`}
          </motion.button>
          <button onClick={dismiss} className="w-full text-xs text-muted-foreground mt-2">Let it break</button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default StreakShield;
