import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { projectTrajectory } from "@/lib/performance";
import { formatShortDate } from "@/i18n/format";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, ReferenceLine } from "recharts";

type SnapshotRow = {
  created_at: string;
  overall_vpr: number;
  speed_index: number;
  power_index: number;
  endurance_capacity: number;
  [key: string]: unknown;
};

/** Slope is in score points per month (see projectTrajectory). */
const describeTrend = (slope: number) => {
  if (slope > 1) return { label: "Rising fast", help: "Your scores are climbing quickly." };
  if (slope > 0.3) return { label: "Rising steadily", help: "Your scores are improving at a steady pace." };
  if (slope < -0.3) return { label: "Falling", help: "Your scores are dropping. Vary your training and check recovery." };
  return { label: "Holding steady", help: "Your scores are holding roughly where they were." };
};

const describeAge = (age: number | undefined) => {
  if (age === undefined) return "Add your date of birth in your profile to see age-based guidance.";
  if (age < 18) return "You are still developing, so focus on foundations and skills.";
  if (age <= 29) return "You are in the typical peak window (about 25–29), so prioritise sport-specific training.";
  return "You are past the usual peak window, so focus on recovery and technique to keep performance high.";
};

const Development = () => {
  const { user, profile } = useAuth();
  const [snaps, setSnaps] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);

  const age = profile?.date_of_birth
    ? Math.floor((Date.now() - new Date(profile.date_of_birth).getTime()) / 31557600000)
    : undefined;

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("vpr_snapshots")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      setSnaps(data || []);
      setLoading(false);
    };
    void load();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const proj = projectTrajectory(snaps, age);
  const trend = describeTrend(proj.slope);
  const chartData = snaps.map((s) => ({
    d: formatShortDate(s.created_at),
    "Overall VPR": s.overall_vpr,
    Speed: s.speed_index,
    Power: s.power_index,
    Endurance: s.endurance_capacity,
  }));

  const summary = [
    { label: "Where you're heading", value: trend.label, help: trend.help },
    { label: "Estimated overall score in a year", value: `${proj.projected12mo} / 100`, help: "If your current trend carries on." },
    { label: "Estimated chance of being near your peak", value: `${proj.peakProbability}%`, help: "Based on your age and current scores." },
  ];

  return (
    <div className="min-h-screen bg-background px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-5xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest">
          <TrendingUp size={14} /> Development
        </div>
        <h1 className="text-2xl font-display font-bold mt-1">Development trajectory</h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          How your VPR scores have changed over time, and a rough estimate of where they could be in a year.
          The estimate uses your snapshots and is adjusted for your age.
        </p>
      </motion.div>

      <div className="bg-energy/5 border border-energy/30 rounded-xl p-3 text-[12px] text-muted-foreground">
        <span className="text-energy font-bold">Estimates only.</span> These forecasts use limited data and are not guarantees.
        Training, injuries, sleep and stress all change results.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {summary.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            className="bg-card/60 backdrop-blur border border-border rounded-xl p-4"
          >
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-2xl font-bold mt-1 text-gradient-electric">{s.value}</div>
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.help}</div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-card/60 backdrop-blur border border-border rounded-2xl p-5"
      >
        <div className="mb-3">
          <h2 className="font-semibold">Your scores over time</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Each line is one score from 0 to 100. The dashed line is your projected overall score in 12 months.
          </p>
        </div>
        {chartData.length >= 2 ? (
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <XAxis dataKey="d" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine
                  y={proj.projected12mo}
                  stroke="hsl(var(--accent))"
                  strokeDasharray="4 4"
                  label={{ value: "12-month projection", fill: "hsl(var(--accent))", fontSize: 10 }}
                />
                <Line type="monotone" dataKey="Overall VPR" stroke="hsl(var(--primary))" strokeWidth={2.5} />
                <Line type="monotone" dataKey="Speed" stroke="hsl(var(--accent))" strokeWidth={1.5} />
                <Line type="monotone" dataKey="Power" stroke="hsl(var(--energy))" strokeWidth={1.5} />
                <Line type="monotone" dataKey="Endurance" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Complete at least 2 VPR snapshots to see your trajectory.</p>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-card/60 backdrop-blur border border-border rounded-2xl p-5 text-sm text-muted-foreground"
      >
        <h2 className="font-semibold text-foreground mb-1">About your age</h2>
        <p>{describeAge(age)}</p>
      </motion.div>
    </div>
  );
};

export default Development;
