import { useEffect, useState } from "react";
import { localDateKey, localDateKeyDaysAgo } from "@/lib/dates";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, ShieldCheck, X, PlayCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { creditCost, spendErrorMessage } from "@/lib/credits";
import { useSpendWithTopUp } from "@/hooks/useSpendWithTopUp";


const DISMISS_KEY = "vaylo_shield_dismissed_date";
const SHIELD_KEY = "vaylo_shield_active_until";

/**
 * Detects when the user is at risk of losing their daily streak (no recovery log
 * or workout logged today after 6pm local) and offers a Streak Shield for credits.
 */
const StreakShield = () => {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [buying, setBuying] = useState(false);
  const [atRisk, setAtRisk] = useState(false);
  const spendWithTopUp = useSpendWithTopUp();

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
          <motion.div
            // One entrance scale, not an infinite heartbeat: a permanently
            // pulsing icon behind text the athlete is trying to read is the
            // grating kind of urgency — it reads as used-car-salesroom motion
            // and fights the reading posture the sheet exists to support.
            initial={{ scale: 0.85 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="w-16 h-16 rounded-2xl bg-energy/15 border border-energy/30 flex items-center justify-center mx-auto mb-4"
          >
            <Flame size={32} className="text-energy" />
          </motion.div>
          <h3 className="font-display font-bold text-xl text-center">Keep tonight's streak</h3>
          <p className="text-sm text-muted-foreground text-center mt-1.5">
            You haven't logged anything today. Log a session before midnight to keep it free
            and easy — or activate a Streak Shield if today already got away from you.
          </p>
          <div className="mt-4 p-3 rounded-xl bg-energy/10 border border-energy/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-energy" />
              <span className="text-sm font-semibold">Streak Shield</span>
            </div>
            <span className="text-sm font-display font-bold">{SHIELD_COST} credits</span>
          </div>
          {/* Recovery before monetisation: the free route is above the paid
              one. Logging a gym session keeps the streak honestly — the shield
              is a paid simplification for a day that already slipped, not the
              gate in front of the only exit. */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => { dismiss(); navigate("/training"); }}
            className="w-full mt-4 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-bold py-3 rounded-xl"
          >
            <PlayCircle size={18} aria-hidden /> Log today's session — free
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            disabled={buying}
            onClick={buyShield}
            className="w-full mt-2 border border-energy/30 bg-energy/10 text-energy font-bold py-2.5 rounded-xl disabled:opacity-50"
          >
            {buying
              ? "Activating…"
              : canAfford
                ? "Use a Streak Shield"
                : `Top up ${SHIELD_COST - (profile?.credits ?? 0)} credits & protect`}
          </motion.button>
          <button
            onClick={dismiss}
            className="w-full text-xs text-muted-foreground mt-3 py-2"
          >
            Not tonight
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default StreakShield;
