import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Target, TrendingDown, TrendingUp, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { fatigueImpact, metricToIndex, type MetricRow } from "@/lib/performance";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const SkillAnalytics = () => {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (user) load(); }, [user]);
  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("performance_metrics").select("*").eq("user_id", user.id).order("log_date", { ascending: true }).limit(300);
    setMetrics((data as any) || []); setLoading(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  const types = Array.from(new Set(metrics.map((m) => m.metric_type)));
  const fatigue = fatigueImpact(metrics);

  // strengths vs weaknesses
  const byType: Record<string, number[]> = {};
  for (const m of metrics) (byType[m.metric_type] ||= []).push(metricToIndex(m.metric_type, m.value));
  const avgs = Object.entries(byType).map(([t, vals]) => ({ t, avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) }));
  const strengths = [...avgs].sort((a, b) => b.avg - a.avg).slice(0, 3);
  const weaknesses = [...avgs].sort((a, b) => a.avg - b.avg).slice(0, 3);

  return (
    <div className="min-h-screen p-6 pt-20 pb-24 max-w-5xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><Target size={14} /> Skill Analytics</div>
        <h1 className="text-4xl font-display font-bold mt-2">Skill <span className="text-gradient-electric">Engine</span></h1>
      </motion.div>

      <div className="grid md:grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-card/60 backdrop-blur border border-border rounded-2xl p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3"><TrendingUp className="text-primary" size={16} /> Strengths</h2>
          {strengths.length ? strengths.map((s) => (
            <div key={s.t} className="flex justify-between py-1.5 border-b border-border/50 last:border-0">
              <span className="text-sm capitalize">{s.t.replace(/_/g, " ")}</span>
              <span className="font-bold text-primary">{s.avg}</span>
            </div>
          )) : <p className="text-sm text-muted-foreground">Log metrics in VPR to see strengths.</p>}
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-card/60 backdrop-blur border border-border rounded-2xl p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3"><TrendingDown className="text-destructive" size={16} /> Weaknesses</h2>
          {weaknesses.length ? weaknesses.map((w) => (
            <div key={w.t} className="flex justify-between py-1.5 border-b border-border/50 last:border-0">
              <span className="text-sm capitalize">{w.t.replace(/_/g, " ")}</span>
              <span className="font-bold text-destructive">{w.avg}</span>
            </div>
          )) : <p className="text-sm text-muted-foreground">No data yet.</p>}
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-card/60 backdrop-blur border border-border rounded-2xl p-5">
        <h2 className="font-semibold mb-2">Fatigue Resistance</h2>
        <div className="flex items-end gap-3">
          <div className="text-5xl font-bold text-gradient-electric">{fatigue.score}</div>
          <div className="text-sm text-muted-foreground pb-2">
            {fatigue.dropoff > 0 ? `Skills drop ${fatigue.dropoff} pts under fatigue` : "Need fresh + tired logs to compare"}
          </div>
        </div>
      </motion.div>

      {types.map((t, i) => {
        const data = metrics.filter((m) => m.metric_type === t).map((m) => ({ d: m.log_date.slice(5), v: metricToIndex(m.metric_type, m.value) }));
        if (data.length < 2) return null;
        return (
          <motion.div key={t} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.05 }}
            className="bg-card/60 backdrop-blur border border-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-2 capitalize">{t.replace(/_/g, " ")} trend</h3>
            <div className="h-32">
              <ResponsiveContainer>
                <LineChart data={data}>
                  <XAxis dataKey="d" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Line type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

export default SkillAnalytics;
