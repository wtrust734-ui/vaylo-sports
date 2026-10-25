import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Eye,
  Loader2,
  Plus,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { getAgeCaps } from "@/lib/athleteDossier";
import { getPrimarySport } from "@/lib/profile";
import { analyzeLimiterTest, LIMITER_QUESTIONS, recoveryDayOptions, type LimiterAnalysis, type LimiterCategory } from "@/lib/limiterTest";
import type { MetricRow } from "@/lib/performance";
import {
  EQUIPMENT,
  describeEquipment,
  normaliseEquipment,
  type EquipmentId,
} from "@/config/equipment";
import { DISCLAIMERS } from "@/config/disclaimers";
import { asPlanWeeks, type PlanSessionLike, type PlanWeekLike } from "@/lib/planSchedule";
import {
  generatePlanData,
  planConstraints,
  type DisabilitySupport,
  type PlanData,
  type PlanQuiz,
} from "@/lib/localPlanBuilder";
import PlanBuildProgress from "@/components/training/PlanBuildProgress";
import ActiveBreakBanner from "@/components/ActiveBreakBanner";
import { useActiveBreak } from "@/hooks/useActiveBreak";
import { PageHeader } from "@/components/layout/PageShell";

type TrainingPlan = Tables<"training_plans">;
type Screen = "home" | "limiter" | "setup" | "detail";
type SetupSource = "standard" | "limiter";

const SPORTS = [
  "Running",
  "Gym/Weightlifting",
  "Football",
  "Basketball",
  "Swimming",
  "Cycling",
  "Tennis",
  "Rugby",
  "Boxing",
  "Athletics",
  "Triathlon",
  "CrossFit",
  "General",
];

const GOALS = ["Speed", "Strength", "Endurance", "Fat Loss", "Muscle Gain", "Power", "Agility"];
const LEVELS = ["beginner", "intermediate", "advanced"] as const;
const DURATIONS = [4, 6, 8, 12];
const TIME_OF_DAY = ["Morning", "Afternoon", "Evening", "Night"];
const ENVIRONMENTS = ["Indoor", "Outdoor", "Mixed", "Altitude"];
const SETUP_STEPS = ["Basics", "Availability", "Preferences", "Anything else?"];

/**
 * Only access needs a training plan can adapt around are listed here.
 *
 * A condition where exercise is contraindicated does not belong in a quiz: it
 * belongs in a conversation with a clinician, and offering it as an option
 * would imply the app can safely plan around it.
 */
const DISABILITY_OPTIONS: { id: DisabilitySupport; label: string; blurb: string }[] = [
  { id: "none", label: "No disability or access need", blurb: "Nothing to adapt for." },
  {
    id: "mobility",
    label: "Mobility / limb difference",
    blurb: "Seated options, supported versions and low-impact conditioning.",
  },
  {
    id: "chronic_pain_fatigue",
    label: "Chronic pain or fatigue",
    blurb: "Shorter sessions, more rest and a lower ceiling on intensity.",
  },
  {
    id: "vision",
    label: "Vision impairment",
    blurb: "Familiar spaces, guided outdoor work and clear verbal cues.",
  },
  {
    id: "hearing",
    label: "Hearing impairment",
    blurb: "Visual coaching cues and demonstrated, not shouted, instructions.",
  },
  {
    id: "neurodivergent",
    label: "Neurodivergent (e.g. ADHD, autism)",
    blurb: "Short single-focus blocks and a written finish line.",
  },
  { id: "prefer_not_to_say", label: "Prefer not to say", blurb: "Skip the adaptation questions." },
];

const DISABILITY_LABEL: Record<DisabilitySupport, string> = {
  none: "No disability or access need",
  mobility: "Mobility / limb difference",
  chronic_pain_fatigue: "Chronic pain or fatigue",
  vision: "Vision impairment",
  hearing: "Hearing impairment",
  neurodivergent: "Neurodivergent",
  prefer_not_to_say: "Prefer not to say",
};

const isLimiterPlan = (plan: { goal?: string | null; title?: string | null }) =>
  plan.goal?.startsWith("Fix:") || plan.title?.startsWith("Limiter Fix Plan");

const FOCUS_GROUPS = [
  {
    tier: "Easy",
    items: ["General Fitness", "Mobility", "Flexibility", "Active Recovery", "Posture", "Core Basics"],
  },
  {
    tier: "Intermediate",
    items: ["Strength", "Endurance", "Muscle Gain", "Cardio Base", "Balance", "Technique", "Injury Prevention"],
  },
  {
    tier: "Advanced",
    items: ["Speed", "Power", "Agility", "Explosiveness", "VO2 Max", "Sport-Specific", "Plyometrics"],
  },
];

const LIMITER_LABEL: Record<LimiterCategory, string> = {
  speed: "Speed",
  endurance: "Endurance",
  strength: "Strength",
  power: "Power",
  mobility: "Mobility",
  agility: "Change of direction",
  technique: "Technique",
  recovery: "Recovery",
};

/** The focus-area vocabulary the plan builder understands, keyed by limiter. */
const LIMITER_FOCUS: Record<LimiterCategory, string> = {
  speed: "Speed",
  endurance: "Endurance",
  strength: "Strength",
  power: "Power",
  mobility: "Mobility",
  agility: "Agility",
  technique: "Technique",
  recovery: "Active Recovery",
};

const card = "rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-[var(--vaylo-elev-card)]";
const input =
  "w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";

const chip = (active: boolean) =>
  `press inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-semibold transition-colors ${
    active
      ? "border-primary/60 bg-primary/15 text-primary"
      : "border-white/[0.08] bg-white/[0.03] text-foreground hover:border-primary/30 hover:bg-white/[0.06]"
  }`;

const joinGoals = (goals: string[]): string => {
  const joined = goals.join(", ");
  return joined.length > 300 ? joined.slice(0, 300).trimEnd().replace(/,\s*\S*$/, "") : joined;
};

/** `plan_data` is stored as JSON, and older rows wrap the weeks in `{ weeks }`. */
function readWeeks(data: unknown): PlanWeekLike[] {
  const direct = asPlanWeeks(data);
  if (direct.length) return direct;
  if (data && typeof data === "object") {
    const wrapped = (data as { weeks?: unknown }).weeks;
    return asPlanWeeks(wrapped);
  }
  return [];
}

function exerciseRows(value: unknown): { name: string; sets: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row) => ({
      name: typeof row.name === "string" ? row.name : "",
      sets: typeof row.sets === "string" ? row.sets : "",
    }))
    .filter((row) => row.name.length > 0);
}

function ageFromProfile(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;
  return Math.floor((Date.now() - born.getTime()) / 31_557_600_000);
}

const Training = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  const [screen, setScreen] = useState<Screen>("home");
  const [selectedPlan, setSelectedPlan] = useState<TrainingPlan | null>(null);
  const [expandedWeek, setExpandedWeek] = useState<number | null>(1);

  // Limiter test
  const [limiterStarted, setLimiterStarted] = useState(false);
  const [limiterStep, setLimiterStep] = useState(0);
  const [limiterAnswers, setLimiterAnswers] = useState<Record<string, number>>({});
  const [limiterResult, setLimiterResult] = useState<LimiterAnalysis | null>(null);
  const [limiterMetrics, setLimiterMetrics] = useState<MetricRow[]>([]);
  const [limiterReadiness, setLimiterReadiness] = useState<{ readiness_score: number | null }[]>([]);

  // Plan setup quiz
  const [setupSource, setSetupSource] = useState<SetupSource>("standard");
  const [setupStep, setSetupStep] = useState(0);
  const [planNotes, setPlanNotes] = useState("");
  const [disability, setDisability] = useState<DisabilitySupport>("none");
  const [creating, setCreating] = useState(false);
  /** Weeks of the plan being built, or null when no build screen is showing. */
  const [buildWeeks, setBuildWeeks] = useState<number | null>(null);
  /** The answers the build is using, shown on the build screen as they go in. */
  const [buildDetails, setBuildDetails] = useState<string[]>([]);
  // An availability window covering today. This screen is where the athlete
  // goes to train, so a break has to be visible here too — not only on the
  // dashboard card and /availability.
  const activeBreak = useActiveBreak();
  /** Resolves when the build screen reports 100%, so the reveal waits for it. */
  const finishBuildRef = useRef<(() => void) | null>(null);
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState(getPrimarySport(profile?.sport));
  const [goals, setGoals] = useState<string[]>(["Strength"]);
  const [level, setLevel] = useState<string>(profile?.experience_level || "beginner");
  const [duration, setDuration] = useState(6);
  const [age, setAge] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [hoursPerWeek, setHoursPerWeek] = useState(6);
  const [sessionLength, setSessionLength] = useState<PlanQuiz["sessionLengthPref"]>("standard");
  const [timeOfDay, setTimeOfDay] = useState("Evening");
  const [recoveryDays, setRecoveryDays] = useState(1);
  const [equipment, setEquipment] = useState<EquipmentId[]>([]);
  const [environment, setEnvironment] = useState("Mixed");
  const [intensity, setIntensity] = useState<PlanQuiz["intensityPref"]>("balanced");
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [targetEvent, setTargetEvent] = useState("");

  const activePlan = useMemo(() => plans.find((plan) => plan.active) ?? null, [plans]);
  const latestLimiterPlan = useMemo(() => plans.find((plan) => isLimiterPlan(plan)) ?? null, [plans]);
  const ageNumber = age ? Number.parseInt(age, 10) : null;
  const ageCaps = ageNumber && Number.isFinite(ageNumber) ? getAgeCaps(ageNumber) : null;
  const topLimiter = limiterResult?.limiters[0] ?? null;

  const loadPlans = useCallback(async () => {
    if (!user) return;
    setLoadingPlans(true);
    const { data, error } = await supabase
      .from("training_plans")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      setLoadError(error.message);
    } else {
      setLoadError(null);
      setPlans((data ?? []) as TrainingPlan[]);
    }
    setLoadingPlans(false);
  }, [user]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  // Seed the quiz from the profile once, without overwriting a choice made here.
  useEffect(() => {
    setSport(getPrimarySport(profile?.sport));
    setLevel(profile?.experience_level || "beginner");
    const born = ageFromProfile(profile?.date_of_birth);
    if (born) setAge(String(born));
    const saved = normaliseEquipment(
      (profile?.extended_profile as Record<string, unknown> | null)?.equipment,
    );
    if (saved.length) setEquipment((current) => (current.length ? current : saved));
  }, [profile?.sport, profile?.experience_level, profile?.date_of_birth, profile?.extended_profile]);

  // Logged tests and readiness sharpen the limiter reading. A missing read is
  // not an error: the test still works on self-ratings and says so.
  useEffect(() => {
    if (screen !== "limiter" || !user) return;
    let alive = true;
    Promise.all([
      supabase
        .from("performance_metrics")
        .select("metric_type, value, log_date")
        .eq("user_id", user.id)
        .order("log_date", { ascending: false })
        .limit(40),
      supabase
        .from("recovery_logs")
        .select("readiness_score, log_date")
        .eq("user_id", user.id)
        .order("log_date", { ascending: false })
        .limit(14),
    ])
      .then(([metrics, readiness]) => {
        if (!alive) return;
        setLimiterMetrics((metrics.data ?? []) as MetricRow[]);
        setLimiterReadiness((readiness.data ?? []) as { readiness_score: number | null }[]);
      })
      .catch(() => {
        /* self-ratings only */
      });
    return () => {
      alive = false;
    };
  }, [screen, user]);

  const openLimiter = () => {
    setLimiterStarted(false);
    setLimiterStep(0);
    setLimiterAnswers({});
    setLimiterResult(null);
    setScreen("limiter");
  };

  const answerLimiter = (score: number) => {
    const question = LIMITER_QUESTIONS[limiterStep];
    const next = { ...limiterAnswers, [question.id]: score };
    setLimiterAnswers(next);
    if (limiterStep < LIMITER_QUESTIONS.length - 1) {
      setLimiterStep((step) => step + 1);
      return;
    }
    setLimiterResult(
      analyzeLimiterTest(
        next,
        limiterMetrics,
        getPrimarySport(profile?.sport) || sport,
        limiterReadiness,
      ),
    );
  };

  const retakeLimiter = () => {
    setLimiterStarted(true);
    setLimiterStep(0);
    setLimiterAnswers({});
    setLimiterResult(null);
  };

  const openSetup = (source: SetupSource) => {
    setSetupSource(source);
    setSetupStep(0);
    setPlanNotes("");
    setDisability("none");
    setTargetEvent("");
    if (source === "limiter" && limiterResult) {
      const labels = limiterResult.limiters.map((limiter) => LIMITER_LABEL[limiter.name]);
      setTitle(`Limiter Fix Plan — ${labels[0] ?? "Training"}`);
      setDuration(4);
      setGoals(["Strength"]);
      setFocusAreas([
        ...new Set(limiterResult.limiters.map((limiter) => LIMITER_FOCUS[limiter.name])),
      ]);
    } else {
      setTitle("");
      setDuration(6);
      setFocusAreas([]);
    }
    setScreen("setup");
  };

  const leaveSetup = () => {
    if (setupStep > 0) {
      setSetupStep((step) => step - 1);
      return;
    }
    setScreen(setupSource === "limiter" ? "limiter" : "home");
  };

  const toggleEquipment = (id: EquipmentId) => {
    if (id === "none") {
      setEquipment((current) => (current.includes("none") ? [] : ["none"]));
      return;
    }
    setEquipment((current) => {
      const withoutNone = current.filter((item) => item !== "none");
      return withoutNone.includes(id)
        ? withoutNone.filter((item) => item !== id)
        : [...withoutNone, id];
    });
  };

  const toggleFocus = (area: string) => {
    setFocusAreas((current) =>
      current.includes(area) ? current.filter((item) => item !== area) : [...current, area],
    );
  };

  const toggleGoal = (goal: string) => {
    setGoals((current) =>
      current.includes(goal)
        ? current.length > 1
          ? current.filter((item) => item !== goal)
          : current
        : [...current, goal],
    );
  };

  const createPlan = async () => {
    if (!user || creating) return;
    const parsedAge = age ? Number.parseInt(age, 10) : ageNumber;
    if (!parsedAge || !Number.isFinite(parsedAge)) {
      toast.error("Enter your age — the plan's loads are capped by it.");
      return;
    }
    const caps = getAgeCaps(parsedAge);
    const effectiveDays = Math.min(daysPerWeek, caps.maxSessionsPerWeek, 7 - caps.minRestDays);
    const effectiveRecovery = Math.max(recoveryDays, caps.minRestDays);
    const effectiveHours = Math.min(
      hoursPerWeek,
      (effectiveDays * caps.maxMinutesPerSession) / 60,
    );
    const quiz: PlanQuiz = {
      daysPerWeek: effectiveDays,
      hoursPerWeek: Math.max(1, Math.round(effectiveHours * 2) / 2),
      sessionLengthPref: sessionLength,
      equipment,
      environment,
      intensityPref: parsedAge < 16 && intensity === "hard" ? "balanced" : intensity,
      focusAreas,
      timeOfDay,
      targetEvent: targetEvent.trim(),
      recoveryDays: effectiveRecovery,
      notes: planNotes.trim(),
      disability,
    };
    const constraints = planConstraints(quiz);
    const notesForDescription = planNotes.trim().replace(/\s+/g, " ").slice(0, 220);
    const adaptationLine = [
      notesForDescription
        ? `Your notes are part of this plan: "${notesForDescription}${planNotes.trim().length > 220 ? "…" : ""}".`
        : "",
      disability !== "none" && disability !== "prefer_not_to_say"
        ? `Adapted for: ${DISABILITY_LABEL[disability]}.`
        : "",
      constraints.cues.length ? `${constraints.cues.length} adaptation${constraints.cues.length === 1 ? "" : "s"} applied to every session.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const limiterGoal =
      setupSource === "limiter" && limiterResult
        ? limiterResult.limiters.map((limiter) => LIMITER_LABEL[limiter.name]).join(", ")
        : null;
    const goal = limiterGoal ? `Fix: ${limiterGoal}` : joinGoals(goals);
    const generationGoal = limiterGoal ?? goal;
    const sportName = sport || getPrimarySport(profile?.sport);
    const planTitle =
      title.trim() ||
      (setupSource === "limiter" && topLimiter
        ? `Limiter Fix Plan — ${LIMITER_LABEL[topLimiter.name]}`
        : `${goals.join(" + ")} ${sportName} Plan`);

    setCreating(true);
    // The build screen is a promise the reveal waits on. The plan is assembled
    // and saved while it runs; the counter only decides when the athlete sees
    // the result, never whether the work happens.
    setBuildDetails(
      [
        `${effectiveDays} training day${effectiveDays === 1 ? "" : "s"} a week`,
        `${effectiveRecovery} full rest day${effectiveRecovery === 1 ? "" : "s"}`,
        equipment.length ? describeEquipment(equipment) : "Bodyweight and open space",
        planNotes.trim() ? "Your notes applied to every session" : "",
        disability !== "none" && disability !== "prefer_not_to_say"
          ? `Adapted: ${DISABILITY_LABEL[disability]}`
          : "",
        focusAreas.length ? `Focus: ${focusAreas.slice(0, 3).join(", ")}` : "",
      ].filter(Boolean),
    );
    setBuildWeeks(duration);
    const buildScreenFinished = new Promise<void>((resolve) => {
      finishBuildRef.current = resolve;
    });
    let savedPlan: TrainingPlan | null = null;
    let failure: string | null = null;
    try {
      const planData: PlanData = generatePlanData(
        sportName,
        generationGoal,
        level,
        duration,
        parsedAge,
        quiz,
      );
      const confidence = limiterResult?.confidence.replace(/[.\s]+$/, "") ?? "";
      const description =
        setupSource === "limiter" && limiterResult
          ? `${duration}-week plan targeting ${limiterResult.limiters
              .map((limiter) => LIMITER_LABEL[limiter.name].toLowerCase())
              .join(", ")}. Built from your Limiter Test — ${confidence.toLowerCase()} — with ${effectiveDays} sessions and ${effectiveRecovery} recovery day${effectiveRecovery === 1 ? "" : "s"} a week.${adaptationLine ? ` ${adaptationLine}` : ""}`
          : `${duration}-week ${goals.join(" + ").toLowerCase()} plan for ${sportName.toLowerCase()} · ${effectiveDays}d/wk · ${quiz.hoursPerWeek}h/wk · ${intensity} intensity${focusAreas.length ? ` · focus: ${focusAreas.join(", ")}` : ""} · trains in the ${timeOfDay.toLowerCase()}${quiz.targetEvent ? ` · targeting ${quiz.targetEvent}` : ""}.${adaptationLine ? ` ${adaptationLine}` : ""}`;

      // Only one plan can drive the dashboard and the daily card. Deactivate
      // first, then insert as active, so there is never a moment with two.
      const { error: deactivateError } = await supabase
        .from("training_plans")
        .update({ active: false })
        .eq("user_id", user.id)
        .eq("active", true);
      if (deactivateError) throw deactivateError;

      const planRow = {
        user_id: user.id,
        title: planTitle,
        sport: sportName,
        goal,
        level,
        duration_weeks: duration,
        description,
        plan_data: planData as unknown as Json,
        active: true,
      };
      // Two attempts: the plan is already assembled in memory, so a retry costs
      // a moment and a lost insert costs the athlete the plan they just built.
      // A second attempt never regenerates anything — same row, same data.
      let saved: TrainingPlan | null = null;
      let insertMessage: string | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const { data: inserted, error: insertError } = await supabase
          .from("training_plans")
          .insert(planRow)
          .select("*")
          .single();
        if (!insertError && inserted) {
          saved = inserted as TrainingPlan;
          break;
        }
        insertMessage = insertError?.message ?? null;
      }
      if (!saved) {
        // The build is gone, so say so plainly and say what NOT to do: creating
        // the plan again would replace it a second time rather than recover
        // this one. Nothing was charged — training plans are built on device.
        throw new Error(
          "Your plan was written but could not be saved. Do not create it again — doing it a second time replaces this one rather than recovering it. Nothing was charged. Contact support from Profile if this keeps happening." +
            (insertMessage ? ` (${insertMessage})` : ""),
        );
      }

      savedPlan = saved;
    } catch (error) {
      failure = error instanceof Error ? error.message : "Could not create the plan.";
      // Nothing was built, so there is nothing to reveal: end the build screen
      // now instead of making the athlete watch a 10–20s counter for an error
      // that is already known. The counter paces the reveal, it never delays a
      // failure report.
      finishBuildRef.current?.();
    }

    // Reveal only after the counter has shown 100% — this is what makes the
    // build feel crafted rather than instant, without delaying the save.
    await buildScreenFinished;
    finishBuildRef.current = null;
    setBuildWeeks(null);
    setBuildDetails([]);
    setCreating(false);

    if (failure) {
      toast.error(failure);
      return;
    }
    if (!savedPlan) {
      toast.error("The plan was created but could not be opened.");
      return;
    }

    const plan = savedPlan;
    setPlans((current) => [plan, ...current.map((row) => ({ ...row, active: false }))]);
    setSelectedPlan(plan);
    setExpandedWeek(1);
    setScreen("detail");
    toast.success(
      setupSource === "limiter" ? "Limiter plan created — opening it now." : "Plan created.",
    );
    if (effectiveDays < daysPerWeek) {
      toast.message(`Capped at ${effectiveDays} days a week for your age band.`);
    }
  };

  const activatePlan = async (plan: TrainingPlan) => {
    if (!user || activating || plan.active) return;
    setActivating(true);
    try {
      await supabase
        .from("training_plans")
        .update({ active: false })
        .eq("user_id", user.id)
        .eq("active", true);
      const { error } = await supabase
        .from("training_plans")
        .update({ active: true })
        .eq("id", plan.id)
        .eq("user_id", user.id);
      if (error) throw error;
      setPlans((current) =>
        current.map((row) => ({ ...row, active: row.id === plan.id })),
      );
      if (selectedPlan?.id === plan.id) setSelectedPlan({ ...selectedPlan, active: true });
      toast.success("This plan is now active.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not activate the plan.");
    } finally {
      setActivating(false);
    }
  };

  const deletePlan = async (plan: TrainingPlan) => {
    setConfirmDelete(null);
    const { error } = await supabase
      .from("training_plans")
      .delete()
      .eq("id", plan.id)
      .eq("user_id", user?.id ?? "");
    if (error) {
      toast.error(error.message);
      return;
    }
    setPlans((current) => current.filter((row) => row.id !== plan.id));
    if (selectedPlan?.id === plan.id) {
      setSelectedPlan(null);
      setScreen("home");
    }
    toast.success("Plan deleted.");
  };

  const openPlan = (plan: TrainingPlan) => {
    setSelectedPlan(plan);
    const weeks = readWeeks(plan.plan_data);
    const current = weeks.find((week) => week.week === plan.week_current) ?? weeks[0];
    setExpandedWeek(current?.week ?? 1);
    setScreen("detail");
  };

  // One header, shared with every other screen. Training used to draw its own
  // eyebrow/title pair at a different size, so moving from the Train hub into
  // the plan list changed the title size and the column by a few pixels.
  const header = (eyebrow: string, heading: string, subtitle?: string) => (
    <PageHeader eyebrow={eyebrow} icon={Dumbbell} title={heading} subtitle={subtitle} />
  );

  const backButton = (onClick: () => void, label: string) => (
    <button
      type="button"
      onClick={onClick}
      className="press mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-muted-foreground"
    >
      <ChevronLeft size={18} aria-hidden /> {label}
    </button>
  );

  // ------------------------------------------------------------- limiter ---
  if (screen === "limiter") {
    const question = LIMITER_QUESTIONS[limiterStep];
    const answered = limiterAnswers[question?.id] ?? null;
    const total = LIMITER_QUESTIONS.length;
    return (
      <div className="min-h-screen pb-28">
        <div className="mx-auto w-full max-w-2xl px-5 pt-[var(--vaylo-screen-top)] sm:px-6">
          {backButton(() => setScreen("home"), "Training")}
          {header("Limiter Test", "Find the one thing to work on")}

          {!limiterStarted && !limiterResult ? (
            <div className="space-y-4">
              <div className={`${card} p-5`}>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                  <Target size={20} className="text-primary" aria-hidden />
                </span>
                <h2 className="mt-4 font-display text-lg font-bold">Eight honest ratings</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Rate how reliably you can do each part of your sport. The test ranks the
                  areas by how much they hold your sport back — not by which one sounds worst.
                </p>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li className="flex gap-2">
                    <Check size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                    Takes about two minutes.
                  </li>
                  <li className="flex gap-2">
                    <Check size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                    Logged speed, strength, endurance and recovery tests sharpen the result.
                  </li>
                  <li className="flex gap-2">
                    <Check size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                    At the end you can build a plan around the result.
                  </li>
                </ul>
                <button
                  type="button"
                  onClick={() => setLimiterStarted(true)}
                  className="press mt-5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow"
                >
                  Start the test <ChevronRight size={16} aria-hidden />
                </button>
              </div>
              <p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
                A limiter here is a training priority, not a diagnosis. Sharp or persistent pain
                needs a physiotherapist or doctor, not a plan from an app.
              </p>
            </div>
          ) : limiterResult ? (
            <div className="space-y-4">
              <div className={`${card} p-5`}>
                <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
                  Your limiter
                </p>
                <h2 className="mt-1 font-display text-2xl font-bold">
                  {topLimiter ? LIMITER_LABEL[topLimiter.name] : "No clear limiter"}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {topLimiter
                    ? `${LIMITER_LABEL[topLimiter.name]} is ranked first for ${sport && sport !== "General" ? sport : "your sport"}. Work on it before adding more volume elsewhere.`
                    : "Nothing stood out enough to call a limiter. That is a good result — keep training across the board."}
                </p>
                <p className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
                  {limiterResult.confidence}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openSetup("limiter")}
                    className="press flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-glow"
                  >
                    <Sparkles size={16} aria-hidden /> Create a plan to fix this
                  </button>
                  <button
                    type="button"
                    onClick={retakeLimiter}
                    className="press min-h-[48px] rounded-xl border border-white/[0.08] px-4 text-sm font-semibold text-muted-foreground"
                  >
                    Retake
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                {limiterResult.limiters.map((limiter) => (
                  <div key={limiter.name} className={`${card} p-4`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold">{LIMITER_LABEL[limiter.name]}</p>
                      <p className="shrink-0 text-sm font-bold tabular-nums">
                        {limiter.score.toFixed(1)}
                        <span className="text-muted-foreground">/10</span>
                      </p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className={`h-full rounded-full ${
                          limiter.score <= 4
                            ? "bg-destructive"
                            : limiter.score <= 6
                              ? "bg-energy"
                              : "bg-primary"
                        }`}
                        style={{ width: `${Math.max(3, Math.min(100, limiter.score * 10))}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      {limiter.evidence === "self-rating only"
                        ? "Self-rating only — log a test for objective evidence."
                        : "Backed by your logged test data and self-rating."}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-1" aria-hidden>
                {LIMITER_QUESTIONS.map((item, index) => (
                  <span
                    key={item.id}
                    className={`h-1 flex-1 rounded-full ${
                      index <= limiterStep ? "bg-primary" : "bg-white/[0.08]"
                    }`}
                  />
                ))}
              </div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Question {limiterStep + 1} of {total}
              </p>
              <div className={`${card} p-5`}>
                <h2 className="font-display text-lg font-bold leading-snug">{question.question}</h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  Rate yourself 1 (very weak) to 10 (excellent).
                </p>
                <div className="mt-4 grid grid-cols-5 gap-2">
                  {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
                    <button
                      key={score}
                      type="button"
                      aria-label={`Rate ${score} out of 10`}
                      aria-pressed={answered === score}
                      onClick={() => answerLimiter(score)}
                      className={`press flex h-12 items-center justify-center rounded-xl border text-sm font-bold tabular-nums transition-colors ${
                        answered === score
                          ? "border-primary bg-primary/20 text-primary"
                          : "border-white/[0.08] bg-white/[0.03] text-foreground hover:border-primary/40"
                      }`}
                    >
                      {score}
                    </button>
                  ))}
                </div>
                <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
                  {limiterMetrics.length > 0
                    ? `${limiterMetrics.length} logged test${limiterMetrics.length === 1 ? "" : "s"} will sharpen this reading.`
                    : "No logged tests yet — this reading will be based on your self-ratings and say so."}
                </p>
              </div>
              {limiterStep > 0 ? (
                <button
                  type="button"
                  onClick={() => setLimiterStep((step) => Math.max(0, step - 1))}
                  className="press inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-muted-foreground"
                >
                  <ChevronLeft size={16} aria-hidden /> Previous question
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------- setup ---
  if (screen === "setup" && setupSource === "limiter" && limiterResult) {
    const steps = ["age", "days", "recovery", "equipment", "notes", "summary"] as const;
    const step = steps[Math.min(setupStep, steps.length - 1)];
    const stepIndex = steps.indexOf(step);
    const lastStep = step === "summary";
    const canContinue = step !== "age" || (ageNumber !== null && ageNumber >= 13);
    const plannedDays = ageCaps
      ? Math.min(daysPerWeek, ageCaps.maxSessionsPerWeek, 7 - ageCaps.minRestDays)
      : daysPerWeek;
    // A week has seven days: whatever is not a training day is a rest day, so
    // the rest answer can never exceed what is left. Without this, choosing six
    // training days still offered "None / 1 / 2 / 3 full rest" — answers that
    // add up to more than a week. When exactly one day is left, one is the only
    // honest option (the day is not training, so it is rest).
    const maxRecoveryDays = Math.max(0, 7 - plannedDays);
    const recoveryOptions = recoveryDayOptions(plannedDays);
    const plannedRecovery = Math.min(
      maxRecoveryDays,
      ageCaps ? Math.max(recoveryDays, ageCaps.minRestDays) : recoveryDays,
    );
    const constraints = planConstraints({
      daysPerWeek: plannedDays,
      hoursPerWeek,
      sessionLengthPref: sessionLength,
      equipment,
      environment,
      intensityPref: intensity,
      focusAreas,
      timeOfDay,
      targetEvent,
      recoveryDays: plannedRecovery,
      notes: planNotes,
      disability,
    });
    const targetLabel = limiterResult.limiters
      .map((limiter) => LIMITER_LABEL[limiter.name])
      .join(", ");

    return (
      <div className="min-h-screen pb-28">
        {buildWeeks !== null ? (
          <PlanBuildProgress
            weeks={buildWeeks}
            details={buildDetails}
            onComplete={() => finishBuildRef.current?.()}
          />
        ) : null}
        <div className="mx-auto w-full max-w-2xl px-5 pt-[var(--vaylo-screen-top)] sm:px-6">
          {backButton(
            () => (stepIndex === 0 ? setScreen("limiter") : setSetupStep((current) => Math.max(0, current - 1))),
            stepIndex === 0 ? "Limiter result" : "Previous question",
          )}
          {header(
            "Limiter plan",
            "Build the plan that fixes it",
            "Six quick questions. They decide the sessions — the limiter decides the focus.",
          )}

          <div className="mb-4 rounded-xl border border-primary/25 bg-primary/[0.06] px-3.5 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
              Fixing your limiter
            </p>
            <p className="mt-1 text-sm font-semibold">{targetLabel}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {limiterResult.confidence}
            </p>
          </div>

          <div className="mb-4 flex gap-1" aria-hidden>
            {steps.map((item, index) => (
              <span
                key={item}
                className={`h-1 flex-1 rounded-full ${index <= stepIndex ? "bg-primary" : "bg-white/[0.08]"}`}
              />
            ))}
          </div>
          <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {step === "summary"
              ? `Review · ${steps.length - 1} questions answered`
              : `Question ${stepIndex + 1} of ${steps.length - 1}`}
          </p>

          <div className={`${card} p-5`}>
            {step === "age" ? (
              <div>
                <h2 className="font-display text-xl font-bold leading-snug">What age are you?</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Age sets the ceiling on sessions, load and rest. It is applied automatically — you
                  do not have to police it.
                </p>
                <label htmlFor="limiter-plan-age" className="mt-4 block text-xs font-semibold text-muted-foreground">
                  Age
                </label>
                <input
                  id="limiter-plan-age"
                  type="number"
                  inputMode="numeric"
                  min={13}
                  max={100}
                  placeholder="e.g. 24"
                  value={age}
                  onChange={(event) => setAge(event.target.value)}
                  className={`${input} mt-1.5`}
                />
                <p className={`mt-2 text-[12px] leading-relaxed ${ageNumber !== null && ageNumber < 13 ? "text-destructive" : "text-muted-foreground"}`}>
                  {ageNumber !== null && ageNumber < 13
                    ? "A training plan needs an age of 13 or older. If that is not right, a parent or clinician should help choose what comes next."
                    : ageCaps
                      ? `At ${ageNumber}, this plan is capped at ${ageCaps.maxSessionsPerWeek} sessions a week with at least ${ageCaps.minRestDays} full rest day${ageCaps.minRestDays === 1 ? "" : "s"}.`
                      : "Loads and session counts are capped by age."}
                </p>
              </div>
            ) : null}

            {step === "days" ? (
              <div>
                <h2 className="font-display text-xl font-bold leading-snug">How many days a week are you free?</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Pick the number you can actually keep. A plan you can finish beats a perfect one
                  you cannot.
                </p>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {[2, 3, 4, 5, 6, 7].map((days) => (
                    <button
                      key={days}
                      type="button"
                      aria-pressed={daysPerWeek === days}
                      onClick={() => {
                        setDaysPerWeek(days);
                        // Keep the rest answer inside the week when the training
                        // answer grows. Six days leaves one, so a stale 2 or 3
                        // becomes 1 immediately rather than at submit time.
                        const effective = ageCaps
                          ? Math.min(days, ageCaps.maxSessionsPerWeek, 7 - ageCaps.minRestDays)
                          : days;
                        const maxRest = Math.max(0, 7 - effective);
                        setRecoveryDays((current) =>
                          maxRest === 1 ? 1 : Math.min(current, maxRest),
                        );
                      }}
                      className={`${chip(daysPerWeek === days)} min-h-[56px] text-base`}
                    >
                      {days}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                  {ageCaps && plannedDays < daysPerWeek
                    ? `Your age band caps this at ${plannedDays} training days. The plan will use ${plannedDays}.`
                    : "Rest days are programmed around the days you choose."}
                </p>
              </div>
            ) : null}

            {step === "recovery" ? (
              <div>
                <h2 className="font-display text-xl font-bold leading-snug">How many full recovery days can you take?</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Full rest means no training. Training days plus full rest days cannot add up to
                  more than seven — the plan will never drop below your age band's minimum, and the
                  remaining days are recovery.
                </p>
                <div className={`mt-5 grid gap-2 ${recoveryOptions.length > 3 ? "grid-cols-4" : recoveryOptions.length === 3 ? "grid-cols-3" : recoveryOptions.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {recoveryOptions.map((days) => (
                    <button
                      key={days}
                      type="button"
                      aria-pressed={plannedRecovery === days}
                      onClick={() => setRecoveryDays(days)}
                      className={`${chip(plannedRecovery === days)} min-h-[56px]`}
                    >
                      {days === 0 ? "None" : days}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                  {maxRecoveryDays === 0
                    ? "All seven days are training days, so there is no full rest day left in the week."
                    : `You have ${plannedDays} training day${plannedDays === 1 ? "" : "s"}, so at most ${maxRecoveryDays} full rest day${maxRecoveryDays === 1 ? "" : "s"} fit in the week.`}
                </p>
                {ageCaps && plannedRecovery > recoveryDays ? (
                  <p className="mt-3 text-[12px] leading-relaxed text-energy">
                    Your age band requires at least {plannedRecovery} full rest day{plannedRecovery === 1 ? "" : "s"} — that is what the plan will use.
                  </p>
                ) : null}
              </div>
            ) : null}

            {step === "equipment" ? (
              <div>
                <h2 className="font-display text-xl font-bold leading-snug">What equipment do you have?</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Pick everything you can reach. Leave it empty and the plan uses bodyweight and open
                  space only.
                </p>
                <div className="mt-4 space-y-3">
                  {(["Gym", "Endurance", "Field", "Minimal"] as const).map((group) => {
                    const items = EQUIPMENT.filter((item) => item.group === group);
                    if (!items.length) return null;
                    return (
                      <div key={group}>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                          {group}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {items.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              aria-pressed={equipment.includes(item.id)}
                              onClick={() => toggleEquipment(item.id)}
                              className={chip(equipment.includes(item.id))}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                  {equipment.length
                    ? `Your plan will use: ${describeEquipment(equipment)}.`
                    : "Nothing selected — the plan will use bodyweight and open space only."}
                </p>
              </div>
            ) : null}

            {step === "notes" ? (
              <div className="space-y-5">
                <div>
                  <h2 className="font-display text-xl font-bold leading-snug">Anything else we should know?</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    Injuries, a physical job, a holiday coming up, only 30 minutes on weekdays —
                    anything that changes what you can do. It is kept with this plan and applied to
                    the sessions.
                  </p>
                  <label htmlFor="limiter-plan-notes" className="mt-4 block text-xs font-semibold text-muted-foreground">
                    Your notes <span className="font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="limiter-plan-notes"
                    value={planNotes}
                    maxLength={500}
                    rows={4}
                    placeholder="e.g. left knee gets sore on downhill runs; I only have 30 minutes on weekdays"
                    onChange={(event) => setPlanNotes(event.target.value)}
                    className={`${input} mt-1.5 min-h-[110px] resize-y leading-relaxed`}
                  />
                  <p className="mt-1 text-right text-[11px] text-muted-foreground">
                    {planNotes.length}/500
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">
                    Do you have a disability or access need we should adapt for?
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    These are all conditions a training plan can work around. If a clinician has told
                    you not to exercise, do not start this plan.
                  </p>
                  <div className="mt-2 space-y-2">
                    {DISABILITY_OPTIONS.map((option) => {
                      const active = disability === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setDisability(option.id)}
                          className={`press flex min-h-[56px] w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                            active
                              ? "border-primary/60 bg-primary/15"
                              : "border-white/[0.08] bg-white/[0.03]"
                          }`}
                        >
                          <span
                            aria-hidden
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              active ? "border-primary bg-primary text-primary-foreground" : "border-white/25"
                            }`}
                          >
                            {active ? <Check size={10} /> : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-semibold">{option.label}</span>
                            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                              {option.blurb}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            {step === "summary" ? (
              <div>
                <h2 className="font-display text-xl font-bold leading-snug">Ready to build it</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {duration} weeks, {plannedDays} training day{plannedDays === 1 ? "" : "s"} and{" "}
                  {plannedRecovery} full recovery day{plannedRecovery === 1 ? "" : "s"} a week, built
                  around {targetLabel.toLowerCase()}.
                </p>
                <dl className="mt-4 space-y-2 text-sm">
                  {[
                    ["Limiter", targetLabel],
                    ["Age", ageNumber !== null ? String(ageNumber) : "Not set"],
                    ["Training days", `${plannedDays} a week`],
                    ["Full recovery", `${plannedRecovery} a week`],
                    ["Equipment", equipment.length ? describeEquipment(equipment) : "Bodyweight / open space"],
                    ["Your notes", planNotes.trim() || "None"],
                    ["Access need", DISABILITY_LABEL[disability]],
                  ].map(([label, value]) => (
                    // Label above value on a phone, side by side from `sm` up:
                    // a fixed 112px label column left ~110px for a value like
                    // "speed, strength, endurance", which broke mid-word on a
                    // 320px screen instead of reading as a sentence.
                    <div key={label} className="flex flex-col gap-0.5 border-b border-white/[0.06] pb-2 last:border-0 sm:flex-row sm:gap-3">
                      <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground sm:w-28 sm:text-[12px] sm:font-normal sm:normal-case sm:tracking-normal">{label}</dt>
                      <dd className="min-w-0 flex-1 break-words text-[13px] font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
                {constraints.cues.length ? (
                  <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.05] px-3.5 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                      Adaptations applied
                    </p>
                    <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
                      {constraints.cues.map((cue) => (
                        <li key={cue} className="flex gap-2">
                          <Check size={13} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                          <span>{cue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  {DISCLAIMERS.healthRisk.full}
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={() => setSetupStep((current) => Math.max(0, current - 1))}
                className="press min-h-[48px] rounded-xl border border-white/[0.08] px-4 text-sm font-semibold text-muted-foreground"
              >
                Back
              </button>
            ) : null}
            {lastStep ? (
              <button
                type="button"
                onClick={() => void createPlan()}
                disabled={creating || !ageNumber || ageNumber < 13}
                className="press flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden /> Creating…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} aria-hidden /> Create my plan
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSetupStep((current) => current + 1)}
                disabled={!canContinue}
                className="press flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50"
              >
                Next question <ChevronRight size={16} aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (screen === "setup") {
    const canContinue = setupStep > 0 || (ageNumber !== null && ageNumber >= 13);
    const lastStep = setupStep === 3;
    return (
      <div className="min-h-screen pb-28">
        {buildWeeks !== null ? (
          <PlanBuildProgress
            weeks={buildWeeks}
            details={buildDetails}
            onComplete={() => finishBuildRef.current?.()}
          />
        ) : null}
        <div className="mx-auto w-full max-w-2xl px-5 pt-[var(--vaylo-screen-top)] sm:px-6">
          {backButton(leaveSetup, setupSource === "limiter" ? "Limiter result" : "Training")}
          {header(
            setupSource === "limiter" ? "Limiter plan" : "New plan",
            setupSource === "limiter" ? "Build the plan that fixes it" : "Build your plan",
          )}

          <div className="mb-4 flex gap-1" aria-hidden>
            {SETUP_STEPS.map((label, index) => (
              <span
                key={label}
                className={`h-1 flex-1 rounded-full ${index <= setupStep ? "bg-primary" : "bg-white/[0.08]"}`}
              />
            ))}
          </div>
          <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Step {setupStep + 1} of {SETUP_STEPS.length} · {SETUP_STEPS[setupStep]}
          </p>

          {setupSource === "limiter" && limiterResult ? (
            <p className="mb-4 rounded-xl border border-primary/25 bg-primary/[0.06] px-3.5 py-3 text-[13px] leading-relaxed text-muted-foreground">
              Targeting{" "}
              <strong className="text-foreground">
                {limiterResult.limiters
                  .map((limiter) => LIMITER_LABEL[limiter.name])
                  .join(", ")}
              </strong>
              . These answers decide the sessions — not the test result alone.
            </p>
          ) : null}

          <div className={`${card} p-4 sm:p-5`}>
            {setupStep === 0 ? (
              <div className="space-y-4">
                <div>
                  <label htmlFor="plan-title" className="text-xs font-semibold text-muted-foreground">
                    Plan name
                  </label>
                  <input
                    id="plan-title"
                    type="text"
                    value={title}
                    maxLength={100}
                    placeholder="Optional"
                    onChange={(event) => setTitle(event.target.value)}
                    className={`${input} mt-1.5`}
                  />
                </div>

                <div>
                  <label htmlFor="plan-age" className="text-xs font-semibold text-muted-foreground">
                    Your age *
                  </label>
                  <input
                    id="plan-age"
                    type="number"
                    inputMode="numeric"
                    min={13}
                    max={100}
                    placeholder="Age"
                    value={age}
                    onChange={(event) => setAge(event.target.value)}
                    className={`${input} mt-1.5`}
                  />
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                    {ageCaps
                      ? `At ${ageNumber}, this plan is capped at ${ageCaps.maxSessionsPerWeek} sessions a week with at least ${ageCaps.minRestDays} full rest day${ageCaps.minRestDays === 1 ? "" : "s"}.`
                      : "Loads and session counts are capped by age."}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Sport</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {SPORTS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={sport === option}
                        onClick={() => setSport(option)}
                        className={chip(sport === option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">
                    Goals <span className="font-normal">(pick all that apply)</span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {GOALS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={goals.includes(option)}
                        onClick={() => toggleGoal(option)}
                        className={chip(goals.includes(option))}
                      >
                        {goals.includes(option) ? <Check size={13} aria-hidden /> : null}
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Level</p>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {LEVELS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={level === option}
                        onClick={() => setLevel(option)}
                        className={`${chip(level === option)} capitalize`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Plan length</p>
                  <div className="mt-1.5 grid grid-cols-4 gap-2">
                    {DURATIONS.map((weeks) => (
                      <button
                        key={weeks}
                        type="button"
                        aria-pressed={duration === weeks}
                        onClick={() => setDuration(weeks)}
                        className={chip(duration === weeks)}
                      >
                        {weeks}w
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {setupStep === 1 ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">
                    Days a week you can train
                  </p>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5 min-[360px]:grid-cols-6">
                    {[2, 3, 4, 5, 6, 7].map((days) => (
                      <button
                        key={days}
                        type="button"
                        aria-pressed={daysPerWeek === days}
                        onClick={() => setDaysPerWeek(days)}
                        className={`${chip(daysPerWeek === days)} px-1`}
                      >
                        {days}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="plan-hours" className="text-xs font-semibold text-muted-foreground">
                    Hours a week
                  </label>
                  <input
                    id="plan-hours"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={30}
                    step={0.5}
                    value={hoursPerWeek}
                    onChange={(event) => setHoursPerWeek(Number.parseFloat(event.target.value) || 0)}
                    className={`${input} mt-1.5`}
                  />
                  <p className="mt-1.5 text-[12px] text-muted-foreground">
                    Sessions will average about{" "}
                    {Math.round((hoursPerWeek * 60) / Math.max(1, daysPerWeek))} minutes.
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Session length</p>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {(["short", "standard", "long"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={sessionLength === option}
                        onClick={() => setSessionLength(option)}
                        className={`${chip(sessionLength === option)} capitalize`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Best time to train</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {TIME_OF_DAY.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={timeOfDay === option}
                        onClick={() => setTimeOfDay(option)}
                        className={chip(timeOfDay === option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">
                    Full recovery days a week
                  </p>
                  <div className="mt-1.5 grid grid-cols-4 gap-2">
                    {[0, 1, 2, 3].map((days) => (
                      <button
                        key={days}
                        type="button"
                        aria-pressed={recoveryDays === days}
                        onClick={() => setRecoveryDays(days)}
                        className={chip(recoveryDays === days)}
                      >
                        {days === 0 ? "None" : days}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                    The most you can build in. Under-18 and older age bands get a higher minimum
                    rest, applied automatically.
                  </p>
                </div>
              </div>
            ) : null}

            {setupStep === 2 ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Intensity</p>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {(["easy", "balanced", "hard"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={intensity === option}
                        onClick={() => setIntensity(option)}
                        className={`${chip(intensity === option)} capitalize`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Equipment you have</p>
                  <div className="mt-2 space-y-3">
                    {(["Gym", "Endurance", "Field", "Minimal"] as const).map((group) => {
                      const items = EQUIPMENT.filter((item) => item.group === group);
                      if (!items.length) return null;
                      return (
                        <div key={group}>
                          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                            {group}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {items.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                aria-pressed={equipment.includes(item.id)}
                                onClick={() => toggleEquipment(item.id)}
                                className={chip(equipment.includes(item.id))}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                    {equipment.length
                      ? `Your plan will use: ${describeEquipment(equipment)}.`
                      : "Nothing selected — the plan will use bodyweight and open space only."}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Environment</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {ENVIRONMENTS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={environment === option}
                        onClick={() => setEnvironment(option)}
                        className={chip(environment === option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">Focus areas</p>
                  <div className="mt-2 space-y-2.5">
                    {FOCUS_GROUPS.map((group) => (
                      <div key={group.tier}>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                          {group.tier}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {group.items.map((area) => (
                            <button
                              key={area}
                              type="button"
                              aria-pressed={focusAreas.includes(area)}
                              onClick={() => toggleFocus(area)}
                              className={chip(focusAreas.includes(area))}
                            >
                              {area}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="plan-event" className="text-xs font-semibold text-muted-foreground">
                    Target event <span className="font-normal">(optional)</span>
                  </label>
                  <input
                    id="plan-event"
                    type="text"
                    value={targetEvent}
                    maxLength={100}
                    placeholder="e.g. Half marathon in 8 weeks"
                    onChange={(event) => setTargetEvent(event.target.value)}
                    className={`${input} mt-1.5`}
                  />
                </div>

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {DISCLAIMERS.healthRisk.full}
                </p>
                {ageNumber !== null && ageNumber < 18 ? (
                  <p className="flex items-start gap-1.5 text-xs text-energy">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                    Under-18 limits applied: lighter loads, more mobility, more rest.
                  </p>
                ) : null}
              </div>
            ) : null}

            {setupStep === 3 ? (
              <div className="space-y-5">
                <div>
                  <h2 className="font-display text-lg font-bold leading-snug">
                    Anything else we should know?
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    Injuries, a physical job, a holiday coming up, only 30 minutes on weekdays —
                    anything that changes what you can do. It is kept with this plan and applied to
                    the sessions.
                  </p>
                  <label htmlFor="plan-notes" className="mt-4 block text-xs font-semibold text-muted-foreground">
                    Your notes <span className="font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="plan-notes"
                    value={planNotes}
                    maxLength={500}
                    rows={4}
                    placeholder="e.g. left knee gets sore on downhill runs; I only have 30 minutes on weekdays"
                    onChange={(event) => setPlanNotes(event.target.value)}
                    className={`${input} mt-1.5 min-h-[110px] resize-y leading-relaxed`}
                  />
                  <p className="mt-1 text-right text-[11px] text-muted-foreground">
                    {planNotes.length}/500
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground">
                    Do you have a disability or access need we should adapt for?
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    These are all conditions a training plan can work around. If a clinician has told
                    you not to exercise, do not start this plan.
                  </p>
                  <div className="mt-2 space-y-2">
                    {DISABILITY_OPTIONS.map((option) => {
                      const active = disability === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setDisability(option.id)}
                          className={`press flex min-h-[56px] w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                            active
                              ? "border-primary/60 bg-primary/15"
                              : "border-white/[0.08] bg-white/[0.03]"
                          }`}
                        >
                          <span
                            aria-hidden
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              active ? "border-primary bg-primary text-primary-foreground" : "border-white/25"
                            }`}
                          >
                            {active ? <Check size={10} /> : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-semibold">{option.label}</span>
                            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                              {option.blurb}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                    {DISCLAIMERS.healthRisk.full}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex gap-2">
              {setupStep > 0 ? (
                <button
                  type="button"
                  onClick={() => setSetupStep((step) => step - 1)}
                  className="press min-h-[48px] rounded-xl border border-white/[0.08] px-4 text-sm font-semibold text-muted-foreground"
                >
                  Back
                </button>
              ) : null}
              {lastStep ? (
                <button
                  type="button"
                  onClick={() => void createPlan()}
                  disabled={creating || !ageNumber || ageNumber < 13}
                  className="press flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50"
                >
                  {creating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" aria-hidden /> Creating…
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} aria-hidden /> Create plan
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSetupStep((step) => step + 1)}
                  disabled={!canContinue}
                  className="press flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50"
                >
                  Next <ChevronRight size={16} aria-hidden />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------- detail ---
  if (screen === "detail" && selectedPlan) {
    const weeks = readWeeks(selectedPlan.plan_data);
    return (
      <div className="min-h-screen pb-28">
        <div className="mx-auto w-full max-w-3xl px-5 pt-[var(--vaylo-screen-top)] sm:px-6">
          {backButton(() => setScreen("home"), "Training")}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold uppercase tracking-widest text-primary">
                {selectedPlan.active ? "Active plan" : "Plan"}
              </p>
              <h1 className="mt-1 font-display text-2xl font-bold leading-tight">
                {selectedPlan.title}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Week {selectedPlan.week_current} of {selectedPlan.duration_weeks} ·{" "}
                {selectedPlan.sport} · {selectedPlan.level}
              </p>
            </div>
            <div className="flex gap-2">
              {!selectedPlan.active ? (
                <button
                  type="button"
                  onClick={() => void activatePlan(selectedPlan)}
                  disabled={activating}
                  className="press inline-flex min-h-[44px] items-center rounded-xl border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary disabled:opacity-50"
                >
                  {activating ? "Activating…" : "Make active"}
                </button>
              ) : (
                <span className="inline-flex min-h-[44px] items-center rounded-xl border border-primary/20 bg-primary/10 px-3 text-xs font-semibold text-primary">
                  Active
                </span>
              )}
            </div>
          </div>

          {selectedPlan.description ? (
            <p className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-3 text-[13px] leading-relaxed text-muted-foreground">
              {selectedPlan.description}
            </p>
          ) : null}

          {weeks.length === 0 ? (
            <div className={`${card} mt-4 p-5 text-sm text-muted-foreground`}>
              This plan has no weeks stored yet. Create a new plan to replace it.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {weeks.map((week) => {
                const open = expandedWeek === week.week;
                return (
                  <div key={week.week} className={card}>
                    <button
                      type="button"
                      onClick={() => setExpandedWeek(open ? null : week.week)}
                      aria-expanded={open}
                      className="press flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-sm font-bold">Week {week.week}</span>
                          {week.isDeload ? (
                            <span className="rounded-full bg-energy/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-energy">
                              Deload
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {week.sessions.filter((s) => !s.isRest && !s.isRecovery).length} sessions ·{" "}
                          {week.sessions.filter((s) => s.isRest).length} rest
                          {week.sessions.some((s) => s.isRecovery)
                            ? ` · ${week.sessions.filter((s) => s.isRecovery).length} active recovery`
                            : ""}
                        </span>
                      </span>
                      <ChevronRight
                        size={18}
                        className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                        aria-hidden
                      />
                    </button>
                    {open ? (
                      <div className="space-y-2 px-3 pb-3 sm:px-4">
                        {week.sessions.map((session) => (
                          <SessionCard
                            key={`${week.week}-${session.day}`}
                            session={session}
                            highlight={week.week === selectedPlan.week_current}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openSetup("standard")}
              className="press inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/[0.08] px-3.5 text-xs font-semibold text-muted-foreground"
            >
              <Plus size={14} aria-hidden /> New plan
            </button>
            {confirmDelete === selectedPlan.id ? (
              <>
                <button
                  type="button"
                  onClick={() => void deletePlan(selectedPlan)}
                  className="press inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-destructive/40 px-3.5 text-xs font-semibold text-destructive"
                >
                  Delete permanently
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                  className="press inline-flex min-h-[44px] items-center rounded-xl border border-white/[0.08] px-3.5 text-xs font-semibold text-muted-foreground"
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(selectedPlan.id)}
                className="press inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/[0.08] px-3.5 text-xs font-semibold text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={14} aria-hidden /> Delete plan
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- home ---
  return (
    <div className="min-h-screen pb-28">
      <div className="mx-auto w-full max-w-3xl px-5 pt-[var(--vaylo-screen-top)] sm:px-6">
        <button
          type="button"
          onClick={() => {
            if (location.key !== "default") navigate(-1);
            else navigate("/");
          }}
          aria-label={location.key !== "default" ? "Go back" : "Go to the home screen"}
          className="press mb-2 inline-flex min-h-[44px] items-center gap-1 text-[15px] font-medium text-primary"
        >
          <ChevronLeft size={20} aria-hidden /> Back
        </button>
        {header(
          "Training",
          "Build the plan around your limiter",
          "Log what you do in Workouts. Plan what comes next here.",
        )}

        {loadError ? (
          <p className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-[13px] text-destructive">
            Could not load your plans: {loadError}
          </p>
        ) : null}

        {activeBreak ? (
          <div className="mb-4">
            <ActiveBreakBanner event={activeBreak} />
          </div>
        ) : null}

        {activePlan ? (
          <div className="mb-4 rounded-2xl border border-primary/25 bg-gradient-card p-5 shadow-card">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
              <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
                {isLimiterPlan(activePlan) ? "Your limiter plan" : "Active plan"}
              </p>
            </div>
            <h2 className="mt-2 font-display text-xl font-bold">{activePlan.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Week {activePlan.week_current} of {activePlan.duration_weeks} · {activePlan.sport} ·{" "}
              {activePlan.level}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${Math.max(
                    2,
                    Math.min(
                      100,
                      (activePlan.week_current / Math.max(1, activePlan.duration_weeks)) * 100,
                    ),
                  )}%`,
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => openPlan(activePlan)}
              className="press mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow"
            >
              <Eye size={16} aria-hidden /> {isLimiterPlan(activePlan) ? "Open limiter plan" : "Open plan"}
            </button>
          </div>
        ) : (
          <div className={`${card} mb-4 p-5 text-center`}>
            <Dumbbell size={28} className="mx-auto text-primary" aria-hidden />
            <h2 className="mt-3 font-display text-lg font-bold">No training plan yet</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Build one from your sport, availability and equipment — or start with the Limiter
              Test and build the plan around the thing that is actually holding you back.
            </p>
            <button
              type="button"
              onClick={() => openSetup("standard")}
              className="press mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-3 text-sm font-semibold text-primary-foreground shadow-glow"
            >
              <Plus size={16} aria-hidden /> Create a plan
            </button>
          </div>
        )}

        {latestLimiterPlan && !latestLimiterPlan.active ? (
          <button
            type="button"
            onClick={() => openPlan(latestLimiterPlan)}
            className={`${card} press mb-4 flex w-full items-center gap-3 p-4 text-left transition-colors hover:border-primary/25`}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <Target size={19} className="text-primary" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                Your limiter plan
              </span>
              <span className="mt-0.5 block truncate text-sm font-semibold">
                {latestLimiterPlan.title}
              </span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                Week {latestLimiterPlan.week_current} of {latestLimiterPlan.duration_weeks} · open it
                to keep going
              </span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden />
          </button>
        ) : null}

        <button
          type="button"
          onClick={openLimiter}
          className={`${card} press mb-5 flex w-full items-center gap-3 p-4 text-left transition-colors hover:border-primary/25`}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
            <Target size={19} className="text-primary" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Limiter Test</span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">
              Eight ratings. One priority. Then a plan built to fix it.
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden />
        </button>

        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
            Your plans
          </h2>
          <button
            type="button"
            onClick={() => openSetup("standard")}
            className="press inline-flex min-h-[44px] items-center gap-1 text-xs font-semibold text-primary"
          >
            <Plus size={14} aria-hidden /> New
          </button>
        </div>

        {loadingPlans ? (
          <div className={`${card} mt-2 flex items-center gap-2 p-4 text-xs text-muted-foreground`}>
            <Loader2 size={14} className="animate-spin" aria-hidden /> Loading plans…
          </div>
        ) : plans.length === 0 ? (
          <div className={`${card} mt-2 p-4 text-sm text-muted-foreground`}>
            Nothing here yet. Create a plan or take the Limiter Test.
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {plans.map((plan) => (
              <div key={plan.id} className={`${card} flex items-center gap-2 p-2 pl-3`}>
                <button
                  type="button"
                  onClick={() => openPlan(plan)}
                  className="press flex min-h-[56px] min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04]">
                    {isLimiterPlan(plan) ? (
                      <Target size={16} className="text-primary" aria-hidden />
                    ) : (
                      <Dumbbell size={16} className="text-primary" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm font-semibold">{plan.title}</span>
                      {isLimiterPlan(plan) ? (
                        <span className="shrink-0 rounded-full bg-energy/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-energy">
                          Limiter
                        </span>
                      ) : null}
                      {plan.active ? (
                        <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                          Active
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {plan.duration_weeks}w · {plan.sport} · {plan.level}
                    </span>
                  </span>
                </button>
                {confirmDelete === plan.id ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void deletePlan(plan)}
                      className="press flex min-h-[44px] items-center rounded-xl border border-destructive/40 px-2.5 text-[11px] font-semibold text-destructive"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="press flex min-h-[44px] items-center rounded-xl border border-white/[0.08] px-2.5 text-[11px] font-semibold text-muted-foreground"
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label={`Delete ${plan.title}`}
                    onClick={() => setConfirmDelete(plan.id)}
                    className="press flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => navigate("/workouts")}
          className="press mt-5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] text-xs font-semibold text-muted-foreground"
        >
          <Dumbbell size={14} aria-hidden /> Log a finished session in Workouts
        </button>
      </div>
    </div>
  );
};

/** One session inside the plan detail view. */
function SessionCard({
  session,
  highlight,
}: {
  session: PlanSessionLike;
  highlight: boolean;
}) {
  const warmup = exerciseRows(session.warmup);
  const main = exerciseRows(session.exercises);
  const cooldown = exerciseRows(session.cooldown);
  const resting = session.isRest || session.isRecovery;
  return (
    <div
      className={`rounded-xl border p-3 ${
        resting
          ? "border-white/[0.05] bg-white/[0.015]"
          : highlight
            ? "border-primary/20 bg-primary/[0.045]"
            : "border-white/[0.06] bg-white/[0.025]"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
          {session.dayName ?? `Day ${session.day}`}
        </p>
        <p className="text-[11px] font-semibold tabular-nums text-muted-foreground">
          {session.duration_minutes ? `${session.duration_minutes} min` : resting ? "Rest" : ""}
        </p>
      </div>
      <p className="mt-0.5 text-sm font-semibold leading-snug">{session.title}</p>
      {session.description ? (
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {session.description}
        </p>
      ) : null}

      {Array.isArray(session.adaptations) && session.adaptations.length > 0 ? (
        <details className="mt-2 rounded-lg border border-primary/15 bg-primary/[0.04] px-2.5 py-2">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
            Adapted for you
          </summary>
          <ul className="mt-1.5 space-y-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {session.adaptations.map((cue: string) => (
              <li key={cue} className="flex gap-1.5">
                <Check size={12} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                <span>{cue}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* The set description has no `flex-1 basis-40`. That made every long
          set description wrap INSIDE a 160px-wide column, so its second line
          started under the middle of the row instead of under its own first
          word — the training tab's text-in-the-wrong-place bug. Left to wrap
          naturally, it falls to a new line aligned with the exercise name. */}
      {main.length > 0 ? (
        <div className="mt-2.5 space-y-1">
          {main.map((row, index) => (
            <div key={`${row.name}-${index}`} className="flex flex-wrap gap-x-2 text-[12.5px]">
              <span className="font-medium text-foreground">{row.name}</span>
              {row.sets ? (
                <span className="min-w-0 text-muted-foreground">{row.sets}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {warmup.length > 0 ? (
        <details className="mt-2.5">
          <summary className="cursor-pointer py-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
            Warm-up ({warmup.length})
          </summary>
          <div className="mt-1.5 space-y-1">
            {warmup.map((row, index) => (
              <div key={`${row.name}-${index}`} className="flex flex-wrap gap-x-2 text-[12px]">
                <span className="text-muted-foreground">{row.name}</span>
                {row.sets ? <span className="text-muted-foreground/70">{row.sets}</span> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {cooldown.length > 0 ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer py-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-info">
            Cool-down ({cooldown.length})
          </summary>
          <div className="mt-1.5 space-y-1">
            {cooldown.map((row, index) => (
              <div key={`${row.name}-${index}`} className="flex flex-wrap gap-x-2 text-[12px]">
                <span className="text-muted-foreground">{row.name}</span>
                {row.sets ? <span className="text-muted-foreground/70">{row.sets}</span> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default Training;
