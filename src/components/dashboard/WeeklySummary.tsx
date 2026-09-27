import { useEffect, useState } from "react";
import { localDateKey } from "@/lib/dates";
import { motion } from "framer-motion";
import { Sparkles, X, TrendingUp } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getRPE } from "@/components/RPEModal";
import { lsGet, lsSet } from "@/lib/localStore";

const isoMonday = () => {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return localDateKey(d);
};

interface WeeklySummaryData {
  totalMin: number;
  planned: number;
  completed: number;
  avgRPE: string;
  load: number;
  top: { title: string } | null;
  insight: string;
}

const WeeklySummary = () => {
  const { user } = useAuth();
  const [data, setData] = useState<WeeklySummaryData | null>(null);
  const monday = isoMonday();
  const dismissKey = `vaylo_weekly_dismiss_${monday}`;
  const [dismissed, setDismissed] = useState(lsGet<boolean>(dismissKey, false));

  useEffect(() => {
    if (!user || dismissed) return;
    (async () => {
      const since = new Date(monday).toISOString();
      const [w, p, a] = await Promise.all([
        supabase.from("workouts").select("*").eq("user_id", user.id).gte("created_at", since),
        supabase.from("plan_events").select("*").eq("user_id", user.id).gte("scheduled_date", monday),
        supabase.from("achievements").select("*").eq("user_id", user.id).gte("earned_at", since).order("earned_at", { ascending: false }).limit(1),
      ]);
      const workouts = w.data || [];
      const planned = (p.data || []).length;
      const completed = workouts.filter((x) => x.completed).length;
      const totalMin = workouts.reduce((s: number, x) => s + (x.duration_minutes || 0), 0);
      const rpe = getRPE().filter(r => new Date(r.date) >= new Date(monday));
      const avgRPE = rpe.length ? (rpe.reduce((s, r) => s + r.rpe, 0) / rpe.length) : 0;
      const load = workouts.reduce((s: number, x) => s + (x.duration_minutes || 0) * 1.2, 0);
      const top = a.data?.[0];
      const insight = avgRPE > 7.5
        ? "Average RPE is elevated. Schedule one lighter aerobic day before your next hard session."
        : completed < planned
        ? `You completed ${completed}/${planned} sessions. Block two non-negotiable training windows this week.`
        : "Consistency is strong. Add one quality session this week to push your ceiling.";
      setData({ totalMin, planned, completed, avgRPE: avgRPE.toFixed(1), top, insight, load: Math.round(load) });
    })();
  }, [user, dismissed]);

  if (dismissed || !data) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="mx-5 mb-4 bg-gradient-card border border-primary/30 rounded-2xl p-5 shadow-card relative">
      <button onClick={() => { lsSet(dismissKey, true); setDismissed(true); }}
        className="absolute top-3 right-3 p-1.5 text-muted-foreground hover:text-foreground"><X size={14} /></button>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-primary font-semibold">
        <Sparkles size={12} /> Weekly Report · Week of {new Date(monday).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </div>
      <h3 className="font-display font-bold text-xl mt-1">Your performance recap</h3>
      <div className="grid grid-cols-4 gap-2 mt-4">
        <Stat label="Load" value={data.load} />
        <Stat label="Sessions" value={`${data.completed}/${data.planned || data.completed}`} />
        <Stat label="Avg RPE" value={data.avgRPE} />
        <Stat label="Minutes" value={data.totalMin} />
      </div>
      {data.top && (
        <div className="mt-3 text-xs text-muted-foreground">
          🏅 Top achievement: <span className="text-foreground font-semibold">{data.top.title}</span>
        </div>
      )}
      <div className="mt-4 bg-background/40 border border-border rounded-xl p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-electric-purple font-bold">
          <TrendingUp size={11} /> AI Insight
        </div>
        <p className="text-sm mt-1">{data.insight}</p>
      </div>
    </motion.div>
  );
};

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="text-center">
    <p className="text-lg font-display font-bold">{value}</p>
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
  </div>
);

export default WeeklySummary;
