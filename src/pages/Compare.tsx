import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { calculateVPR, type MetricRow, type VPRScores } from "@/lib/performance";
import { Radar, RadarChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, ResponsiveContainer } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Elite reference profiles — ILLUSTRATIVE stylized 0-100 indices for motivational
// benchmarking only. Not measured athlete data, not official stats — approximated
// from public benchmarks and rounded for display.
const ELITES: Record<string, { name: string; profile: VPRScores }> = {
  "Sprinting": { name: "Usain Bolt (peak)", profile: { speed_index: 100, power_index: 95, endurance_capacity: 50, repeatability: 80, skill_consistency: 85, reaction_efficiency: 90, overall_vpr: 89 } },
  "Running": { name: "Eliud Kipchoge", profile: { speed_index: 78, power_index: 60, endurance_capacity: 100, repeatability: 95, skill_consistency: 90, reaction_efficiency: 70, overall_vpr: 88 } },
  "Football": { name: "Cristiano Ronaldo (peak)", profile: { speed_index: 88, power_index: 92, endurance_capacity: 80, repeatability: 85, skill_consistency: 90, reaction_efficiency: 85, overall_vpr: 87 } },
  "Basketball": { name: "LeBron James (peak)", profile: { speed_index: 82, power_index: 95, endurance_capacity: 78, repeatability: 88, skill_consistency: 92, reaction_efficiency: 90, overall_vpr: 88 } },
  "Cycling": { name: "Tadej Pogačar", profile: { speed_index: 75, power_index: 92, endurance_capacity: 100, repeatability: 95, skill_consistency: 85, reaction_efficiency: 70, overall_vpr: 88 } },
  "Swimming": { name: "Michael Phelps (peak)", profile: { speed_index: 90, power_index: 88, endurance_capacity: 95, repeatability: 90, skill_consistency: 95, reaction_efficiency: 80, overall_vpr: 90 } },
  "Tennis": { name: "Novak Djokovic", profile: { speed_index: 80, power_index: 80, endurance_capacity: 88, repeatability: 92, skill_consistency: 95, reaction_efficiency: 95, overall_vpr: 88 } },
  "Rugby": { name: "Maro Itoje", profile: { speed_index: 78, power_index: 95, endurance_capacity: 85, repeatability: 90, skill_consistency: 80, reaction_efficiency: 80, overall_vpr: 85 } },
  "default": { name: "World-class generalist", profile: { speed_index: 85, power_index: 85, endurance_capacity: 85, repeatability: 85, skill_consistency: 85, reaction_efficiency: 85, overall_vpr: 85 } },
};

const Compare = () => {
  const { user, profile } = useAuth();
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const userSport = profile?.sport?.split(",")[0]?.trim() || "Running";
  const [compareSport, setCompareSport] = useState(userSport);

  // Keep the comparison sport in sync when the profile finishes loading or changes.
  useEffect(() => { setCompareSport(userSport); }, [userSport]);

  useEffect(() => { if (user) void load(); }, [user]);
  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("performance_metrics").select("*").eq("user_id", user.id).limit(200);
    setMetrics((data as any) || []);
    setLoading(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  const userVpr = calculateVPR(metrics, userSport);
  const elite = ELITES[compareSport] || ELITES.default;

  const data = [
    { axis: "Speed", you: userVpr.speed_index, elite: elite.profile.speed_index },
    { axis: "Power", you: userVpr.power_index, elite: elite.profile.power_index },
    { axis: "Endurance", you: userVpr.endurance_capacity, elite: elite.profile.endurance_capacity },
    { axis: "Repeat", you: userVpr.repeatability, elite: elite.profile.repeatability },
    { axis: "Skill", you: userVpr.skill_consistency, elite: elite.profile.skill_consistency },
    { axis: "React", you: userVpr.reaction_efficiency, elite: elite.profile.reaction_efficiency },
  ];

  const gaps = data.map((d) => ({ axis: d.axis, gap: d.elite - d.you })).sort((a, b) => b.gap - a.gap);
  const biggestGap = gaps[0];

  const guidance: Record<string, string> = {
    Speed: "Add 2 sprint sessions/week. Focus on max-velocity flying 30s and acceleration starts.",
    Power: "Bring in plyometrics + 1 heavy lower-body lift weekly. Triple-extension drills pay off.",
    Endurance: "Add 1 long Zone-2 session and 1 threshold session per week for 6 weeks.",
    Repeat: "Train repeatability with EMOM/AMRAP-style intervals. Keep RPE consistent across sets.",
    Skill: "Schedule daily skill-specific deliberate practice (15 min) under low fatigue.",
    React: "Add reaction-cue drills (visual/audio) pre-warmup. 5 min × 4 days/week.",
  };

  const hasData = metrics.length > 0;

  return (
    <div className="min-h-screen p-6 pt-20 pb-24 max-w-4xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><Trophy size={14} /> Athlete Comparison</div>
        <h1 className="text-4xl font-display font-bold mt-2">Stack Up vs <span className="text-gradient-electric">Elite</span></h1>
        <p className="text-muted-foreground mt-1 text-sm">Illustrative benchmarking — stylized elite profiles for motivation, not official measurements.</p>
      </motion.div>

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Compare to:</span>
        <Select value={compareSport} onValueChange={setCompareSport}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.keys(ELITES).filter((k) => k !== "default").map((k) => <SelectItem key={k} value={k}>{k} — {ELITES[k].name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {!hasData && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center">
          <p className="text-sm font-semibold">No performance metrics yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Log workouts, skills and tests in Training & Performance to build your VPR. The chart below will fill as you add data — comparison is most useful once you have logs in 2–3 domains (e.g., speed + endurance + skill).</p>
        </div>
      )}

      <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
        className="p-6 rounded-2xl bg-card/40 border border-border">
        <ResponsiveContainer width="100%" height={320}>
          <RadarChart data={data}>
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
            <Radar name="Elite" dataKey="elite" stroke="hsl(var(--energy))" fill="hsl(var(--energy))" fillOpacity={0.15} />
            <Radar name="You" dataKey="you" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.4} />
          </RadarChart>
        </ResponsiveContainer>
        <div className="flex items-center justify-center gap-4 text-xs mt-2">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-primary" /> You · {userVpr.overall_vpr} VPR</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-energy" /> {elite.name} · {elite.profile.overall_vpr} VPR</span>
        </div>
        <p className="mt-3 text-center text-[10px] leading-relaxed text-muted-foreground">Elite profiles are illustrative stylized benchmarks (0–100 indices) — not actual measurements of the named athletes. Your VPR is calculated only from your logged metrics using the same 0–100 scale. Use the gap as a directional training prompt, not a diagnosis.</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
        className="p-5 rounded-2xl bg-card/40 border border-border">
        <h3 className="font-semibold mb-3">Biggest Gap → Action Plan</h3>
        {!hasData ? (
          <p className="text-sm text-muted-foreground">Add at least 3 performance logs to generate a personalised action plan.</p>
        ) : (
          <>
            <div className="text-sm mb-1 text-muted-foreground">Your largest opportunity is in <span className="text-primary font-semibold">{biggestGap.axis}</span> ({biggestGap.gap > 0 ? `+${biggestGap.gap} pts` : "you lead"}).</div>
            <p className="text-sm">{guidance[biggestGap.axis]}</p>
          </>
        )}

        <div className="mt-4 space-y-1.5">
          {gaps.map((g) => (
            <div key={g.axis} className="flex items-center gap-3">
              <span className="w-16 text-xs text-muted-foreground">{g.axis}</span>
              <div className="flex-1 bg-muted/30 h-2 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} whileInView={{ width: `${Math.max(0, Math.min(100, (data.find((d) => d.axis === g.axis)!.you / 100) * 100))}%` }} viewport={{ once: true }}
                  className="h-full bg-primary" />
              </div>
              <span className="w-16 text-xs text-right">{g.gap > 0 ? `-${g.gap}` : `+${-g.gap}`}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

export default Compare;
