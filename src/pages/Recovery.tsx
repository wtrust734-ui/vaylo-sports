import { useState, useEffect, useMemo } from "react";
import { localDateKey } from "@/lib/dates";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Moon, Battery, Activity, Brain, Check, Info, TrendingUp, TrendingDown, Minus, Zap, Shield, AlertTriangle, Play, Crown, Lock, Flame } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";

// ─── TYPES ───
interface HrvBaseline { date: string; hrv_7day_avg: number | null; rhr_7day_avg: number | null; trend: string }
interface RecoveryLog { log_date: string; hrv: number | null; rhr: number | null; sleep_quality: number | null; fatigue: number | null; soreness: number | null; mood: number | null; stress: number | null; energy: number | null; readiness_score: number | null; rest_hours: number | null; adjusted_session: any; notes: string | null }

// ─── READINESS ENGINE ───
const calcReadiness100 = (
  hrv: number | null, hrvBaseline: number | null,
  sleep: number, fatigue: number, soreness: number, mood: number,
  recentRpeAvg: number | null
): number => {
  let totalWeight = 0;
  let totalScore = 0;

  if (hrv && hrvBaseline && hrvBaseline > 0) {
    const deviation = ((hrv - hrvBaseline) / hrvBaseline) * 100;
    const hrvScore = Math.min(100, Math.max(0, 50 + deviation * 2));
    totalWeight += 35;
    totalScore += hrvScore * 35;
  }

  totalWeight += 20;
  totalScore += (sleep / 10) * 100 * 20;

  totalWeight += 15;
  totalScore += ((10 - fatigue) / 10) * 100 * 15;

  totalWeight += 15;
  totalScore += ((10 - soreness) / 10) * 100 * 15;

  totalWeight += 10;
  totalScore += (mood / 10) * 100 * 10;

  if (recentRpeAvg !== null) {
    const loadScore = Math.max(0, 100 - (recentRpeAvg * 10));
    totalWeight += 5;
    totalScore += loadScore * 5;
  }

  return totalWeight > 0 ? Math.round(totalScore / totalWeight) : 50;
};

const getZone = (score: number) => {
  if (score >= 85) return { label: "GREEN", color: "hsl(var(--success))", bgClass: "bg-green-500/10 border-green-500/30", textClass: "text-green-500", emoji: "🔥", title: "Push Hard", desc: "Your body is primed for peak performance. Go all out today.", action: "Increase volume 10-15% or add intensity." };
  if (score >= 70) return { label: "NORMAL", color: "hsl(var(--primary))", bgClass: "bg-primary/10 border-primary/30", textClass: "text-primary", emoji: "⚡", title: "Train as Planned", desc: "Good recovery. Stick to your scheduled session.", action: "Follow your plan as written." };
  if (score >= 50) return { label: "CAUTION", color: "hsl(var(--energy))", bgClass: "bg-yellow-500/10 border-yellow-500/30", textClass: "text-yellow-500", emoji: "⚠️", title: "Reduce Load", desc: "Recovery incomplete. Your body needs a lighter session.", action: "Reduce volume 20-30% and lower intensity." };
  return { label: "RED", color: "hsl(var(--destructive))", bgClass: "bg-red-500/10 border-red-500/30", textClass: "text-destructive", emoji: "🛌", title: "Recovery Focus", desc: "Your body is signaling fatigue. Easy movement only.", action: "Replace with 20 min easy + mobility work." };
};

// ─── TRAINING ADJUSTMENT ENGINE ───
const adjustSession = (session: any, zone: ReturnType<typeof getZone>): any => {
  if (!session || session.isRest || session.isRecovery) return session;
  const adjusted = JSON.parse(JSON.stringify(session));
  adjusted._originalTitle = session.title;
  adjusted._zone = zone.label;
  adjusted._reason = zone.action;

  if (zone.label === "GREEN") {
    adjusted.title = `${session.title} (Boosted)`;
    if (adjusted.exercises) {
      adjusted.exercises = adjusted.exercises.map((ex: any) => {
        const sets = ex.sets || "";
        const match = sets.match(/^(\d+)/);
        if (match) {
          const num = parseInt(match[1]);
          const boosted = Math.min(num + Math.ceil(num * 0.15), num + 3);
          return { ...ex, sets: sets.replace(/^\d+/, String(boosted)) };
        }
        return ex;
      });
    }
    adjusted.duration_minutes = Math.round((session.duration_minutes || 30) * 1.1);
  } else if (zone.label === "CAUTION") {
    adjusted.title = `${session.title} (Reduced)`;
    if (adjusted.exercises) {
      adjusted.exercises = adjusted.exercises.map((ex: any) => {
        const sets = ex.sets || "";
        const match = sets.match(/^(\d+)/);
        if (match) {
          const num = parseInt(match[1]);
          const reduced = Math.max(Math.round(num * 0.75), 1);
          let newSets = sets.replace(/^\d+/, String(reduced));
          newSets = newSets.replace(/RPE\s*\d+/i, (m: string) => {
            const rpe = parseInt(m.replace(/RPE\s*/i, ""));
            return `RPE ${Math.max(rpe - 2, 4)}`;
          });
          return { ...ex, sets: newSets };
        }
        return ex;
      });
    }
    adjusted.duration_minutes = Math.round((session.duration_minutes || 30) * 0.75);
  } else if (zone.label === "RED") {
    adjusted.title = "Easy Recovery Session";
    adjusted.description = "Your body needs rest. Light movement to promote blood flow.";
    adjusted.duration_minutes = 20;
    adjusted.exercises = [
      { name: "Easy walk or very light jog", sets: "10 min @ conversational pace" },
      { name: "Dynamic stretching", sets: "5 min — legs, hips, shoulders" },
      { name: "Foam rolling", sets: "5 min — quads, hamstrings, calves" },
    ];
    adjusted.warmup = [];
    adjusted.cooldown = [
      { name: "Deep breathing", sets: "2 min — box breathing (4-4-4-4)" },
    ];
  }
  return adjusted;
};

// ─── SLIDER COMPONENT (stable, no re-animation on value change) ───
const SliderRow = ({ label, icon: Icon, value, onChange, color, lowLabel = "Poor", highLabel = "Excellent", max = 10, idx, disabled }: {
  label: string; icon: any; value: number; onChange: (v: number) => void; color: string;
  lowLabel?: string; highLabel?: string; max?: number; idx: number; disabled: boolean;
}) => (
  <motion.div
    initial={{ opacity: 0, x: -20 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay: idx * 0.06, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    className="bg-card border border-border rounded-xl p-3 hover:border-primary/20 transition-colors"
  >
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <Icon size={14} className={color} />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className="text-sm font-display font-bold">{value}/{max}</span>
    </div>
    <input type="range" min={1} max={max} value={value}
      onChange={e => onChange(parseInt(e.target.value))}
      className="w-full accent-primary h-1.5" disabled={disabled} />
    <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5"><span>{lowLabel}</span><span>{highLabel}</span></div>
  </motion.div>
);

// ─── MAIN COMPONENT ───
const Recovery = () => {
  const { user } = useAuth();
  const { hasFeature } = useSubscription();
  const isPremium = hasFeature("hrv_insights");
  const { toast } = useToast();
  const navigate = useNavigate();

  // Check-in state
  const [step, setStep] = useState<"checkin" | "result">("checkin");
  const [hrv, setHrv] = useState("");
  const [rhr, setRhr] = useState("");
  const [sleep, setSleep] = useState(7);
  const [fatigue, setFatigue] = useState(5);
  const [soreness, setSoreness] = useState(5);
  const [mood, setMood] = useState(7);
  const [stress, setStress] = useState(3);
  const [energy, setEnergy] = useState(6);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [logged, setLogged] = useState(false);

  // Data state
  const [readiness, setReadiness] = useState<number | null>(null);
  const [hrvHistory, setHrvHistory] = useState<RecoveryLog[]>([]);
  const [baselines, setBaselines] = useState<HrvBaseline[]>([]);
  const [currentBaseline, setCurrentBaseline] = useState<number | null>(null);
  const [recentRpeAvg, setRecentRpeAvg] = useState<number | null>(null);
  const [todaySession, setTodaySession] = useState<any>(null);
  const [adjustedSession, setAdjustedSession] = useState<any>(null);
  const [showHrvGuide, setShowHrvGuide] = useState(false);

  // Gamification
  const [streak, setStreak] = useState(0);
  const [peakDays, setPeakDays] = useState(0);
  const [weeklyAvg, setWeeklyAvg] = useState<number | null>(null);

  useEffect(() => { if (user) loadAllData(); }, [user]);

  const loadAllData = async () => {
    if (!user) return;
    const today = localDateKey();

    const [recoveryRes, historyRes, baselinesRes, rpeRes, planRes] = await Promise.all([
      supabase.from("recovery_logs").select("*").eq("user_id", user.id).eq("log_date", today).maybeSingle(),
      supabase.from("recovery_logs").select("*").eq("user_id", user.id).order("log_date", { ascending: false }).limit(30),
      supabase.from("hrv_baselines").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(30),
      supabase.from("performance_logs").select("perceived_exertion").eq("user_id", user.id).order("log_date", { ascending: false }).limit(9),
      supabase.from("training_plans").select("*").eq("user_id", user.id).eq("active", true).limit(1),
    ]);

    if (recoveryRes.data) {
      const d = recoveryRes.data as any;
      setLogged(true);
      setStep("result");
      setReadiness(d.readiness_score);
      setSleep(d.sleep_quality || 7);
      setFatigue(d.fatigue || 5);
      setSoreness(d.soreness || 5);
      setMood(d.mood || 7);
      setStress(d.stress || 3);
      setEnergy(d.energy || 6);
      setHrv(d.hrv ? String(d.hrv) : "");
      setRhr(d.rhr ? String(d.rhr) : "");
      if (d.adjusted_session) setAdjustedSession(d.adjusted_session);
    }

    const history = (historyRes.data || []) as any[];
    setHrvHistory(history);

    const bl = (baselinesRes.data || []) as any[];
    setBaselines(bl);
    if (bl.length > 0 && bl[0].hrv_7day_avg) setCurrentBaseline(Number(bl[0].hrv_7day_avg));

    const rpeVals = (rpeRes.data || []).map((r: any) => r.perceived_exertion).filter(Boolean);
    if (rpeVals.length > 0) setRecentRpeAvg(rpeVals.reduce((a: number, b: number) => a + b, 0) / rpeVals.length);

    if (planRes.data && planRes.data.length > 0) {
      const plan = planRes.data[0] as any;
      if (plan.plan_data && Array.isArray(plan.plan_data)) {
        const weekData = (plan.plan_data as any[]).find((w: any) => w.week === plan.week_current);
        if (weekData?.sessions) {
          const dow = new Date().getDay() || 7;
          const s = weekData.sessions.find((s: any) => s.day === dow && !s.skipped);
          if (s) setTodaySession(s);
        }
      }
    }

    computeGamification(history);
  };

  const computeGamification = (history: RecoveryLog[]) => {
    let s = 0;
    for (const log of history) {
      if (log.readiness_score && log.readiness_score >= 70) s++;
      else break;
    }
    setStreak(s);

    const thisMonth = new Date().getMonth();
    const peaks = history.filter(l => {
      const d = new Date(l.log_date);
      return d.getMonth() === thisMonth && l.readiness_score && l.readiness_score >= 85;
    });
    setPeakDays(peaks.length);

    const last7 = history.slice(0, 7).filter(l => l.readiness_score !== null);
    if (last7.length > 0) {
      setWeeklyAvg(Math.round(last7.reduce((a, b) => a + (b.readiness_score || 0), 0) / last7.length));
    }
  };

  const handleLog = async () => {
    if (!user) return;
    setLoading(true);
    const today = localDateKey();
    const hrvVal = hrv ? parseInt(hrv) : null;
    const rhrVal = rhr ? parseInt(rhr) : null;

    const recentHrv = hrvHistory.filter(h => h.hrv !== null).slice(0, 7).map(h => h.hrv as number);
    let baseline = currentBaseline;
    if (recentHrv.length > 0) {
      baseline = Math.round(recentHrv.reduce((a, b) => a + b, 0) / recentHrv.length);
    }

    const score = calcReadiness100(hrvVal, baseline, sleep, fatigue, soreness, mood, recentRpeAvg);
    const zone = getZone(score);

    let adjusted = null;
    if (todaySession && isPremium) {
      adjusted = adjustSession(todaySession, zone);
      setAdjustedSession(adjusted);
    }

    const notesFull = [notes, hrvVal ? `HRV: ${hrvVal}ms` : "", rhrVal ? `RHR: ${rhrVal}bpm` : ""].filter(Boolean).join(" | ");

    const { error } = await supabase.from("recovery_logs").upsert({
      user_id: user.id,
      log_date: today,
      sleep_quality: sleep,
      fatigue,
      soreness,
      mood,
      stress,
      energy,
      hrv: hrvVal,
      rhr: rhrVal,
      rest_hours: parseFloat(String(sleep)) || null,
      readiness_score: score,
      adjusted_session: adjusted,
      notes: notesFull,
    } as any, { onConflict: "user_id,log_date" });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    if (hrvVal) {
      const allHrv = [hrvVal, ...recentHrv].slice(0, 7);
      const avg7 = Math.round(allHrv.reduce((a, b) => a + b, 0) / allHrv.length);
      const recentRhr = hrvHistory.filter(h => h.rhr !== null).slice(0, 7).map(h => h.rhr as number);
      const allRhr = rhrVal ? [rhrVal, ...recentRhr].slice(0, 7) : recentRhr;
      const rhrAvg = allRhr.length > 0 ? Math.round(allRhr.reduce((a, b) => a + b, 0) / allRhr.length) : null;

      const last3 = [hrvVal, ...recentHrv].slice(0, 3);
      const last3Avg = last3.reduce((a, b) => a + b, 0) / last3.length;
      const trend = last3Avg > avg7 * 1.03 ? "rising" : last3Avg < avg7 * 0.97 ? "falling" : "stable";

      const { error: baselineError } = await supabase.from("hrv_baselines").upsert({
        user_id: user.id,
        date: today,
        hrv_7day_avg: avg7,
        rhr_7day_avg: rhrAvg,
        trend,
      } as any, { onConflict: "user_id,date" });
      if (baselineError) {
        toast({ title: "Couldn't save your HRV baseline", description: baselineError.message, variant: "destructive" });
      }
    }

    setReadiness(score);
    setLogged(true);
    setStep("result");
    toast({ title: `${zone.emoji} Readiness: ${score}/100`, description: zone.title });
    setLoading(false);
  };

  const zone = readiness !== null ? getZone(readiness) : null;

  const chartData = useMemo(() => {
    const logs = [...hrvHistory].reverse().filter(l => l.hrv !== null);
    const bMap = new Map(baselines.map(b => [b.date, b.hrv_7day_avg]));
    return logs.map(l => ({
      date: new Date(l.log_date).toLocaleDateString("en", { month: "short", day: "numeric" }),
      hrv: l.hrv,
      baseline: bMap.get(l.log_date) || null,
    }));
  }, [hrvHistory, baselines]);

  const insights = useMemo(() => {
    const results: string[] = [];
    const withHrv = hrvHistory.filter(h => h.hrv && h.readiness_score);
    if (withHrv.length >= 5) {
      const aboveBaseline = withHrv.filter(h => currentBaseline && h.hrv! > currentBaseline * 1.05);
      if (aboveBaseline.length > 0) {
        const avgScore = Math.round(aboveBaseline.reduce((a, b) => a + (b.readiness_score || 0), 0) / aboveBaseline.length);
        results.push(`Your best sessions happen when HRV is 5%+ above baseline (avg readiness: ${avgScore}/100)`);
      }
      let consec = 0;
      for (const h of hrvHistory) {
        if (currentBaseline && h.hrv && h.hrv < currentBaseline) consec++;
        else break;
      }
      if (consec >= 3) results.push(`⚠️ HRV has been below baseline for ${consec} consecutive days — consider extra recovery`);
    }
    return results;
  }, [hrvHistory, currentBaseline]);

  const hrvGuide = [
    { range: "Below 20ms", level: "Very Low", advice: "Likely overtrained. Full rest day, hydrate, 8+ hours sleep.", color: "text-destructive" },
    { range: "20-40ms", level: "Low", advice: "Light movement only — walking, stretching, gentle yoga.", color: "text-yellow-500" },
    { range: "40-60ms", level: "Moderate", advice: "Train at moderate intensity. Technique work or steady-state.", color: "text-yellow-500" },
    { range: "60-80ms", level: "Good", advice: "Well recovered. High-intensity training, intervals, competition prep.", color: "text-primary" },
    { range: "Above 80ms", level: "Excellent", advice: "Peak state. Max-effort sessions, testing, or competition.", color: "text-green-500" },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-14 pb-3">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Recovery</motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="text-sm text-muted-foreground mt-0.5">
          {logged ? "Today's readiness overview" : "Morning check-in — how are you feeling?"}
        </motion.p>
      </div>

      <AnimatePresence mode="wait">
        {step === "result" && readiness !== null && zone && (
          <motion.div key="result" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }} className="px-5 mb-4">

            {/* Readiness Ring */}
            <div className={`rounded-2xl border p-5 text-center ${zone.bgClass} shadow-card`}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: zone.color }}>Readiness Score</p>
              <div className="relative w-28 h-28 mx-auto mb-3">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--muted))" strokeWidth="7" />
                  <motion.circle cx="50" cy="50" r="42" fill="none" stroke={zone.color} strokeWidth="7" strokeLinecap="round"
                    initial={{ strokeDasharray: "0 264" }} animate={{ strokeDasharray: `${(readiness / 100) * 264} 264` }}
                    transition={{ duration: 1.5, ease: "easeOut" }} />
                </svg>
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: "spring" }}
                  className="absolute inset-0 flex items-center justify-center text-3xl font-display font-bold">{readiness}</motion.span>
              </div>
              <div className="flex items-center justify-center gap-2 mb-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${zone.bgClass}`} style={{ color: zone.color }}>{zone.label}</span>
                <span className="text-sm">{zone.emoji}</span>
              </div>
              <p className="font-display font-bold text-base mb-1">{zone.title}</p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">{zone.desc}</p>
            </div>

            {/* WHY explanation */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="mt-3 bg-card border border-border rounded-xl p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Why this score?</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                {hrv && <p>• HRV: {hrv}ms {currentBaseline ? `(baseline: ${currentBaseline}ms, ${parseInt(hrv) > currentBaseline ? "+" : ""}${Math.round(((parseInt(hrv) - currentBaseline) / currentBaseline) * 100)}%)` : ""}</p>}
                <p>• Sleep quality: {sleep}/10</p>
                <p>• Fatigue: {fatigue}/10 {fatigue >= 7 ? "(high — score reduced)" : ""}</p>
                <p>• Soreness: {soreness}/10 {soreness >= 7 ? "(high — score reduced)" : ""}</p>
                <p>• Mood: {mood}/10</p>
                {recentRpeAvg !== null && <p>• Recent training load (RPE avg): {recentRpeAvg.toFixed(1)}/10</p>}
              </div>
            </motion.div>

            {/* Training Adjustment */}
            {adjustedSession && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
                className="mt-3 bg-card border border-border rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Zap size={14} className="text-primary" />
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Auto-Adjusted Session</p>
                </div>
                {adjustedSession._originalTitle && (
                  <p className="text-[10px] text-muted-foreground mb-1 line-through">Original: {adjustedSession._originalTitle}</p>
                )}
                <p className="text-sm font-bold mb-1">{adjustedSession.title}</p>
                <p className="text-xs text-muted-foreground mb-2">{adjustedSession.description}</p>
                {adjustedSession._reason && (
                  <p className="text-[10px] text-muted-foreground italic mb-2">💡 {adjustedSession._reason}</p>
                )}
                {adjustedSession.exercises && (
                  <div className="space-y-1">
                    {adjustedSession.exercises.map((ex: any, i: number) => (
                      <div key={i} className="bg-muted/30 rounded-lg px-3 py-1.5 flex justify-between">
                        <span className="text-[11px] font-medium">{ex.name}</span>
                        <span className="text-[10px] text-primary font-medium">{ex.sets}</span>
                      </div>
                    ))}
                  </div>
                )}
                <motion.button onClick={() => navigate("/workouts")} whileTap={{ scale: 0.98 }}
                  className="w-full mt-3 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl shadow-glow text-sm">
                  <Play size={16} /> Start Training
                </motion.button>
              </motion.div>
            )}

            {!adjustedSession && todaySession && !isPremium && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
                className="mt-3 bg-card border border-border rounded-xl p-3 text-center">
                <Lock size={16} className="mx-auto text-muted-foreground mb-1" />
                <p className="text-xs font-semibold mb-0.5">Auto Training Adjustments</p>
                <p className="text-[10px] text-muted-foreground">Upgrade to Pro to automatically adjust your training based on readiness.</p>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* HRV Trend Chart */}
      {chartData.length >= 3 && (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="mx-5 mb-4 bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Heart size={14} className="text-destructive" />
              <span className="text-xs font-bold">HRV Trend</span>
            </div>
            {baselines.length > 0 && (
              <div className="flex items-center gap-1">
                {baselines[0]?.trend === "rising" && <TrendingUp size={12} className="text-green-500" />}
                {baselines[0]?.trend === "falling" && <TrendingDown size={12} className="text-destructive" />}
                {baselines[0]?.trend === "stable" && <Minus size={12} className="text-muted-foreground" />}
                <span className="text-[10px] text-muted-foreground capitalize">{baselines[0]?.trend || "stable"}</span>
              </div>
            )}
          </div>
          {isPremium ? (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={30} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="hrv" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="HRV" />
                <Line type="monotone" dataKey="baseline" stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="5 5" dot={false} name="7-day avg" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-6">
              <Lock size={20} className="mx-auto text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">HRV trend charts are a Pro feature</p>
            </div>
          )}
        </motion.div>
      )}

      {/* Gamification */}
      {logged && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="mx-5 mb-4 grid grid-cols-3 gap-2">
          <div className="bg-card border border-border rounded-xl p-3 text-center">
            <Flame size={14} className="mx-auto text-primary mb-1" />
            <p className="text-lg font-display font-bold">{streak}</p>
            <p className="text-[9px] text-muted-foreground">Day streak (70+)</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-3 text-center">
            <Crown size={14} className="mx-auto text-yellow-500 mb-1" />
            <p className="text-lg font-display font-bold">{peakDays}</p>
            <p className="text-[9px] text-muted-foreground">Peak days</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-3 text-center">
            <Shield size={14} className="mx-auto text-green-500 mb-1" />
            <p className="text-lg font-display font-bold">{weeklyAvg ?? "—"}</p>
            <p className="text-[9px] text-muted-foreground">Weekly avg</p>
          </div>
        </motion.div>
      )}

      {/* Insights (Premium) */}
      {logged && insights.length > 0 && isPremium && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="mx-5 mb-4 bg-card border border-border rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-2">Performance Insights</p>
          <div className="space-y-1.5">
            {insights.map((ins, i) => (
              <p key={i} className="text-xs text-muted-foreground">💡 {ins}</p>
            ))}
          </div>
        </motion.div>
      )}

      {/* CHECK-IN FORM */}
      {!logged && (
        <>
          {/* HRV + RHR */}
          <div className="px-5 mb-3">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Heart size={16} className="text-destructive" />
                  <span className="text-sm font-bold">HRV & Heart Rate</span>
                </div>
                <button onClick={() => setShowHrvGuide(!showHrvGuide)} className="text-[10px] text-primary font-semibold flex items-center gap-1">
                  <Info size={10} /> {showHrvGuide ? "Hide" : "Guide"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">HRV (ms)</label>
                  <input type="number" placeholder="e.g. 65" value={hrv} onChange={e => setHrv(e.target.value)}
                    className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">RHR (bpm)</label>
                  <input type="number" placeholder="e.g. 55" value={rhr} onChange={e => setRhr(e.target.value)}
                    className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
              </div>
              {currentBaseline && hrv && (
                <p className="text-[10px] text-muted-foreground">
                  Baseline: {currentBaseline}ms · Today: {parseInt(hrv) > currentBaseline ? "+" : ""}{Math.round(((parseInt(hrv) - currentBaseline) / currentBaseline) * 100)}% from baseline
                </p>
              )}

              {showHrvGuide && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 space-y-1.5">
                  <p className="text-[9px] text-muted-foreground mb-1">HRV = variation between heartbeats. Higher = better recovered.</p>
                  {hrvGuide.map((g, i) => (
                    <div key={i} className="bg-muted/30 rounded-lg p-2">
                      <span className={`text-[10px] font-bold ${g.color}`}>{g.range}</span>
                      <span className="text-[9px] text-muted-foreground ml-1">— {g.advice}</span>
                    </div>
                  ))}
                </motion.div>
              )}
            </motion.div>
          </div>

          {/* Sliders */}
          <div className="px-5 space-y-2 mb-3">
            <SliderRow label="Sleep Quality" icon={Moon} value={sleep} onChange={setSleep} color="text-primary" idx={0} disabled={logged} />
            <SliderRow label="Fatigue" icon={Battery} value={fatigue} onChange={setFatigue} color="text-yellow-500" idx={1} lowLabel="None" highLabel="Exhausted" disabled={logged} />
            <SliderRow label="Soreness" icon={Activity} value={soreness} onChange={setSoreness} color="text-destructive" idx={2} lowLabel="None" highLabel="Very sore" disabled={logged} />
            <SliderRow label="Mood" icon={Brain} value={mood} onChange={setMood} color="text-primary" idx={3} disabled={logged} />
            <SliderRow label="Stress" icon={AlertTriangle} value={stress} onChange={setStress} color="text-yellow-500" idx={4} max={5} lowLabel="None" highLabel="Extreme" disabled={logged} />
            <SliderRow label="Energy" icon={Zap} value={energy} onChange={setEnergy} color="text-green-500" idx={5} lowLabel="Drained" highLabel="Energised" disabled={logged} />
          </div>

          {/* Notes */}
          <div className="px-5 mb-4">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="bg-card border border-border rounded-xl p-3">
              <label className="text-[10px] text-muted-foreground block mb-1">Notes (optional)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="How do you feel today..."
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
            </motion.div>
          </div>

          {/* Submit */}
          <div className="px-5 mb-8">
            <motion.button onClick={handleLog} disabled={loading} whileTap={{ scale: 0.98 }} whileHover={{ scale: 1.01 }}
              className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl disabled:opacity-50 shadow-glow">
              <Check size={18} /> {loading ? "Analysing..." : "Log Morning Check-In"}
            </motion.button>
          </div>
        </>
      )}
    </div>
  );
};

export default Recovery;
