import { getAiLocale } from "@/i18n";
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { Dumbbell, TrendingUp, Zap, ChevronRight, Plus, X, Target, Activity, AlertTriangle, Eye, Calendar, Edit3, ChevronDown, ChevronUp, Trash2, SkipForward, PauseCircle, Check, Undo2, Info, Loader2, Wand2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { spendCredits, creditCost, spendErrorMessage, featureLabel } from "@/lib/credits";
import { useSpendWithTopUp } from "@/hooks/useSpendWithTopUp";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { Tables, type Json } from "@/integrations/supabase/types";
import { getPrimarySport } from "@/lib/profile";
import { getAgeCaps, buildClientDossier } from "@/lib/athleteDossier";
import { LIMITER_QUESTIONS, analyzeLimiterTest, type LimiterAnalysis } from "@/lib/limiterTest";
import type { MetricRow } from "@/lib/performance";
import { EQUIPMENT, describeEquipment, normaliseEquipment, type EquipmentId } from "@/config/equipment";
import { DISCLAIMERS } from "@/config/disclaimers";
import { useAdaptiveSchedule } from "@/hooks/useAdaptiveSchedule";
import { sessionStatusMeta } from "@/lib/lifeEvents";
import { useActiveBreak } from "@/hooks/useActiveBreak";
import ActiveBreakBanner from "@/components/ActiveBreakBanner";
import { breakBriefForGenerator, rebuildPlanForBreak, undoPlanRebuild } from "@/lib/adaptivePlanning";
import { readRecoveryForPlan, type RecoveryReadResult } from "@/lib/recoveryPlanning";
import type { AdjustmentDecision } from "@/lib/recoveryAdjust";
import { explainDecision, explainWeek } from "@/lib/explanations";
import { WhyBody } from "@/components/insights/WhyDisclosure";
import { loadColumnsFor } from "@/lib/recoveryPlanning";
import type { ReturnSessionMeta, ReturnWeekMeta } from "@/lib/planSchedule";
import { matchesAdvice, recommendSetup, type SetupAdvice } from "@/lib/planSetupAdvice";
import { AdvicePanel, AdvancedFreedomNote, RecommendedChip } from "@/components/training/PlanSetupAdvice";
import PlanGenerationProgress from "@/components/training/PlanGenerationProgress";
import {
  MAX_EDIT_INSTRUCTION,
  MIN_EDIT_INSTRUCTION,
  editCost,
  editCostKey,
  newEditRequestId,
  requestPlanEdit,
  spliceEditedWeeks,
  validateEditInstruction,
  weeksForEdit,
  type PlanEditOutcome,
} from "@/lib/planEdit";
import { requestCreditTopUp } from "@/lib/topUpStore";

type TrainingPlan = Tables<"training_plans">;

// Multi-goal: chips toggle on/off; the DB `goal` column stays a plain string,
// so selections are comma-joined (generate-plan accepts ≤300 chars).
const MAX_GOAL_LEN = 300;
const joinGoals = (arr: string[]): string => {
  const s = arr.join(", ");
  return s.length > MAX_GOAL_LEN ? s.slice(0, MAX_GOAL_LEN).trimEnd().replace(/,\s*\S*$/, "") : s;
};

const sportOptions = ["Running", "Gym/Weightlifting", "Football", "Basketball", "Swimming", "Cycling", "Tennis", "Rugby", "Boxing", "Athletics", "Triathlon", "CrossFit", "General"];
const goalOptions = ["Speed", "Strength", "Endurance", "Fat Loss", "Muscle Gain", "Power", "Agility"];
const levelOptions = ["beginner", "intermediate", "advanced"];
const durationOptions = [4, 6, 8, 12];

// ---------------------------------------------------------------------------
// Today's read — Phase 3
// ---------------------------------------------------------------------------

/**
 * How each kind of read is coloured.
 *
 * The tone is the message: green means "your plan stands", amber means "do
 * less", red means "not today", and grey means "I don't know". An athlete
 * reading a colour before they read a sentence is reading it correctly, so the
 * colours are not decoration and none of them is used for a suggestion the
 * rules did not actually make.
 */
const READ_TONE: Record<AdjustmentDecision["action"], { ring: string; chip: string; icon: typeof Activity }> = {
  proceed: { ring: "border-success/25 bg-success/[0.06]", chip: "bg-success/10 text-success", icon: Check },
  preserve: { ring: "border-border bg-muted/30", chip: "bg-muted text-muted-foreground", icon: Check },
  reduce: { ring: "border-energy/25 bg-energy/[0.06]", chip: "bg-energy/10 text-energy", icon: TrendingUp },
  swap: { ring: "border-energy/25 bg-energy/[0.06]", chip: "bg-energy/10 text-energy", icon: TrendingUp },
  move: { ring: "border-energy/25 bg-energy/[0.06]", chip: "bg-energy/10 text-energy", icon: TrendingUp },
  recover: { ring: "border-info/25 bg-info/[0.06]", chip: "bg-info/10 text-info", icon: Activity },
  blocked: { ring: "border-destructive/25 bg-destructive/[0.06]", chip: "bg-destructive/10 text-destructive", icon: PauseCircle },
  insufficient: { ring: "border-border bg-muted/30", chip: "bg-muted text-muted-foreground", icon: Info },
};

/**
 * Today's read, in the athlete's own numbers.
 *
 * Three rules govern what this shows:
 *
 *   • Every suggestion carries its evidence. The "Why" is not optional detail
 *     behind a tap that nobody finds — it is the same sentence the rules built,
 *     listing only numbers the athlete entered or figures derived from their own
 *     sessions.
 *
 *   • "I don't know" gets real space. When there is nothing logged, the panel
 *     says the specification's sentence and says what would change it, rather
 *     than showing a confident default.
 *
 *   • Nothing here edits the plan. This is a suggestion with a reason, and the
 *     plan stays what the athlete approved — the same contract Phase 2's
 *     rebuild kept, and the reason the rules are deterministic rather than a
 *     prompt.
 */
/**
 * The one line each decision gets in the collapsed list.
 *
 * "—" is not a label. A session the rules declined to touch says so in words,
 * because a dash next to a session reads as a bug or as a number that failed to
 * load, and neither is what happened.
 */
const decisionLabel = (decision: AdjustmentDecision): string => {
  switch (decision.action) {
    case "blocked":
      return "Not available";
    case "insufficient":
      return "Not enough information";
    case "preserve":
    case "proceed":
      return "As planned";
    default:
      return decision.volumePct !== null ? `Keep ${decision.volumePct}%` : "Adjusted";
  }
};

const RecoveryTodayRead = ({
  read,
  loading,
  expanded,
  onToggle,
}: {
  read: RecoveryReadResult;
  loading: boolean;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const today = read.facts.today;
  // Phase 6: the week's own recommendation, in the shared shape. Null when the
  // week is left alone, which is why it is rendered conditionally below.
  const weekExplanation = explainWeek(read.week);
  const decisions = read.week.decisions;
  const todayDecision = decisions.find((d) => d.date === today) ?? null;
  const thisWeek = decisions.filter((d) => d.date >= today && d.date <= addSixDays(today));

  const changed = thisWeek.filter(
    (d) => d.action === "reduce" || d.action === "swap" || d.action === "move" || d.action === "recover",
  );
  const blocked = thisWeek.filter((d) => d.action === "blocked");
  const headlineDecision = todayDecision ?? changed[0] ?? blocked[0] ?? null;

  // A panel with nothing in it is worse than no panel: it reads as "nothing to
  // report", which is not the same as "we have not looked".
  if (!headlineDecision) {
    if (read.week.uncertainty) {
      return (
        <div className={`rounded-xl border p-3 ${READ_TONE.insufficient.ring}`}>
          <div className="flex items-start gap-2">
            <Info size={14} className="text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold">Today's read</p>
              <p className="text-[12px] text-muted-foreground mt-1">{read.week.uncertainty}</p>
              <p className="text-[12px] text-muted-foreground/80 mt-1.5">
                A recovery check-in and a few logged sessions are all it takes.
              </p>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  const tone = READ_TONE[headlineDecision.action];
  const Icon = tone.icon;
  const label =
    headlineDecision.action === "blocked"
      ? "Not a training day"
      : headlineDecision.action === "insufficient"
        ? "Today's read"
        : headlineDecision.action === "preserve"
          ? "Leave it as it is"
          : "Today's read";

  return (
    <div className={`rounded-xl border overflow-hidden ${tone.ring}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full text-start p-3 flex items-start gap-2"
      >
        <Icon size={14} className="mt-0.5 shrink-0 text-current" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-xs font-semibold">{label}</span>
            {headlineDecision.volumePct !== null && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded font-bold ${tone.chip}`}>
                keep {headlineDecision.volumePct}%
              </span>
            )}
            {loading && <span className="text-[11px] text-muted-foreground">refreshing…</span>}
          </span>
          <span className="block text-[12px] text-muted-foreground mt-1">
            {/* When the rules declined to act, the reason IS the message. Showing
                "No recommendation yet" in the collapsed state and the actual
                sentence behind a tap would mean the athlete learns nothing
                about whether the app is working until they expand it. */}
            {headlineDecision.action === "insufficient" && headlineDecision.uncertainty
              ? headlineDecision.uncertainty
              : headlineDecision.headline}
          </span>
        </span>
        <ChevronDown size={14} className={`text-muted-foreground shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">


          {/* §8: an adjustment computed offline is still useful, but only if the
              athlete knows it is the last one the app managed to compute rather
              than a fresh reading. */}
          {read.fromCache && (
            <p className="text-[12px] text-energy">
              Saved from your last check-in — we could not reach your account just now, so nothing here has been recalculated.
            </p>
          )}

          {thisWeek.length > 0 && (
            <div className="space-y-1 pt-1">
              {thisWeek.map((decision) => (
                <div key={`${decision.date}-${decision.title}`} className="flex items-baseline justify-between gap-2 text-[12px] text-muted-foreground">
                  <span className="min-w-0 truncate">
                    {formatShortDay(decision.date)} · {decision.title}
                  </span>
                  <span className="shrink-0 text-end">{decisionLabel(decision)}</span>
                </div>
              ))}
            </div>
          )}

          {headlineDecision.uncertainty && (
            <p className="text-[12px] text-muted-foreground italic">{headlineDecision.uncertainty}</p>
          )}

          {/* The reasons, spelled out, through the shared explanation framework.
              The strings are the same ones the rules assembled — `explainDecision`
              is built from this decision's own evidence — so the screen cannot
              drift from what was decided, and the Training screen, the insights
              screen and the weekly report now explain the same decision in the
              same shape. §6's uncertainty sentence is rendered above and only
              when the rules held back; the framework adds the "what this means"
              line and the closing honesty about what this screen is. */}
          {/* ONE explanation, at the level that has something to say.

              The week's reduction comes first when there is one, because it is
              the recommendation the athlete is being asked to act on and it
              carries the number the rules averaged. Otherwise the session's own
              reading is used, which is the case when a hard constraint or a
              single recovery flag changed one session and left the week alone.

              Rendering both was tried and removed: the week's reasons ARE the
              union of the changed sessions' reasons, so today's session appears
              in both lists and every bullet was printed twice. The reasons, the
              rationale and the closing line all come from the shared framework
              either way, so the two levels cannot disagree about anything. */}
          <div className="pt-1">
            <WhyBody
              explanation={weekExplanation ?? explainDecision(headlineDecision)}
              // The week's headline is not on screen anywhere else; the
              // session's already is, in the row above.
              showHeadline={!!weekExplanation}
            />
          </div>
        </div>
      )}
    </div>
  );
};

/** `YYYY-MM-DD` → "Mon 6 Oct", built by hand so it cannot shift by timezone. */
const formatShortDay = (key: string): string => {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  const date = new Date(y, m - 1, d);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  // `getDay()` is Sunday-first; the plan grid is Monday-first.
  const weekday = days[(date.getDay() + 6) % 7];
  return `${weekday} ${date.getDate()} ${months[m - 1]}`;
};

/** Six days after a `YYYY-MM-DD` key — the end of the plan week containing it. */
const addSixDays = (key: string): string => {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + 6);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
};

const Training = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const spendWithTopUp = useSpendWithTopUp();
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  // The break banner on the plans view (audit B1): an active availability
  // window is visible here, not only on /availability.
  const activeBreak = useActiveBreak();
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState<"plans" | "limiter" | "log" | "planDetail">("plans");
  const [selectedPlan, setSelectedPlan] = useState<TrainingPlan | null>(null);
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  const [editingSession, setEditingSession] = useState<{ week: number; day: number } | null>(null);
  const [editSessionTitle, setEditSessionTitle] = useState("");
  const [editSessionDuration, setEditSessionDuration] = useState("");
  const toolsRef = useRef(null);
  const toolsInView = useInView(toolsRef, { once: true, margin: "-50px" });

  // The adaptive record for whichever plan is open. Called at the top level
  // and handed a null plan when none is open, because the plan-detail view is
  // an early return further down and a hook cannot live inside it.
  const adaptive = useAdaptiveSchedule(activeView === "planDetail" ? selectedPlan : null);

  // Phase 3: the recovery-aware read for this week. Deliberately read once per
  // plan and once per recovery log, not per render and not per session — the
  // pure layer in `recoveryAdjust.ts` does the deciding, so this hook only has
  // to gather facts. It degrades to `null` rather than an error banner: an
  // athlete who is offline still gets their plan, just without the read.
  const [recoveryRead, setRecoveryRead] = useState<RecoveryReadResult | null>(null);
  const [recoveryReadLoading, setRecoveryReadLoading] = useState(false);
  const [showRecoveryWhy, setShowRecoveryWhy] = useState(false);

  const planForRead = activeView === "planDetail" ? selectedPlan : null;
  useEffect(() => {
    if (!user || !planForRead) {
      setRecoveryRead(null);
      return;
    }
    let alive = true;
    setRecoveryReadLoading(true);
    readRecoveryForPlan({
      userId: user.id,
      plan: planForRead,
      dateOfBirth: profile?.date_of_birth ?? null,
    })
      .then((result) => {
        if (alive) setRecoveryRead(result);
      })
      .catch(() => {
        // The read is enrichment. A plan that cannot show a suggestion is still
        // a plan, and an error here would be noise the athlete cannot act on.
        if (alive) setRecoveryRead(null);
      })
      .finally(() => {
        if (alive) setRecoveryReadLoading(false);
      });
    return () => {
      alive = false;
    };
    // `planForRead` itself is a fresh object on every render, so depending on
    // it would refetch the read in a loop. Its two identifying fields are the
    // real dependencies: the plan's id, and the stored weeks the projection
    // reads (which change when a session is edited or a rebuild lands).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scoped above
  }, [user, planForRead?.id, planForRead?.plan_data, profile?.date_of_birth]);
  const [expandedChange, setExpandedChange] = useState<string | null>(null);
  const [expandedRebuild, setExpandedRebuild] = useState<string | null>(null);
  const [undoingRebuild, setUndoingRebuild] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [sport, setSport] = useState(getPrimarySport(profile?.sport));
  const [goals, setGoals] = useState<string[]>(["Strength"]);
  const toggleGoal = (g: string) =>
    setGoals((prev) =>
      prev.includes(g)
        ? (prev.length > 1 ? prev.filter((x) => x !== g) : prev) // never leave the athlete with zero goals
        : [...prev, g],
    );
  const [level, setLevel] = useState(profile?.experience_level || "beginner");
  const [duration, setDuration] = useState(6);
  const [planAge, setPlanAge] = useState("");
  // Training-plan quiz (NEW — was previously asked at signup)
  const [planDaysPerWeek, setPlanDaysPerWeek] = useState<number>(4);
  const [planHoursPerWeek, setPlanHoursPerWeek] = useState<number>(6);
  const [planSessionLengthPref, setPlanSessionLengthPref] = useState<"short" | "standard" | "long">("standard");
  const [planEquipment, setPlanEquipment] = useState<EquipmentId[]>([]);
  const [planEnvironment, setPlanEnvironment] = useState<string>("Mixed");
  const [planIntensityPref, setPlanIntensityPref] = useState<"easy" | "balanced" | "hard">("balanced");
  const [planFocusAreas, setPlanFocusAreas] = useState<string[]>([]);
  const [planTimeOfDay, setPlanTimeOfDay] = useState<string>("Evening");
  const [planTargetEvent, setPlanTargetEvent] = useState<string>("");
  const [planRecoveryDays, setPlanRecoveryDays] = useState<number>(1);

  // AI plan edit — the paid path (see `@/lib/planEdit`).
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [aiEditScope, setAiEditScope] = useState<"week" | "plan">("week");
  const [aiEditWeek, setAiEditWeek] = useState<number>(1);
  const [aiEditInstruction, setAiEditInstruction] = useState("");
  const [aiEditBusy, setAiEditBusy] = useState(false);
  const [planQuizStep, setPlanQuizStep] = useState<number>(0); // 0 = basics, 1 = availability, 2 = preferences


  // Limiter test state
  const [limiterStep, setLimiterStep] = useState(0);
  const [limiterAnswers, setLimiterAnswers] = useState<Record<string, number>>({});
  const [limiterResult, setLimiterResult] = useState<LimiterAnalysis | null>(null);
  const [creatingLimiterPlan, setCreatingLimiterPlan] = useState(false);
  // Logged test data strengthens the analysis; without it the test still runs
  // on self-ratings (marked as such) — never on invented numbers.
  const [limiterMetrics, setLimiterMetrics] = useState<MetricRow[]>([]);
  const [limiterReadiness, setLimiterReadiness] = useState<{ readiness_score: number | null }[]>([]);

  useEffect(() => {
    if (activeView !== "limiter" || !user) return;
    let alive = true;
    Promise.all([
      supabase.from("performance_metrics").select("metric_type, value, log_date").eq("user_id", user.id).order("log_date", { ascending: false }).limit(40),
      supabase.from("recovery_logs").select("readiness_score, log_date").eq("user_id", user.id).order("log_date", { ascending: false }).limit(14),
    ]).then(([m, r]) => {
      if (!alive) return;
      setLimiterMetrics((m.data as MetricRow[]) || []);
      setLimiterReadiness((r.data as { readiness_score: number | null }[]) || []);
    }).catch(() => { /* self-ratings still work without server data */ });
    return () => { alive = false; };
  }, [activeView, user]);

  // Performance log state
  type PerformanceLog = Tables<"performance_logs">;
  const [logs, setLogs] = useState<PerformanceLog[]>([]);
  const [showAddLog, setShowAddLog] = useState(false);
  const [logTitle, setLogTitle] = useState("");
  const [logDistance, setLogDistance] = useState("");
  const [logTime, setLogTime] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [logSport, setLogSport] = useState("Running");
  const [logType, setLogType] = useState("training");
  const [logRPE, setLogRPE] = useState("7");
  const [logFormRating, setLogFormRating] = useState("7");
  const [logHeartRate, setLogHeartRate] = useState("");
  const [logCalories, setLogCalories] = useState("");

  useEffect(() => {
    setSport(getPrimarySport(profile?.sport));
    setLevel(profile?.experience_level || "beginner");
    if (profile?.date_of_birth) {
      const age = Math.floor((Date.now() - new Date(profile.date_of_birth).getTime()) / 31557600000);
      setPlanAge(String(age));
    }
  }, [profile?.experience_level, profile?.sport, profile?.date_of_birth]);

  useEffect(() => { if (user) { fetchPlans(); fetchLogs(); } }, [user]);

  // Prefill from calendar block ("Create matching plan")
  const [pendingBlockLink, setPendingBlockLink] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("vaylo_plan_prefill");
      if (!raw) return;
      const p = JSON.parse(raw);
      sessionStorage.removeItem("vaylo_plan_prefill");
      if (p.duration_weeks) setDuration(Number(p.duration_weeks));
      if (p.targetEvent) setPlanTargetEvent(p.targetEvent);
      const prefillPhase = p.phase as string | undefined;
      if (prefillPhase === "Base") setGoals(["Endurance"]);
      else if (prefillPhase === "Build") setGoals(["Strength"]);
      else if (prefillPhase === "Peak") setGoals(["Speed"]);
      else if (prefillPhase === "Taper") setGoals(["Recovery"]);
      if (p.blockId) setPendingBlockLink(p.blockId);
      setShowCreate(true);
      setPlanQuizStep(0);
      toast({ title: "Prefilled from calendar", description: `Creating a matching ${p.phase} plan.` });
    } catch { /* ignore */ }
  }, []);

  // Pre-select the equipment answered at signup, so the same question is not
  // asked twice with a different answer. Only fills an empty selection: if the
  // athlete has already ticked something here, that is the more recent intent.
  useEffect(() => {
    if (planEquipment.length) return;
    const saved = normaliseEquipment((profile?.extended_profile as Record<string, unknown> | null)?.equipment);
    if (saved.length) setPlanEquipment(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per profile, not on every tick
  }, [profile]);

  const fetchPlans = async () => {
    if (!user) return;
    const { data } = await supabase.from("training_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setPlans(data || []);
  };

  // ---------------------------------------------------------------------------
  // Deep link into ONE day: `/training?week=3&day=5`
  // ---------------------------------------------------------------------------
  // The dashboard's "today" card is the surface an athlete actually taps, so the
  // link it follows has to land on the session it just described — not on the
  // plan list, with the right week collapsed and the right day somewhere below
  // the fold. `day` is 1 = Monday … 7 = Sunday, the same numbering the plan
  // itself stores, so the two can never disagree about which day is which.
  const [searchParams] = useSearchParams();
  const deepLinkApplied = useRef<string | null>(null);
  const [highlightDay, setHighlightDay] = useState<{ week: number; day: number } | null>(null);

  useEffect(() => {
    const rawWeek = searchParams.get("week");
    const rawDay = searchParams.get("day");
    if (!rawWeek || !rawDay) return;
    const week = Number(rawWeek);
    const day = Number(rawDay);
    if (!Number.isInteger(week) || !Number.isInteger(day)) return;

    const key = `${week}:${day}`;
    if (deepLinkApplied.current === key) return;

    // The active plan is the one the dashboard card read from; falling back to
    // the newest keeps a link working for a plan that was replaced since.
    const plan = plans.find((p) => p.active) ?? plans[0];
    if (!plan) return; // plans not loaded yet — this effect runs again when they are

    const weeks = Array.isArray(plan.plan_data) ? (plan.plan_data as { week: number }[]) : [];
    // A link naming a week this plan does not have (an old plan, a shortened
    // one) is ignored silently: opening an empty week would look like a bug.
    if (!weeks.some((w) => Number(w.week) === week)) return;

    deepLinkApplied.current = key;
    setSelectedPlan(plan);
    setActiveView("planDetail");
    setExpandedWeek(week);
    setHighlightDay({ week, day });
  }, [searchParams, plans]);

  // Bring the named day into view once its week is expanded, then let the
  // highlight go. A ring that stays put reads as a selected state the athlete
  // cannot clear; one that fades reads as "this is the one you asked for".
  useEffect(() => {
    if (!highlightDay) return;
    const scrollToDay = () =>
      document
        .querySelector(`[data-plan-day="${highlightDay.week}-${highlightDay.day}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Twice: the week opens with a height animation, so the day is already in
    // the DOM when the first pass runs but its final position is not settled
    // yet. The second pass lands it where it ends up rather than where it was
    // mid-animation.
    const first = window.setTimeout(scrollToDay, 160);
    const second = window.setTimeout(scrollToDay, 700);
    const clear = window.setTimeout(() => setHighlightDay(null), 2600);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
      window.clearTimeout(clear);
    };
  }, [highlightDay]);

  const deletePlan = async (planId: string) => {
    if (!user) return;
    const { error } = await supabase.from("training_plans").delete().eq("id", planId).eq("user_id", user.id);
    if (error) { toast({ title: "Couldn't delete plan", description: error.message, variant: "destructive" }); return; }
    setPlans(plans.filter(p => p.id !== planId));
    toast({ title: "Plan deleted" });
  };

  const fetchLogs = async () => {
    if (!user) return;
    const { data } = await supabase.from("performance_logs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
    setLogs(data || []);
  };

  const getAge = () => {
    if (planAge) return parseInt(planAge);
    if (!profile?.date_of_birth) return null;
    return Math.floor((Date.now() - new Date(profile.date_of_birth).getTime()) / 31557600000);
  };

  const createPlan = async () => {
    if (!user || !profile) return;
    const age = getAge();
    if (!age) { toast({ title: "Age required", description: "Enter your age or set DOB in Profile.", variant: "destructive" }); return; }
    // Multi-goal: keep every selected goal in one comma-joined string for the
    // DB column and the generate-plan payload.
    const goal = joinGoals(goals);
    if (!goal) { toast({ title: "Pick at least one goal", variant: "destructive" }); return; }
    const caps = getAgeCaps(age);
    // Clamp availability to age-safe caps before spending/asking AI
    const requestedDays = planDaysPerWeek;
    const clampedDays = Math.min(requestedDays, caps.maxSessionsPerWeek, Math.max(1, 7 - caps.minRestDays));
    if (clampedDays < requestedDays) {
      toast({ title: `Capped to ${clampedDays} days/week`, description: `Age ${age} safety cap: max ${caps.maxSessionsPerWeek} sessions/week with ≥${caps.minRestDays} rest days.`, variant: "default" });
    }
    const cappedHours = Math.min(planHoursPerWeek, (clampedDays * caps.maxMinutesPerSession) / 60);

    setLoading(true);
    try {
      // The generate-plan function verifies auth, throttles and charges
      // training_plan_week credits server-side (with auto-refund on failure).
      const dossier = await buildClientDossier().catch(() => null);
      // Phase 2: what the athlete's own availability says. A plan created the
      // week after a break must not be written as if they were never away.
      // Best-effort — a failed read generates exactly the plan it did before.
      const brief = await breakBriefForGenerator({ userId: user.id, age }).catch(() => null);
      const quiz = {
        daysPerWeek: clampedDays,
        hoursPerWeek: cappedHours,
        sessionLengthPref: planSessionLengthPref,
        equipment: planEquipment,
        environment: planEnvironment,
        intensityPref: age !== null && age < 16 && planIntensityPref === "hard" ? "balanced" as const : planIntensityPref,
        focusAreas: planFocusAreas,
        timeOfDay: planTimeOfDay,
        targetEvent: planTargetEvent,
        recoveryDays: Math.max(planRecoveryDays, caps.minRestDays),
        ageCaps: caps,
      };
      let planData: PlanData | null = null;
      let chargeError: string | null = null;
      try {
        const { data: aiData, error: aiErr } = await supabase.functions.invoke("generate-plan", {
          body: {
            sport, goal, level, duration_weeks: duration, age, quiz, userLocale: getAiLocale(),
            pbs: dossier?.pbs ?? null,
            dossier: dossier ? { pbs_text: dossier.pbs_text, outcomeGoals: dossier.outcomeGoals, injuries: dossier.injuries } : null,
            // The generator is told about breaks; it is not asked to do the
            // arithmetic for them. See `src/lib/adaptivePlanning.ts`.
            breaks: brief?.breaks ?? [],
            returns: brief?.returns ?? [],
          },
        });
        if (aiErr) {
          chargeError = await edgeErrorMessage(aiErr);
        } else if (aiData?.plan_data && Array.isArray(aiData.plan_data) && aiData.plan_data.length > 0) {
          planData = aiData.plan_data;
          if (aiData.cost) await refreshProfile();
        }
      } catch { /* fall through to heuristic */ }
      if (chargeError) {
        setLoading(false);
        toast({ title: "Plan not created", description: chargeError, variant: "destructive" });
        return;
      }
      if (!planData) planData = generatePlanData(sport, goal, level, duration, age, quiz);

      const planRow = {
        user_id: user.id, title: title.trim() || `${goals.join(" + ")} ${sport} Plan`, sport, goal, level, duration_weeks: duration,
        description: `${duration}-week ${goals.join(" + ").toLowerCase()} plan for ${sport.toLowerCase()} (age ${age}) · ${planDaysPerWeek}d/wk · ${planHoursPerWeek}h/wk · ${planIntensityPref} intensity${planTargetEvent ? ` · targeting ${planTargetEvent}` : ""}`,
        plan_data: planData as unknown as Json,
      };
      // The charge for this plan already happened inside generate-plan, so an
      // insert that fails is an athlete who has paid for a plan that does not
      // exist. The plan is sitting in memory right here, so one retry — after a
      // beat — costs nothing and covers the ordinary transient failure. Only if
      // that fails too is the athlete told the truth: the plan was written, the
      // save failed, and the credits need returning by support.
      let inserted = await supabase.from("training_plans").insert(planRow).select("id").single();
      if (inserted.error || !inserted.data) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        inserted = await supabase.from("training_plans").insert(planRow).select("id").single();
      }
      if (inserted.error || !inserted.data) {
        setLoading(false);
        toast({
          title: "Your plan was written but not saved",
          description: "Please do not create it again yet — that would charge you a second time. Contact support from Profile and quote this message; the credits will be put back.",
          variant: "destructive",
        });
        return;
      }

      const insertedId = inserted.data.id;

      // A plan created days after a break *is* a return from that break, so the
      // same rebuild that runs when a break is added runs here too: the athlete
      // never gets a "week 1 at full load" plan the week after a month off.
      // Best-effort — the plan exists and works without it.
      let rebuiltForBreak = false;
      if (brief?.returnEvent) {
        const rebuilt = await rebuildPlanForBreak({
          userId: user.id,
          plan: {
            id: insertedId,
            created_at: new Date().toISOString(),
            plan_data: planData as unknown as Json,
            plan_adjustments: [],
          },
          event: brief.returnEvent,
          age,
        }).catch(() => null);
        rebuiltForBreak = !!rebuilt?.outcome?.adjustment;
      }

      // Periodisation calendar removed — no block linking.

      await refreshProfile();
      toast({
        title: "Plan Created! 🎯",
        description: rebuiltForBreak
          ? "You're coming back from a break, so the first weeks are a rebuild rather than a return to your old workload."
          : undefined,
      });
      void insertedId;
      setShowCreate(false); setTitle(""); setPlanQuizStep(0); fetchPlans();
    } catch (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    finally { setLoading(false); }
  };

  type PlanSession = {
    day: number;
    dayName?: string;
    title: string;
    type: string;
    duration_minutes: number;
    description?: string;
    exercises?: { name: string; sets: string }[];
    warmup?: { name: string; sets: string }[];
    cooldown?: { name: string; sets: string }[];
    isRest?: boolean;
    isRecovery?: boolean;
    skipped?: boolean;
    originalTitle?: string;
    originalExercises?: { name: string; sets: string }[];
    /** Written by the return-from-break rebuild. See `@/lib/planSchedule`. */
    returnFromBreak?: ReturnSessionMeta;
    /** Marked by the rebuild so the plan knows which sessions carry the week. */
    key?: boolean;
    [key: string]: unknown;
  };

  type PlanWeek = {
    week: number;
    sessions: PlanSession[];
    isDeload?: boolean;
    isHoliday?: boolean;
    redistributedFrom?: number;
    extraNote?: string;
    /** Present only on a week the return-from-break rebuild re-cut. */
    returnFromBreak?: ReturnWeekMeta;
    [key: string]: unknown;
  };

  type PlanData = PlanWeek[];

  type PlanQuiz = {
    daysPerWeek: number; hoursPerWeek: number; sessionLengthPref: "short" | "standard" | "long";
    equipment: string[]; environment: string; intensityPref: "easy" | "balanced" | "hard";
    focusAreas: string[]; timeOfDay: string; targetEvent: string; recoveryDays: number;
  };

  const generatePlanData = (sport: string, goal: string, level: string, weeks: number, age: number | null, quiz?: PlanQuiz) => {
    const isYouth = age !== null && age < 18;
    const isSenior = age !== null && age > 50;
    // Use quiz-provided days-per-week when available; fall back to legacy heuristic
    const fallbackSessions = isYouth ? Math.min(level === "beginner" ? 3 : 4, 5)
      : isSenior ? Math.min(level === "beginner" ? 3 : 4, 5)
      : level === "beginner" ? 4 : level === "intermediate" ? 5 : 6;
    const sessionsPerWeek = quiz?.daysPerWeek ? Math.max(1, Math.min(7, quiz.daysPerWeek)) : fallbackSessions;
    // Target avg session length (minutes) derived from hours/week ÷ days/week
    const avgSessionMin = quiz?.hoursPerWeek
      ? Math.max(15, Math.min(150, Math.round((quiz.hoursPerWeek * 60) / sessionsPerWeek)))
      : 45;
    const intensityScale = quiz?.intensityPref === "hard" ? 1.15 : quiz?.intensityPref === "easy" ? 0.8 : 1;
    const lengthScale = quiz?.sessionLengthPref === "long" ? 1.2 : quiz?.sessionLengthPref === "short" ? 0.75 : 1;
    const weeklyPlan = [];
    const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    
    // Build a structured week with rest days
    const buildWeekSessions = (weekNum: number, isDeload: boolean) => {
      const sessions = [];
      const intensityMod = isYouth ? 0.7 : isSenior ? 0.75 : 1;
      
      // Define session types for each day (7 days)
      const weekTemplate = getWeekTemplate(sport, goal, level, sessionsPerWeek, isYouth, isSenior);
      
      for (let d = 0; d < 7; d++) {
        const template = weekTemplate[d];
        if (template.type === "rest") {
          sessions.push({
            day: d + 1, dayName: dayNames[d], title: "Rest Day", type: "rest",
            duration_minutes: 0, description: "Full rest. Focus on sleep, nutrition, and mental recovery.",
            exercises: [
              { name: "Light stretching or yoga", sets: "10-15 min (optional)" },
              { name: "Foam rolling", sets: "5-10 min if needed" },
              { name: "Target sleep", sets: "8-9 hours tonight" },
              { name: "Hydration", sets: "3L+ throughout the day" },
            ],
            skipped: false, isRest: true,
          });
        } else if (template.type === "recovery") {
          sessions.push({
            day: d + 1, dayName: dayNames[d], title: "Active Recovery", type: "recovery",
            duration_minutes: Math.round(25 * intensityMod),
            description: "Low-intensity movement to promote blood flow and recovery. Keep heart rate in Zone 1.",
            exercises: getRecoveryExercises(sport),
            skipped: false, isRecovery: true,
          });
        } else {
          // Use quiz-driven avg duration when provided, else legacy curve
          const baseDuration = quiz?.hoursPerWeek
            ? Math.round(avgSessionMin * (isDeload ? 0.7 : 1) * lengthScale * intensityScale * intensityMod)
            : Math.round((isDeload ? 25 : 35) * intensityMod + (weekNum * 1.5) + (d * 2));
          const dur = Math.max(15, Math.min(180, baseDuration));
          sessions.push({
            day: d + 1, dayName: dayNames[d], title: isDeload ? `${template.title} (Deload)` : template.title,
            type: template.type,
            duration_minutes: dur,
            description: `Week ${weekNum}, ${dayNames[d]} — ${template.title} for ${goal.toLowerCase()} in ${sport}${isDeload ? " (reduced volume — 60% intensity)" : ""}${isYouth ? " [Under-18 limits: lighter loads]" : ""}${isSenior ? " [Senior-adapted: joint-friendly]" : ""}${quiz?.environment ? ` · ${quiz.environment}` : ""}${quiz?.equipment?.length ? ` · equipment: ${quiz.equipment.slice(0, 2).join(", ")}` : ""}`,

            warmup: getWarmupForType(template.type, sport),
            exercises: getExercisesForType(template.title, sport, level, weekNum, isYouth, isDeload),
            cooldown: getCooldownForType(template.type, sport),
            skipped: false,
          });
        }
      }
      return sessions;
    };

    for (let w = 1; w <= weeks; w++) {
      const isDeload = w % 4 === 0;
      weeklyPlan.push({ week: w, sessions: buildWeekSessions(w, isDeload), isDeload, isHoliday: false });
    }
    return weeklyPlan;
  };

  const getWeekTemplate = (sport: string, goal: string, level: string, sessionsPerWeek: number, isYouth: boolean, isSenior: boolean) => {
    // Returns 7 days template with training + rest
    type DayTemplate = { title: string; type: string };
    const template: DayTemplate[] = [];
    
    if (sport === "Running" || sport === "Athletics") {
      if (sessionsPerWeek >= 5) {
        template.push({ title: "Speed Work", type: "speed" });
        template.push({ title: "Strength Training", type: "strength" });
        template.push({ title: "Tempo Run", type: "sport_specific" });
        template.push({ title: "Active Recovery", type: "recovery" });
        template.push({ title: "Interval Training", type: "intervals" });
        template.push({ title: "Long Run", type: "endurance" });
        template.push({ title: "Rest Day", type: "rest" });
      } else {
        template.push({ title: "Sport-Specific", type: "sport_specific" });
        template.push({ title: "Rest Day", type: "rest" });
        template.push({ title: "Strength Training", type: "strength" });
        template.push({ title: "Active Recovery", type: "recovery" });
        template.push({ title: "Speed Work", type: "speed" });
        template.push({ title: "Cross-Training", type: "cross_training" });
        template.push({ title: "Rest Day", type: "rest" });
      }
    } else if (sport === "Gym/Weightlifting") {
      if (sessionsPerWeek >= 5) {
        template.push({ title: "Upper Body Push", type: "upper_push" });
        template.push({ title: "Lower Body", type: "lower" });
        template.push({ title: "Upper Body Pull", type: "upper_pull" });
        template.push({ title: "Active Recovery", type: "recovery" });
        template.push({ title: "Full Body Power", type: "power" });
        template.push({ title: "Accessory & Core", type: "accessory" });
        template.push({ title: "Rest Day", type: "rest" });
      } else {
        template.push({ title: "Upper Body", type: "upper" });
        template.push({ title: "Rest Day", type: "rest" });
        template.push({ title: "Lower Body", type: "lower" });
        template.push({ title: "Active Recovery", type: "recovery" });
        template.push({ title: "Full Body", type: "full_body" });
        template.push({ title: "Rest Day", type: "rest" });
        template.push({ title: "Rest Day", type: "rest" });
      }
    } else if (sport === "Cycling") {
      template.push({ title: "Endurance Ride", type: "endurance" });
      template.push({ title: "Strength Training", type: "strength" });
      template.push({ title: "Interval Training", type: "intervals" });
      template.push({ title: "Active Recovery", type: "recovery" });
      template.push({ title: "Tempo Ride", type: "sport_specific" });
      template.push({ title: "Long Ride", type: "endurance" });
      template.push({ title: "Rest Day", type: "rest" });
    } else if (sport === "Swimming") {
      template.push({ title: "Technique Swim", type: "sport_specific" });
      template.push({ title: "Dryland Strength", type: "strength" });
      template.push({ title: "Interval Swim", type: "intervals" });
      template.push({ title: "Active Recovery", type: "recovery" });
      template.push({ title: "Endurance Swim", type: "endurance" });
      template.push({ title: "Cross-Training", type: "cross_training" });
      template.push({ title: "Rest Day", type: "rest" });
    } else {
      // Football, Basketball, Rugby, Tennis, Boxing, etc.
      template.push({ title: "Sport-Specific Drills", type: "sport_specific" });
      template.push({ title: "Strength & Power", type: "strength" });
      template.push({ title: "Speed & Agility", type: "speed" });
      template.push({ title: "Active Recovery", type: "recovery" });
      template.push({ title: "Conditioning", type: "conditioning" });
      template.push(sessionsPerWeek >= 5 ? { title: "Match Simulation", type: "sport_specific" } : { title: "Rest Day", type: "rest" });
      template.push({ title: "Rest Day", type: "rest" });
    }
    
    return template;
  };

  const getWarmupForType = (type: string, sport: string) => {
    if (type === "strength" || type === "upper_push" || type === "upper_pull" || type === "lower" || type === "upper" || type === "full_body" || type === "power" || type === "accessory") {
      return [
        { name: "Light rowing or cycling", sets: "3 min · easy pace, get blood flowing" },
        { name: "Arm circles (forward & back)", sets: "15 each direction" },
        { name: "Band pull-aparts", sets: "2x15 · light resistance, slow tempo" },
        { name: "Cat-cow stretches", sets: "10 reps · breathe deeply each rep" },
        { name: "Bodyweight squats", sets: "15 reps · pause at bottom 2 sec" },
        { name: "Inchworms", sets: "6 reps · walk hands out, hold plank 3 sec" },
        { name: "Warm-up sets of first exercise", sets: "2x8 @ 40-50% working weight" },
      ];
    }
    if (type === "speed" || type === "intervals" || type === "sport_specific" || type === "conditioning") {
      return [
        { name: "Light jog", sets: "4 min · conversational pace" },
        { name: "Leg swings (front & side)", sets: "12 each leg, each direction" },
        { name: "A-skips", sets: "2x20m · drive knee, dorsiflex ankle" },
        { name: "B-skips", sets: "2x20m · extend and paw ground" },
        { name: "High knees", sets: "2x15m · quick turnover, stay tall" },
        { name: "Butt kicks", sets: "2x15m · heel to glute" },
        { name: "Walking lunges with rotation", sets: "8 each leg · twist toward front leg" },
        { name: "Strides", sets: "3x50m @ 70% · smooth acceleration" },
      ];
    }
    if (type === "endurance") {
      return [
        { name: "Walk to easy jog", sets: "5 min · gradually increase pace" },
        { name: "Dynamic leg swings", sets: "10 each direction" },
        { name: "Ankle circles", sets: "10 each direction" },
        { name: "Gentle high knees", sets: "15 sec" },
        { name: "Deep breathing", sets: "1 min · box breathing 4-4-4-4" },
      ];
    }
    return [
      { name: "Light movement (jog/walk)", sets: "3 min" },
      { name: "Dynamic stretching", sets: "5 min · full body" },
      { name: "Joint circles", sets: "10 each joint" },
    ];
  };

  const getCooldownForType = (type: string, sport: string) => {
    if (type === "strength" || type === "upper_push" || type === "upper_pull" || type === "lower" || type === "upper" || type === "full_body" || type === "power" || type === "accessory") {
      return [
        { name: "Light walking", sets: "2 min · slow pace, let HR come down" },
        { name: "Chest doorway stretch", sets: "30s each side · gentle pull" },
        { name: "Standing quad stretch", sets: "30s each leg · hold wall for balance" },
        { name: "Seated hamstring stretch", sets: "30s each leg · reach for toes" },
        { name: "Child's pose", sets: "45s · sink hips, reach arms forward" },
        { name: "Cross-body shoulder stretch", sets: "20s each arm" },
        { name: "Deep breathing", sets: "1 min · 4-count inhale, 6-count exhale" },
      ];
    }
    return [
      { name: "Easy walk/jog", sets: "3 min · gradually slow down" },
      { name: "Standing quad stretch", sets: "30s each leg" },
      { name: "Hamstring stretch", sets: "30s each leg" },
      { name: "Hip flexor stretch", sets: "30s each side" },
      { name: "Calf stretch", sets: "30s each leg" },
      { name: "Pigeon stretch", sets: "30s each side" },
      { name: "Foam rolling (if available)", sets: "5 min · quads, hamstrings, calves, IT band" },
      { name: "Deep breathing", sets: "1 min · box breathing 4-4-4-4" },
    ];
  };

  const getRecoveryExercises = (sport: string) => [
    { name: "Easy walk or light swim", sets: "15 min · Zone 1 HR, should feel effortless" },
    { name: "Foam rolling (full body)", sets: "10 min · 30-45s per muscle group, focus tight areas" },
    { name: "Yoga flow (Sun Salutation A)", sets: "3 rounds · slow, controlled breathing" },
    { name: "Hip 90/90 stretches", sets: "45s each side · gently rock into stretch" },
    { name: "Cat-cow + Thread the needle", sets: "10 reps each · follow breath" },
    { name: "Couch stretch (hip flexors)", sets: "60s each side · lean into stretch gently" },
    { name: "Supine spinal twist", sets: "30s each side" },
    { name: "Deep breathing (box breathing)", sets: "3 min · 4-4-4-4 pattern" },
  ];

  const getExercisesForType = (type: string, sport: string, level: string, week: number, isYouth: boolean, isDeload: boolean = false) => {
    const s = isDeload ? 3 : level === "beginner" ? 3 : level === "intermediate" ? 4 : 5;
    const r = isYouth ? 8 : isDeload ? 8 : level === "beginner" ? 8 : level === "intermediate" ? 10 : 12;
    const reps = `${s}x${r}`;
    const heavyReps = `${s}x${Math.max(r - 4, 3)}`;
    const wk = Math.min(week, 12);
    const restSec = level === "beginner" ? "90s" : level === "intermediate" ? "75s" : "60s";
    const rpe = isDeload ? 5 : 6 + Math.min(wk, 4);
    const deloadNote = isDeload ? " (DELOAD: reduce weight 40%)" : "";

    if (type === "Strength Training" || type === "Strength & Power") return [
      { name: "Back Squat", sets: `${reps} @ RPE ${rpe} · ${restSec} rest${deloadNote} — feet shoulder-width, brace core, break parallel, drive through heels` },
      { name: "Romanian Deadlift (RDL)", sets: `${reps} @ RPE ${Math.max(rpe - 1, 5)} · ${restSec} rest — hip hinge, soft knees, feel hamstring stretch, bar close to legs` },
      { name: "Bench Press", sets: `${reps} @ RPE ${rpe} · ${restSec} rest — retract scapulae, feet flat, control descent 2-3 sec, pause at chest` },
      { name: "Bent-Over Barbell Row", sets: `${reps} @ RPE ${Math.max(rpe - 1, 5)} · ${restSec} rest — 45° torso angle, pull to lower chest, squeeze lats 1 sec` },
      { name: "Overhead Press (Standing)", sets: `${s}x${r - 2} @ RPE ${rpe} · ${restSec} rest — brace core+glutes, slight arc, full lockout overhead` },
      { name: "Weighted Pull-ups (or Lat Pulldown)", sets: `${heavyReps} · 90s rest — full hang, chin over bar, controlled descent 3 sec` },
      { name: "Barbell Hip Thrust", sets: `${s}x${r} · ${restSec} rest — shoulders on bench, full lockout, squeeze glutes 2 sec at top` },
      { name: "Plank + Side Plank", sets: `3x45s each (plank, left, right) · 30s rest between — neutral spine, brace hard` },
    ];

    if (type === "Upper Body Push") return [
      { name: "Bench Press", sets: `${s}x${r} @ RPE ${rpe} · ${restSec} rest${deloadNote} — retract scapulae, arch slightly, control 3 sec eccentric` },
      { name: "Incline Dumbbell Press (30°)", sets: `${s}x${r} · ${restSec} rest — squeeze at top, lower to chest level, 2 sec pause` },
      { name: "Standing Overhead Press", sets: `${s}x${r - 2} @ RPE ${rpe} · ${restSec} rest — strict form, no leg drive, full lockout` },
      { name: "Dumbbell Lateral Raises", sets: `3x15 · 45s rest — slight lean, pinky up, control the weight down 3 sec` },
      { name: "Tricep Dips (weighted if able)", sets: `${s}x${r} · 60s rest — lean slightly forward, full range of motion` },
      { name: "Cable Flyes", sets: `3x12 · 45s rest — slight bend in elbows, squeeze chest at centre` },
      { name: "Face Pulls", sets: `3x15 · 45s rest — pull to forehead, external rotate, squeeze 2 sec` },
    ];

    if (type === "Upper Body Pull") return [
      { name: "Weighted Pull-ups (or Lat Pulldown)", sets: `${s}x${r - 2} · 90s rest${deloadNote} — full dead hang, pull to chest, 3 sec negative` },
      { name: "Barbell Bent-Over Row", sets: `${s}x${r} @ RPE ${rpe} · ${restSec} rest — 45° angle, pull to navel, squeeze 1 sec` },
      { name: "Seated Cable Row", sets: `${s}x${r} · 60s rest — pull to lower chest, squeeze shoulder blades together` },
      { name: "Dumbbell Rear Delt Flyes", sets: `3x15 · 45s rest — chest on bench, squeeze rear delts 2 sec` },
      { name: "Barbell Curl", sets: `3x${r} · 60s rest — no swinging, full range, 2 sec eccentric` },
      { name: "Hammer Curls", sets: `3x12 · 45s rest — neutral grip, control throughout` },
      { name: "Face Pulls", sets: `3x15 · 45s rest — high cable, external rotate at end` },
    ];

    if (type === "Lower Body") return [
      { name: "Back Squat", sets: `${s}x${r} @ RPE ${rpe} · ${restSec} rest${deloadNote} — brace core, knees track toes, break parallel, 2 sec pause at bottom` },
      { name: "Romanian Deadlift", sets: `${s}x${r} @ RPE ${Math.max(rpe - 1, 5)} · ${restSec} rest — hip hinge, bar close, feel hamstring stretch at bottom` },
      { name: "Bulgarian Split Squat", sets: `3x10 each leg · 60s rest — rear foot on bench, torso upright, full depth` },
      { name: "Leg Press", sets: `${s}x${r} · ${restSec} rest — feet shoulder-width, don't lock out, controlled eccentric 3 sec` },
      { name: "Leg Curl (lying or seated)", sets: `3x12 · 45s rest — squeeze at peak, 3 sec eccentric` },
      { name: "Calf Raises (standing)", sets: `4x15 · 45s rest — full stretch at bottom, pause at top 2 sec` },
      { name: "Weighted Plank", sets: `3x45s · 30s rest — plate on back, brace hard, neutral spine` },
    ];

    if (type === "Upper Body") return [
      { name: "Bench Press", sets: `${s}x${r} @ RPE ${rpe} · ${restSec} rest — retract scapulae, 3 sec descent, pause at chest` },
      { name: "Barbell Row", sets: `${s}x${r} @ RPE ${Math.max(rpe - 1, 5)} · ${restSec} rest — 45° angle, pull to navel` },
      { name: "Overhead Press", sets: `${s}x${r - 2} · ${restSec} rest — strict, no leg drive` },
      { name: "Pull-ups/Lat Pulldown", sets: `${s}x${r - 2} · 90s rest — full range, control negative` },
      { name: "Lateral Raises", sets: `3x15 · 45s rest — controlled, slight lean forward` },
      { name: "Tricep Pushdowns", sets: `3x12 · 45s rest — elbows pinned, full extension` },
      { name: "Barbell Curl", sets: `3x12 · 45s rest — strict form, no swing` },
    ];

    if (type === "Full Body" || type === "Full Body Power") return [
      { name: "Power Clean (or Hang Clean)", sets: `${s}x${Math.max(r - 5, 3)} @ RPE ${rpe} · 2 min rest${deloadNote} — explosive hip extension, catch in front squat position` },
      { name: "Front Squat", sets: `${s}x${r - 2} · 90s rest — elbows high, brace hard, break parallel` },
      { name: "Push Press", sets: `${s}x${r - 2} · 90s rest — quarter dip, explosive press, use legs to drive` },
      { name: "Pendlay Row", sets: `${s}x${r} · 75s rest — dead stop each rep, explosive pull to sternum` },
      { name: "Dumbbell Walking Lunges", sets: `3x12 each leg · 60s rest — long stride, knee tracks toe, upright torso` },
      { name: "Plank to Push-up", sets: `3x10 · 45s rest — plank position, press up one hand at a time, alternate lead hand` },
    ];

    if (type === "Accessory & Core") return [
      { name: "Dumbbell Lateral Raises", sets: `4x15 · 45s rest — slight lean, control the negative 3 sec` },
      { name: "Cable Face Pulls", sets: `4x15 · 45s rest — pull to forehead, external rotate, squeeze 2 sec` },
      { name: "Incline Dumbbell Curl", sets: `3x12 · 45s rest — full stretch at bottom, squeeze at top` },
      { name: "Overhead Tricep Extension (cable)", sets: `3x12 · 45s rest — full stretch, lock out at bottom` },
      { name: "Hanging Leg Raises", sets: `4x12 · 45s rest — control the swing, curl pelvis up` },
      { name: "Cable Woodchops", sets: `3x12 each side · 45s rest — rotate through core, arms stay straight` },
      { name: "Ab Wheel Rollouts (or Plank)", sets: `3x10 · 45s rest — brace core, don't let hips sag` },
      { name: "Farmer's Walk", sets: `3x40m · 60s rest — heavy dumbbells/kettlebells, upright posture, squeeze grip` },
    ];

    if (type === "Speed Work" || type === "Speed & Agility") {
      if (sport === "Running" || sport === "Athletics") return [
        { name: "200m Repeats", sets: `${3 + Math.min(wk, 3)}x200m @ 85-90% effort · 2-3 min walk/jog recovery — focus on relaxed speed, pumping arms, driving knees` },
        { name: "Flying 30m Sprints", sets: `4x30m @ 95% · full walking recovery (2-3 min) — build-up run 20m then sprint 30m, stay relaxed` },
        { name: "Hill Sprints", sets: `${4 + Math.min(wk, 4)}x60m steep hill · jog down recovery — short, choppy steps, drive arms hard, lean into hill` },
        { name: "Wicket Runs", sets: `4x40m · walk back recovery — set mini-hurdles at stride length, focus on turnover speed and dorsiflexion` },
        { name: "Acceleration Drills (3-point start)", sets: `5x20m · 90s rest — powerful push-off, low drive phase, pump arms, gradual rise` },
      ];
      if (sport === "Football" || sport === "Basketball" || sport === "Rugby") return [
        { name: "T-Test Agility Drill", sets: `5 reps · 90s rest — sprint forward 10m, shuffle left 5m, shuffle right 10m, shuffle left 5m, backpedal 10m` },
        { name: "5-10-5 Pro Shuttle", sets: `6 reps · 90s rest — sprint 5yd, plant & turn 180°, sprint 10yd, plant & turn, sprint 5yd` },
        { name: "Cone Weave Sprints", sets: `4x30m · 60s rest — weave through 8 cones, stay low, push off outside foot` },
        { name: "Reaction Sprints", sets: `6x10m · full rest — partner calls direction, explode and sprint` },
        { name: "Sprint Intervals", sets: `8x30m · 90s rest — max effort, walk back to start` },
      ];
      return [
        { name: `${sport}-specific speed drills`, sets: `${20 + wk * 2} min total · match intensity intervals with full recovery` },
        { name: "Agility ladder", sets: `3x through full pattern · 30s rest between — in-in-out-out, ickey shuffle, 2-in/2-out` },
        { name: "Reaction sprints", sets: `6x10m · full rest — visual or auditory cue, explosive first step` },
      ];
    }

    if (type === "Tempo Run") return [
      { name: "Tempo Run", sets: `${20 + wk * 2} min @ lactate threshold pace (comfortably hard — can speak in 3-4 word phrases) — steady effort, don't speed up mid-run` },
      { name: "Strides after tempo", sets: `4x100m @ 80% · walk back — smooth, tall, relaxed` },
    ];

    if (type === "Interval Training") {
      if (sport === "Running" || sport === "Athletics") return [
        { name: "400m Repeats", sets: `${4 + Math.min(wk, 4)}x400m @ 90-95% · 90s-2 min jog recovery — hold consistent pace, don't start too fast` },
        { name: "200m at Race Pace", sets: `3x200m @ race pace · full recovery — practice target pace, feel the rhythm` },
      ];
      if (sport === "Cycling") return [
        { name: "4 min On / 3 min Off Intervals", sets: `${4 + Math.min(wk, 3)} sets @ 105-110% FTP · recover at 50% FTP — seated, smooth pedal stroke` },
        { name: "30/30 Intervals", sets: `10x(30s hard / 30s easy) · high cadence, explosive power` },
      ];
      if (sport === "Swimming") return [
        { name: "100m Repeats", sets: `${6 + Math.min(wk, 4)}x100m @ threshold pace · 15-20s rest — focus on stroke count, smooth catch` },
        { name: "50m Sprint Intervals", sets: `4x50m @ race pace · 30s rest — explosive off the wall, strong kick` },
      ];
      return [
        { name: "High-intensity interval training", sets: `${20 + wk} min — 30s work / 30s rest × 10-15 rounds, max effort each interval` },
      ];
    }

    if (type === "Long Run") return [
      { name: "Long Run", sets: `${40 + wk * 3} min @ Zone 2 (easy conversational pace — you should be able to hold a full conversation)` },
      { name: "Negative split last 10 min", sets: "Increase pace slightly — feel strong, don't sprint, just pick it up" },
    ];

    if (type === "Endurance Ride" || (type === "Long Ride" && sport === "Cycling")) return [
      { name: "Endurance Ride", sets: `${50 + wk * 3} min · Zone 2-3 — steady cadence 80-90 RPM, stay aero, focus on smooth pedalling` },
      { name: "Cadence Drills (last 15 min)", sets: `3x3 min @ 100+ RPM · 2 min easy — spin faster, not harder` },
    ];

    if (type === "Conditioning") return [
      { name: "Shuttle Runs", sets: `6x20m · 60s rest — touch line, turn, sprint back, all out effort` },
      { name: "Burpee to Broad Jump", sets: `4x8 · 75s rest — chest to floor, explosive jump forward` },
      { name: "Medicine Ball Slams", sets: `3x12 · 45s rest — overhead, slam hard, catch on bounce, repeat fast` },
      { name: "Battle Ropes", sets: `4x30s · 45s rest — alternating waves, full amplitude, stay low` },
      { name: "Box Jumps", sets: `3x8 · 60s rest — step down (don't jump), explosive drive, land soft` },
    ];

    if (type === "Cross-Training") return [
      { name: sport === "Running" ? "Swimming (easy technique)" : "Easy Run", sets: `${25 + wk} min · Zone 2 heart rate — cross-training improves aerobic base without impact stress` },
      { name: sport === "Cycling" ? "Rowing" : "Cycling (steady)", sets: `${20 + wk} min · conversational pace — low impact, maintain cadence` },
      { name: "Core Circuit", sets: `3 rounds: 30s plank, 15 sit-ups, 10 back extensions, 20 bicycle crunches · 60s rest between rounds — no rushing, quality reps` },
    ];

    if (type === "Sport-Specific Drills" || type === "Sport-Specific" || type === "Match Simulation") {
      if (sport === "Running" || sport === "Athletics") return [
        { name: "Easy Run (Zone 2)", sets: `${25 + wk * 2} min · conversational pace — nasal breathing if possible, 180+ cadence` },
        { name: "Strides", sets: `${4 + Math.min(wk, 4)}x100m @ 80% · walk back — smooth, tall, relaxed form` },
        { name: "Drills (A-skip, B-skip, high knees)", sets: "2x30m each drill — focus on technique, not speed" },
      ];
      if (sport === "Gym/Weightlifting") return [
        { name: "Clean & Jerk", sets: `${s}x${Math.max(r - 5, 2)} @ RPE ${rpe} · 2 min rest — explosive hip drive, fast elbows, catch in front rack, drive press overhead` },
        { name: "Snatch", sets: `${s}x${Math.max(r - 5, 2)} @ RPE ${rpe} · 2 min rest — wide grip, pull close, fast turnover, catch overhead with locked arms` },
        { name: "Front Squat", sets: `${reps} · 90s rest — high elbows, brace core, break parallel` },
        { name: "Pendlay Row", sets: `${reps} · 75s rest — dead stop each rep, explosive pull to sternum` },
      ];
      if (sport === "Swimming") return [
        { name: "Warm-up swim", sets: "400m easy mixed stroke — loosen up, focus on body position" },
        { name: "Main set", sets: `${4 + Math.min(wk, 4)}x100m @ threshold · 20s rest — hold stroke count, smooth catch and pull` },
        { name: "Kick set", sets: "4x50m with board · 15s rest — kick from hips, pointed toes, steady rhythm" },
        { name: "Cool-down", sets: "200m easy — choice of stroke, relax" },
      ];
      if (sport === "Cycling") return [
        { name: "Endurance Ride", sets: `${40 + wk * 3} min · Zone 2-3 — steady cadence 80-90 RPM` },
        { name: "Cadence Drills", sets: "4x3 min @ 100+ RPM · 2 min easy spin — focus on smooth circular pedalling" },
        { name: "Seated Climbs", sets: `3x5 min @ threshold · 3 min recovery — stay seated, gear up, grind` },
      ];
      if (sport === "Football" || sport === "Basketball" || sport === "Rugby") return [
        { name: "Agility Ladder Drills", sets: "3x full pattern · 45s rest — quick feet, stay low, eyes up, precise footwork" },
        { name: "Cone Drills (T-test, 5-10-5)", sets: `${4 + Math.min(wk, 3)} reps · 60s rest — plant hard, push off outside foot, stay low through turns` },
        { name: "Small-Sided Game Simulation", sets: `${15 + wk} min — match intensity with short recovery, replicate game scenarios` },
        { name: "Sprint Intervals", sets: `6x30m · 90s rest — max effort, replicate game-speed bursts` },
      ];
      return [
        { name: `${sport} skill practice`, sets: `${25 + wk * 2} min · focused technique — deliberate practice, quality over quantity` },
        { name: "Sport-specific conditioning", sets: `${15 + wk} min · match intensity intervals — replicate competition demands` },
      ];
    }

    if (type === "Technique Swim" || type === "Dryland Strength" || type === "Endurance Swim") {
      if (type === "Technique Swim") return [
        { name: "Catch-up drill", sets: "4x50m · 15s rest — one arm completes full stroke before other starts" },
        { name: "Fingertip drag drill", sets: "4x50m · 15s rest — drag fingertips along surface, high elbow recovery" },
        { name: "Kick on side drill", sets: "4x25m each side · 10s rest — one arm extended, body rotated" },
        { name: "Build swims", sets: "4x100m · 20s rest — start easy, finish at race pace" },
      ];
      if (type === "Dryland Strength") return [
        { name: "Push-ups", sets: `${s}x15 · 45s rest — chest to floor, full lockout` },
        { name: "Lat Pulldowns", sets: `${s}x${r} · 60s rest — wide grip, pull to upper chest` },
        { name: "Tricep Dips", sets: `${s}x${r} · 60s rest — full depth, controlled` },
        { name: "Plank", sets: "3x45s · 30s rest — core tight, flat back" },
        { name: "Russian Twists", sets: "3x20 · 30s rest — feet elevated, medicine ball" },
      ];
      return [
        { name: "Endurance Swim", sets: `${wk * 50 + 800}m continuous · Zone 2 — steady stroke, breathe every 3 strokes` },
        { name: "Pull buoy set", sets: "4x100m · 15s rest — focus on upper body catch and pull" },
      ];
    }

    return [{ name: `${sport} ${type} Training`, sets: `${30 + week * 2} min · sport-specific work at moderate intensity` }];
  };

  // Edit plan session
  const saveSessionEdit = async () => {
    if (!selectedPlan || !editingSession) return;
    const planData = JSON.parse(JSON.stringify(selectedPlan.plan_data)) as PlanData;
    const weekIdx = planData.findIndex((w) => w.week === editingSession.week);
    if (weekIdx === -1) return;
    const sessionIdx = planData[weekIdx].sessions.findIndex((s) => s.day === editingSession.day);
    if (sessionIdx === -1) return;
    if (editSessionTitle) planData[weekIdx].sessions[sessionIdx].title = editSessionTitle;
    if (editSessionDuration) {
      const mins = parseInt(editSessionDuration, 10);
      // Session duration is bounded to the same 15–180 window the builder uses.
      if (!Number.isFinite(mins) || mins < 5 || mins > 300) {
        toast({ title: "Duration must be 5–300 minutes", variant: "destructive" });
        return;
      }
      planData[weekIdx].sessions[sessionIdx].duration_minutes = mins;
    }
    // Scope the update to THIS plan. The previous call had no filter — RLS made
    // it touch only the owner's rows, which still meant EVERY plan the athlete
    // owned was overwritten with the edited plan's data.
    const { error } = await supabase
      .from("training_plans")
      .update({ plan_data: planData as unknown as Json })
      .eq("id", selectedPlan.id)
      .eq("user_id", user?.id ?? "");
    if (error) { toast({ title: "Couldn't save the session", description: error.message, variant: "destructive" }); return; }
    setSelectedPlan({ ...selectedPlan, plan_data: planData as unknown as Json });
    setEditingSession(null);
    toast({ title: "Session updated! ✏️" });
  };

  const toggleWeekHoliday = async (weekNum: number) => {
    if (!selectedPlan) return;
    const planData = JSON.parse(JSON.stringify(selectedPlan.plan_data)) as PlanData;
    const weekIdx = planData.findIndex((w) => w.week === weekNum);
    if (weekIdx === -1) return;
    const wasHoliday = planData[weekIdx].isHoliday;
    planData[weekIdx].isHoliday = !wasHoliday;
    
    // If marking as holiday, redistribute sessions to next non-holiday week
    if (!wasHoliday) {
      const holidaySessions = planData[weekIdx].sessions.filter((s) => !s.isRest && !s.isRecovery);
      // Find next non-holiday week
      const nextWeekIdx = planData.findIndex((w, i) => i > weekIdx && !w.isHoliday);
      if (nextWeekIdx !== -1 && holidaySessions.length > 0) {
        // Add key sessions to next week as extra work
        planData[nextWeekIdx].redistributedFrom = weekNum;
        planData[nextWeekIdx].extraNote = `Includes redistributed work from Week ${weekNum} (holiday)`;
      }
      // Replace sessions with light recovery for holiday
      planData[weekIdx].sessions = planData[weekIdx].sessions.map((s) => {
        if (s.isRest) return s;
        return {
          ...s, title: "Holiday — Light Movement (optional)", type: "holiday",
          duration_minutes: 15, description: "Holiday week. Optional light activity — walk, swim, stretch. Enjoy your break!",
          exercises: [
            { name: "Light walk or swim", sets: "15-20 min · completely easy" },
            { name: "Stretching", sets: "10 min · focus on tight areas" },
            { name: "Stay hydrated", sets: "3L+ water" },
          ],
          originalTitle: s.title, originalExercises: s.exercises,
        };
      });
    } else {
      // Restore original sessions
      planData[weekIdx].sessions = planData[weekIdx].sessions.map((s) => {
        if (s.originalTitle) {
          return { ...s, title: s.originalTitle, exercises: s.originalExercises, type: s.originalTitle.toLowerCase().replace(/[^a-z]/g, "_"), duration_minutes: 40, description: `Restored session` };
        }
        return s;
      });
    }
    
    // Scoped to this plan (see saveSessionEdit — an unfiltered update would
    // overwrite every plan the athlete owns).
    const { error } = await supabase
      .from("training_plans")
      .update({ plan_data: planData as unknown as Json })
      .eq("id", selectedPlan.id)
      .eq("user_id", user?.id ?? "");
    if (error) { toast({ title: "Couldn't update your week", description: error.message, variant: "destructive" }); return; }
    setSelectedPlan({ ...selectedPlan, plan_data: planData as unknown as Json });
    toast({ title: !wasHoliday ? "Week marked as holiday 🏖️ — sessions redistributed to next week" : "Holiday removed — sessions restored" });
  };

  /**
   * The paid AI plan edit.
   *
   * The free edits (a session's title, a holiday, skipping a session) stay free
   * and local; this is the one that asks a model, so this is the one that
   * charges, and the charge happens server-side. What this function owns:
   * never send an instruction that is not one, never splice a week the athlete
   * did not ask about, and never leave the screen showing a change the database
   * does not have.
   *
   * There is no refresh-the-balance-needed path here for the happy case: the
   * server returns the new balance, and the profile is re-read so every credit
   * count in the app agrees.
   */
  const runPlanEdit = async () => {
    if (!selectedPlan || !user || aiEditBusy) return;

    const check = validateEditInstruction(aiEditInstruction);
    if (!check.ok) { toast({ title: check.error ?? "Tell the coach what to change", variant: "destructive" }); return; }

    const planData = JSON.parse(JSON.stringify(selectedPlan.plan_data)) as PlanData;
    const targets = weeksForEdit(planData, aiEditScope, aiEditWeek);
    if (targets.length === 0) {
      toast({ title: "That week isn't in this plan", variant: "destructive" });
      return;
    }

    const cost = editCost(aiEditScope);
    const request = {
      scope: aiEditScope,
      week: aiEditWeek,
      instruction: check.instruction ?? aiEditInstruction.trim(),
      weeks: targets,
      sport: selectedPlan.sport,
      level: selectedPlan.level,
      durationWeeks: selectedPlan.duration_weeks,
      targetEvent: planTargetEvent,
      requestId: newEditRequestId(),
      userLocale: getAiLocale(),
    };

    setAiEditBusy(true);
    let result: PlanEditOutcome = await requestPlanEdit(request);

    // Not enough credits is the one failure the athlete can do something about,
    // so it opens the top-up sheet and then retries the SAME request. Reusing
    // the request id is safe: a refused spend never wrote a ledger row, so the
    // retry cannot be billed twice.
    if (!result.ok && result.quotaExceeded) {
      const outcome = await requestCreditTopUp({
        shortfall: result.shortfall ?? Math.max(0, (result.cost ?? cost) - (result.balance ?? 0)),
        reasonLabel: featureLabel(editCostKey(aiEditScope)),
        balance: result.balance ?? 0,
      });
      if (!outcome.purchased) {
        setAiEditBusy(false);
        toast({ title: "Not enough credits", description: result.error ?? "Top up to apply this edit.", variant: "destructive" });
        return;
      }
      result = await requestPlanEdit(request);
    }

    setAiEditBusy(false);
    if (!result.ok) {
      toast({ title: "Edit not applied", description: result.error ?? "The edit could not be applied.", variant: "destructive" });
      return;
    }

    const { plan: nextPlan, replaced, orphans } = spliceEditedWeeks(planData, result.weeks ?? [], aiEditScope, aiEditWeek);
    if (replaced.length === 0 || orphans.length > 0) {
      // The server validated the count, so this means the model returned weeks
      // this plan does not contain. Nothing is written: a plan edited into the
      // wrong place renders beautifully and is wrong.
      toast({ title: "That edit didn't line up with your plan", description: "Nothing was changed. Please try again.", variant: "destructive" });
      return;
    }

    const { error } = await supabase
      .from("training_plans")
      .update({ plan_data: nextPlan as unknown as Json })
      .eq("id", selectedPlan.id)
      .eq("user_id", user.id);
    if (error) {
      toast({ title: "Couldn't save the edit", description: error.message, variant: "destructive" });
      return;
    }

    setSelectedPlan({ ...selectedPlan, plan_data: nextPlan as unknown as Json });
    setAiEditInstruction("");
    await refreshProfile();
    toast({
      title: "Plan updated ✨",
      description: replaced.length === 1
        ? `Week ${replaced[0]} rewritten · ${result.cost ?? cost} credits (${result.balance} left)`
        : `${replaced.length} weeks rewritten · ${result.cost ?? cost} credits (${result.balance} left)`,
    });
  };

  /**
   * Undo a rebuild.
   *
   * The sessions that were replaced are restored from the rebuild's own record
   * rather than recomputed, so this works even though the athlete has been
   * looking at — and possibly editing — the rebuilt week in the meantime. Only
   * the most recent rebuild can be reversed: each one scaled what the one
   * before it left behind, so undoing an older one underneath a newer one would
   * restore numbers that were never true.
   */
  const undoRebuild = async (recordId: string) => {
    if (!selectedPlan) return;
    setUndoingRebuild(recordId);
    const result = await undoPlanRebuild({ plan: selectedPlan, recordId });
    setUndoingRebuild(null);
    if (!result.ok) {
      toast({ title: "Couldn't undo that", description: result.error, variant: "destructive" });
      return;
    }
    setSelectedPlan({
      ...selectedPlan,
      plan_data: result.plan_data as Json,
      plan_adjustments: result.plan_adjustments as unknown as Json,
    });
    toast({
      title: "Rebuild undone",
      description: "Those weeks are back to how they were before your break.",
    });
  };

  const skipSession = async (weekNum: number, dayNum: number) => {
    if (!selectedPlan) return;
    const planData = JSON.parse(JSON.stringify(selectedPlan.plan_data)) as PlanData;
    const weekIdx = planData.findIndex((w) => w.week === weekNum);
    if (weekIdx === -1) return;
    const sessionIdx = planData[weekIdx].sessions.findIndex((s) => s.day === dayNum);
    if (sessionIdx === -1) return;
    planData[weekIdx].sessions[sessionIdx].skipped = !planData[weekIdx].sessions[sessionIdx].skipped;
    // Scoped to this plan (see saveSessionEdit).
    const { error } = await supabase
      .from("training_plans")
      .update({ plan_data: planData as unknown as Json })
      .eq("id", selectedPlan.id)
      .eq("user_id", user?.id ?? "");
    if (error) {
      // Put the local state back so the UI can't disagree with the database.
      planData[weekIdx].sessions[sessionIdx].skipped = !planData[weekIdx].sessions[sessionIdx].skipped;
      toast({ title: "Couldn't update the session", description: error.message, variant: "destructive" });
      return;
    }
    setSelectedPlan({ ...selectedPlan, plan_data: planData as unknown as Json });
  };

  // Limiter test
  const answerLimiterQuestion = (score: number) => {
    const q = LIMITER_QUESTIONS[limiterStep];
    const newAnswers = { ...limiterAnswers, [q.id]: score };
    setLimiterAnswers(newAnswers);
    if (limiterStep < LIMITER_QUESTIONS.length - 1) {
      setLimiterStep(limiterStep + 1);
    } else {
      // Sport-weighted analysis over answered categories only — unanswered
      // questions are skipped, never defaulted to a fake mid-point.
      setLimiterResult(analyzeLimiterTest(newAnswers, limiterMetrics, getPrimarySport(profile?.sport) || sport, limiterReadiness));
    }
  };

  const createLimiterPlan = async () => {
    if (!user || !profile || !limiterResult || limiterResult.limiters.length === 0) return;
    const age = getAge();
    if (!age) { toast({ title: "Age required", description: "Set your DOB in Profile first.", variant: "destructive" }); return; }
    const LIMITER_WEEKS = 4;

    setCreatingLimiterPlan(true);
    try {
      // Insufficient credits now open the global top-up sheet and retry the
      // spend automatically after a successful purchase.
      const spend = await spendWithTopUp("limiter_fix_plan", { reason: `Limiter Fix Plan (${LIMITER_WEEKS} weeks)` });
      if (!spend.success) { setCreatingLimiterPlan(false); if (spend.dismissedTopUp) toast({ title: "Not enough credits", description: spendErrorMessage("limiter_fix_plan", spend), variant: "destructive" }); return; }
      // Generate plan focused on weakest areas
      const weakAreas = limiterResult.limiters.map(l => l.name);
      const planGoal = `Fix: ${weakAreas.slice(0, 3).join(", ")}`;
      const planData = generatePlanData(sport, planGoal, level, 4, age);
      
      const { error: insertError } = await supabase.from("training_plans").insert({
        user_id: user.id, title: "Limiter Fix Plan", sport, goal: planGoal, level, duration_weeks: 4,
        description: `4-week plan targeting: ${weakAreas.join(", ")}. ${limiterResult.confidence}`,
        plan_data: planData,
      });
      if (insertError) throw insertError;
      
      await refreshProfile();
      toast({ title: "Limiter Fix Plan Created! 🎯", description: "Check your training plans." });
      setActiveView("plans");
      setLimiterResult(null);
      setLimiterStep(0);
      setLimiterAnswers({});
      fetchPlans();
    } catch (err) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setCreatingLimiterPlan(false);
  };

  // Performance log
  const addLog = async () => {
    if (!user) return;
    const distKm = logDistance ? parseFloat(logDistance) : null;
    const parts = logTime.split(":").map(Number);
    let totalSec = 0;
    if (parts.length === 3) totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) totalSec = parts[0] * 60 + parts[1];
    const pace = distKm && totalSec ? `${Math.floor((totalSec / distKm) / 60)}:${(Math.round((totalSec / distKm) % 60)).toString().padStart(2, "0")} /km` : null;
    const { error } = await supabase.from("performance_logs").insert({
      user_id: user.id, title: logTitle || `${logType} - ${logSport}`, distance_km: distKm,
      time_seconds: totalSec || null, pace_per_km: pace, notes: logNotes || null, sport: logSport, log_type: logType,
      perceived_exertion: parseInt(logRPE) || null, form_rating: parseInt(logFormRating) || null,
      heart_rate_avg: logHeartRate ? parseInt(logHeartRate) : null, calories_burned: logCalories ? parseInt(logCalories) : null,
      // Phase 3: the load, priced at the moment the session is logged, so the
      // number and the session it describes are always written together. The
      // duration the athlete actually recorded is what feeds it, not the plan's
      // — the plan says what was intended and this is what happened.
      ...loadColumnsFor({
        sport: logSport,
        durationMinutes: totalSec ? Math.round(totalSec / 60) : null,
        rpe: parseInt(logRPE) || null,
        distanceKm: distKm,
      }),
    });
    if (error) { toast({ title: "Couldn't save your log", description: error.message, variant: "destructive" }); return; }
    setShowAddLog(false); setLogTitle(""); setLogDistance(""); setLogTime(""); setLogNotes(""); setLogHeartRate(""); setLogCalories("");
    fetchLogs();
    toast({ title: "Log saved! 📝" });
  };

  const chipClass = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 ${active ? "bg-primary/15 border-primary text-primary shadow-glow" : "bg-card border-border text-foreground hover:border-primary/30"}`;
  const inputClass = "w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all duration-300";

  // ---- Recommended answers for the create wizard --------------------------
  // Nearly every question the wizard asks needs training knowledge to answer,
  // so every one of them carries a recommendation (see planSetupAdvice.ts for
  // the numbers and the reasoning, both unit-tested). Recomputed on render:
  // the level, the goals, the sport and the athlete's age all move it, and the
  // maths is pure and trivial.
  const planAdvice = recommendSetup({ level, goals, sport, age: getAge(), caps: getAgeCaps(getAge()) });
  const adviceApplied = (field: keyof SetupAdvice, value: unknown) => matchesAdvice(planAdvice, field, value);

  /** Puts one recommended value in place, for a single field. */
  const applyAdviceField = (field: keyof SetupAdvice) => {
    if (field === "daysPerWeek") setPlanDaysPerWeek(planAdvice.daysPerWeek);
    else if (field === "restDays") setPlanRecoveryDays(planAdvice.restDays);
    else if (field === "sessionLengthPref") setPlanSessionLengthPref(planAdvice.sessionLengthPref);
    else if (field === "hoursPerWeek") setPlanHoursPerWeek(planAdvice.hoursPerWeek);
    else if (field === "intensityPref") setPlanIntensityPref(planAdvice.intensityPref);
    else if (field === "environment") setPlanEnvironment(planAdvice.environment);
    else if (field === "focusAreas") setPlanFocusAreas(planAdvice.focusAreas);
    else if (field === "durationWeeks") setDuration(planAdvice.durationWeeks);
  };

  /** Fills every answer the wizard owns — the "I don't know, you choose" path. */
  const applyRecommendedSetup = () => {
    (["daysPerWeek", "restDays", "sessionLengthPref", "hoursPerWeek", "intensityPref", "environment", "focusAreas", "durationWeeks"] as (keyof SetupAdvice)[])
      .forEach(applyAdviceField);
  };

  /**
   * Opens the wizard, pre-filled with the recommendation for anyone who is not
   * advanced. Seeded here rather than in an effect on `showCreate` so it runs
   * exactly once per open: an athlete who changes a field must not have it
   * overwritten a moment later by a recommendation reacting to their level.
   * An advanced athlete gets nothing pre-filled — see AdvancedFreedomNote.
   */
  const openCreateWizard = () => {
    if (level !== "advanced") applyRecommendedSetup();
    setShowCreate(true);
  };

  // === LIMITER TEST VIEW ===
  if (activeView === "limiter") return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4 flex items-center gap-3">
        <motion.button onClick={() => { setActiveView("plans"); setLimiterStep(0); setLimiterAnswers({}); setLimiterResult(null); }} whileTap={{ scale: 0.9 }} className="text-muted-foreground"><ChevronRight size={20} className="rotate-180" /></motion.button>
        <h1 className="text-xl font-display font-bold">Limiter Test</h1>
      </div>
      <div className="px-5">
        {!limiterResult ? (
          <motion.div key={limiterStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
            <div className="flex gap-1 mb-2">
              {LIMITER_QUESTIONS.map((_, i) => (
                <div key={i} className={`flex-1 h-1 rounded-full ${i <= limiterStep ? "bg-primary" : "bg-muted"}`} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{limiterStep + 1} of {LIMITER_QUESTIONS.length}</p>
            <h3 className="font-display font-bold text-lg">{LIMITER_QUESTIONS[limiterStep].question}</h3>
            <p className="text-xs text-muted-foreground">Rate yourself 1 (very weak) to 10 (excellent)</p>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <motion.button key={n} onClick={() => answerLimiterQuestion(n)} whileTap={{ scale: 0.9 }}
                  className={`py-3 rounded-xl text-sm font-bold border transition-all ${limiterAnswers[LIMITER_QUESTIONS[limiterStep].id] === n ? "bg-primary/20 border-primary text-primary" : "bg-card border-border text-foreground hover:border-primary/30"}`}>{n}</motion.button>
              ))}
            </div>
            {limiterMetrics.length > 0 && (
              <p className="text-[12px] text-success flex items-center gap-1.5"><Check size={12} /> {limiterMetrics.length} logged test{limiterMetrics.length === 1 ? "" : "s"} will sharpen this analysis.</p>
            )}
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
            <div className="bg-gradient-card border border-primary/20 rounded-2xl p-5 shadow-card text-center">
              <AlertTriangle size={32} className="mx-auto text-primary mb-3" />
              <h3 className="font-display font-bold text-lg">Your Limiters</h3>
              <p className="text-sm text-muted-foreground mt-1">{limiterResult.limiters.length === 0 ? "No significant limiters found! You're well-rounded." : "Areas to improve, ranked by how much they hold your sport back"}</p>
              <p className="text-[12px] text-muted-foreground mt-2 px-2">{limiterResult.confidence}</p>
              {/* The score comes from self-ratings, not a measurement, and the
                  fix plan is the largest single AI output in the app. Both
                  facts belong on the card that sells it. */}
              <p className="text-[11px] leading-relaxed text-muted-foreground mt-3 px-2">
                {DISCLAIMERS.aiEstimate.short} A plan built from this is a starting point, not a diagnosis.
              </p>
            </div>
            {limiterResult.limiters.map((l, i) => (
              <motion.div key={l.name} initial={{ opacity: 0, x: -15 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold capitalize">{l.name}</span>
                  <span className={`text-sm font-display font-bold ${l.score <= 4 ? "text-destructive" : l.score <= 6 ? "text-energy" : "text-primary"}`}>{l.score}/10</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${l.score * 10}%` }} transition={{ delay: 0.3 + i * 0.1, duration: 0.6 }}
                    className={`h-full rounded-full ${l.score <= 4 ? "bg-destructive" : l.score <= 6 ? "bg-energy" : "bg-primary"}`} />
                </div>
                <p className="text-[12px] text-muted-foreground mt-2">
                  {l.evidence === "logged metric + self-rating" ? "📊 Backed by your logged test data + self-rating" : "🗣️ Self-rating only — log a test for objective data"}
                </p>
              </motion.div>
            ))}
            {limiterResult.limiters.length > 0 && (
              <motion.button onClick={createLimiterPlan} disabled={creatingLimiterPlan}
                whileTap={{ scale: 0.98 }} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow mt-4 disabled:opacity-50">
                {creatingLimiterPlan ? "Creating Plan..." : `Build a plan targeting these limiters (${creditCost("limiter_fix_plan")} credits · 4 weeks)`}
              </motion.button>
            )}
            <button onClick={() => { setLimiterStep(0); setLimiterAnswers({}); setLimiterResult(null); setActiveView("plans"); }} className="w-full text-sm text-muted-foreground underline text-center">Back to Training</button>
          </motion.div>
        )}
      </div>
    </div>
  );

  // === PERFORMANCE LOG VIEW ===
  if (activeView === "log") return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4 flex items-center gap-3">
        <motion.button onClick={() => setActiveView("plans")} whileTap={{ scale: 0.9 }} className="text-muted-foreground"><ChevronRight size={20} className="rotate-180" /></motion.button>
        <h1 className="text-xl font-display font-bold">Performance Log</h1>
      </div>
      <div className="px-5">
        {!showAddLog ? (
          <motion.button onClick={() => setShowAddLog(true)} whileTap={{ scale: 0.98 }} className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow mb-5 flex items-center justify-center gap-2"><Plus size={18} /> Log Performance</motion.button>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-2xl p-4 space-y-3 mb-5">
            <input type="text" placeholder="Title (optional)" value={logTitle} onChange={e => setLogTitle(e.target.value)} className={inputClass} />
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Log Type</label>
              <div className="flex gap-1.5 flex-wrap">
                {["training", "race", "time_trial", "test", "friendly", "interval", "tempo", "long_run"].map(t => (
                  <button key={t} onClick={() => setLogType(t)} className={`capitalize ${chipClass(logType === t)}`}>{t.replace("_", " ")}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Sport</label>
              <div className="flex flex-wrap gap-1.5">
                {["Running", "Cycling", "Swimming", "Gym", "Football", "CrossFit", "Other"].map(s => (
                  <button key={s} onClick={() => setLogSport(s)} className={chipClass(logSport === s)}>{s}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" step="0.01" placeholder="Distance (km)" value={logDistance} onChange={e => setLogDistance(e.target.value)} className={inputClass} />
              <input type="text" placeholder="Time (MM:SS)" value={logTime} onChange={e => setLogTime(e.target.value)} className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" placeholder="Avg HR (bpm)" value={logHeartRate} onChange={e => setLogHeartRate(e.target.value)} className={inputClass} />
              <input type="number" placeholder="Calories burned" value={logCalories} onChange={e => setLogCalories(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Perceived Exertion (RPE 1-10)</label>
              <input type="range" min={1} max={10} value={logRPE} onChange={e => setLogRPE(e.target.value)} className="w-full accent-primary" />
              <div className="flex justify-between text-[12px] text-muted-foreground"><span>Easy</span><span className="font-bold text-primary">{logRPE}</span><span>Max</span></div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Form Rating (1-10)</label>
              <input type="range" min={1} max={10} value={logFormRating} onChange={e => setLogFormRating(e.target.value)} className="w-full accent-primary" />
              <div className="flex justify-between text-[12px] text-muted-foreground"><span>Poor</span><span className="font-bold text-primary">{logFormRating}</span><span>Perfect</span></div>
            </div>
            <textarea placeholder="Notes..." value={logNotes} onChange={e => setLogNotes(e.target.value)} rows={2} className={inputClass + " resize-none"} />
            <div className="flex gap-2">
              <button onClick={() => setShowAddLog(false)} className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground">Cancel</button>
              <motion.button onClick={addLog} whileTap={{ scale: 0.98 }} className="flex-1 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl shadow-glow">Save</motion.button>
            </div>
          </motion.div>
        )}
        <div className="space-y-3 mb-8">
          {logs.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No logs yet.</p>}
          {logs.map((log, i) => (
            <motion.div key={log.id} initial={{ opacity: 0, x: -15 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
              className="bg-card border border-border rounded-xl p-4 hover:border-primary/20 transition-colors duration-300">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm">{log.title || "Training"}</h4>
                <span className="text-[12px] bg-primary/10 text-primary px-2 py-0.5 rounded-full capitalize">{log.log_type?.replace("_", " ")}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {log.sport && `${log.sport} · `}
                {log.distance_km && `${Number(log.distance_km)} km`}
                {log.pace_per_km && ` · ${log.pace_per_km}`}
                {log.time_seconds && ` · ${Math.floor(log.time_seconds / 60)}:${(log.time_seconds % 60).toString().padStart(2, "0")}`}
              </p>
              <div className="flex gap-3 mt-1">
                {log.perceived_exertion && <span className="text-[12px] text-muted-foreground">RPE: {log.perceived_exertion}/10</span>}
                {log.form_rating && <span className="text-[12px] text-muted-foreground">Form: {log.form_rating}/10</span>}
                {log.heart_rate_avg && <span className="text-[12px] text-muted-foreground">{log.heart_rate_avg} bpm</span>}
                {log.calories_burned && <span className="text-[12px] text-muted-foreground">{log.calories_burned} kcal</span>}
              </div>
              {log.notes && <p className="text-xs text-muted-foreground mt-1">{log.notes}</p>}
              <p className="text-[12px] text-muted-foreground mt-1">{new Date(log.created_at).toLocaleDateString()}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );

  // === PLAN DETAIL VIEW ===
  if (activeView === "planDetail" && selectedPlan) {
    const planData = selectedPlan.plan_data as PlanData | null;
    return (
      <div className="min-h-screen bg-background">
        <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4 flex items-center gap-3">
          <motion.button onClick={() => { setActiveView("plans"); setSelectedPlan(null); setExpandedWeek(null); }} whileTap={{ scale: 0.9 }} className="text-muted-foreground"><ChevronRight size={20} className="rotate-180" /></motion.button>
          <h1 className="text-lg font-display font-bold flex-1">{selectedPlan.title}</h1>
        </div>
        <div className="px-5 mb-3">
          <p className="text-sm text-muted-foreground">{selectedPlan.sport} · {selectedPlan.level} · Week {selectedPlan.week_current}/{selectedPlan.duration_weeks}</p>
          {adaptive.adjustments.length > 0 && (
            <span className="inline-flex items-center gap-1 mt-1.5 text-[12px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
              <TrendingUp size={11} /> Rebuilt for a break
            </span>
          )}
          <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${(selectedPlan.week_current / selectedPlan.duration_weeks) * 100}%` }} className="h-full bg-primary rounded-full" />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => setExpandedWeek(-1)}
              className="text-[12px] font-semibold bg-primary/10 text-primary px-3 py-1.5 rounded-lg">
              Expand all weeks
            </button>
            <button onClick={() => setExpandedWeek(null)}
              className="text-[12px] font-semibold bg-muted text-muted-foreground px-3 py-1.5 rounded-lg">
              Collapse all
            </button>
          </div>
        </div>

        {/* Edit with AI. Deliberately sits next to the free edits and says so:
            an athlete who does not know a holiday is free will pay 10 credits
            for one, and a paid button that hides the free option is a dark
            pattern however good the AI is. */}
        <div className="px-5 mb-4">
          <button
            type="button"
            onClick={() => setAiEditOpen((open) => !open)}
            aria-expanded={aiEditOpen}
            className="flex w-full items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-3"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Wand2 size={15} className="text-primary" /> Edit this plan with AI
            </span>
            <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
              {editCost(aiEditScope)} credits
              <ChevronDown size={14} className={`transition-transform ${aiEditOpen ? "rotate-180" : ""}`} />
            </span>
          </button>

          {aiEditOpen && (
            <div className="mt-2 space-y-3 rounded-2xl border border-border bg-gradient-card p-4">
              <div className="flex gap-1.5">
                {([["week", "This week"], ["plan", "Whole plan"]] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAiEditScope(value)}
                    aria-pressed={aiEditScope === value}
                    className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold ${aiEditScope === value ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"}`}
                  >
                    {label} · {editCost(value)} credits
                  </button>
                ))}
              </div>

              {aiEditScope === "week" && (
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">Which week</span>
                  <select
                    value={aiEditWeek}
                    onChange={(e) => setAiEditWeek(Number(e.target.value))}
                    className={inputClass}
                  >
                    {(planData ?? []).map((w) => (
                      <option key={w.week} value={w.week}>
                        Week {w.week}{w.isDeload ? " — deload" : ""}{w.isHoliday ? " — holiday" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">What should change?</span>
                {/* `resize-none` and a deliberate height: the browser's own
                    resize handle sat on top of the text, and the long example
                    placeholder was clipped rather than wrapped once the box
                    was two rows tall. The example moved out of the box and
                    under it, where it can be read in full. */}
                <textarea
                  value={aiEditInstruction}
                  onChange={(e) => setAiEditInstruction(e.target.value.slice(0, MAX_EDIT_INSTRUCTION))}
                  rows={4}
                  placeholder="What should change?"
                  className={`${inputClass} resize-none leading-relaxed`}
                />
                <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                  e.g. “my knee is sore — swap the running for swimming this week and keep the strength work”.
                </span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {aiEditInstruction.length}/{MAX_EDIT_INSTRUCTION} — the more specific you are, the better the edit.
                </span>
              </label>

              <motion.button
                type="button"
                onClick={runPlanEdit}
                disabled={aiEditBusy || aiEditInstruction.trim().length < MIN_EDIT_INSTRUCTION}
                whileTap={{ scale: 0.98 }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50"
              >
                {aiEditBusy
                  ? <><Loader2 size={16} className="animate-spin" /> Asking the coach…</>
                  : <><Wand2 size={16} /> Apply edit ({editCost(aiEditScope)} credits)</>}
              </motion.button>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Holidays, session titles, durations and skipping a session are free and stay free — use those
                for anything you can do with a tap. An AI edit that fails is refunded automatically, and nothing
                is written to your plan unless the edit comes back complete.
              </p>
            </div>
          )}
        </div>

        {/* A rebuild is the biggest thing that can happen to a plan, so it is
            said first, in the athlete's own numbers, with a way out. Collapsed
            to one sentence — the detail and the undo are one tap away rather
            than in the athlete's face every time they open their plan. */}
        {adaptive.adjustments.length > 0 && (
          <div className="px-5 mb-4">
            {adaptive.adjustments.map((record, index) => {
              const open = expandedRebuild === record.id;
              const isLatest = index === adaptive.adjustments.length - 1;
              return (
                <div key={record.id} className="rounded-xl border border-primary/25 bg-primary/[0.06] mb-2 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedRebuild(open ? null : record.id)}
                    aria-expanded={open}
                    className="w-full text-start p-3 flex items-start gap-2"
                  >
                    <TrendingUp size={14} className="text-primary mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold">{record.headline}</span>
                      <span className="block text-[12px] text-muted-foreground mt-0.5">{record.explanation}</span>
                    </span>
                    <ChevronDown size={14} className={`text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && (
                    <div className="px-3 pb-3 space-y-1">
                      {record.steps.map((step) => (
                        <div key={step.week} className="flex items-baseline justify-between gap-2 text-[12px] text-muted-foreground">
                          <span className="min-w-0 truncate">
                            Week {step.week}{step.back === 1 ? " · back" : ` · week ${step.back} back`}
                          </span>
                          <span className="shrink-0 text-end">
                            {step.volumePct}% volume · up to {step.intensityPct}% intensity
                            {step.dropped > 0 ? ` · ${step.dropped} dropped` : ""}
                          </span>
                        </div>
                      ))}
                      {/* No separate medical line here: the explanation above
                          already ends with it, and the same sentence twice is
                          how a screen starts to look like a disclaimer. The
                          field stays on the record for anything that should not
                          have to parse prose to find it. */}
                      {isLatest ? (
                        <button
                          type="button"
                          onClick={() => void undoRebuild(record.id)}
                          disabled={undoingRebuild === record.id}
                          className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-primary disabled:opacity-50"
                        >
                          <Undo2 size={12} />
                          {undoingRebuild === record.id ? "Undoing…" : "Undo this rebuild"}
                        </button>
                      ) : (
                        <p className="text-[12px] text-muted-foreground pt-1">
                          Undo the more recent rebuild first — this one is underneath it.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Phase 3: today's read. Placed after the rebuild panel and before
            "what changed" because it answers a different question — not "why is
            this different from what you were given" but "given what your body
            has told me this week, what should today be". Always shown, even
            when the answer is "nothing to change" or "I don't know": a
            recommendation that appears only when it has something to say reads
            as nagging, and one that hides its inputs reads as magic. */}
        {recoveryRead && planData && (
          <div className="px-5 mb-4">
            <RecoveryTodayRead
              read={recoveryRead}
              loading={recoveryReadLoading}
              expanded={showRecoveryWhy}
              onToggle={() => setShowRecoveryWhy((open) => !open)}
            />
          </div>
        )}

        {/* "What changed?" — the honest answer to why part of this plan is not
            there. Collapsed to one sentence, with the sessions behind it on
            tap, so the calendar stays a calendar rather than a report. */}
        {(adaptive.changes.length > 0 || adaptive.error) && (
          <div className="px-5 mb-4">
            {adaptive.changes.map((change) => {
              const open = expandedChange === change.event.id;
              return (
                <div key={change.event.id} className="rounded-xl border border-info/25 bg-info/[0.06] mb-2 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedChange(open ? null : change.event.id)}
                    aria-expanded={open}
                    className="w-full text-start p-3 flex items-start gap-2"
                  >
                    <Calendar size={14} className="text-info mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold">What changed</span>
                      <span className="block text-[12px] text-muted-foreground mt-0.5">{change.explanation}</span>
                    </span>
                    <ChevronDown size={14} className={`text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && (
                    <div className="px-3 pb-3 space-y-1">
                      {change.sessions.map((s) => (
                        <div key={`${s.scheduled_date}-${s.title}`} className="flex items-baseline justify-between gap-2 text-[12px] text-muted-foreground">
                          <span className="min-w-0 truncate">
                            {new Date(`${s.scheduled_date}T00:00:00`).toLocaleDateString()} · {s.title}
                            {s.important && <span className="text-info"> · key session</span>}
                          </span>
                          <span className="shrink-0">{sessionStatusMeta(s.status).label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {adaptive.error && (
              <p className="text-[12px] text-destructive">Couldn't load what changed: {adaptive.error}</p>
            )}
          </div>
        )}

        <div className="px-5 space-y-3 mb-8">
          {planData?.map((week) => (
            <div key={week.week} className={`bg-card border rounded-xl overflow-hidden ${week.week === selectedPlan.week_current ? "border-primary/30" : week.isHoliday ? "border-energy/30" : "border-border"}`}>
              <button onClick={() => setExpandedWeek(expandedWeek === week.week ? null : week.week)}
                className="w-full flex items-center justify-between p-4">
                <div className="flex items-center gap-2">
                  <h4 className="font-display font-bold text-sm">Week {week.week}{week.isDeload ? " (Deload)" : ""}</h4>
                  {week.week === selectedPlan.week_current && <span className="text-[12px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">Current</span>}
                  {week.isHoliday && <span className="text-[12px] bg-energy/10 text-energy px-2 py-0.5 rounded-full font-semibold">🏖️ Holiday</span>}
                  {/* The week-level tag: this week is not what the generator
                      wrote, and the athlete can see that from the outside. */}
                  {week.returnFromBreak && (
                    <span
                      title={week.extraNote}
                      className="text-[12px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold"
                    >
                      Rebuilt · {week.returnFromBreak.volumePct}%
                    </span>
                  )}
                  {week.extraNote && !week.returnFromBreak && <span className="text-[12px] bg-accent/10 text-accent-foreground px-2 py-0.5 rounded-full">+Extra</span>}
                </div>
                <motion.div animate={{ rotate: (expandedWeek === week.week || expandedWeek === -1) ? 180 : 0 }}><ChevronDown size={16} className="text-muted-foreground" /></motion.div>
              </button>
              <AnimatePresence>
                {(expandedWeek === week.week || expandedWeek === -1) && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-4 pb-4">
                    {week.extraNote && <p className="text-[12px] text-accent-foreground bg-accent/5 rounded-lg px-2 py-1 mb-2">{week.extraNote}</p>}
                    <div className="flex gap-2 mb-3">
                      <motion.button whileTap={{ scale: 0.95 }} onClick={() => toggleWeekHoliday(week.week)}
                        className="text-[12px] bg-energy/10 text-energy px-3 py-1 rounded-lg font-semibold">
                        {week.isHoliday ? "Remove Holiday" : "🏖️ Mark Holiday"}
                      </motion.button>
                    </div>
                    <div className="space-y-2">
                      {week.sessions?.map((session, si) => {
                        // The day a deep link asked for. Computed once per row so
                        // the ring rules below cannot disagree about which day it
                        // is, and so a highlighted day never also wears the
                        // cancelled-by-availability ring.
                        const isHighlighted = highlightDay?.week === week.week && highlightDay?.day === session.day;
                        return (
                        <div
                          key={si}
                          data-plan-day={`${week.week}-${session.day}`}
                          className={`rounded-lg transition-shadow duration-500 ${session.skipped ? "opacity-40" : ""} ${adaptive.statusFor(week.week, session.day) === "cancelled_due_to_availability" && !isHighlighted ? "opacity-70 ring-1 ring-info/30" : ""} ${isHighlighted ? "ring-2 ring-primary/60" : ""} ${session.isRest ? "bg-muted/20 border border-dashed border-border" : session.isRecovery ? "bg-accent/5 border border-accent/10" : "bg-muted/50 border border-border"} overflow-hidden`}
                        >
                          {editingSession?.week === week.week && editingSession?.day === session.day ? (
                            <div className="p-3 space-y-2">
                              <input value={editSessionTitle} onChange={e => setEditSessionTitle(e.target.value)} className={inputClass} placeholder="Session title" />
                              <input value={editSessionDuration} onChange={e => setEditSessionDuration(e.target.value)} type="number" className={inputClass} placeholder="Duration (min)" />
                              <div className="flex gap-2">
                                <button onClick={() => setEditingSession(null)} className="text-xs text-muted-foreground">Cancel</button>
                                <motion.button onClick={saveSessionEdit} whileTap={{ scale: 0.95 }} className="text-xs text-primary font-semibold">Save</motion.button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between px-3 py-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[12px] text-muted-foreground font-medium">{session.dayName || `Day ${session.day}`}</span>
                                    {session.isRest && <span className="text-[12px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">REST</span>}
                                    {session.isRecovery && <span className="text-[12px] bg-accent/10 px-1.5 py-0.5 rounded text-accent-foreground">RECOVERY</span>}
                                    {/* A session the rebuild touched, marked as such —
                                        otherwise a shortened session looks like the
                                        generator simply wrote a shorter one. */}
                                    {session.returnFromBreak && (
                                      <span
                                        title={
                                          session.returnFromBreak.dropped
                                            ? `${session.returnFromBreak.originalTitle ?? "This session"} was dropped for the rebuild — nothing was moved to another day.`
                                            : `Shortened from ${session.returnFromBreak.originalDuration ?? "?"} min while you rebuild.`
                                        }
                                        className={
                                          session.returnFromBreak.dropped
                                            ? "text-[12px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
                                            : "text-[12px] bg-primary/10 text-primary px-1.5 py-0.5 rounded"
                                        }
                                      >
                                        {session.returnFromBreak.dropped
                                          ? "DROPPED"
                                          : `REBUILD · ${session.returnFromBreak.intensityPct}%`}
                                      </span>
                                    )}
                                  </div>
                                  <span className={`text-xs font-semibold ${session.skipped ? "line-through" : ""}`}>{session.title}</span>
                                  {session.duration_minutes > 0 && <span className="text-[12px] text-muted-foreground ml-2">{session.duration_minutes} min</span>}
                                  {/* The status chip. Simple first, and the "What changed?"
                                      panel above carries the reason — progressive
                                      disclosure, per the design brief. */}
                                  {adaptive.statusFor(week.week, session.day) !== "planned" && (
                                    <span
                                      title={sessionStatusMeta(adaptive.statusFor(week.week, session.day)).detail}
                                      className="inline-block mt-1 text-[12px] bg-info/10 text-info px-1.5 py-0.5 rounded"
                                    >
                                      {sessionStatusMeta(adaptive.statusFor(week.week, session.day)).label}
                                    </span>
                                  )}
                                </div>
                                {!session.isRest && (
                                  <div className="flex items-center gap-1">
                                    <button onClick={() => { setEditingSession({ week: week.week, day: session.day }); setEditSessionTitle(session.title); setEditSessionDuration(String(session.duration_minutes)); }}
                                      className="p-1 text-muted-foreground hover:text-primary"><Edit3 size={12} /></button>
                                    <button onClick={() => skipSession(week.week, session.day)}
                                      className="p-1 text-muted-foreground hover:text-energy"><SkipForward size={12} /></button>
                                  </div>
                                )}
                              </div>
                              {session.description && <p className="text-[12px] text-muted-foreground px-3 pb-1">{session.description}</p>}
                              {/* Warmup.

                                  Two conditions, and both were bugs. An EMPTY
                                  array still printed the heading, so a rest day
                                  came back from the generator as a Warm-up
                                  heading over blank space — a section that had
                                  failed to load, in the athlete's reading of it.
                                  And a rest day has nothing to warm up FOR, so an
                                  answer that put mobility work in that slot is
                                  shown as the day's own work below instead of as
                                  a warm-up nobody is about to do. */}
                              {!session.isRest && (session.warmup?.length ?? 0) > 0 && !session.skipped && (
                                <div className="px-3 pb-1">
                                  <p className="text-[12px] font-semibold text-energy uppercase tracking-wider mb-1">Warm-up</p>
                                  {session.warmup.map((ex, ei) => (
                                    <div key={ei} className="border-b border-white/[0.05] py-1.5 last:border-b-0">
                                      <p className="text-[12.5px] font-medium leading-snug text-foreground/90 break-words">{ex.name}</p>
                                      <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground break-words">{ex.sets}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* Main exercises */}
                              {(session.exercises?.length ?? 0) > 0 && !session.skipped && (
                                <div className="px-3 pb-1">
                                  {!session.isRest && !session.isRecovery && <p className="text-[12px] font-semibold text-primary uppercase tracking-wider mb-1">Main Session</p>}
                                  {/* Stacked, not two columns.

                                      These rows used to be
                                      `flex justify-between` with the
                                      prescription right-aligned inside a
                                      `max-w-[50%]` column, so on a 390px phone
                                      "3 x 8 each side @ RPE 6-7, rest 75 sec,
                                      controlled depth" wrapped into four ragged
                                      lines beside a name that wrapped into two.
                                      A prescription is a sentence, not a value:
                                      it belongs under the movement it belongs
                                      to, where it can use the full width. */}
                                  {session.exercises.map((ex, ei) => (
                                    <div key={ei} className="border-b border-white/[0.05] py-1.5 last:border-b-0">
                                      <p className="text-[12.5px] font-medium leading-snug text-foreground break-words">{ex.name}</p>
                                      <p className="mt-0.5 text-[12px] font-medium leading-snug text-primary/90 break-words">{ex.sets}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* Cooldown — the same empty-heading and
                                  rest-day rules as the warm-up above. */}
                              {!session.isRest && (session.cooldown?.length ?? 0) > 0 && !session.skipped && (
                                <div className="px-3 pb-2">
                                  <p className="text-[12px] font-semibold text-info uppercase tracking-wider mb-1">Cool-down</p>
                                  {session.cooldown.map((ex, ei) => (
                                    <div key={ei} className="border-b border-white/[0.05] py-1.5 last:border-b-0">
                                      <p className="text-[12.5px] font-medium leading-snug text-foreground/90 break-words">{ex.name}</p>
                                      <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground break-words">{ex.sets}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // === MAIN PLANS VIEW ===
  const hasNoPlans = plans.length === 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Training</motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">Build your body. Sharpen your edge.</motion.p>
      </div>

      {activeBreak && (
        <div className="mx-5 mb-5">
          <ActiveBreakBanner event={activeBreak} />
        </div>
      )}

      {hasNoPlans && !showCreate && (
        <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          className="mx-5 mb-5 bg-gradient-card border border-primary/30 rounded-2xl p-5 shadow-card text-center">
          <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 2, repeat: Infinity }}><Dumbbell size={32} className="mx-auto text-primary mb-3" /></motion.div>
          <h3 className="font-display font-bold text-lg">No training plan yet</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Create your first personalised plan to get started.</p>
          <motion.button onClick={openCreateWizard} whileTap={{ scale: 0.98 }} whileHover={{ scale: 1.02 }}
            className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">
            <Plus size={18} /> Create Training Plan
          </motion.button>
        </motion.div>
      )}

      {plans.filter(p => p.active).map(plan => (
        <motion.div key={plan.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
          className="mx-5 mb-5 bg-gradient-card border border-border rounded-2xl p-4 shadow-card hover:border-primary/20 transition-colors duration-500">
          <div className="flex items-center gap-2 mb-2"><div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" /><span className="text-[12px] font-semibold uppercase tracking-wider text-primary">Active Plan</span></div>
          <h3 className="font-display font-bold text-lg">{plan.title}</h3>
          <p className="text-sm text-muted-foreground mt-1">Week {plan.week_current} of {plan.duration_weeks} · {plan.sport} · {plan.level}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Includes strength, plyometrics & cross-training</p>
          <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${(plan.week_current / plan.duration_weeks) * 100}%` }} transition={{ delay: 0.3, duration: 0.8 }} className="h-full bg-primary rounded-full" />
          </div>
          {/* The "Start workout" CTA used to open the workout logger, which is
              gone. This card is the plan summary; opening the plan is the only
              action it still owns, so the eye button now fills the row. */}
          <div className="flex gap-2 mt-4">
            <motion.button onClick={() => { setSelectedPlan(plan); setActiveView("planDetail"); setExpandedWeek(plan.week_current); }} whileTap={{ scale: 0.98 }}
              className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">
              <Eye size={18} /> Open plan
            </motion.button>
          </div>
        </motion.div>
      ))}

      {showCreate && (
        <motion.div initial={{ opacity: 0, y: 15, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          className="mx-5 mb-5 bg-gradient-card border border-border rounded-2xl p-4 shadow-card space-y-3">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display font-bold">Create Plan</h3>
            <button onClick={() => { setShowCreate(false); setPlanQuizStep(0); }} className="text-muted-foreground"><X size={18} /></button>
          </div>
          {/* Progress dots */}
          <div className="flex gap-1">
            {[0, 1, 2].map(i => (
              <div key={i} className={`flex-1 h-1 rounded-full ${i <= planQuizStep ? "bg-primary" : "bg-muted"}`} />
            ))}
          </div>
          {loading ? (
            <PlanGenerationProgress weeks={duration} />
          ) : (
            <p className="text-[12px] text-muted-foreground">Step {planQuizStep + 1} of 3 · {["Basics", "Availability", "Preferences"][planQuizStep]}</p>
          )}

          {!loading && planQuizStep === 0 && (
            <div className="space-y-3">
              <AdvicePanel
                step={1}
                advice={planAdvice}
                onApplyAll={applyRecommendedSetup}
                onApplyField={applyAdviceField}
                applied={{ durationWeeks: adviceApplied("durationWeeks", duration) }}
              />
              {level === "advanced" && <AdvancedFreedomNote />}
              <input type="text" placeholder="Plan name (optional)" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} className={inputClass} />
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Your Age *</label>
                <input type="number" placeholder="Age (required for safe training)" value={planAge} onChange={e => setPlanAge(e.target.value)} className={inputClass} />
                <p className="text-[12px] text-muted-foreground mt-1">Training load is adapted for your age group.</p>
              </div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Sport</label><div className="flex flex-wrap gap-1.5">{sportOptions.map(s => (<button key={s} onClick={() => setSport(s)} className={chipClass(sport === s)}>{s}</button>))}</div></div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Goals <span className="text-muted-foreground/70">(pick all that apply)</span></label>
                <div className="flex flex-wrap gap-1.5">
                  {goalOptions.map(g => (
                    <button key={g} type="button" onClick={() => toggleGoal(g)}
                      className={chipClass(goals.includes(g))}>
                      {goals.includes(g) && <Check size={12} className="inline mr-1 -mt-0.5" />}{g}
                    </button>
                  ))}
                </div>
                <p className="text-[12px] text-muted-foreground mt-1">{goals.length} goal{goals.length === 1 ? "" : "s"} selected — the plan will blend all of them.</p>
              </div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Level</label><div className="flex gap-1.5">{levelOptions.map(l => (<button key={l} onClick={() => setLevel(l)} className={`flex-1 capitalize ${chipClass(level === l)}`}>{l}</button>))}</div></div>
              <div><div className="mb-1 flex items-center gap-2"><label className="text-xs text-muted-foreground">Plan length</label><RecommendedChip value={`${planAdvice.durationWeeks}w`} applied={adviceApplied("durationWeeks", duration)} onApply={() => applyAdviceField("durationWeeks")} /></div><div className="flex gap-1.5">{durationOptions.map(d => (<button key={d} onClick={() => setDuration(d)} className={`flex-1 ${chipClass(duration === d)}`}>{d}w</button>))}</div></div>
            </div>
          )}

          {!loading && planQuizStep === 1 && (
            <div className="space-y-3">
              <AdvicePanel
                step={2}
                advice={planAdvice}
                onApplyAll={applyRecommendedSetup}
                onApplyField={applyAdviceField}
                applied={{
                  daysPerWeek: adviceApplied("daysPerWeek", planDaysPerWeek),
                  restDays: adviceApplied("restDays", planRecoveryDays),
                  sessionLengthPref: adviceApplied("sessionLengthPref", planSessionLengthPref),
                  hoursPerWeek: adviceApplied("hoursPerWeek", planHoursPerWeek),
                }}
              />
              <div>
                <div className="mb-1 flex items-center gap-2"><label className="text-xs text-muted-foreground">Days per week you can train</label><RecommendedChip value={`${planAdvice.daysPerWeek} days`} applied={adviceApplied("daysPerWeek", planDaysPerWeek)} onApply={() => applyAdviceField("daysPerWeek")} /></div>
                <div className="flex gap-1.5 flex-wrap">{[2,3,4,5,6,7].map(n => (
                  <button key={n} onClick={() => setPlanDaysPerWeek(n)} className={`flex-1 ${chipClass(planDaysPerWeek === n)}`}>{n}</button>
                ))}</div>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-2"><label className="text-xs text-muted-foreground">Total hours per week</label><RecommendedChip value={`~${planAdvice.hoursPerWeek}h`} applied={adviceApplied("hoursPerWeek", planHoursPerWeek)} onApply={() => applyAdviceField("hoursPerWeek")} /></div>
                <input type="number" min={1} max={30} step={0.5} value={planHoursPerWeek} onChange={e => setPlanHoursPerWeek(parseFloat(e.target.value) || 0)} className={inputClass} />
                <p className="text-[12px] text-muted-foreground mt-1">Sessions will average ~{Math.round((planHoursPerWeek * 60) / Math.max(1, planDaysPerWeek))} min.</p>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-2"><label className="text-xs text-muted-foreground">Preferred session length</label><RecommendedChip value={planAdvice.sessionLengthPref} applied={adviceApplied("sessionLengthPref", planSessionLengthPref)} onApply={() => applyAdviceField("sessionLengthPref")} /></div>
                <div className="grid grid-cols-3 gap-1.5">
                  {([["short","Short"],["standard","Standard"],["long","Long"]] as const).map(([v,l]) => (
                    <button key={v} onClick={() => setPlanSessionLengthPref(v)} className={chipClass(planSessionLengthPref === v)}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Best time of day to train</label>
                {/* "Afternoon" in an 11px font needs ~70px, which is exactly the
                    cell width four-across gives at 320px — so the label clipped
                    on the narrowest phones. Two-up below `sm`. */}
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {["Morning","Afternoon","Evening","Night"].map(t => (
                    <button key={t} onClick={() => setPlanTimeOfDay(t)} className={`text-[12px] ${chipClass(planTimeOfDay === t)}`}>{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-2"><label className="text-xs text-muted-foreground">Dedicated full rest days per week</label><RecommendedChip value={`${planAdvice.restDays} full rest`} applied={adviceApplied("restDays", planRecoveryDays)} onApply={() => applyAdviceField("restDays")} /></div>
                <div className="flex gap-1.5">{[0,1,2,3].map(n => (
                  <button key={n} onClick={() => setPlanRecoveryDays(n)} className={`flex-1 ${chipClass(planRecoveryDays === n)}`}>{n}</button>
                ))}</div>
              </div>
            </div>
          )}

          {!loading && planQuizStep === 2 && (
            <div className="space-y-3">
              <AdvicePanel
                step={3}
                advice={planAdvice}
                onApplyAll={applyRecommendedSetup}
                onApplyField={applyAdviceField}
                applied={{
                  intensityPref: adviceApplied("intensityPref", planIntensityPref),
                  environment: adviceApplied("environment", planEnvironment),
                  focusAreas: adviceApplied("focusAreas", planFocusAreas),
                }}
              />
              <div>
                <div className="mb-1 flex items-center gap-2"><label className="text-xs text-muted-foreground">Intensity preference</label><RecommendedChip value={planAdvice.intensityPref} applied={adviceApplied("intensityPref", planIntensityPref)} onApply={() => applyAdviceField("intensityPref")} /></div>
                <div className="grid grid-cols-3 gap-1.5">
                  {([["easy","Easy"],["balanced","Balanced"],["hard","Hard"]] as const).map(([v,l]) => (
                    <button key={v} onClick={() => setPlanIntensityPref(v)} className={chipClass(planIntensityPref === v)}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Equipment available</label>
                {/* The catalogue (src/config/equipment.ts) rather than free-form
                    labels: the ids are what generate-plan turns into an
                    instruction, and a label the model cannot map to a real
                    facility is how a plan prescribes a pool to somebody with
                    no pool. "Nothing yet" is exclusive. */}
                <div className="space-y-2">
                  {(["Gym", "Endurance", "Field", "Minimal"] as const).map(group => (
                    <div key={group}>
                      <p className="text-[12px] uppercase tracking-widest text-muted-foreground/70 mb-1">{group}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {EQUIPMENT.filter(e => e.group === group).map(e => {
                          const selected = planEquipment.includes(e.id);
                          return (
                            <button
                              key={e.id}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => {
                                if (e.id === "none") {
                                  setPlanEquipment(selected ? [] : ["none"]);
                                } else {
                                  const withoutNone = planEquipment.filter(id => id !== "none");
                                  setPlanEquipment(selected ? withoutNone.filter(id => id !== e.id) : [...withoutNone, e.id]);
                                }
                              }}
                              className={`text-[12px] ${chipClass(selected)}`}
                            >{e.label}</button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[12px] text-muted-foreground mt-1">
                  {planEquipment.length
                    ? `Your plan will use: ${describeEquipment(planEquipment)}.`
                    : "Nothing selected — the plan will be bodyweight and space only."}
                </p>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-2"><label className="text-xs text-muted-foreground">Training environment</label><RecommendedChip value={planAdvice.environment} applied={adviceApplied("environment", planEnvironment)} onApply={() => applyAdviceField("environment")} /></div>
                <div className="grid grid-cols-4 gap-1.5">
                  {["Indoor","Outdoor","Mixed","Altitude"].map(e => (
                    <button key={e} onClick={() => setPlanEnvironment(e)} className={`text-[12px] ${chipClass(planEnvironment === e)}`}>{e}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-2"><label className="text-xs text-muted-foreground">Focus areas <span className="text-muted-foreground/70">(easy → advanced)</span></label><RecommendedChip value={`${planAdvice.focusAreas.length} areas`} applied={adviceApplied("focusAreas", planFocusAreas)} onApply={() => applyAdviceField("focusAreas")} /></div>
                <div className="space-y-2">
                  {[
                    { tier: "Easy", color: "text-success", items: ["General Fitness","Mobility","Flexibility","Active Recovery","Fat Loss","Posture","Core Basics","Walking Base"] },
                    { tier: "Intermediate", color: "text-primary", items: ["Strength","Endurance","Muscle Gain","Cardio Base","Balance","Technique","Injury Prevention","Cross-Training"] },
                    { tier: "Advanced", color: "text-energy", items: ["Speed","Power","Explosiveness","Agility","VO2 Max","Anaerobic Threshold","Sport-Specific","Reactive Strength","Plyometrics","Peak Performance","Mental Toughness","Race Prep"] },
                  ].map(group => (
                    <div key={group.tier}>
                      <p className={`text-[12px] uppercase tracking-widest font-semibold mb-1 ${group.color}`}>{group.tier}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {group.items.map(f => (
                          <button key={f} type="button" onClick={() => setPlanFocusAreas(planFocusAreas.includes(f) ? planFocusAreas.filter(x=>x!==f) : [...planFocusAreas, f])}
                            className={`text-[12px] ${chipClass(planFocusAreas.includes(f))}`}>{f}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Target event / race (optional)</label>
                <input type="text" placeholder="e.g. Marathon in 8 weeks" value={planTargetEvent} onChange={e => setPlanTargetEvent(e.target.value)} maxLength={100} className={inputClass} />
              </div>
              <p className="text-xs text-muted-foreground">Cost: {creditCost("training_plan_week", duration)} credits ({duration} weeks × {creditCost("training_plan_week")} credits/week).</p>
              {/* Training loads and intensity targets are what this screen
                  produces, and getting them wrong is how somebody gets hurt,
                  so the health line belongs here and not only on a legal page. */}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {DISCLAIMERS.healthRisk.full}
              </p>
              {planAge && parseInt(planAge) < 16 && <p className="text-xs text-energy flex items-center gap-1"><AlertTriangle size={12} /> Under-18 safety limits applied (lighter loads, more mobility).</p>}
              {planAge && parseInt(planAge) > 50 && <p className="text-xs text-energy flex items-center gap-1"><AlertTriangle size={12} /> Senior-adapted plan (balance, joint-friendly).</p>}
            </div>
          )}

          {!loading && (
          <div className="flex gap-2 pt-1">
            {planQuizStep > 0 && (
              <button onClick={() => setPlanQuizStep(s => s - 1)} className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground">Back</button>
            )}
            {planQuizStep < 2 ? (
              <motion.button onClick={() => setPlanQuizStep(s => s + 1)} disabled={planQuizStep === 0 && !planAge} whileTap={{ scale: 0.98 }}
                className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl disabled:opacity-50 shadow-glow">
                Next <ChevronRight size={16} />
              </motion.button>
            ) : (
              <motion.button onClick={createPlan} disabled={loading || !planAge} whileTap={{ scale: 0.98 }}
                className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl disabled:opacity-50 shadow-glow">
                <Zap size={16} /> Create Plan ({creditCost("training_plan_week", duration)} credits)
              </motion.button>
            )}
          </div>
          )}
        </motion.div>
      )}



      {!hasNoPlans && (
        <div className="px-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Your Plans</h3>
            <button onClick={openCreateWizard} className="text-xs text-primary font-semibold flex items-center gap-1"><Plus size={14} /> New</button>
          </div>
          <div className="space-y-3 mb-6">
            {plans.map((plan, i) => (
              <motion.div key={plan.id} initial={{ opacity: 0, x: -15 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.06 }}
                className="bg-card border border-border rounded-xl p-4 hover:border-primary/20 transition-colors duration-300">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 cursor-pointer" onClick={() => { setSelectedPlan(plan); setActiveView("planDetail"); setExpandedWeek(plan.week_current); }}>
                    <div className="p-2 rounded-lg bg-primary/10"><Dumbbell size={18} className="text-primary" /></div>
                    <div><h4 className="font-semibold text-sm">{plan.title}</h4><p className="text-xs text-muted-foreground">{plan.duration_weeks}w · {plan.sport} · {plan.level}</p></div>
                  </div>
                  <div className="flex items-center gap-2">
                    {plan.active ? <span className="text-[12px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">Active</span> : null}
                    <motion.button onClick={(e) => { e.stopPropagation(); deletePlan(plan.id); }} whileTap={{ scale: 0.9 }}
                      className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={14} /></motion.button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      <div ref={toolsRef} className="px-5">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Performance Tools</h3>
        <div className="space-y-3 mb-8">
          {[
            { icon: Activity, label: "Performance Log", desc: "Track sessions, RPE, form & progress", view: "log" as const },
            { icon: Target, label: "Limiter Test", desc: "Find your weakest areas & get a fix plan", view: "limiter" as const },
          ].map((tool, i) => (
            <motion.div key={tool.label} initial={{ opacity: 0, x: -20 }} animate={toolsInView ? { opacity: 1, x: 0 } : {}}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              whileHover={{ x: 4 }} whileTap={{ scale: 0.97 }}
              onClick={() => setActiveView(tool.view)}
              className="bg-card border border-border rounded-xl p-4 flex items-center justify-between cursor-pointer hover:border-primary/20 transition-colors duration-300">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10"><tool.icon size={18} className="text-primary" /></div>
                <div><h4 className="font-semibold text-sm">{tool.label}</h4><p className="text-xs text-muted-foreground">{tool.desc}</p></div>
              </div>
              <ChevronRight size={16} className="text-muted-foreground" />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Training;