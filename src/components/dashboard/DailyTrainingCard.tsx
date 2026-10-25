interface PlanWeek { week: number; sessions?: DaySession[]; [key: string]: unknown }
import { motion, useInView } from "framer-motion";
import { localDateKey } from "@/lib/dates";
import { currentWeekOf } from "@/lib/planSchedule";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Play, Clock, Zap, Dumbbell, Sun, Moon, Flame, StretchHorizontal, ChevronDown, ChevronUp, Edit3, Droplets, Apple, Calendar, Heart } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBreak } from "@/hooks/useActiveBreak";
import ActiveBreakBanner from "@/components/ActiveBreakBanner";
import { claimStreakDay } from "@/lib/streakRewards";

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
  /** Declared rather than left to the index signature: the projection needs a
   *  date, and the anchor for every plan week is the day the plan was created. */
  created_at: string | null;
  [key: string]: unknown;
};

/**
 * The plan week the athlete is genuinely in.
 *
 * Same rule as the plan screen: `week_current` is written once by the generator
 * and never advanced, so reading it here pinned the dashboard's "Today's
 * Schedule" to week 1 for the life of the plan — a session the athlete had
 * already done being presented as today's training, and last night's check-in
 * appearing to change nothing. The week is derived from the plan's anchor and
 * today instead.
 */
const planWeekOf = (plan: PlanRow): number => currentWeekOf(plan) ?? plan.week_current ?? 1;

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

const DailyTrainingCard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activePlan, setActivePlan] = useState<PlanRow | null>(null);
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
  const [upcomingEvent, setUpcomingEvent] = useState<EventRow | null>(null);

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
      // Column lists, not "*": the dashboard card reads plan identity, the
      // current week and the week template — pulling every column (the plan
      // table carries several large ones) fed 4 full-screen cards off one
      // oversized row (audit finding 3.1).
      supabase.from("training_plans").select("id, created_at, plan_data, week_current, duration_weeks").eq("user_id", user.id).eq("active", true).limit(1),
      supabase.from("water_logs").select("amount_ml").eq("user_id", user.id).eq("log_date", today),
      supabase.from("user_settings").select("water_goal_ml").eq("user_id", user.id).maybeSingle(),
      supabase.from("meal_logs").select("calories").eq("user_id", user.id).eq("log_date", today),
      supabase.from("recovery_logs").select("readiness_score, adjusted_session").eq("user_id", user.id).eq("log_date", today).maybeSingle(),
      supabase.from("events").select("id, title, event_date").eq("user_id", user.id).gte("event_date", new Date().toISOString()).order("event_date", { ascending: true }).limit(1),
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
          const weekData = (plan.plan_data as PlanWeek[]).find((w) => w.week === planWeekOf(plan));
          if (weekData?.sessions) {
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
  }, [user, today]);

  // A break that stops training takes today's session off the card entirely.
  // The sessions inside it are not deleted — they are marked unavailable — but
  // an athlete who recorded a holiday must not be handed work by the dashboard.
  // This is the same rule the plan screen applies through the availability
  // statuses; the card reads it from the break itself because it never loads
  // `plan_events`.
  const breakStopsTraining = activeBreak?.allow_training === "no";
  const session = breakStopsTraining ? undefined : todaySessions[0];
  const isRestDay = session?.isRest;
  const isRecoveryDay = session?.isRecovery;
  const isTrainingDay = session && !isRestDay && !isRecoveryDay;

  // Rest days qualify the streak too — claimed from the dashboard card, where
  // the scheduled rest day is actually shown. It is a server-side ask: the RPC
  // verifies the active plan really schedules a rest day before inserting the
  // activity-day row, so a client guess can never mint one. Reference and day
  // are both today — a rest day's source is the day itself.
  const restClaimedRef = useRef("");
  useEffect(() => {
    if (!user || !isRestDay || breakStopsTraining) return;
    if (restClaimedRef.current === today) return;
    restClaimedRef.current = today;
    const day = localDateKey();
    void claimStreakDay("rest_day", day, day);
  }, [user, isRestDay, breakStopsTraining, today]);
  const noSession = !session && !!activePlan;
  const totalDayMinutes = isTrainingDay ? (session.duration_minutes + 20) : 0;
  const zoneDot = readiness !== null ? getZoneDot(readiness) : null;
  // Whether the day-summary grid has anything real to show. A brand-new athlete
  // otherwise saw four tiles that were all placeholders stacked under an empty
  // state that already said there was no plan — see the note at the grid.
  const hasDayStats = waterMl > 0 || mealCount > 0 || readiness !== null || totalDayMinutes > 0;

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
        {/* Wrap-safe: the label (~140px tracked-out) plus the readiness pill
            plus the week tag exceed a 320px content box (~248px), so a strict
            single row squeezed them into each other. The row may now wrap —
            the week tag drops to its own line — and the label steps down a
            size on narrow phones instead of forcing it. Nothing truncates: a
            clipped section header reads as broken, a wrapped one does not. */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary shadow-glow animate-pulse-glow" />
            <span className="whitespace-nowrap text-[12px] font-bold uppercase tracking-[0.16em] text-primary max-[400px]:text-[10.5px] max-[400px]:tracking-[0.1em]">Today's Schedule</span>
            {zoneDot && (
              <span className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5">
                <span className={`h-2 w-2 rounded-full ${zoneDot.color}`} />
                <span className="text-[12px] font-bold tabular-nums text-muted-foreground">{readiness}/100</span>
              </span>
            )}
          </div>
          {activePlan && <span className="shrink-0 text-[12px] font-medium tabular-nums text-muted-foreground">Week {planWeekOf(activePlan)}/{activePlan.duration_weeks}</span>}
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

        {(isRestDay || noSession) && (
          <>
            <h3 className="font-display font-bold text-lg">
              {breakStopsTraining ? "On a break" : "Rest & Recovery Day"}
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              {breakStopsTraining
                ? "Nothing is programmed while you are away. Your sessions are marked unavailable rather than moved into the days after it, and the plan builds back gradually when you return."
                : "No training scheduled. Focus on recovery."}
            </p>
            {/* A break that stops training gets no activity list. Recording one
                is the athlete saying the app should stop asking, so the one
                thing this card must not do is hand them a workout or a
                stretching routine. The list stays for an ordinary rest day. */}
            {!breakStopsTraining && (
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
            )}
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
              {/* The bullet is its own column and the dose is content-sized: with
                  the bullet inside the name string, a name long enough to wrap
                  continued UNDER the dot instead of under its own first word. */}
              {session.exercises?.map((ex, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5 text-[12px] text-muted-foreground">
                  <span aria-hidden className="shrink-0 text-primary">•</span>
                  <span className="min-w-0 flex-1">{ex.name}</span>
                  <span className="shrink-0 ps-2 text-right font-medium">{ex.sets}</span>
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
                  <span className="text-[12px] tabular-nums text-muted-foreground mr-1">10 min</span>
                  {showWarmup ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                </button>
                {showWarmup && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-1.5 space-y-1 pl-1">
                    {session.warmup.map((ex, i) => (
                      <div key={i} className="flex items-start justify-between gap-2 rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2 text-[12px] text-muted-foreground">
                        <span className="min-w-0 flex-1">{ex.name}</span>
                        <span className="shrink-0 text-right font-medium">{ex.sets}</span>
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
                <span className="text-[12px] tabular-nums text-muted-foreground border border-white/[0.06] bg-white/[0.04] rounded-full px-2 py-0.5">{session.duration_minutes} min</span>
              </div>
              {session.description && (
                <p className="text-[12px] leading-relaxed text-muted-foreground">{session.description}</p>
              )}
              {session.exercises && session.exercises.length > 0 && !expanded && (
                <p className="text-[12px] text-primary/75 mt-2 font-medium">{session.exercises.length} exercises · Tap below for details</p>
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
                        <span className="text-[12px] text-primary font-medium">{ex.sets}</span>
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
                  <span className="text-[12px] tabular-nums text-muted-foreground mr-1">10 min</span>
                  {showCooldown ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                </button>
                {showCooldown && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-1.5 space-y-1 pl-1">
                    {session.cooldown.map((ex, i) => (
                      <div key={i} className="flex items-start justify-between gap-2 rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2 text-[12px] text-muted-foreground">
                        <span className="min-w-0 flex-1">{ex.name}</span>
                        <span className="shrink-0 text-right font-medium">{ex.sets}</span>
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
        {hasDayStats && (
        <div className="mt-4 pt-4 border-t border-white/[0.06] grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur p-2.5 text-center">
            <Droplets size={13} className="mx-auto text-primary mb-1" />
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Water</p>
            <p className="text-[12px] font-bold tabular-nums">{waterMl > 0 ? `${(waterMl/1000).toFixed(1)}L` : "—"}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur p-2.5 text-center">
            <Apple size={13} className="mx-auto text-emerald-400 mb-1" />
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Meals</p>
            <p className="text-[12px] font-bold tabular-nums">{mealCount > 0 ? `${mealCount} · ${totalCalories}` : "—"}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur p-2.5 text-center cursor-pointer hover:bg-white/[0.06] transition-colors" onClick={() => navigate("/recovery")}>
            <Heart size={13} className="mx-auto text-destructive mb-1" />
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Readiness</p>
            <p className="text-[12px] font-bold tabular-nums">{readiness !== null ? `${readiness}` : "—"}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur p-2.5 text-center">
            <Clock size={13} className="mx-auto text-primary mb-1" />
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
            <p className="text-[12px] font-bold tabular-nums">{totalDayMinutes > 0 ? `${totalDayMinutes}m` : "Rest"}</p>
          </div>
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
