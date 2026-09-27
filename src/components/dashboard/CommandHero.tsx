import { motion, useInView } from "framer-motion";
import { localDateKey } from "@/lib/dates";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Activity, Play } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { calculateVPR, type VPRScores } from "@/lib/performance";
import AnimatedNumber from "@/components/motion/AnimatedNumber";

const RING_SIZE = 196;
const STROKE = 10;
const R = (RING_SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

const zoneFor = (s: number | null) => {
  if (s == null) return { label: "—", color: "hsl(var(--muted-foreground))" };
  if (s >= 85) return { label: "GREEN", color: "hsl(var(--success))" };
  if (s >= 70) return { label: "READY", color: "hsl(var(--primary))" };
  if (s >= 50) return { label: "CAUTION", color: "hsl(var(--energy))" };
  return { label: "RED", color: "hsl(var(--destructive))" };
};

const CommandHero = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const [vpr, setVpr] = useState<VPRScores | null>(null);
  const [readiness, setReadiness] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = profile?.full_name?.split(" ")[0] || "Athlete";

  useEffect(() => {
    if (!user) return;
    const today = localDateKey();
    Promise.all([
      supabase.from("performance_metrics").select("*").eq("user_id", user.id),
      supabase.from("recovery_logs").select("readiness_score, log_date").eq("user_id", user.id).order("log_date", { ascending: false }).limit(14),
    ]).then(([mRes, rRes]) => {
      const sport = profile?.sport || "default";
      if (mRes.data?.length) setVpr(calculateVPR(mRes.data, Array.isArray(sport) ? sport[0] : sport));
      const todays = rRes.data?.find((r) => r.log_date === today);
      if (todays) setReadiness(todays.readiness_score);
      // streak: consecutive logged days from today
      let s = 0;
      const set = new Set((rRes.data || []).map((r: any) => r.log_date));
      for (let i = 0; i < 14; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        if (set.has(localDateKey(d))) s++; else break;
      }
      setStreak(s);
    });
  }, [user, profile]);

  const overall = vpr?.overall_vpr ?? 0;
  const z = zoneFor(readiness);

  return (
    <div ref={ref} className="px-5 pt-12 pb-2">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5 }}
        className="flex items-end justify-between mb-5"
      >
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">{greeting}</p>
          <h1 className="text-3xl font-display font-bold leading-tight">
            <span className="text-gradient-electric">{name}</span>
          </h1>
        </div>
        {streak > 0 && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Streak</p>
            <p className="text-xl font-display font-bold text-energy">{streak}d</p>
          </div>
        )}
      </motion.div>

      {/* Performance Ring */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={inView ? { opacity: 1, scale: 1 } : {}}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative mx-auto mb-5"
        style={{ width: RING_SIZE, height: RING_SIZE }}
      >
        {/* glow */}
        <div className="absolute inset-0 rounded-full bg-primary/20 blur-3xl opacity-40 pointer-events-none" />

        <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90 relative">
          <defs>
            <linearGradient id="vpr-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="hsl(var(--electric-purple))" />
              <stop offset="100%" stopColor="hsl(var(--primary))" />
            </linearGradient>
          </defs>
          <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={R} stroke="hsl(var(--border))" strokeWidth={STROKE} fill="none" />
          <motion.circle
            cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={R} stroke="url(#vpr-grad)"
            strokeWidth={STROKE} fill="none" strokeLinecap="round"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={inView ? { strokeDashoffset: C - (C * overall) / 100 } : {}}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">VPR</p>
          <motion.div
            className="text-5xl font-display font-bold tabular-nums leading-none mt-1"
            initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 0.6 }}
          >
            {overall ? <AnimatedNumber value={overall} duration={1.2} /> : "—"}
          </motion.div>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: z.color, boxShadow: `0 0 8px ${z.color}` }} />
            <span className="text-[10px] font-bold tracking-wider" style={{ color: z.color }}>{z.label}</span>
          </div>
        </div>
      </motion.div>

      {/* Primary Action */}
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ delay: 0.5, duration: 0.5 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => navigate("/workouts")}
        className="w-full group relative overflow-hidden rounded-2xl bg-gradient-electric p-[1px] shadow-electric"
      >
        <div className="relative flex items-center justify-between bg-card/40 backdrop-blur-xl rounded-2xl px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Play size={18} className="text-primary fill-primary ml-0.5" />
            </div>
            <div className="text-start">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Today's Mission</p>
              <p className="text-sm font-bold">Start Training</p>
            </div>
          </div>
          <ChevronRight size={20} className="text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
        </div>
      </motion.button>

      {/* Secondary action row */}
      <div className="grid grid-cols-2 gap-2 mt-2">
        <button
          onClick={() => navigate("/recovery")}
          className="flex items-center justify-center gap-2 bg-card/60 border border-border rounded-xl py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all"
        >
          <Activity size={13} /> {readiness !== null ? `Readiness ${readiness}` : "Check In"}
        </button>
        <button
          onClick={() => navigate("/vpr")}
          className="flex items-center justify-center gap-2 bg-card/60 border border-border rounded-xl py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all"
        >
          View Profile <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
};

export default CommandHero;
