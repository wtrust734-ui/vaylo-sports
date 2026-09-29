import { useEffect, useState } from "react";
import { Flame, Gift, Check, Lock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useStreak } from "@/hooks/useStreak";
import { supabase } from "@/integrations/supabase/client";
import { localDateKey } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import BigRewardChest from "./BigRewardChest";

export default function DailyRewardsCard() {
  const { user } = useAuth();
  const { streak, refresh } = useStreak();
  const [openChest, setOpenChest] = useState(false);
  const [claimedThisCycle, setClaimedThisCycle] = useState<boolean>(false);
  const [reveal, setReveal] = useState(false);
  const current = streak?.current_streak ?? 0;
  const dayInCycle = current === 0 ? 0 : ((current - 1) % 7) + 1;
  const cycleNumber = Math.max(0, Math.floor(current / 7));
  const chestReady = current >= 7;

  // Touch streak whenever the user comes online / opens the app so daily rewards appear immediately.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const touch = async () => {
      // Supabase returns errors instead of throwing, so check the result.
      // `p_date` keeps the streak on the athlete's local calendar day.
      const { error } = await supabase.rpc("touch_streak", { p_date: localDateKey() });
      if (error && !/offline|fetch/i.test(error.message ?? "")) console.warn("touch_streak", error);
      if (!alive) return;
      await refresh();
      setReveal(true);
      setTimeout(() => alive && setReveal(false), 2200);
    };
    if (typeof navigator === "undefined" || navigator.onLine) touch();
    const onOnline = () => touch();
    window.addEventListener("online", onOnline);
    return () => { alive = false; window.removeEventListener("online", onOnline); };
  }, [user?.id]);

  useEffect(() => {
    if (!user || !chestReady) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("chest_claims")
        .select("id")
        .eq("user_id", user.id)
        .eq("cycle_number", cycleNumber)
        .maybeSingle();
      if (!cancelled) setClaimedThisCycle(!!data);
    })();
    return () => { cancelled = true; };
  }, [user, chestReady, cycleNumber]);

  const canOpen = chestReady && !claimedThisCycle;

  return (
    <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <AnimatePresence>
        {reveal && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/10 via-amber-500/10 to-primary/10" />
        )}
      </AnimatePresence>
      <div className="relative mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-orange-400" />
          <h3 className="font-semibold">Daily Rewards</h3>
          {reveal && <span className="text-[10px] uppercase tracking-widest text-primary font-semibold animate-pulse">Refreshed</span>}
        </div>
        <span className="text-xs text-muted-foreground">Day {Math.min(dayInCycle || 1, 7)} of 7</span>
      </div>

      {/* Seven columns stay seven — this is a week, and wrapping it to two rows
          would stop reading as a cycle. The gap tightens on phones instead so
          each day keeps a usable target at 320px. */}
      <div className="mb-4 grid grid-cols-7 gap-1 sm:gap-1.5">
        {Array.from({ length: 7 }).map((_, i) => {
          const day = i + 1;
          const isDone = day <= dayInCycle;
          const isToday = day === dayInCycle;
          const isChest = day === 7;
          return (
            <div
              key={day}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-lg border text-xs transition ${
                isDone
                  ? isChest
                    ? "border-amber-400/60 bg-amber-500/15 text-amber-200"
                    : "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                  : isToday
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-muted/40 bg-muted/10 text-muted-foreground"
              }`}
            >
              {isChest ? (
                <Gift className="h-4 w-4" />
              ) : isDone ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <span>{day}</span>
              )}
            </div>
          );
        })}
      </div>

      <motion.button
        whileHover={canOpen ? { scale: 1.02 } : undefined}
        whileTap={canOpen ? { scale: 0.98 } : undefined}
        disabled={!canOpen}
        onClick={() => setOpenChest(true)}
        className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition ${
          canOpen
            ? "bg-gradient-to-r from-amber-500 to-amber-600 text-black shadow-glow-energy"
            : "cursor-not-allowed bg-muted/40 text-muted-foreground"
        }`}
      >
        {canOpen ? (
          <><Gift className="h-4 w-4" /> Open Big Reward Chest</>
        ) : claimedThisCycle ? (
          <><Check className="h-4 w-4" /> Chest claimed — come back tomorrow</>
        ) : (
          <><Lock className="h-4 w-4" /> Chest unlocks at Day 7</>
        )}
      </motion.button>

      <BigRewardChest
        open={openChest}
        onClose={() => setOpenChest(false)}
        onClaimed={() => { setClaimedThisCycle(true); refresh(); }}
      />
    </Card>
  );
}
