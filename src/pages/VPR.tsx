import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Plus, Sparkles, Loader2, Lock, Crown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { supabase } from "@/integrations/supabase/client";
import { calculateVPR, detectArchetype, archetypeReadiness, ARCHETYPE_MIN_METRICS, ARCHETYPE_MIN_BUCKETS, getSportWeights, type MetricRow, type VPRScores } from "@/lib/performance";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const METRIC_OPTIONS = [
  { v: "sprint_40m", l: "40m sprint (s)" },
  { v: "vertical_jump", l: "Vertical jump (cm)" },
  { v: "broad_jump", l: "Broad jump (cm)" },
  { v: "beep_test", l: "Beep test (level)" },
  { v: "vo2_max", l: "VO2 max" },
  { v: "reaction_time", l: "Reaction time (ms)" },
  { v: "shooting_accuracy", l: "Shooting accuracy (%)" },
  { v: "passing_accuracy", l: "Passing accuracy (%)" },
  { v: "serve_consistency", l: "Serve consistency (%)" },
  { v: "first_touch", l: "First touch (%)" },
  { v: "bench_press", l: "Bench press (kg)" },
  { v: "squat", l: "Squat (kg)" },
  { v: "ftp", l: "FTP (W)" },
];

const VPRPage = () => {
  const { user, profile } = useAuth();
  const { isActive } = useSubscription();
  const navigate = useNavigate();
  const isPro = isActive;
  const sport = profile?.sport?.split(",")[0]?.trim() || "Running";
  type SnapshotRow = { created_at: string; overall_vpr: number; [key: string]: unknown };
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [position, setPosition] = useState<string>("");
  const [type, setType] = useState("vertical_jump");
  const [value, setValue] = useState("");
  const [fatigue, setFatigue] = useState("5");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (user) load(); }, [user]);

  const load = async () => {
    if (!user) return;
    const [m, s, p] = await Promise.all([
      supabase.from("performance_metrics").select("*").eq("user_id", user.id).order("log_date", { ascending: false }).limit(200),
      supabase.from("vpr_snapshots").select("*").eq("user_id", user.id).order("created_at", { ascending: true }).limit(50),
      supabase.from("athlete_position").select("*").eq("user_id", user.id).maybeSingle(),
    ]);
    setMetrics(m.data || []);
    setSnapshots(s.data || []);
    if (p.data?.position) setPosition(p.data.position);
    setLoading(false);
  };

  const vpr: VPRScores = calculateVPR(metrics, sport, position);
  const readiness = archetypeReadiness(metrics);
  const archetype = readiness.ready ? detectArchetype(vpr) : null;
  const radarData = [
    { axis: "Speed", value: vpr.speed_index },
    { axis: "Power", value: vpr.power_index },
    { axis: "Endurance", value: vpr.endurance_capacity },
    { axis: "Repeat.", value: vpr.repeatability },
    { axis: "Skill", value: vpr.skill_consistency },
    { axis: "Reaction", value: vpr.reaction_efficiency },
  ];

  const addMetric = async () => {
    if (!user || !value) return;
    setSaving(true);
    const { error } = await supabase.from("performance_metrics").insert({
      user_id: user.id, metric_type: type, value: Number(value), sport, fatigue_level: Number(fatigue),
    });
    if (error) toast.error(error.message);
    else { toast.success("Logged"); setValue(""); await load(); await snapshot(); }
    setSaving(false);
  };

  const snapshot = async () => {
    if (!user) return;
    const { error } = await supabase.from("vpr_snapshots").insert({
      user_id: user.id, sport, position: position || null,
      ...vpr, archetype: archetype?.name ?? null,
    });
    if (error) { toast.error(error.message); return; }
  };

  const savePosition = async (val: string) => {
    setPosition(val);
    if (!user) return;
    const { error } = await supabase.from("athlete_position").upsert({ user_id: user.id, primary_sport: sport, position: val }, { onConflict: "user_id" });
    if (error) { toast.error(error.message); }
  };

  if (loading) return <div className="min-h-screen app-mesh flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;

  return (
    <div className="min-h-screen app-mesh p-6 pt-20 pb-28 max-w-5xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><Activity size={14} /> Vaylo Sports Performance Rating</div>
        <h1 className="text-4xl font-display font-bold mt-2">VPR <span className="text-gradient-electric">{vpr.overall_vpr}</span></h1>
        {archetype ? (
          <p className="text-muted-foreground mt-1">{archetype.name} — {archetype.description}</p>
        ) : (
          <p className="text-muted-foreground mt-1">
            Archetype: <span className="font-semibold text-foreground">not set yet</span> — log at least {ARCHETYPE_MIN_METRICS} metrics across {ARCHETYPE_MIN_BUCKETS}+ areas.{' '}
            <span className="text-xs">({readiness.total}/{ARCHETYPE_MIN_METRICS} logged · {readiness.filledBuckets}/{ARCHETYPE_MIN_BUCKETS} areas filled)</span>
          </p>
        )}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="rounded-[22px] border border-white/[0.07] bg-card/60 backdrop-blur-xl shadow-card p-6 overflow-hidden relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
        <div className="relative">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="h-72">
            <ResponsiveContainer>
              <RadarChart data={radarData}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <Radar dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.4} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-3">
            {radarData.map((r) => (
              <div key={r.axis} className="flex items-center gap-3 mb-3">
                <span className="w-20 text-sm text-muted-foreground">{r.axis}</span>
                <div className="flex-1 h-2 bg-white/[0.06] border border-white/[0.04] rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${r.value}%` }} transition={{ delay: 0.3, duration: 0.8 }}
                    className="h-full bg-gradient-primary" />
                </div>
                <span className="w-10 text-right font-mono text-sm">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
        </div>
      </motion.div>



      {snapshots.length >= 2 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="rounded-[22px] border border-white/[0.07] bg-card/60 backdrop-blur-xl shadow-card p-6 overflow-hidden relative">
          <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
          <div className="relative">
          <h2 className="font-semibold mb-3">Progression</h2>
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart data={snapshots.map((s) => ({ date: new Date(s.created_at).toLocaleDateString(), VPR: s.overall_vpr }))}>
                <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Line type="monotone" dataKey="VPR" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          </div>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="rounded-[22px] border border-white/[0.07] bg-card/60 backdrop-blur-xl shadow-card p-6 space-y-3 overflow-hidden relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
        <div className="relative space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Plus size={16} /> Log a metric</h2>
        <div className="grid grid-cols-2 gap-2">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{METRIC_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" step="0.1" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" min="1" max="10" placeholder="Fatigue 1-10" value={fatigue} onChange={(e) => setFatigue(e.target.value)} />
          <Input placeholder="Position (e.g. Striker)" value={position} onChange={(e) => savePosition(e.target.value)} />
        </div>
        <Button onClick={addMetric} disabled={saving || !value} className="w-full">
          {saving ? <Loader2 className="animate-spin" size={16} /> : <><Sparkles size={16} className="mr-1" /> Save & Recalculate</>}
        </Button>
        </div>
      </motion.div>

      <p className="text-xs text-muted-foreground text-center">Sport: {sport}{position && ` · ${position}`} · Weighted by sport profile</p>
    </div>
  );
};

export default VPRPage;
