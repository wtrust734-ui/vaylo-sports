import { useEffect, useState } from "react";
import { localDateKey, localDateKeyDaysAgo } from "@/lib/dates";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { spendCredits, creditCost, spendErrorMessage } from "@/lib/credits";


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
    const spend = await spendCredits("streak_shield", { idempotencyKey: `shield:${user.id}:${todayKey}` });
    setBuying(false);
    if (!spend.success) { toast.error(spendErrorMessage("streak_shield", spend)); return; }
    localStorage.setItem(SHIELD_KEY, localDateKey());
    await refreshProfile?.();
    toast.success("🛡️ Streak Shield activated — your streak is safe for today.");
    setShow(false);
  };

  if (!atRisk || !show) return null;
  const SHIELD_COST = creditCost("streak_shield");
  const canAfford = (profile?.credits ?? 0) >= SHIELD_COST;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[65] bg-black/75 backdrop-blur-sm flex items-center justify-center px-6">
        <motion.div initial={{ scale: 0.85, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.85, y: 20 }}
          className="bg-card border border-energy/40 rounded-2xl p-6 max-w-sm w-full shadow-electric relative">
          <button onClick={dismiss} className="absolute top-3 right-3 text-muted-foreground"><X size={18} /></button>
          <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 1.4, repeat: Infinity }}
            className="w-16 h-16 rounded-2xl bg-energy/15 border border-energy/30 flex items-center justify-center mx-auto mb-4">
            <Flame size={32} className="text-energy" />
          </motion.div>
          <h3 className="font-display font-bold text-xl text-center">Your streak is in danger</h3>
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
          <motion.button whileTap={{ scale: 0.97 }} disabled={buying || !canAfford} onClick={buyShield}
            className="w-full mt-4 bg-gradient-to-r from-energy to-energy/70 text-background font-bold py-3 rounded-xl shadow-glow disabled:opacity-50">
            {buying ? "Activating…" : canAfford ? "Protect my streak" : `Need ${SHIELD_COST - (profile?.credits ?? 0)} more credits`}
          </motion.button>
          <button onClick={dismiss} className="w-full text-xs text-muted-foreground mt-2">Let it break</button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default StreakShield;
