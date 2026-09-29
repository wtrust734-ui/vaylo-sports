import { getAiLocale } from "@/i18n";
import { useState, useEffect, useRef } from "react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { Dumbbell, TrendingUp, Zap, ChevronRight, Play, Plus, X, Target, Activity, AlertTriangle, Eye, Calendar, Edit3, ChevronDown, ChevronUp, Trash2, SkipForward, PauseCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { spendCredits, creditCost, spendErrorMessage } from "@/lib/credits";
import { useSpendWithTopUp } from "@/hooks/useSpendWithTopUp";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { Tables, type Json } from "@/integrations/supabase/types";
import { useNavigate } from "react-router-dom";
import { getPrimarySport } from "@/lib/profile";
import { getAgeCaps, buildClientDossier } from "@/lib/athleteDossier";

type TrainingPlan = Tables<"training_plans">;

const sportOptions = ["Running", "Gym/Weightlifting", "Football", "Basketball", "Swimming", "Cycling", "Tennis", "Rugby", "Boxing", "Athletics", "Triathlon", "CrossFit", "General"];
const goalOptions = ["Speed", "Strength", "Endurance", "Fat Loss", "Muscle Gain", "Power", "Agility"];
const levelOptions = ["beginner", "intermediate", "advanced"];
const durationOptions = [4, 6, 8, 12];

const Training = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const spendWithTopUp = useSpendWithTopUp();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
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

  const [title, setTitle] = useState("");
  const [sport, setSport] = useState(getPrimarySport(profile?.sport));
  const [goal, setGoal] = useState("Strength");
  const [level, setLevel] = useState(profile?.experience_level || "beginner");
  const [duration, setDuration] = useState(6);
  const [planAge, setPlanAge] = useState("");
  // Training-plan quiz (NEW — was previously asked at signup)
  const [planDaysPerWeek, setPlanDaysPerWeek] = useState<number>(4);
  const [planHoursPerWeek, setPlanHoursPerWeek] = useState<number>(6);
  const [planSessionLengthPref, setPlanSessionLengthPref] = useState<"short" | "standard" | "long">("standard");
  const [planEquipment, setPlanEquipment] = useState<string[]>([]);
  const [planEnvironment, setPlanEnvironment] = useState<string>("Mixed");
  const [planIntensityPref, setPlanIntensityPref] = useState<"easy" | "balanced" | "hard">("balanced");
  const [planFocusAreas, setPlanFocusAreas] = useState<string[]>([]);
  const [planTimeOfDay, setPlanTimeOfDay] = useState<string>("Evening");
  const [planTargetEvent, setPlanTargetEvent] = useState<string>("");
  const [planRecoveryDays, setPlanRecoveryDays] = useState<number>(1);
  const [planQuizStep, setPlanQuizStep] = useState<number>(0); // 0 = basics, 1 = availability, 2 = preferences


  // Limiter test state
  const [limiterStep, setLimiterStep] = useState(0);
  const [limiterAnswers, setLimiterAnswers] = useState<Record<string, number>>({});
  const [limiterResult, setLimiterResult] = useState<{ limiters: { name: string; score: number }[]; plan: PlanData | null } | null>(null);
  const [creatingLimiterPlan, setCreatingLimiterPlan] = useState(false);

  const limiterQuestions = [
    { id: "sprint_ability", q: "How would you rate your sprinting/short burst speed?", category: "speed" },
    { id: "acceleration", q: "How quickly can you accelerate from a standstill?", category: "speed" },
    { id: "long_effort", q: "How well do you sustain effort over 30+ minutes?", category: "endurance" },
    { id: "recovery_between", q: "How quickly do you recover between efforts?", category: "endurance" },
    { id: "max_strength", q: "How strong are you relative to your sport's demands?", category: "strength" },
    { id: "power_output", q: "How explosive are your movements?", category: "power" },
    { id: "flexibility", q: "How is your range of motion and flexibility?", category: "mobility" },
    { id: "agility", q: "How well do you change direction at speed?", category: "agility" },
    { id: "mental_focus", q: "How well do you focus during high-pressure moments?", category: "mental" },
    { id: "technical", q: "How refined is your sport-specific technique?", category: "technique" },
  ];

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
      if (p.phase === "Base") setGoal("Endurance");
      else if (p.phase === "Build") setGoal("Strength");
      else if (p.phase === "Peak") setGoal("Speed");
      else if (p.phase === "Taper") setGoal("Recovery");
      if (p.blockId) setPendingBlockLink(p.blockId);
      setShowCreate(true);
      setPlanQuizStep(0);
      toast({ title: "Prefilled from calendar", description: `Creating a matching ${p.phase} plan.` });
    } catch { /* ignore */ }
  }, []);

  const fetchPlans = async () => {
    if (!user) return;
    const { data } = await supabase.from("training_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setPlans(data || []);
  };

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
          body: { sport, goal, level, duration_weeks: duration, age, quiz, userLocale: getAiLocale(), pbs: dossier?.pbs ?? null, dossier: dossier ? { pbs_text: dossier.pbs_text, outcomeGoals: dossier.outcomeGoals, injuries: dossier.injuries } : null },
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

      const { data: inserted, error: insertError } = await supabase.from("training_plans").insert({
        user_id: user.id, title: title.trim() || `${goal} ${sport} Plan`, sport, goal, level, duration_weeks: duration,
        description: `${duration}-week ${goal.toLowerCase()} plan for ${sport.toLowerCase()} (age ${age}) · ${planDaysPerWeek}d/wk · ${planHoursPerWeek}h/wk · ${planIntensityPref} intensity${planTargetEvent ? ` · targeting ${planTargetEvent}` : ""}`,
        plan_data: planData as unknown as Json,
      }).select("id").single();
      if (insertError) throw insertError;

      // Periodisation calendar removed — no block linking.

      await refreshProfile();
      toast({ title: "Plan Created! 🎯" });
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
    [key: string]: unknown;
  };

  type PlanWeek = {
    week: number;
    sessions: PlanSession[];
    isDeload?: boolean;
    isHoliday?: boolean;
    redistributedFrom?: number;
    extraNote?: string;
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
            description: `Week ${weekNum}, ${dayNames[d]} — ${template.title} for ${goal.toLowerCase()} in ${sport}${isDeload ? " (reduced volume — 60% intensity)" : ""}${isYouth ? " [Youth-adapted: lighter loads]" : ""}${isSenior ? " [Senior-adapted: joint-friendly]" : ""}${quiz?.environment ? ` · ${quiz.environment}` : ""}${quiz?.equipment?.length ? ` · equipment: ${quiz.equipment.slice(0, 2).join(", ")}` : ""}`,

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
    if (editSessionDuration) planData[weekIdx].sessions[sessionIdx].duration_minutes = parseInt(editSessionDuration);
    const { error } = await supabase.from("training_plans").update({ plan_data: planData as unknown as Json });
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
    
    const { error } = await supabase.from("training_plans").update({ plan_data: planData as unknown as Json });
    if (error) { toast({ title: "Couldn't update your week", description: error.message, variant: "destructive" }); return; }
    setSelectedPlan({ ...selectedPlan, plan_data: planData as unknown as Json });
    toast({ title: !wasHoliday ? "Week marked as holiday 🏖️ — sessions redistributed to next week" : "Holiday removed — sessions restored" });
  };

  const skipSession = async (weekNum: number, dayNum: number) => {
    if (!selectedPlan) return;
    const planData = JSON.parse(JSON.stringify(selectedPlan.plan_data)) as PlanData;
    const weekIdx = planData.findIndex((w) => w.week === weekNum);
    if (weekIdx === -1) return;
    const sessionIdx = planData[weekIdx].sessions.findIndex((s) => s.day === dayNum);
    if (sessionIdx === -1) return;
    planData[weekIdx].sessions[sessionIdx].skipped = !planData[weekIdx].sessions[sessionIdx].skipped;
    const { error } = await supabase.from("training_plans").update({ plan_data: planData as unknown as Json });
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
    const q = limiterQuestions[limiterStep];
    const newAnswers = { ...limiterAnswers, [q.id]: score };
    setLimiterAnswers(newAnswers);
    if (limiterStep < limiterQuestions.length - 1) {
      setLimiterStep(limiterStep + 1);
    } else {
      const categories: Record<string, number[]> = {};
      limiterQuestions.forEach(lq => {
        if (!categories[lq.category]) categories[lq.category] = [];
        categories[lq.category].push(newAnswers[lq.id] || 5);
      });
      const avgScores = Object.entries(categories).map(([name, scores]) => ({
        name, score: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
      })).sort((a, b) => a.score - b.score);
      const limiters = avgScores.slice(0, 2);
      setLimiterResult({ limiters, plan: null });
    }
  };

  const createLimiterPlan = async () => {
    if (!user || !profile || !limiterResult || limiterResult.limiters.length === 0) return;
    const age = getAge();
    if (!age) { toast({ title: "Age required", description: "Set your DOB in Profile first.", variant: "destructive" }); return; }
    const LIMITER_WEEKS = 4;
    const LIMITER_COST = creditCost("limiter_fix_plan");

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
        user_id: user.id, title: `Limiter Fix Plan`, sport, goal: planGoal, level, duration_weeks: 4,
        description: `4-week plan targeting: ${weakAreas.join(", ")}. Tailored to address your weakest performance areas.`,
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
    });
    if (error) { toast({ title: "Couldn't save your log", description: error.message, variant: "destructive" }); return; }
    setShowAddLog(false); setLogTitle(""); setLogDistance(""); setLogTime(""); setLogNotes(""); setLogHeartRate(""); setLogCalories("");
    fetchLogs();
    toast({ title: "Log saved! 📝" });
  };

  const chipClass = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 ${active ? "bg-primary/15 border-primary text-primary shadow-glow" : "bg-card border-border text-foreground hover:border-primary/30"}`;
  const inputClass = "w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all duration-300";

  // === LIMITER TEST VIEW ===
  if (activeView === "limiter") return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4 flex items-center gap-3">
        <motion.button onClick={() => { setActiveView("plans"); setLimiterStep(0); setLimiterAnswers({}); setLimiterResult(null); }} whileTap={{ scale: 0.9 }} className="text-muted-foreground"><ChevronRight size={20} className="rotate-180" /></motion.button>
        <h1 className="text-xl font-display font-bold">Limiter Test</h1>
      </div>
      <div className="px-5">
        {!limiterResult ? (
          <motion.div key={limiterStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
            <div className="flex gap-1 mb-2">
              {limiterQuestions.map((_, i) => (
                <div key={i} className={`flex-1 h-1 rounded-full ${i <= limiterStep ? "bg-primary" : "bg-muted"}`} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{limiterStep + 1} of {limiterQuestions.length}</p>
            <h3 className="font-display font-bold text-lg">{limiterQuestions[limiterStep].q}</h3>
            <p className="text-xs text-muted-foreground">Rate yourself 1 (very weak) to 10 (excellent)</p>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <motion.button key={n} onClick={() => answerLimiterQuestion(n)} whileTap={{ scale: 0.9 }}
                  className={`py-3 rounded-xl text-sm font-bold border transition-all ${limiterAnswers[limiterQuestions[limiterStep].id] === n ? "bg-primary/20 border-primary text-primary" : "bg-card border-border text-foreground hover:border-primary/30"}`}>{n}</motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
            <div className="bg-gradient-card border border-primary/20 rounded-2xl p-5 shadow-card text-center">
              <AlertTriangle size={32} className="mx-auto text-primary mb-3" />
              <h3 className="font-display font-bold text-lg">Your Limiters</h3>
              <p className="text-sm text-muted-foreground mt-1">{limiterResult.limiters.length === 0 ? "No significant limiters found! You're well-rounded." : "Areas to improve, ranked by weakness"}</p>
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
      <div className="px-5 pt-14 pb-4 flex items-center gap-3">
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
              <div className="flex justify-between text-[10px] text-muted-foreground"><span>Easy</span><span className="font-bold text-primary">{logRPE}</span><span>Max</span></div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Form Rating (1-10)</label>
              <input type="range" min={1} max={10} value={logFormRating} onChange={e => setLogFormRating(e.target.value)} className="w-full accent-primary" />
              <div className="flex justify-between text-[10px] text-muted-foreground"><span>Poor</span><span className="font-bold text-primary">{logFormRating}</span><span>Perfect</span></div>
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
                <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full capitalize">{log.log_type?.replace("_", " ")}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {log.sport && `${log.sport} · `}
                {log.distance_km && `${Number(log.distance_km)} km`}
                {log.pace_per_km && ` · ${log.pace_per_km}`}
                {log.time_seconds && ` · ${Math.floor(log.time_seconds / 60)}:${(log.time_seconds % 60).toString().padStart(2, "0")}`}
              </p>
              <div className="flex gap-3 mt-1">
                {log.perceived_exertion && <span className="text-[10px] text-muted-foreground">RPE: {log.perceived_exertion}/10</span>}
                {log.form_rating && <span className="text-[10px] text-muted-foreground">Form: {log.form_rating}/10</span>}
                {log.heart_rate_avg && <span className="text-[10px] text-muted-foreground">{log.heart_rate_avg} bpm</span>}
                {log.calories_burned && <span className="text-[10px] text-muted-foreground">{log.calories_burned} kcal</span>}
              </div>
              {log.notes && <p className="text-xs text-muted-foreground mt-1">{log.notes}</p>}
              <p className="text-[10px] text-muted-foreground mt-1">{new Date(log.created_at).toLocaleDateString()}</p>
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
        <div className="px-5 pt-14 pb-4 flex items-center gap-3">
          <motion.button onClick={() => { setActiveView("plans"); setSelectedPlan(null); setExpandedWeek(null); }} whileTap={{ scale: 0.9 }} className="text-muted-foreground"><ChevronRight size={20} className="rotate-180" /></motion.button>
          <h1 className="text-lg font-display font-bold flex-1">{selectedPlan.title}</h1>
        </div>
        <div className="px-5 mb-3">
          <p className="text-sm text-muted-foreground">{selectedPlan.sport} · {selectedPlan.level} · Week {selectedPlan.week_current}/{selectedPlan.duration_weeks}</p>
          <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${(selectedPlan.week_current / selectedPlan.duration_weeks) * 100}%` }} className="h-full bg-primary rounded-full" />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => setExpandedWeek(-1)}
              className="text-[11px] font-semibold bg-primary/10 text-primary px-3 py-1.5 rounded-lg">
              Expand all weeks
            </button>
            <button onClick={() => setExpandedWeek(null)}
              className="text-[11px] font-semibold bg-muted text-muted-foreground px-3 py-1.5 rounded-lg">
              Collapse all
            </button>
          </div>
        </div>
        <div className="px-5 space-y-3 mb-8">
          {planData?.map((week) => (
            <div key={week.week} className={`bg-card border rounded-xl overflow-hidden ${week.week === selectedPlan.week_current ? "border-primary/30" : week.isHoliday ? "border-energy/30" : "border-border"}`}>
              <button onClick={() => setExpandedWeek(expandedWeek === week.week ? null : week.week)}
                className="w-full flex items-center justify-between p-4">
                <div className="flex items-center gap-2">
                  <h4 className="font-display font-bold text-sm">Week {week.week}{week.isDeload ? " (Deload)" : ""}</h4>
                  {week.week === selectedPlan.week_current && <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">Current</span>}
                  {week.isHoliday && <span className="text-[10px] bg-energy/10 text-energy px-2 py-0.5 rounded-full font-semibold">🏖️ Holiday</span>}
                  {week.extraNote && <span className="text-[10px] bg-accent/10 text-accent-foreground px-2 py-0.5 rounded-full">+Extra</span>}
                </div>
                <motion.div animate={{ rotate: (expandedWeek === week.week || expandedWeek === -1) ? 180 : 0 }}><ChevronDown size={16} className="text-muted-foreground" /></motion.div>
              </button>
              <AnimatePresence>
                {(expandedWeek === week.week || expandedWeek === -1) && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-4 pb-4">
                    {week.extraNote && <p className="text-[10px] text-accent-foreground bg-accent/5 rounded-lg px-2 py-1 mb-2">{week.extraNote}</p>}
                    <div className="flex gap-2 mb-3">
                      <motion.button whileTap={{ scale: 0.95 }} onClick={() => toggleWeekHoliday(week.week)}
                        className="text-[11px] bg-energy/10 text-energy px-3 py-1 rounded-lg font-semibold">
                        {week.isHoliday ? "Remove Holiday" : "🏖️ Mark Holiday"}
                      </motion.button>
                    </div>
                    <div className="space-y-2">
                      {week.sessions?.map((session, si) => (
                        <div key={si} className={`rounded-lg ${session.skipped ? "opacity-40" : ""} ${session.isRest ? "bg-muted/20 border border-dashed border-border" : session.isRecovery ? "bg-accent/5 border border-accent/10" : "bg-muted/50 border border-border"} overflow-hidden`}>
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
                                    <span className="text-[10px] text-muted-foreground font-medium">{session.dayName || `Day ${session.day}`}</span>
                                    {session.isRest && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">REST</span>}
                                    {session.isRecovery && <span className="text-[10px] bg-accent/10 px-1.5 py-0.5 rounded text-accent-foreground">RECOVERY</span>}
                                  </div>
                                  <span className={`text-xs font-semibold ${session.skipped ? "line-through" : ""}`}>{session.title}</span>
                                  {session.duration_minutes > 0 && <span className="text-[10px] text-muted-foreground ml-2">{session.duration_minutes} min</span>}
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
                              {session.description && <p className="text-[10px] text-muted-foreground px-3 pb-1">{session.description}</p>}
                              {/* Warmup */}
                              {session.warmup && !session.skipped && (
                                <div className="px-3 pb-1">
                                  <p className="text-[10px] font-semibold text-energy uppercase tracking-wider mb-0.5">Warm-up</p>
                                  {session.warmup.map((ex, ei) => (
                                    <div key={ei} className="flex justify-between text-[10px] text-muted-foreground py-0.5">
                                      <span>{ex.name}</span><span className="text-right ml-2 flex-shrink-0">{ex.sets}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* Main exercises */}
                              {session.exercises && !session.skipped && (
                                <div className="px-3 pb-1">
                                  {!session.isRest && !session.isRecovery && <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-0.5">Main Session</p>}
                                  {session.exercises.map((ex, ei) => (
                                    <div key={ei} className="flex justify-between text-[10px] py-0.5">
                                      <span className="font-medium text-foreground">{ex.name}</span>
                                      <span className="text-muted-foreground text-right ml-2 flex-shrink-0 max-w-[50%]">{ex.sets}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* Cooldown */}
                              {session.cooldown && !session.skipped && (
                                <div className="px-3 pb-2">
                                  <p className="text-[10px] font-semibold text-info uppercase tracking-wider mb-0.5">Cool-down</p>
                                  {session.cooldown.map((ex, ei) => (
                                    <div key={ei} className="flex justify-between text-[10px] text-muted-foreground py-0.5">
                                      <span>{ex.name}</span><span className="text-right ml-2 flex-shrink-0">{ex.sets}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ))}
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
      <div className="px-5 pt-14 pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Training</motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">Build your body. Sharpen your edge.</motion.p>
      </div>

      {hasNoPlans && !showCreate && (
        <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          className="mx-5 mb-5 bg-gradient-card border border-primary/30 rounded-2xl p-5 shadow-card text-center">
          <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 2, repeat: Infinity }}><Dumbbell size={32} className="mx-auto text-primary mb-3" /></motion.div>
          <h3 className="font-display font-bold text-lg">No training plan yet</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Create your first personalised plan to get started.</p>
          <motion.button onClick={() => setShowCreate(true)} whileTap={{ scale: 0.98 }} whileHover={{ scale: 1.02 }}
            className="w-full flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">
            <Plus size={18} /> Create Training Plan
          </motion.button>
        </motion.div>
      )}

      {plans.filter(p => p.active).map(plan => (
        <motion.div key={plan.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
          className="mx-5 mb-5 bg-gradient-card border border-border rounded-2xl p-4 shadow-card hover:border-primary/20 transition-colors duration-500">
          <div className="flex items-center gap-2 mb-2"><div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" /><span className="text-[11px] font-semibold uppercase tracking-wider text-primary">Active Plan</span></div>
          <h3 className="font-display font-bold text-lg">{plan.title}</h3>
          <p className="text-sm text-muted-foreground mt-1">Week {plan.week_current} of {plan.duration_weeks} · {plan.sport} · {plan.level}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Includes strength, plyometrics & cross-training</p>
          <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${(plan.week_current / plan.duration_weeks) * 100}%` }} transition={{ delay: 0.3, duration: 0.8 }} className="h-full bg-primary rounded-full" />
          </div>
          <div className="flex gap-2 mt-4">
            <motion.button onClick={() => navigate("/workouts")} whileTap={{ scale: 0.98 }}
              className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">
              <Play size={18} /> Start workout
            </motion.button>
            <motion.button onClick={() => { setSelectedPlan(plan); setActiveView("planDetail"); setExpandedWeek(plan.week_current); }} whileTap={{ scale: 0.98 }}
              className="flex items-center justify-center gap-1 bg-card border border-border px-3 py-3 rounded-xl hover:border-primary/20 transition-colors">
              <Eye size={16} />
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
          <p className="text-[10px] text-muted-foreground">Step {planQuizStep + 1} of 3 · {["Basics", "Availability", "Preferences"][planQuizStep]}</p>

          {planQuizStep === 0 && (
            <div className="space-y-3">
              <input type="text" placeholder="Plan name (optional)" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} className={inputClass} />
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Your Age *</label>
                <input type="number" placeholder="Age (required for safe training)" value={planAge} onChange={e => setPlanAge(e.target.value)} className={inputClass} />
                <p className="text-[10px] text-muted-foreground mt-1">Training load is adapted for your age group.</p>
              </div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Sport</label><div className="flex flex-wrap gap-1.5">{sportOptions.map(s => (<button key={s} onClick={() => setSport(s)} className={chipClass(sport === s)}>{s}</button>))}</div></div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Goal</label><div className="flex flex-wrap gap-1.5">{goalOptions.map(g => (<button key={g} onClick={() => setGoal(g)} className={chipClass(goal === g)}>{g}</button>))}</div></div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Level</label><div className="flex gap-1.5">{levelOptions.map(l => (<button key={l} onClick={() => setLevel(l)} className={`flex-1 capitalize ${chipClass(level === l)}`}>{l}</button>))}</div></div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Plan length</label><div className="flex gap-1.5">{durationOptions.map(d => (<button key={d} onClick={() => setDuration(d)} className={`flex-1 ${chipClass(duration === d)}`}>{d}w</button>))}</div></div>
            </div>
          )}

          {planQuizStep === 1 && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Days per week you can train</label>
                <div className="flex gap-1.5 flex-wrap">{[2,3,4,5,6,7].map(n => (
                  <button key={n} onClick={() => setPlanDaysPerWeek(n)} className={`flex-1 ${chipClass(planDaysPerWeek === n)}`}>{n}</button>
                ))}</div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Total hours per week</label>
                <input type="number" min={1} max={30} step={0.5} value={planHoursPerWeek} onChange={e => setPlanHoursPerWeek(parseFloat(e.target.value) || 0)} className={inputClass} />
                <p className="text-[10px] text-muted-foreground mt-1">Sessions will average ~{Math.round((planHoursPerWeek * 60) / Math.max(1, planDaysPerWeek))} min.</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Preferred session length</label>
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
                    <button key={t} onClick={() => setPlanTimeOfDay(t)} className={`text-[11px] ${chipClass(planTimeOfDay === t)}`}>{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Dedicated full rest days per week</label>
                <div className="flex gap-1.5">{[0,1,2,3].map(n => (
                  <button key={n} onClick={() => setPlanRecoveryDays(n)} className={`flex-1 ${chipClass(planRecoveryDays === n)}`}>{n}</button>
                ))}</div>
              </div>
            </div>
          )}

          {planQuizStep === 2 && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Intensity preference</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {([["easy","Easy"],["balanced","Balanced"],["hard","Hard"]] as const).map(([v,l]) => (
                    <button key={v} onClick={() => setPlanIntensityPref(v)} className={chipClass(planIntensityPref === v)}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Equipment available</label>
                <div className="flex flex-wrap gap-1.5">
                  {["Full gym","Home weights","Bands","Track","Field/Court","Pool","Bike/Trainer","None / bodyweight"].map(eq => (
                    <button key={eq} onClick={() => setPlanEquipment(planEquipment.includes(eq) ? planEquipment.filter(x=>x!==eq) : [...planEquipment, eq])} className={chipClass(planEquipment.includes(eq))}>{eq}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Training environment</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {["Indoor","Outdoor","Mixed","Altitude"].map(e => (
                    <button key={e} onClick={() => setPlanEnvironment(e)} className={`text-[11px] ${chipClass(planEnvironment === e)}`}>{e}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Focus areas <span className="text-muted-foreground/70">(easy → advanced)</span></label>
                <div className="space-y-2">
                  {[
                    { tier: "Easy", color: "text-success", items: ["General Fitness","Mobility","Flexibility","Active Recovery","Fat Loss","Posture","Core Basics","Walking Base"] },
                    { tier: "Intermediate", color: "text-primary", items: ["Strength","Endurance","Muscle Gain","Cardio Base","Balance","Technique","Injury Prevention","Cross-Training"] },
                    { tier: "Advanced", color: "text-energy", items: ["Speed","Power","Explosiveness","Agility","VO2 Max","Anaerobic Threshold","Sport-Specific","Reactive Strength","Plyometrics","Peak Performance","Mental Toughness","Race Prep"] },
                  ].map(group => (
                    <div key={group.tier}>
                      <p className={`text-[10px] uppercase tracking-widest font-semibold mb-1 ${group.color}`}>{group.tier}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {group.items.map(f => (
                          <button key={f} type="button" onClick={() => setPlanFocusAreas(planFocusAreas.includes(f) ? planFocusAreas.filter(x=>x!==f) : [...planFocusAreas, f])}
                            className={`text-[11px] ${chipClass(planFocusAreas.includes(f))}`}>{f}</button>
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
              {planAge && parseInt(planAge) < 16 && <p className="text-xs text-energy flex items-center gap-1"><AlertTriangle size={12} /> Youth-adapted plan (lighter loads, more mobility).</p>}
              {planAge && parseInt(planAge) > 50 && <p className="text-xs text-energy flex items-center gap-1"><AlertTriangle size={12} /> Senior-adapted plan (balance, joint-friendly).</p>}
            </div>
          )}

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
                <Zap size={16} /> {loading ? "Creating..." : `Create Plan (${creditCost("training_plan_week", duration)} credits)`}
              </motion.button>
            )}
          </div>
        </motion.div>
      )}



      {!hasNoPlans && (
        <div className="px-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Your Plans</h3>
            <button onClick={() => setShowCreate(true)} className="text-xs text-primary font-semibold flex items-center gap-1"><Plus size={14} /> New</button>
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
                    {plan.active ? <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">Active</span> : null}
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