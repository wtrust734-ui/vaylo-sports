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
      const recoveryData = recoveryRes.data as any;
      const hasAdjusted = recoveryData?.adjusted_session;

      if (recoveryData?.readiness_score) {
        setReadiness(recoveryData.readiness_score);
        setHasCheckedIn(true);
      }

      if (planRes.data && planRes.data.length > 0) {
        const plan = planRes.data[0];
        setActivePlan(plan);
        if (plan.plan_data && Array.isArray(plan.plan_data)) {
          const weekData = (plan.plan_data as any[]).find((w: any) => w.week === plan.week_current);
          if (weekData?.isHoliday) {
            setIsHolidayWeek(true);
          } else if (weekData?.sessions) {
            const dayOfWeek = new Date().getDay() || 7;

            // Use adjusted session if available
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
      className="mx-5 rounded-2xl bg-gradient-card border border-primary/20 overflow-hidden shadow-card"
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">Today's Schedule</span>
            {zoneDot && (
              <div className="flex items-center gap-1 ml-1">
                <div className={`w-2 h-2 rounded-full ${zoneDot.color}`} />
                <span className="text-[9px] font-bold text-muted-foreground">{readiness}/100</span>
              </div>
            )}
          </div>
          {activePlan && <span className="text-[10px] text-muted-foreground">Week {activePlan.week_current}/{activePlan.duration_weeks}</span>}
        </div>

        {/* Morning check-in prompt */}
        {!hasCheckedIn && activePlan && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            onClick={() => navigate("/recovery")}
            className="mb-3 bg-primary/5 border border-primary/20 rounded-lg p-2.5 flex items-center gap-2 cursor-pointer hover:bg-primary/10 transition-colors">
            <Heart size={14} className="text-primary" />
            <div className="flex-1">
              <p className="text-[11px] font-semibold">Morning Check-In</p>
              <p className="text-[9px] text-muted-foreground">Log your HRV & recovery to optimise today's training</p>
            </div>
            <span className="text-[10px] text-primary font-semibold">Go →</span>
          </motion.div>
        )}

        {/* Adjusted session badge */}
        {session?._zone && (
          <div className="mb-2 flex items-center gap-1.5">
            <Zap size={10} className="text-primary" />
            <span className="text-[9px] font-bold text-primary">Auto-adjusted</span>
            {session._originalTitle && (
              <span className="text-[9px] text-muted-foreground line-through ml-1">{session._originalTitle}</span>
            )}
          </div>
        )}

        {/* No plan */}
        {!activePlan && (
          <div className="text-center py-2">
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 2, repeat: Infinity }}>
              <Dumbbell size={28} className="mx-auto text-primary mb-2" />
            </motion.div>
            <h3 className="font-display font-bold text-lg mb-1">No Training Plan Yet</h3>
            <p className="text-xs text-muted-foreground mb-3">Create a plan to see your daily schedule</p>
            <motion.button onClick={() => navigate("/training")} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl shadow-glow text-sm">
              <Zap size={16} /> Create Plan
            </motion.button>
          </div>
        )}

        {/* Holiday Week */}
        {isHolidayWeek && activePlan && (
          <>
            <h3 className="font-display font-bold text-lg mb-1">🏖️ Holiday Week</h3>
            <p className="text-xs text-muted-foreground mb-2">This week is marked as a holiday. Sessions have been redistributed.</p>
            <div className="bg-muted/30 rounded-lg p-3 mb-3 space-y-1">
              <p className="text-[11px] font-semibold">Recommended today:</p>
              <p className="text-[10px] text-muted-foreground">• Light walk or swim (15-20 min)</p>
              <p className="text-[10px] text-muted-foreground">• Stretching & foam rolling</p>
              <p className="text-[10px] text-muted-foreground">• Hydrate well — {(waterGoal/1000).toFixed(1)}L+</p>
              <p className="text-[10px] text-muted-foreground">• Sleep 8-9 hours</p>
            </div>
            <motion.button onClick={() => navigate("/recovery")} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 bg-accent/10 text-accent-foreground font-semibold py-2.5 rounded-xl text-sm">
              <Moon size={16} /> Log Recovery
            </motion.button>
          </>
        )}

        {/* Rest Day */}
        {(isRestDay || noSession) && (
          <>
            <h3 className="font-display font-bold text-lg mb-1">🛌 Rest & Recovery Day</h3>
            <p className="text-xs text-muted-foreground mb-2">No training scheduled. Focus on recovery.</p>
            <div className="bg-muted/30 rounded-lg p-3 mb-3 space-y-1">
              <p className="text-[11px] font-semibold">What to do today:</p>
              {session?.exercises ? session.exercises.map((ex, i) => (
                <p key={i} className="text-[10px] text-muted-foreground">• {ex.name} — {ex.sets}</p>
              )) : (
                <>
                  <p className="text-[10px] text-muted-foreground">• Light stretching or yoga (15-20 min)</p>
                  <p className="text-[10px] text-muted-foreground">• Foam rolling major muscle groups</p>
                  <p className="text-[10px] text-muted-foreground">• 7-9 hours sleep tonight</p>
                  <p className="text-[10px] text-muted-foreground">• Stay hydrated — target {(waterGoal/1000).toFixed(1)}L+</p>
                </>
              )}
            </div>
            <motion.button onClick={() => navigate("/recovery")} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 bg-primary/10 text-primary font-semibold py-2.5 rounded-xl text-sm">
              <Moon size={16} /> Log Recovery
            </motion.button>
          </>
        )}

        {/* Recovery Day */}
        {isRecoveryDay && (
          <>
            <h3 className="font-display font-bold text-lg mb-0.5">🧘 Active Recovery</h3>
            <p className="text-xs text-muted-foreground mb-3">{session.description}</p>
            <div className="bg-muted/30 rounded-lg p-3 mb-3 space-y-1">
              <p className="text-[11px] font-semibold">Today's recovery session ({session.duration_minutes} min):</p>
              {session.exercises?.map((ex, i) => (
                <div key={i} className="flex justify-between text-[10px] text-muted-foreground py-0.5">
                  <span>• {ex.name}</span><span>{ex.sets}</span>
                </div>
              ))}
            </div>
            <motion.button onClick={() => navigate("/recovery")} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 bg-primary/10 text-primary font-semibold py-2.5 rounded-xl text-sm">
              <Moon size={16} /> Log Recovery
            </motion.button>
          </>
        )}

        {/* Training Day */}
        {isTrainingDay && (
          <>
            <h3 className="font-display font-bold text-lg mb-0.5">{session.dayName ? `${session.dayName}: ` : ""}{session.title}</h3>
            <p className="text-xs text-muted-foreground mb-3">{session.description}</p>

            {/* Warm-up */}
            {session.warmup && session.warmup.length > 0 && (
              <div className="mb-1.5">
                <button onClick={() => setShowWarmup(!showWarmup)}
                  className="w-full flex items-center gap-2 bg-accent/5 rounded-lg px-3 py-1.5 border border-accent/10">
                  <Sun size={12} className="text-accent-foreground" />
                  <span className="text-[11px] font-medium flex-1 text-left">Warm-up ({session.warmup.length} exercises)</span>
                  <span className="text-[10px] text-muted-foreground mr-1">10 min</span>
                  {showWarmup ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                </button>
                {showWarmup && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-1 space-y-0.5 pl-3">
                    {session.warmup.map((ex, i) => (
                      <div key={i} className="flex justify-between text-[10px] text-muted-foreground py-0.5">
                        <span>{ex.name}</span><span className="text-right ml-2 flex-shrink-0">{ex.sets}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </div>
            )}

            {/* Main Session */}
            <div className="bg-primary/5 rounded-lg px-3 py-2 border border-primary/10 mb-1.5">
              <div className="flex items-center gap-2 mb-1">
                <Flame size={12} className="text-primary" />
                <span className="text-[11px] font-semibold text-primary flex-1">{session.title}</span>
                <span className="text-[10px] text-muted-foreground">{session.duration_minutes} min</span>
              </div>
              {session.description && (
                <p className="text-[10px] text-muted-foreground leading-relaxed">{session.description}</p>
              )}
              {session.exercises && session.exercises.length > 0 && !expanded && (
                <p className="text-[10px] text-primary/70 mt-1">{session.exercises.length} exercises · Tap below for details</p>
              )}
            </div>

            {/* Exercises expandable */}
            {session.exercises && session.exercises.length > 0 && (
              <>
                <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-xs text-primary font-semibold mb-1.5 ml-1">
                  {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {expanded ? "Hide" : "View"} Exercises ({session.exercises.length})
                </button>
                {expanded && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-1 mb-2">
                    {session.exercises.map((ex, i) => (
                      <div key={i} className="bg-muted/30 rounded-lg px-3 py-2">
                        <span className="text-[11px] font-medium block">{ex.name}</span>
                        <span className="text-[10px] text-primary">{ex.sets}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </>
            )}

            {/* Cool-down */}
            {session.cooldown && session.cooldown.length > 0 && (
              <div className="mb-3">
                <button onClick={() => setShowCooldown(!showCooldown)}
                  className="w-full flex items-center gap-2 bg-secondary/5 rounded-lg px-3 py-1.5 border border-secondary/10">
                  <StretchHorizontal size={12} className="text-secondary-foreground" />
                  <span className="text-[11px] font-medium flex-1 text-left">Cool-down ({session.cooldown.length} exercises)</span>
                  <span className="text-[10px] text-muted-foreground mr-1">10 min</span>
                  {showCooldown ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                </button>
                {showCooldown && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-1 space-y-0.5 pl-3">
                    {session.cooldown.map((ex, i) => (
                      <div key={i} className="flex justify-between text-[10px] text-muted-foreground py-0.5">
                        <span>{ex.name}</span><span className="text-right ml-2 flex-shrink-0">{ex.sets}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <motion.button onClick={() => navigate("/workouts")} whileTap={{ scale: 0.98 }}
                className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl shadow-glow text-sm">
                <Play size={16} /> Start Training
              </motion.button>
              <motion.button onClick={() => navigate("/training")} whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center bg-card border border-border px-3 py-2.5 rounded-xl hover:border-primary/20 transition-colors">
                <Edit3 size={14} />
              </motion.button>
            </div>
          </>
        )}

        {/* Daily Overview Stats */}
        <div className="mt-3 pt-3 border-t border-border grid grid-cols-4 gap-2">
          <div className="text-center">
            <Droplets size={12} className="mx-auto text-primary mb-0.5" />
            <p className="text-[10px] text-muted-foreground">Water</p>
            <p className="text-xs font-bold">{waterMl > 0 ? `${(waterMl/1000).toFixed(1)}L` : "—"}</p>
          </div>
          <div className="text-center">
            <Apple size={12} className="mx-auto text-accent-foreground mb-0.5" />
            <p className="text-[10px] text-muted-foreground">Meals</p>
            <p className="text-xs font-bold">{mealCount > 0 ? `${mealCount} · ${totalCalories}kcal` : "—"}</p>
          </div>
          <div className="text-center cursor-pointer" onClick={() => navigate("/recovery")}>
            <Heart size={12} className="mx-auto text-destructive mb-0.5" />
            <p className="text-[10px] text-muted-foreground">Readiness</p>
            <p className="text-xs font-bold">{readiness !== null ? `${readiness}/100` : "—"}</p>
          </div>
          <div className="text-center">
            <Clock size={12} className="mx-auto text-primary mb-0.5" />
            <p className="text-[10px] text-muted-foreground">Total</p>
            <p className="text-xs font-bold">{totalDayMinutes > 0 ? `${totalDayMinutes}m` : "Rest"}</p>
          </div>
        </div>

        {/* Upcoming Event */}
        {upcomingEvent && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
            onClick={() => navigate("/events")}
            className="mt-3 pt-3 border-t border-border flex items-center gap-2 cursor-pointer">
            <Calendar size={14} className="text-primary" />
            <div className="flex-1">
              <p className="text-[11px] font-semibold">{upcomingEvent.title}</p>
              <p className="text-[10px] text-muted-foreground">
                {(() => {
                  const diff = new Date(upcomingEvent.event_date).getTime() - Date.now();
                  const days = Math.floor(diff / 86400000);
                  return days > 0 ? `${days} days away` : "Today!";
                })()}
              </p>
            </div>
            <span className="text-[10px] text-primary font-semibold">View →</span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

export default DailyTrainingCard;
