interface PlanSession { day: number; skipped?: boolean; isRest?: boolean; isRecovery?: boolean; [key: string]: unknown }
interface PlanWeek { week: number; sessions?: PlanSession[]; isHoliday?: boolean; [key: string]: unknown }
import { motion, useInView } from "framer-motion";
import { localDateKey } from "@/lib/dates";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Play, Clock, Zap, Dumbbell, Sun, Moon, Flame, StretchHorizontal, ChevronDown, ChevronUp, Edit3, Droplets, Apple, Calendar, Heart } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DaySession {
  day: number;
  dayName?: string;
  title: string;
  type: string;
  duration_minutes: number;
  description: string;
  warmup?: { name: string; sets: string }[];
  exercises?: { name: string; sets: string }[];
  cooldown?: { name: string; sets: string }[];
  skipped?: boolean;
  isRest?: boolean;
  isRecovery?: boolean;
  _originalTitle?: string;
  _zone?: string;
  _reason?: string;
}

const getZoneDot = (score: number) => {
  if (score >= 85) return { color: "bg-green-500", label: "GREEN" };
  if (score >= 70) return { color: "bg-primary", label: "NORMAL" };
  if (score >= 50) return { color: "bg-yellow-500", label: "CAUTION" };
  return { color: "bg-destructive", label: "RED" };
};

const DailyTrainingCard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activePlan, setActivePlan] = useState<any>(null);
  const [todaySessions, setTodaySessions] = useState<DaySession[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showWarmup, setShowWarmup] = useState(false);
  const [showCooldown, setShowCooldown] = useState(false);
  const [waterMl, setWaterMl] = useState(0);
  const [waterGoal, setWaterGoal] = useState(3000);
  const [mealCount, setMealCount] = useState(0);
  const [totalCalories, setTotalCalories] = useState(0);
  const [readiness, setReadiness] = useState<number | null>(null);
  const [hasCheckedIn, setHasCheckedIn] = useState(false);
  const [upcomingEvent, setUpcomingEvent] = useState<any>(null);
  const [isHolidayWeek, setIsHolidayWeek] = useState(false);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-30px" });
  const today = localDateKey();

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("training_plans").select("*").eq("user_id", user.id).eq("active", true).limit(1),
      supabase.from("water_logs").select("amount_ml").eq("user_id", user.id).eq("log_date", today),
      supabase.from("user_settings").select("water_goal_ml").eq("user_id", user.id).maybeSingle(),
      supabase.from("meal_logs").select("calories").eq("user_id", user.id).eq("log_date", today),
      supabase.from("recovery_logs").select("readiness_score, adjusted_session").eq("user_id", user.id).eq("log_date", today).maybeSingle(),
      supabase.from("events").select("*").eq("user_id", user.id).gte("event_date", new Date().toISOString()).order("event_date", { ascending: true }).limit(1),
    ]).then(([planRes, waterRes, settingsRes, mealRes, recoveryRes, eventRes]) => {
      const recoveryData = recoveryRes.data;
      const hasAdjusted = recoveryData?.adjusted_session;

      if (recoveryData?.readiness_score) {
        setReadiness(recoveryData.readiness_score);
        setHasCheckedIn(true);
      }

      if (planRes.data && planRes.data.length > 0) {
        const plan = planRes.data[0];
        setActivePlan(plan);
        if (plan.plan_data && Array.isArray(plan.plan_data)) {
          const weekData = (plan.plan_data as PlanWeek[]).find((w) => w.week === plan.week_current);
          if (weekData?.isHoliday) {
            setIsHolidayWeek(true);
          } else if (weekData?.sessions) {
            const dayOfWeek = new Date().getDay() || 7;
            if (hasAdjusted) {
              setTodaySessions([hasAdjusted as DaySession]);
            } else {
              const todaySession = weekData.sessions.find((s: any) => s.day === dayOfWeek && !s.skipped);
              if (todaySession) setTodaySessions([todaySession]);
            }
          }
        }
      }
      const totalWater = (waterRes.data || []).reduce((sum, r) => sum + r.amount_ml, 0);
      setWaterMl(totalWater);
      if (settingsRes.data?.water_goal_ml) setWaterGoal(settingsRes.data.water_goal_ml);
      const meals = mealRes.data || [];
      setMealCount(meals.length);
      setTotalCalories(meals.reduce((sum, m) => sum + (m.calories || 0), 0));
      if (eventRes.data && eventRes.data.length > 0) setUpcomingEvent(eventRes.data[0]);
    });
  }, [user]);

  const session = todaySessions[0];
  const isRestDay = session?.isRest;
  const isRecoveryDay = session?.isRecovery;
  const isTrainingDay = session && !isRestDay && !isRecoveryDay;
  const noSession = !session && activePlan && !isHolidayWeek;
  const totalDayMinutes = isTrainingDay ? (session.duration_minutes + 20) : 0;
  const zoneDot = readiness !== null ? getZoneDot(readiness) : null;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="mx-5 rounded-[22px] border border-white/[0.07] bg-card/60 backdrop-blur-xl overflow-hidden shadow-card relative"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full blur-3xl opacity-25" style={{ background: "radial-gradient(circle at center, hsl(var(--primary) / 0.35), transparent 68%)" }} />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary shadow-glow animate-pulse-glow" />
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">Today's Schedule</span>
            {zoneDot && (
              <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5">
                <span className={`h-2 w-2 rounded-full ${zoneDot.color}`} />
                <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{readiness}/100</span>
              </span>
            )}
          </div>
          {activePlan && <span className="text-[10px] font-medium tabular-nums text-muted-foreground">Week {activePlan.week_current}/{activePlan.duration_weeks}</span>}
        </div>

        {!hasCheckedIn && activePlan && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            onClick={() => navigate("/recovery")}
            className="mb-3 rounded-2xl border border-primary/20 bg-primary/[0.07] backdrop-blur p-3 flex items-center gap-2.5 cursor-pointer hover:bg-primary/[0.10] transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
              <Heart size={14} className="text-primary-foreground" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold leading-none">Morning Check-In</p>
              <p className="text-[11px] text-muted-foreground leading-snug">Log your HRV & recovery to optimise today's training</p>
            </div>
            <span className="text-[11px] font-bold text-primary shrink-0">Go →</span>
          </motion.div>
        )}

        {session?._zone && (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1">
            <Zap size={10} className="text-primary" />
            <span className="text-[10px] font-bold tracking-wide text-primary">Auto-adjusted</span>
            {session._originalTitle && (
              <span className="text-[10px] text-muted-foreground line-through ml-1">{session._originalTitle}</span>
            )}
          </div>
        )}

        {!activePlan && (
          <div className="text-center py-3">
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 2, repeat: Infinity }}>
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-primary shadow-glow border border-white/10">
                <Dumbbell size={20} className="text-primary-foreground" />
              </span>
            </motion.div>
            <h3 className="font-display font-bold text-lg mt-3">No Training Plan Yet</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-4">Create a plan to see your daily schedule</p>
            <motion.button onClick={() => navigate("/training")} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow border border-white/10 text-sm">
              <Zap size={16} /> Create Plan
            </motion.button>
          </div>
        )}

        {isHolidayWeek && activePlan && (
          <>
            <h3 className="font-display font-bold text-lg">Holiday Week</h3>
            <p className="text-xs text-muted-foreground mb-3">This week is marked as a holiday. Sessions have been redistributed.</p>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] backdrop-blur p-3 mb-3 space-y-1">
              <p className="text-[11px] font-semibold">Recommended today:</p>
              <p className="text-[11px] text-muted-foreground">• Light walk or swim (15-20 min)</p>
              <p className="text-[11px] text-muted-foreground">• Stretching & foam rolling</p>
              <p className="text-[11px] text-muted-foreground">• Hydrate well — {(waterGoal/1000).toFixed(1)}L+</p>
              <p className="text-[11px] text-muted-foreground">• Sleep 8-9 hours</p>
            </div>
            <motion.button onClick={() => navigate("/recovery")} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] text-foreground font-semibold py-3 text-sm backdrop-blur">
              <Moon size={16} /> Log Recovery
            </motion.button>
          </>
        )}

        {(isRestDay || noSession) && (
          <>
            <h3 className="font-display font-bold text-lg">Rest & Recovery Day</h3>
            <p className="text-xs text-muted-foreground mb-3">No training scheduled. Focus on recovery.</p>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] p-3 mb-3 space-y-1">
              <p className="text-[11px] font-semibold">What to do today:</p>
              {session?.exercises ? session.exercises.map((ex, i) => (
                <p key={i} className="text-[11px] text-muted-foreground">• {ex.name} — {ex.sets}</p>
              )) : (
                <>
                  <p className="text-[11px] text-muted-foreground">• Light stretching or yoga (15-20 min)</p>
                  <p className="text-[11px] text-muted-foreground">• Foam rolling major muscle groups</p>
                  <p className="text-[11px] text-muted-foreground">• 7-9 hours sleep tonight</p>
                  <p className="text-[11px] text-muted-foreground">• Stay hydrated — target {(waterGoal/1000).toFixed(1)}L+</p>
                </>
              )}
            </div>
            <motion.button onClick={() => navigate("/recovery")} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-primary/15 bg-primary/10 text-primary font-semibold py-3 text-sm">
              <Moon size={16} /> Log Recovery
            </motion.button>
          </>
        )}

        {isRecoveryDay && (
          <>
            <h3 className="font-display font-bold text-lg mb-0.5">Active Recovery</h3>
            <p className="text-xs text-muted-foreground mb-3">{session.description}</p>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] p-3 mb-3 space-y-1">
              <p className="text-[11px] font-semibold">Today's recovery session ({session.duration_minutes} min):</p>
              {session.exercises?.map((ex, i) => (
                <div key={i} className="flex justify-between text-[11px] text-muted-foreground py-0.5">
                  <span>• {ex.name}</span><span>{ex.sets}</span>
                </div>
              ))}
            </div>
            <motion.button onClick={() => navigate("/recovery")} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-primary/15 bg-primary/10 text-primary font-semibold py-3 text-sm">
              <Moon size={16} /> Log Recovery
            </motion.button>
          </>
        )}

        {isTrainingDay && (
          <>
            <h3 className="font-display font-bold text-[17px] leading-tight">{session.dayName ? `${session.dayName}: ` : ""}{session.title}</h3>
            <p className="text-xs leading-relaxed text-muted-foreground mt-1 mb-3">{session.description}</p>

            {session.warmup && session.warmup.length > 0 && (
              <div className="mb-2">
                <button onClick={() => setShowWarmup(!showWarmup)}
                  className="w-full flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] backdrop-blur px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] border border-white/[0.06]">
                    <Sun size={12} className="text-foreground" />
                  </span>
                  <span className="text-[12px] font-semibold flex-1 text-start">Warm-up ({session.warmup.length})</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground mr-1">10 min</span>
                  {showWarmup ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                </button>
                {showWarmup && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-1.5 space-y-1 pl-1">
                    {session.warmup.map((ex, i) => (
                      <div key={i} className="flex justify-between rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2 text-[11px] text-muted-foreground">
                        <span>{ex.name}</span><span className="text-right ml-2 shrink-0 font-medium">{ex.sets}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </div>
            )}

            <div className="rounded-2xl border border-primary/15 bg-primary/[0.08] backdrop-blur px-3 py-3 mb-2">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
                  <Flame size={13} className="text-primary-foreground" />
                </span>
                <span className="text-[12px] font-bold text-primary flex-1">{session.title}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground border border-white/[0.06] bg-white/[0.04] rounded-full px-2 py-0.5">{session.duration_minutes} min</span>
              </div>
              {session.description && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">{session.description}</p>
              )}
              {session.exercises && session.exercises.length > 0 && !expanded && (
                <p className="text-[11px] text-primary/75 mt-2 font-medium">{session.exercises.length} exercises · Tap below for details</p>
              )}
            </div>

            {session.exercises && session.exercises.length > 0 && (
              <>
                <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-xs font-bold text-primary mb-2 ml-1">
                  {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {expanded ? "Hide" : "View"} Exercises ({session.exercises.length})
                </button>
                {expanded && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-1.5 mb-3">
                    {session.exercises.map((ex, i) => (
                      <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.04] backdrop-blur px-3 py-2.5">
                        <span className="text-[12px] font-semibold block leading-tight">{ex.name}</span>
                        <span className="text-[11px] text-primary font-medium">{ex.sets}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </>
            )}

            {session.cooldown && session.cooldown.length > 0 && (
              <div className="mb-3">
                <button onClick={() => setShowCooldown(!showCooldown)}
                  className="w-full flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] backdrop-blur px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] border border-white/[0.06]">
                    <StretchHorizontal size={12} className="text-foreground" />
                  </span>
                  <span className="text-[12px] font-semibold flex-1 text-start">Cool-down ({session.cooldown.length})</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground mr-1">10 min</span>
                  {showCooldown ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                </button>
                {showCooldown && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-1.5 space-y-1 pl-1">
                    {session.cooldown.map((ex, i) => (
                      <div key={i} className="flex justify-between rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2 text-[11px] text-muted-foreground">
                        <span>{ex.name}</span><span className="text-right ml-2 shrink-0 font-medium">{ex.sets}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <motion.button onClick={() => navigate("/workouts")} whileTap={{ scale: 0.98 }}
                className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-bold py-3 rounded-xl shadow-glow border border-white/10 text-sm">
                <Play size={16} className="fill-primary-foreground" /> Start Training
              </motion.button>
              <motion.button onClick={() => navigate("/training")} whileTap={{ scale: 0.98 }} aria-label="Edit plan"
                className="flex items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur px-3.5 py-3 hover:bg-white/[0.07] transition-colors">
                <Edit3 size={15} className="text-muted-foreground" />
              </motion.button>
            </div>
          </>
        )}

        <div className="mt-4 pt-4 border-t border-white/[0.06] grid grid-cols-4 gap-2">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur p-2.5 text-center">
            <Droplets size={13} className="mx-auto text-primary mb-1" />
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Water</p>
            <p className="text-[11px] font-bold tabular-nums">{waterMl > 0 ? `${(waterMl/1000).toFixed(1)}L` : "—"}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur p-2.5 text-center">
            <Apple size={13} className="mx-auto text-emerald-400 mb-1" />
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Meals</p>
            <p className="text-[11px] font-bold tabular-nums">{mealCount > 0 ? `${mealCount} · ${totalCalories}` : "—"}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur p-2.5 text-center cursor-pointer hover:bg-white/[0.06] transition-colors" onClick={() => navigate("/recovery")}>
            <Heart size={13} className="mx-auto text-destructive mb-1" />
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Readiness</p>
            <p className="text-[11px] font-bold tabular-nums">{readiness !== null ? `${readiness}` : "—"}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur p-2.5 text-center">
            <Clock size={13} className="mx-auto text-primary mb-1" />
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="text-[11px] font-bold tabular-nums">{totalDayMinutes > 0 ? `${totalDayMinutes}m` : "Rest"}</p>
          </div>
        </div>

        {upcomingEvent && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            onClick={() => navigate("/events")}
            className="mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] backdrop-blur flex items-center gap-2.5 p-3 cursor-pointer hover:bg-white/[0.06] transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.06] border border-white/[0.06]">
              <Calendar size={14} className="text-primary" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold leading-tight truncate">{upcomingEvent.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {(() => {
                  const diff = new Date(upcomingEvent.event_date).getTime() - Date.now();
                  const days = Math.floor(diff / 86400000);
                  return days > 0 ? `${days} days away` : "Today!";
                })()}
              </p>
            </div>
            <span className="text-[11px] font-bold text-primary shrink-0">View →</span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

export default DailyTrainingCard;
