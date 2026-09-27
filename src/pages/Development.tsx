import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { projectTrajectory } from "@/lib/performance";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from "recharts";

const Development = () => {
  const { user, profile } = useAuth();
  type SnapshotRow = { created_at: string; overall_vpr: number; speed_index: number; power_index: number; endurance_capacity: number; [key: string]: unknown };
  const [snaps, setSnaps] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);

  const age = profile?.date_of_birth ? Math.floor((Date.now() - new Date(profile.date_of_birth).getTime()) / 31557600000) : undefined;

  useEffect(() => { if (user) load(); }, [user]);
  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("vpr_snapshots").select("*").eq("user_id", user.id).order("created_at", { ascending: true });
    setSnaps(data || []); setLoading(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  const proj = projectTrajectory(snaps, age);
  const data = snaps.map((s) => ({ d: new Date(s.created_at).toLocaleDateString(), VPR: s.overall_vpr, Speed: s.speed_index, Power: s.power_index, Endurance: s.endurance_capacity }));
  const flag = proj.slope > 1 ? "Late bloomer trajectory" : proj.slope > 0.3 ? "Steady upward trend" : proj.slope < -0.3 ? "Stagnation — change stimulus" : "Plateau";

  return (
    <div className="min-h-screen p-6 pt-20 pb-24 max-w-5xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><TrendingUp size={14} /> Athlete Development Map</div>
        <h1 className="text-4xl font-display font-bold mt-2">Development <span className="text-gradient-electric">Trajectory</span></h1>
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          Projections use a linear regression on your VPR snapshots, age-adjusted against normative athlete data
          (Malina et al. 2004 growth curves; NSCA position stand on youth training, Faigenbaum et al. 2009;
          Lloyd & Oliver YPD model 2012). Peak power output typically falls between ages 25–29 (Allen et al. 2015),
          endurance peaks 27–34 (Lepers & Cattagni 2012), skill-based sports 26–32.
        </p>
      </motion.div>

      <div className="bg-energy/5 border border-energy/30 rounded-xl p-3 flex gap-2 text-[11px]">
        <span className="text-energy font-bold">Disclaimer:</span>
        <span className="text-muted-foreground">Trajectory forecasts are statistical estimates from limited data, not guarantees. Individual variance is high — training quality, injury history, genetics, and life stress all shift the curve. Use as a directional signal, not a verdict.</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { l: "Monthly slope", v: `${proj.slope > 0 ? "+" : ""}${proj.slope}` },
          { l: "12mo projection", v: proj.projected12mo },
          { l: "Peak probability", v: `${proj.peakProbability}%` },
        ].map((s, i) => (
          <motion.div key={s.l} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 + i * 0.05 }}
            className="bg-card/60 backdrop-blur border border-border rounded-xl p-4 text-center">
            <div className="text-xs text-muted-foreground">{s.l}</div>
            <div className="text-2xl font-bold mt-1 text-gradient-electric">{s.v}</div>
          </motion.div>
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-card/60 backdrop-blur border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Growth curves</h2>
          <span className="text-xs text-primary uppercase">{flag}</span>
        </div>
        {data.length >= 2 ? (
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={data}>
                <XAxis dataKey="d" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <ReferenceLine y={proj.projected12mo} stroke="hsl(var(--accent))" strokeDasharray="4 4" label={{ value: "12mo target", fill: "hsl(var(--accent))", fontSize: 10 }} />
                <Line type="monotone" dataKey="VPR" stroke="hsl(var(--primary))" strokeWidth={2.5} />
                <Line type="monotone" dataKey="Speed" stroke="hsl(var(--accent))" strokeWidth={1.5} />
                <Line type="monotone" dataKey="Power" stroke="hsl(var(--energy))" strokeWidth={1.5} />
                <Line type="monotone" dataKey="Endurance" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="text-sm text-muted-foreground">Need at least 2 VPR snapshots to project trajectory.</p>}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="bg-card/60 backdrop-blur border border-border rounded-2xl p-5 text-sm">
        <h2 className="font-semibold mb-2">Insights</h2>
        <ul className="space-y-1.5 text-muted-foreground">
          <li>▸ Chronological age: <span className="text-foreground font-semibold">{age ?? "—"}</span></li>
          <li>▸ {age && age < 18 ? "Pre-peak development window — focus on skill + foundation." : age && age < 28 ? "Peak performance years — maximize specificity." : "Maintenance phase — emphasize recovery + technique."}</li>
          <li>▸ {proj.slope > 0.5 ? "Trajectory suggests strong sport alignment." : "Consider re-testing weak buckets to confirm true ceiling."}</li>
        </ul>
      </motion.div>
    </div>
  );
};

export default Development;
