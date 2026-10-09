interface PlanWeek { week: number; sessions?: DaySession[]; isHoliday?: boolean; [key: string]: unknown }
import { motion, useInView } from "framer-motion";
import { localDateKey } from "@/lib/dates";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Play, Clock, Zap, Dumbbell, Sun, Moon, Flame, StretchHorizontal, ChevronDown, ChevronUp, ChevronRight, Edit3, Droplets, Apple, Calendar, Heart } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBreak } from "@/hooks/useActiveBreak";
import ActiveBreakBanner from "@/components/ActiveBreakBanner";

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

type PlanRow = {
  id: string;
  plan_data: unknown;
  week_current: number | null;
  duration_weeks: number | null;
  [key: string]: unknown;
};

type EventRow = {
  id: string;
  title: string;
  event_date: string;
  [key: string]: unknown;
};

const getZoneDot = (score: number) => {
  if (score >= 85) return { color: "bg-green-500", label: "GREEN" };
  if (score >= 70) return { color: "bg-primary", label: "NORMAL" };
  if (score >= 50) return { color: "bg-yellow-500", label: "CAUTION" };
  return { color: "bg-destructive", label: "RED" };
};

/**
 * Human name for a plan session's `type`, so the card says what the work is
 * rather than "sport_specific". Unknown types are de-slugged rather than
 * dropped, because a new generator type must still render as something.
 */
const SESSION_TYPE_LABELS: Record<string, string> = {
  strength: "Strength",
  speed: "Speed",
  intervals: "Intervals",
  endurance: "Endurance",
  sport_specific: "Sport-specific",
  cross_training: "Cross-training",
  conditioning: "Conditioning",
  power: "Power",
  upper: "Upper body",
  upper_push: "Upper body push",
  upper_pull: "Upper body pull",
  lower: "Lower body",
  full_body: "Full body",
  accessory: "Accessory & core",
  mobility: "Mobility",
  recovery: "Recovery",
  rest: "Rest",
};

const sessionTypeLabel = (type: string | undefined): string => {
  const key = (type ?? "").trim().toLowerCase();
  if (!key) return "Training";
  return SESSION_TYPE_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

const DailyTrainingCard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activePlan, setActivePlan] = useState<PlanRow | null>(null);
  const [todaySessions, setTodaySessions] = useState<DaySession[]>([]);
  const [showWarmup, setShowWarmup] = useState(false);
  const [showCooldown, setShowCooldown] = useState(false);
  const [waterMl, setWaterMl] = useState(0);
  const [waterGoal, setWaterGoal] = useState(3000);
  const [mealCount, setMealCount] = useState(0);
  const [totalCalories, setTotalCalories] = useState(0);
  const [readiness, setReadiness] = useState<number | null>(null);
  const [hasCheckedIn, setHasCheckedIn] = useState(false);
  const [upcomingEvent, setUpcomingEvent] = useState<EventRow | null>(null);
  const [isHolidayWeek, setIsHolidayWeek] = useState(false);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-30px" });
  const today = localDateKey();
  // An active availability window shows above everything else in the card,
  // plan or no plan — before 2026-10-06 an athlete on a holiday was told "No
  // training plan yet" with no mention of it (audit finding B1).
  const activeBreak = useActiveBreak();

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
              setTodaySessions([hasAdjusted as unknown as DaySession]);
            } else {
              const todaySession = weekData.sessions.find((s) => s.day === dayOfWeek && !s.skipped);
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
  // Whether the day-summary grid has anything real to show. A brand-new athlete
  // otherwise saw four tiles that were all placeholders stacked under an empty
  // state that already said there was no plan — see the note at the grid.
  // The day-summary tiles, built one at a time so a tile only exists when it
  // has a real number in it.
  //
  // This was one flag for the whole grid keyed on "is there anything at all",
  // and a training day always answered yes — so Water, Meals and Readiness each
  // printed an em dash beside one real number. Three dashes read as a screen
  // that failed to load, not one waiting for input, and this is the last thing
  // on the home screen so it is what the athlete remembers.
  type DayTile = {
    key: string;
    icon: typeof Droplets;
    tone: string;
    label: string;
    value: string;
    onPress?: () => void;
  };
  const tile = (ok: boolean, t: DayTile): DayTile | null => (ok ? t : null);
  const dayTiles = [
    tile(waterMl > 0, {
      key: "water", icon: Droplets, tone: "text-primary", label: "Water",
      value: `${(waterMl / 1000).toFixed(1)}L`,
    }),
    tile(mealCount > 0, {
      key: "meals", icon: Apple, tone: "text-emerald-400", label: "Meals",
      value: `${mealCount} · ${totalCalories}`,
    }),
    tile(readiness !== null, {
      key: "readiness", icon: Heart, tone: "text-destructive", label: "Readiness",
      value: `${readiness}`, onPress: () => navigate("/recovery"),
    }),
    tile(totalDayMinutes > 0, {
      key: "total", icon: Clock, tone: "text-primary", label: "Total",
      value: `${totalDayMinutes}m`,
    }),
  ].filter((t): t is DayTile => t !== null);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 12 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="mx-5 rounded-[22px] border border-white/[0.07] bg-card/70 sm:bg-card/60 sm:backdrop-blur-xl overflow-hidden shadow-card relative"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full blur-3xl opacity-20 sm:opacity-25 hidden sm:block" style={{ background: "radial-gradient(circle at center, hsl(var(--primary) / 0.35), transparent 68%)" }} />
      <div className="relative p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-primary shadow-glow animate-pulse-glow" />
            <span className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary">Today's Schedule</span>
            {zoneDot && (
              <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5">
                <span className={`h-2 w-2 rounded-full ${zoneDot.color}`} />
                <span className="text-[12px] font-bold tabular-nums text-muted-foreground">{readiness}/100</span>
              </span>
            )}
          </div>
          {activePlan && <span className="text-[12px] font-medium tabular-nums text-muted-foreground">Week {activePlan.week_current}/{activePlan.duration_weeks}</span>}
        </div>

        {activeBreak && (
          <div className="mb-3">
            <ActiveBreakBanner event={activeBreak} />
          </div>
        )}

        {!hasCheckedIn && activePlan && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            onClick={() => navigate("/recovery")}
            className="mb-3 rounded-2xl border border-primary/20 bg-primary/[0.07] backdrop-blur p-3 flex items-center gap-2.5 cursor-pointer hover:bg-primary/[0.10] transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
              <Heart size={14} className="text-primary-foreground" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold leading-none">Morning Check-In</p>
              <p className="text-[12px] text-muted-foreground leading-snug">Log your HRV & recovery to optimise today's training</p>
            </div>
            <span className="text-[12px] font-bold text-primary shrink-0">Go →</span>
          </motion.div>
        )}

        {session?._zone && (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1">
            <Zap size={10} className="text-primary" />
            <span className="text-[12px] font-bold tracking-wide text-primary">Auto-adjusted</span>
            {session._originalTitle && (
              <span className="text-[12px] text-muted-foreground line-through ml-1">{session._originalTitle}</span>
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
            <h3 className="font-display font-bold text-lg mt-3">No training plan yet</h3>
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
              <p className="text-[12px] font-semibold">Recommended today:</p>
              <p className="text-[12px] text-muted-foreground">• Light walk or swim (15-20 min)</p>
              <p className="text-[12px] text-muted-foreground">• Stretching & foam rolling</p>
              <p className="text-[12px] text-muted-foreground">• Hydrate well — {(waterGoal/1000).toFixed(1)}L+</p>
              <p className="text-[12px] text-muted-foreground">• Sleep 8-9 hours</p>
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
              <p className="text-[12px] font-semibold">What to do today:</p>
              {session?.exercises ? session.exercises.map((ex, i) => (
                <p key={i} className="text-[12px] text-muted-foreground">• {ex.name} — {ex.sets}</p>
              )) : (
                <>
                  <p className="text-[12px] text-muted-foreground">• Light stretching or yoga (15-20 min)</p>
                  <p className="text-[12px] text-muted-foreground">• Foam rolling major muscle groups</p>
                  <p className="text-[12px] text-muted-foreground">• 7-9 hours sleep tonight</p>
                  <p className="text-[12px] text-muted-foreground">• Stay hydrated — target {(waterGoal/1000).toFixed(1)}L+</p>
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
              <p className="text-[12px] font-semibold">Today's recovery session ({session.duration_minutes} min):</p>
              {session.exercises?.map((ex, i) => (
                <div key={i} className="py-0.5 text-[12px] text-muted-foreground">
                  <span className="block font-medium">• {ex.name}</span>
                  <span className="block pl-3 leading-snug">{ex.sets}</span>
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
            {/* Today's session IS the button.

                Two complaints met here. The card named the session but hid the
                work behind a "View Exercises" toggle, so the dashboard answered
                "what am I doing today?" with a count; and it could not open the
                day it was describing. Every exercise and its prescription is now
                always on screen, and the whole block opens the plan at this exact
                day — `/training?week=&day=` is the contract Training.tsx reads.
                Rows are stacked (name, then prescription) because the old
                side-by-side pair wrapped to four ragged lines on a 390px phone. */}
            <button
              type="button"
              onClick={() => navigate(`/training?week=${activePlan?.week_current ?? 1}&day=${session.day}`)}
              className="press w-full rounded-2xl border border-primary/15 bg-primary/[0.08] backdrop-blur px-3 py-3 mb-2 text-start transition-colors hover:bg-primary/[0.12]"
            >
              <span className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
                  <Flame size={14} className="text-primary-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-bold uppercase tracking-[0.14em] text-primary">
                    Today's session · {sessionTypeLabel(session.type)}
                  </span>
                  <span className="block font-display text-[16px] font-bold leading-snug">
                    {session.dayName ? `${session.dayName}: ` : ""}{session.title}
                  </span>
                </span>
                <span className="shrink-0 rounded-full border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-[12px] tabular-nums text-muted-foreground">
                  {session.duration_minutes} min
                </span>
              </span>

              {session.description && (
                <span className="mt-1.5 block text-[12px] leading-relaxed text-muted-foreground">{session.description}</span>
              )}

              {session.exercises && session.exercises.length > 0 && (
                <span className="mt-2.5 block space-y-1">
                  {session.exercises.map((ex, i) => (
                    <span key={i} className="block rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
                      <span className="block text-[13px] font-semibold leading-tight">{ex.name}</span>
                      <span className="block text-[12px] leading-snug text-primary/85">{ex.sets}</span>
                    </span>
                  ))}
                </span>
              )}

              <span className="mt-2.5 flex items-center gap-1 text-[12px] font-bold text-primary">
                View today's session <ChevronRight size={13} className="rtl-flip" aria-hidden />
              </span>
            </button>

            {session.warmup && session.warmup.length > 0 && (
              <div className="mb-2">
                <button onClick={() => setShowWarmup(!showWarmup)}
                  className="w-full flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] backdrop-blur px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] border border-white/[0.06]">
                    <Sun size={12} className="text-foreground" />
                  </span>
                  <span className="text-[12px] font-semibold flex-1 text-start">Warm-up ({session.warmup.length})</span>
                  {showWarmup ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                </button>
                {showWarmup && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-1.5 space-y-1 pl-1">
                    {/* Stacked, like the main session rows above: the same
                        side-by-side pair wrapped the prescription onto three
                        ragged lines on a phone. */}
                    {session.warmup.map((ex, i) => (
                      <div key={i} className="rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2">
                        <span className="block text-[12px] font-medium text-foreground">{ex.name}</span>
                        <span className="block text-[12px] leading-snug text-muted-foreground">{ex.sets}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </div>
            )}

            {session.cooldown && session.cooldown.length > 0 && (
              <div className="mb-3">
                <button onClick={() => setShowCooldown(!showCooldown)}
                  className="w-full flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] backdrop-blur px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] border border-white/[0.06]">
                    <StretchHorizontal size={12} className="text-foreground" />
                  </span>
                  <span className="text-[12px] font-semibold flex-1 text-start">Cool-down ({session.cooldown.length})</span>
                  {showCooldown ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                </button>
                {showCooldown && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-1.5 space-y-1 pl-1">
                    {session.cooldown.map((ex, i) => (
                      <div key={i} className="rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2">
                        <span className="block text-[12px] font-medium text-foreground">{ex.name}</span>
                        <span className="block text-[12px] leading-snug text-muted-foreground">{ex.sets}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <motion.button onClick={() => navigate("/train")} whileTap={{ scale: 0.98 }}
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

        {/* Only rendered when there is something to show.

            With no plan and no logs this grid was four placeholder tiles —
            Water "—", Meals "—", Readiness "—", Total "Rest" — sitting under an
            empty state that had just said there is no plan. A wall of em dashes
            reads as a screen that failed to load, not one waiting for input, and
            it is the last thing on the home screen so it is what the athlete
            remembers. Four meaningless tiles are worse than none; the empty
            state above already carries the one action that matters.

            2-up on phones: four columns inside a 320px viewport leaves ~65px per
            cell, which squeezes the icon, the value and the label into each
            other. Two columns keeps the same information readable. */}
        {dayTiles.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/[0.06] grid grid-cols-2 gap-2 sm:grid-cols-4">
          {dayTiles.map((tile) => (
            <div
              key={tile.key}
              onClick={tile.onPress}
              className={`rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur p-2.5 text-center ${tile.onPress ? "cursor-pointer hover:bg-white/[0.06] transition-colors" : ""}`}
            >
              <tile.icon size={13} className={`mx-auto mb-1 ${tile.tone}`} />
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{tile.label}</p>
              <p className="text-[12px] font-bold tabular-nums">{tile.value}</p>
            </div>
          ))}
        </div>
        )}

        {upcomingEvent && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            onClick={() => navigate("/events")}
            className="mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] backdrop-blur flex items-center gap-2.5 p-3 cursor-pointer hover:bg-white/[0.06] transition-colors">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.06] border border-white/[0.06]">
              <Calendar size={14} className="text-primary" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold leading-tight truncate">{upcomingEvent.title}</p>
              <p className="text-[12px] text-muted-foreground">
                {(() => {
                  const diff = new Date(upcomingEvent.event_date).getTime() - Date.now();
                  const days = Math.floor(diff / 86400000);
                  return days > 0 ? `${days} days away` : "Today!";
                })()}
              </p>
            </div>
            <span className="text-[12px] font-bold text-primary shrink-0">View →</span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

export default DailyTrainingCard;
