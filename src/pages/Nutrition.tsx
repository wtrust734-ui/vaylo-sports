import { getAiLocale } from "@/i18n";
import { useState, useEffect, useRef } from "react";
import { localDateKey } from "@/lib/dates";
import { motion, useInView } from "framer-motion";
import { Droplets, Plus, Trash2, Zap, Camera, FileText, X, AlertTriangle, Upload, Loader2, Lock, Check, Sparkles, ChevronDown, ChevronRight, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useUnlockFeature } from "@/hooks/useUnlockFeature";
import { hapticSuccess, hapticWarning } from "@/lib/haptics";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { creditCost } from "@/lib/credits";
// The AI plan path: the server charges and refunds (see the function's own
// header), so nothing here spends credits — what lives here is the request
// check and the defensive read of the answer.
import {
  DAY_NAMES,
  newNutritionPlanRequestId,
  parseGeneratedPlan,
  planHeader,
  dayTotals,
  planTotals,
  validatePlanRequest,
  type GeneratedPlan,
  type PlanWeek,
  type NutritionGoal,
} from "@/lib/nutritionPlan";
import { getLocalPBs } from "@/lib/athleteDossier";
import { dietPlanRefusalReason, isAdultDob } from "@/lib/age";
import { DISCLAIMERS, disclaimerShort } from "@/config/disclaimers";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { capturePhoto } from "@/lib/camera";
import { isNative } from "@/lib/platform";
import { hapticImpact } from "@/lib/haptics";
import type { Json, Tables } from "@/integrations/supabase/types";

const Nutrition = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { hasFeature, refresh: refreshEntitlements } = useSubscription();
  const unlock = useUnlockFeature();
  // The Nutrition Pack is the one unlock this screen owns: it makes the calorie
  // scan free and removes the per-week charge from plans. It was priced in the
  // Market's cost list and had NO purchase call anywhere in the app — this is
  // the screen where an athlete discovers it, so this is where it is bought.
  const hasNutritionPack = hasFeature("nutrition_pack");
  const [unlockingPack, setUnlockingPack] = useState(false);
  const packPrice = creditCost("nutrition_pack_unlock");

  const buyNutritionPack = async () => {
    if (!user) return;
    setUnlockingPack(true);
    try {
      const res = await unlock("nutrition_pack");
      if (res.status === "failed") {
        hapticWarning();
        toast({ title: "Couldn't unlock Nutrition Pack", description: res.error, variant: "destructive" });
        return;
      }
      hapticSuccess();
      await Promise.all([refreshEntitlements(), refreshProfile()]);
      toast({
        title: "Nutrition Pack unlocked",
        description: "Calorie scans are free from now on, and plans no longer charge per week.",
      });
    } finally {
      setUnlockingPack(false);
    }
  };
  const [waterMl, setWaterMl] = useState(0);
  const [waterGoal, setWaterGoal] = useState(3000);
  const [showWaterGoalEdit, setShowWaterGoalEdit] = useState(false);
  const [newWaterGoal, setNewWaterGoal] = useState("3000");
  const [addAmount, setAddAmount] = useState("250");
  const [meals, setMeals] = useState<Tables<"meal_logs">[]>([]);
  const [showAddMeal, setShowAddMeal] = useState(false);
  const [mealName, setMealName] = useState("");
  const [mealCalories, setMealCalories] = useState("");
  const [mealProtein, setMealProtein] = useState("");
  const [mealCarbs, setMealCarbs] = useState("");
  const [mealFat, setMealFat] = useState("");
  const [mealType, setMealType] = useState<string>("meal");

  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [plans, setPlans] = useState<Tables<"nutrition_plans">[]>([]);
  const [planTitle, setPlanTitle] = useState("");
  const [planGoal, setPlanGoal] = useState<NutritionGoal>("Maintain");
  // Targets start BLANK on purpose: blank means "the AI sets them from your goal
  // and your data", which is the difference between a plan and a spreadsheet.
  const [planCalories, setPlanCalories] = useState("");
  const [planProtein, setPlanProtein] = useState("");
  const [planCarbs, setPlanCarbs] = useState("");
  const [planFat, setPlanFat] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [planWeeks, setPlanWeeks] = useState("4");
  const [generating, setGenerating] = useState(false);
  const [planError, setPlanError] = useState<{ message: string; topUp?: boolean } | null>(null);
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null);
  const [expandedPlanWeek, setExpandedPlanWeek] = useState<number | null>(null);
  /** Which stored plan is expanded. One state for fresh and stored plans alike. */
  const [expandedStoredPlan, setExpandedStoredPlan] = useState<string | null>(null);

  const [showScan, setShowScan] = useState(false);
  const [scanResult, setScanResult] = useState<{ name?: string; calories?: number; protein?: number; carbs?: number; fat?: number; description?: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  // One in-flight destructive mutation at a time; a double-tap on a meal's
  // delete fired two DELETEs and a double reload.
  const [deleting, setDeleting] = useState(false);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mealsRef = useRef(null);
  const mealsInView = useInView(mealsRef, { once: true, margin: "-30px" });
  const today = localDateKey();

  const getAge = () => {
    if (!profile?.date_of_birth) return null;
    return Math.floor((Date.now() - new Date(profile.date_of_birth).getTime()) / 31557600000);
  };

  // AI calorie estimation is adult-only, for the same reason nutrition plans
  // are: an estimated calorie and macro breakdown for an under-18 is exactly the
  // material the published child-safety page promises is switched off. The app's
  // target market moved to 18–30 on 2026-10-08; this gate is a safety floor and
  // is deliberately unchanged by that.
  // Unknown date of birth is not an adult — matching src/lib/age.ts and
  // public.viewer_is_adult().
  const canScanCalories = isAdultDob(profile?.date_of_birth);
  const CALORIE_SCAN_REFUSAL =
    "Calorie and macro estimation is built for adult athletes (18+). If you are under 18, we do not estimate calories or macros for you — this is deliberate, not a missing setting.";

  useEffect(() => { if (user) { fetchWater(); fetchMeals(); fetchSettings(); fetchPlans(); } }, [user]);

  const fetchSettings = async () => {
    if (!user) return;
    const { data } = await supabase.from("user_settings").select("water_goal_ml").eq("user_id", user.id).maybeSingle();
    if (data?.water_goal_ml) { setWaterGoal(data.water_goal_ml); setNewWaterGoal(String(data.water_goal_ml)); }
  };

  const fetchWater = async () => {
    if (!user) return;
    const { data } = await supabase.from("water_logs").select("amount_ml").eq("user_id", user.id).eq("log_date", today);
    setWaterMl((data || []).reduce((sum, r) => sum + r.amount_ml, 0));
  };

  const fetchMeals = async () => {
    if (!user) return;
    const { data } = await supabase.from("meal_logs").select("*").eq("user_id", user.id).eq("log_date", today).order("logged_at", { ascending: true });
    setMeals(data || []);
  };

  const fetchPlans = async () => {
    if (!user) return;
    const { data } = await supabase.from("nutrition_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setPlans(data || []);
  };

  const addWater = async () => {
    if (!user) return;
    const ml = parseInt(addAmount) || 250;
    const { error } = await supabase.from("water_logs").insert({ user_id: user.id, amount_ml: ml, log_date: today });
    if (error) { toast({ title: "Couldn't log water", description: error.message, variant: "destructive" }); return; }
    fetchWater();
    toast({ title: `+${ml}ml 💧` });
  };

  const saveWaterGoal = async () => {
    if (!user) return;
    const goal = parseInt(newWaterGoal) || 3000;
    const { error } = await supabase.from("user_settings").upsert({ user_id: user.id, water_goal_ml: goal }, { onConflict: "user_id" });
    if (error) { toast({ title: "Couldn't save your water goal", description: error.message, variant: "destructive" }); return; }
    setWaterGoal(goal); setShowWaterGoalEdit(false);
    toast({ title: "Water goal updated!" });
  };

  const addMeal = async () => {
    if (!user || !mealName.trim() || saving) return;
    setSaving(true);
    // Clamp to the per-meal windows the meal_logs_numeric_bounds DB constraint
    // enforces; NaN/negative input becomes null ("not recorded"), not 0.
    const num = (v: string, max: number) => {
      const n = parseFloat(v);
      return Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n * 10) / 10) : null;
    };
    const { error } = await supabase.from("meal_logs").insert({
      user_id: user.id, name: mealName.trim().slice(0, 120), calories: num(mealCalories, 10000),
      protein_g: num(mealProtein, 500), carbs_g: num(mealCarbs, 1000),
      fat_g: num(mealFat, 500), meal_type: mealType, log_date: today,
    });
    setSaving(false);
    if (error) { toast({ title: "Couldn't log the meal", description: error.message, variant: "destructive" }); return; }
    setShowAddMeal(false); setMealName(""); setMealCalories(""); setMealProtein(""); setMealCarbs(""); setMealFat("");
    fetchMeals();
    toast({ title: "Meal logged! 🍽️" });
  };

  const deleteMeal = async (id: string, name: string) => {
    if (deleting) return;
    const confirmed = window.confirm(`Delete the meal "${name}" from today's log? This can't be undone.`);
    if (!confirmed) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("meal_logs").delete().eq("id", id);
      if (error) { toast({ title: "Couldn't delete the meal", description: error.message, variant: "destructive" }); return; }
      fetchMeals();
    } finally {
      setDeleting(false);
    }
  };

  // AI Calorie Scan with image
  /** Shared by the web file input and the native camera. */
  const runScan = async (base64: string) => {
    // The server verifies Nutrition Pack ownership, charges credits and refunds
    // on failure — nothing is charged or validated from the client.
    setScanning(true);
    setScanResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-analyze", {
        body: { type: "calorie_scan", image_base64: base64, userLocale: getAiLocale(), pbs: getLocalPBs().slice(0, 20).map((p) => ({ metric: p.metric, value: p.value, unit: p.unit, date: p.date })) },
      });
      if (error) throw new Error(await edgeErrorMessage(error));
      const payload = (data ?? {}) as { result?: string; cost?: number; balance?: number | null };
      try {
        const parsed = JSON.parse(payload.result ?? "");
        setScanResult(parsed && typeof parsed === "object" ? parsed : { name: "Scanned meal", description: payload.result });
      } catch {
        // What came back is not JSON, so there are no numbers in it.
        //
        // This used to invent a meal — 300 kcal, 15g protein, 35g carbs, 12g fat
        // — and offer it for logging. Those are not estimates, they are a meal
        // nobody ate, and the athlete would have logged them as their own. The
        // text is shown, the numbers are em dashes, and the athlete can type
        // them in themselves or take another photo.
        setScanResult({ name: "Scanned meal", description: payload.result });
      }
      toast({ title: "Scan complete! 📸", description: payload.cost ? `${payload.cost} credits used.` : "Free with Nutrition Pack." });
      await refreshProfile();
    } catch (err) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const handleScanImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !profile) return;
    // Backstop: the panel cannot open for an under-18, but the input is also
    // unreachable by other means only if this holds.
    if (!canScanCalories) {
      e.target.value = "";
      toast({ title: "Age restriction", description: CALORIE_SCAN_REFUSAL, variant: "destructive" });
      return;
    }
    setScanPreview((prev) => {
      // The previous preview's blob URL stays allocated until revoked —
      // repeated scans without this leaked each photo's bytes for the session.
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Couldn't read the image file."));
        reader.readAsDataURL(file);
      });
      await runScan(base64);
    } catch (err) {
      toast({ title: "Couldn't read that photo", description: (err as Error).message, variant: "destructive" });
    } finally {
      e.target.value = "";
    }
  };

  /**
   * Native path. The age gate is re-checked here because the camera is
   * reachable without the panel that normally hides it — the same refusal has
   * to happen on this route, not just on the button that is hidden.
   */
  const scanFromCamera = async () => {
    if (!user || !profile) return;
    if (!canScanCalories) {
      toast({ title: "Age restriction", description: CALORIE_SCAN_REFUSAL, variant: "destructive" });
      return;
    }
    const shot = await capturePhoto();
    if (!shot) return; // cancelled
    setScanPreview(shot.previewUrl);
    hapticImpact("medium");
    await runScan(shot.base64);
  };

  const onScanPhoto = () => {
    if (isNative()) void scanFromCamera();
    else fileInputRef.current?.click();
  };

  /**
   * A number from a scan, or an em dash. The model answers `null` for anything
   * it could not read, and React renders `null` as nothing at all.
   */
  const scanValue = (value: unknown, unit = ""): string =>
    typeof value === "number" && Number.isFinite(value) ? `${value}${unit}` : "—";

  /** True when the scan produced at least one real number to log. */
  const hasScanNumbers = !!scanResult &&
    [scanResult.calories, scanResult.protein, scanResult.carbs, scanResult.fat]
      .some((v) => typeof v === "number" && Number.isFinite(v));

  const addScanResult = async () => {
    if (!user || !scanResult) return;
    const { error } = await supabase.from("meal_logs").insert({
      user_id: user.id, name: scanResult.name || "Scanned Meal", calories: scanResult.calories || null,
      protein_g: scanResult.protein || null, carbs_g: scanResult.carbs || null, fat_g: scanResult.fat || null,
      meal_type: "meal", log_date: today,
    });
    if (error) { toast({ title: "Couldn't save the scanned meal", description: error.message, variant: "destructive" }); return; }
    setScanResult(null); setShowScan(false);
    setScanPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    fetchMeals();
    toast({ title: "Scanned meal logged!" });
  };

  /** A blank optional target means "you choose", not zero. */
  const optTarget = (value: string) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const planWeeksNum = Math.max(1, Math.min(12, parseInt(planWeeks, 10) || 4));
  const planCost = hasNutritionPack ? 0 : creditCost("nutrition_plan_week", planWeeksNum);

  /**
   * Ask the server to write the plan.
   *
   * The charge happens there, before the model call, and is refunded on every
   * failure path — so this function never spends a credit itself and never has
   * to roll one back. What it owns is the honest reporting of the three ways
   * this can end: a plan, a refusal the athlete can act on, or a save failure
   * that must not be silently swallowed.
   */
  const generateNutritionPlan = async () => {
    if (!user || !profile || generating) return;

    // One check, shared with every other entry point (see dietPlanRefusalReason).
    //
    // This used to allow an UNKNOWN date of birth through: `age !== null &&
    // age < 18` was false when there was no DOB, so the very accounts that had
    // not proved their age were the ones that got a calorie-target plan. The
    // safe default for a restriction on minors is to refuse when the age is
    // unknown, which is also what public.viewer_is_adult() does server-side.
    const refusal = dietPlanRefusalReason(profile.date_of_birth);
    if (refusal) {
      toast({ title: "Nutrition plans are 18+", description: refusal, variant: "destructive" });
      return;
    }

    const check = validatePlanRequest({ goal: planGoal, weeks: planWeeksNum });
    if (!check.ok) {
      toast({ title: "Check the plan settings", description: check.error, variant: "destructive" });
      return;
    }

    setGenerating(true);
    setPlanError(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-nutrition-plan", {
        body: {
          goal: check.goal,
          weeks: check.weeks,
          sport: profile.sport ?? "",
          level: profile.experience_level ?? "",
          calories_target: optTarget(planCalories),
          protein_target: optTarget(planProtein),
          carbs_target: optTarget(planCarbs),
          fat_target: optTarget(planFat),
          notes: planNotes.trim().slice(0, 300),
          userLocale: getAiLocale(),
          request_id: newNutritionPlanRequestId(),
        },
      });

      if (error) {
        const status = (error as { context?: { status?: number } })?.context?.status ?? 0;
        const message = await edgeErrorMessage(error);
        // A 402 carries the exact gap, which the athlete can act on; anything
        // else is reported as it is.
        let shortfall: number | null = null;
        let chargedCost: number | null = null;
        try {
          const payload = await (error as { context: Response }).context.json();
          if (typeof payload?.shortfall === "number") shortfall = payload.shortfall;
          if (typeof payload?.cost === "number") chargedCost = payload.cost;
        } catch {
          /* body unreadable — the message is still usable */
        }
        if (status === 402) {
          setPlanError({
            message:
              shortfall !== null
                ? `You need ${chargedCost ?? planCost} credits for a ${check.weeks}-week plan — ${shortfall} short. Nothing was charged.`
                : message,
            topUp: true,
          });
          return;
        }
        setPlanError({ message });
        return;
      }

      const parsed = parseGeneratedPlan((data as { plan?: unknown } | null)?.plan);
      if (!parsed.plan) {
        setPlanError({ message: parsed.error ?? "The plan came back unreadable." });
        return;
      }

      const header = planHeader(parsed.plan);
      const first = parsed.plan.weeks[0];
      const { error: insertError } = await supabase.from("nutrition_plans").insert({
        user_id: user.id,
        title: planTitle.trim() || `${check.goal} Plan`,
        goal: check.goal,
        // The stored target columns mirror week 1, so an old plan list row and a
        // new one read the same way.
        calories_target: first?.calories || header.targets.calories || optTarget(planCalories) || null,
        protein_target: first?.protein_g || header.targets.protein_g || optTarget(planProtein) || null,
        carbs_target: first?.carbs_g || header.targets.carbs_g || optTarget(planCarbs) || null,
        fat_target: first?.fat_g || header.targets.fat_g || optTarget(planFat) || null,
        weeks: parsed.plan.weeks.length,
        plan_data: parsed.plan.weeks as unknown as Json,
      });

      if (insertError) {
        // The charge has already happened and the plan exists only in memory.
        // Keeping it on screen is what stops it being lost; regenerating would
        // charge a second time, and the client cannot refund a charge
        // (credits_grant is service-role only) — the same contract Training.tsx
        // holds when a plan the athlete paid for fails to save.
        setGeneratedPlan(parsed.plan);
        setExpandedPlanWeek(parsed.plan.weeks[0]?.week ?? null);
        setPlanError({
          message:
            "Your plan was written, but it could not be saved to your account. Do not generate it again — that charges a second time. It is shown below so you keep it; contact support and it will be put right.",
        });
        return;
      }

      setGeneratedPlan(parsed.plan);
      setExpandedPlanWeek(parsed.plan.weeks[0]?.week ?? null);
      setPlanTitle("");
      await refreshProfile();
      fetchPlans();
      toast({
        title: "Nutrition plan ready 🥗",
        description: planCost ? `${planCost} credits used for ${parsed.plan.weeks.length} weeks.` : "Free with Nutrition Pack.",
      });
    } catch (err) {
      setPlanError({
        message: `The plan could not be generated (${(err as Error)?.message ?? "unknown error"}). Check your connection and try again — a failed generation is refunded automatically.`,
      });
    } finally {
      setGenerating(false);
    }
  };

  const totalCalories = meals.reduce((s, m) => s + (m.calories || 0), 0);
  const totalProtein = meals.reduce((s, m) => s + (m.protein_g || 0), 0);
  const totalCarbs = meals.reduce((s, m) => s + (m.carbs_g || 0), 0);
  const totalFat = meals.reduce((s, m) => s + (m.fat_g || 0), 0);
  const inputClass = "w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-electric-purple/50 transition-all duration-300";
  const waterQuickAmounts = [50, 100, 150, 200, 250, 330, 500];

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Nutrition</motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">Fuel your performance.</motion.p>
      </div>

      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="px-5">
        {/* Nutrition Pack — the paid half of this screen, stated once, at the top,
            where the athlete meets the calorie scan that costs credits. */}
        <div className={`mb-4 rounded-2xl border p-4 ${hasNutritionPack ? "border-energy/40 bg-energy/5" : "border-electric-purple/25 bg-gradient-card"}`}>
          {hasNutritionPack ? (
            <div className="flex items-start gap-3">
              <Check size={16} className="mt-0.5 shrink-0 text-energy" />
              <div>
                <p className="text-sm font-semibold text-energy">Nutrition Pack active</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  AI calorie scans are free, and nutrition plans skip the {creditCost("nutrition_plan_week")}-credit weekly charge. Yours permanently.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <Lock size={16} className="mt-0.5 shrink-0 text-electric-purple" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Nutrition Pack — {packPrice} credits, once</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    Makes the calorie scan free on every meal photo and removes the per-week charge from plans.
                    The scan still works without it, at {creditCost("calorie_scan")} credits a photo.
                  </p>
                </div>
              </div>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={buyNutritionPack}
                disabled={unlockingPack}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
              >
                {unlockingPack ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
                {unlockingPack ? "Unlocking…" : `Unlock for ${packPrice} credits`}
              </motion.button>
            </>
          )}
        </div>

        {/* Hydration */}
        <div className="bg-card border border-border rounded-2xl p-4 mb-4 hover:border-electric-purple/20 transition-colors duration-300">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Droplets size={16} className="text-electric-glow" /><span className="text-sm font-semibold">Hydration</span></div>
            <button onClick={() => setShowWaterGoalEdit(!showWaterGoalEdit)} className="text-xs text-muted-foreground underline">{showWaterGoalEdit ? "Cancel" : "Set Goal"}</button>
          </div>
          {showWaterGoalEdit ? (
            <div className="flex gap-2 mb-3">
              <input type="number" step="10" value={newWaterGoal} onChange={e => setNewWaterGoal(e.target.value)} className={inputClass} />
              <motion.button whileTap={{ scale: 0.95 }} onClick={saveWaterGoal} className="bg-primary text-primary-foreground px-4 rounded-xl text-sm font-semibold">Save</motion.button>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-2xl font-display font-bold">{waterMl}ml</span>
                <span className="text-sm text-muted-foreground">/ {waterGoal}ml</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
                <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min((waterMl / waterGoal) * 100, 100)}%` }} transition={{ duration: 0.8 }} className="h-full bg-electric rounded-full" />
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {waterQuickAmounts.map(amt => (
                  <motion.button key={amt} whileTap={{ scale: 0.9 }} onClick={() => setAddAmount(String(amt))}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${addAmount === String(amt) ? "bg-electric-purple/15 border-electric-purple text-electric-purple" : "bg-card border-border text-foreground"}`}>
                    {amt}ml
                  </motion.button>
                ))}
              </div>
              <div className="flex gap-2">
                <input type="number" step="10" value={addAmount} onChange={e => setAddAmount(e.target.value)} className="min-w-0 flex-1 bg-muted border border-border rounded-xl px-3 py-2 text-sm text-foreground" />
                <motion.button whileTap={{ scale: 0.95 }} onClick={addWater} className="bg-electric-purple/10 text-electric-purple text-sm font-semibold px-4 py-2 rounded-xl"><Plus size={14} className="inline mr-1" /> Add</motion.button>
              </div>
            </>
          )}
        </div>

        {/* Today's Macros */}
        {meals.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-4 sm:grid-cols-4">
            {[{ label: "Cal", value: totalCalories, unit: "kcal" }, { label: "Protein", value: totalProtein, unit: "g" }, { label: "Carbs", value: totalCarbs, unit: "g" }, { label: "Fat", value: totalFat, unit: "g" }].map((m, i) => (
              <motion.div key={m.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }}
                className="bg-card border border-border rounded-xl p-2.5 text-center">
                <span className="text-[12px] text-muted-foreground">{m.label}</span>
                <p className="text-sm font-display font-bold">{Math.round(m.value)}<span className="text-[12px] text-muted-foreground">{m.unit}</span></p>
              </motion.div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 mb-5">
          <motion.button whileTap={{ scale: 0.98 }}
            onClick={() => {
              if (!canScanCalories) {
                toast({ title: "Age restriction", description: CALORIE_SCAN_REFUSAL, variant: "destructive" });
                return;
              }
              setShowScan(!showScan);
            }}
            aria-disabled={!canScanCalories}
            className={`flex-1 flex items-center justify-center gap-2 font-semibold py-3 rounded-xl ${canScanCalories ? "bg-gradient-primary text-primary-foreground shadow-glow" : "bg-muted text-muted-foreground"}`}>
            {/* Prices come from the credit config, not from the copy. The buttons
                read "2" and "1" here long after the economy repriced the scan
                to 12 and the plan to 8 — a hard-coded price goes stale silently,
                and the athlete finds out at the coin slot. */}
            {/* No brackets around the price.

                `Scan ({cost} <Zap/>)` rendered as "Scan (12 ⚡ )": the inline
                SVG's own box carries a couple of pixels of slack either side
                (the glyph does not touch its viewbox), so a closing bracket
                landed away from the number it encloses and read as a typo. With
                the glyph between the two words instead, that slack is the gap
                and there is no bracket to sit wrong. */}
            <Camera size={18} /> {hasNutritionPack ? "Scan (free)" : <>Scan <Zap size={11} className="inline" />{creditCost("calorie_scan")}</>}
          </motion.button>
          <motion.button whileTap={{ scale: 0.98 }} onClick={() => setShowCreatePlan(!showCreatePlan)}
            className="flex-1 flex items-center justify-center gap-2 bg-card border border-border text-foreground font-semibold py-3 rounded-xl hover:border-electric-purple/20 transition-colors">
            <FileText size={18} /> {hasNutritionPack ? "Plan (free)" : <>Plan <Zap size={11} className="inline" />{creditCost("nutrition_plan_week")}/wk</>}
          </motion.button>
        </div>

        {/* Scan UI with image upload */}
        {showScan && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-electric-purple/20 rounded-2xl p-4 space-y-3 mb-5">
            <div className="flex items-center justify-between"><h3 className="font-display font-bold text-sm">📸 Scan Food</h3><button onClick={() => { setShowScan(false); setScanResult(null); setScanPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; }); }} className="text-muted-foreground" aria-label="Close scan"><X size={16} aria-hidden /></button></div>
            <p className="text-xs text-muted-foreground">Take a photo or upload an image of your meal. Our AI will estimate calories and macros.</p>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleScanImage} className="hidden" />
            
            {scanPreview && (
              <div className="rounded-xl overflow-hidden border border-border">
                <img src={scanPreview} alt="Meal preview" className="w-full h-40 object-cover" />
              </div>
            )}

            {scanning && (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 size={20} className="animate-spin text-electric-purple" />
                <span className="text-sm text-muted-foreground">Analyzing your meal...</span>
              </div>
            )}

            {!scanResult && !scanning && (
              <div className="flex gap-2">
                <motion.button onClick={onScanPhoto} whileTap={{ scale: 0.98 }}
                  className="flex-1 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl shadow-glow flex items-center justify-center gap-2">
                  <Camera size={16} /> Take Photo
                </motion.button>
                <motion.button onClick={() => fileInputRef.current?.click()} whileTap={{ scale: 0.98 }}
                  className="bg-card border border-border px-4 py-2.5 rounded-xl flex items-center gap-2 hover:border-electric-purple/20">
                  <Upload size={16} /> Upload
                </motion.button>
              </div>
            )}

            {scanResult && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="bg-gradient-card border border-electric-purple/20 rounded-xl p-4">
                <h4 className="font-semibold text-sm mb-1">{scanResult.name}</h4>
                {scanResult.description && <p className="text-xs text-muted-foreground mb-2">{scanResult.description}</p>}
                {/* Em dashes, not blanks.

                    A photo the model could not read comes back with nulls, and
                    `${null}` renders as nothing — so the row read "Cal" with no
                    number, then "P g", "C g", "F g": a unit with nothing in
                    front of it, which reads as a screen that broke. The one case
                    where the app has no answer is now the one case where it says
                    so. */}
                <div className="grid grid-cols-2 gap-2 mb-3 sm:grid-cols-4">
                  <div className="text-center"><p className="text-xs text-muted-foreground">Cal</p><p className="text-sm font-bold">{scanValue(scanResult.calories)}</p></div>
                  <div className="text-center"><p className="text-xs text-muted-foreground">P</p><p className="text-sm font-bold">{scanValue(scanResult.protein, "g")}</p></div>
                  <div className="text-center"><p className="text-xs text-muted-foreground">C</p><p className="text-sm font-bold">{scanValue(scanResult.carbs, "g")}</p></div>
                  <div className="text-center"><p className="text-xs text-muted-foreground">F</p><p className="text-sm font-bold">{scanValue(scanResult.fat, "g")}</p></div>
                </div>
                {!hasScanNumbers && (
                  <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
                    We couldn't estimate this one — nothing was written down as a number. Try a clearer photo, or
                    log the meal with your own figures.
                  </p>
                )}
                <motion.button onClick={addScanResult} whileTap={{ scale: 0.98 }} className="w-full bg-electric-purple/10 text-electric-purple font-semibold py-2 rounded-xl text-sm">Log This Meal</motion.button>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Generate Nutrition Plan — written by the model, charged per week */}
        {showCreatePlan && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-2xl p-4 space-y-3 mb-5">
            <div className="flex items-center justify-between"><h3 className="font-display font-bold text-sm">Generate Nutrition Plan</h3><button onClick={() => { setShowCreatePlan(false); setPlanError(null); }} className="text-muted-foreground" aria-label="Close plan generator"><X size={16} aria-hidden /></button></div>
            <p className="text-xs text-muted-foreground flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> <span>{disclaimerShort("minor")}</span></p>
            <input type="text" placeholder="Plan name (optional)" value={planTitle} onChange={e => setPlanTitle(e.target.value)} className={inputClass} />
            <div>
              <label className="text-[12px] text-muted-foreground">Goal</label>
              <div className="mt-1 flex gap-1.5">
                {(["Cut", "Maintain", "Bulk"] as const).map(g => (
                  <button key={g} onClick={() => setPlanGoal(g)} className={`flex-1 px-2 py-2 rounded-lg text-xs font-semibold border transition-all ${planGoal === g ? "bg-electric-purple/15 border-electric-purple text-electric-purple" : "bg-card border-border text-foreground"}`}>{g}</button>
                ))}
              </div>
            </div>
            <div><label className="text-[12px] text-muted-foreground">Length — {creditCost("nutrition_plan_week")} credits per week (free with Nutrition Pack)</label>
              <input type="number" min={1} max={12} value={planWeeks} onChange={e => setPlanWeeks(e.target.value)} className={inputClass} /></div>
            {/* Targets are hints, not the plan. Blank (the default) tells the model
                to set them from the goal and the athlete's own training data. */}
            <details className="rounded-xl border border-border bg-muted/20 px-3 py-2">
              <summary className="cursor-pointer text-[12px] font-semibold text-muted-foreground">Targets (optional — leave blank and the AI sets them)</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div><label className="text-[12px] text-muted-foreground">Daily calories</label><input type="number" placeholder="e.g. 2400" value={planCalories} onChange={e => setPlanCalories(e.target.value)} className={inputClass} /></div>
                <div><label className="text-[12px] text-muted-foreground">Protein (g)</label><input type="number" placeholder="e.g. 160" value={planProtein} onChange={e => setPlanProtein(e.target.value)} className={inputClass} /></div>
                <div><label className="text-[12px] text-muted-foreground">Carbs (g)</label><input type="number" placeholder="e.g. 280" value={planCarbs} onChange={e => setPlanCarbs(e.target.value)} className={inputClass} /></div>
                <div><label className="text-[12px] text-muted-foreground">Fat (g)</label><input type="number" placeholder="e.g. 70" value={planFat} onChange={e => setPlanFat(e.target.value)} className={inputClass} /></div>
              </div>
              <div className="mt-2">
                <label className="text-[12px] text-muted-foreground">Anything to avoid or include?</label>
                <input type="text" placeholder="e.g. no dairy, one vegetarian day" value={planNotes} onChange={e => setPlanNotes(e.target.value)} className={inputClass} />
              </div>
            </details>

            {generating && (
              <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-xl border border-electric-purple/20 bg-electric-purple/5 px-3 py-2.5">
                <Loader2 size={16} className="animate-spin text-electric-purple" />
                <span className="text-[12px] leading-relaxed">Writing your {planWeeksNum}-week plan, meal by meal… Credits are only kept if a plan arrives; a failure is refunded automatically.</span>
              </div>
            )}

            {planError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                <p className="text-[12px] font-semibold text-destructive">Plan not created</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{planError.message}</p>
                {planError.topUp && (
                  <button onClick={() => navigate("/market")} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-[12px] font-semibold text-primary">
                    <Wallet size={12} /> Top up in the Market
                  </button>
                )}
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {DISCLAIMERS.nutrition.full}
            </p>
            <motion.button onClick={generateNutritionPlan} whileTap={{ scale: 0.98 }} disabled={generating}
              className="w-full bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl shadow-glow flex items-center justify-center gap-2 disabled:opacity-60">
              {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {generating
                ? "Writing your plan…"
                : planCost === 0
                  ? "Generate plan — free with Nutrition Pack"
                  : `Generate plan (${planCost} credits · ${creditCost("nutrition_plan_week")}/wk)`}
            </motion.button>
            {planCost > 0 && (
              <p className="text-center text-[12px] text-muted-foreground">{planWeeksNum} weeks × {creditCost("nutrition_plan_week")} credits. Charged only if the plan arrives.</p>
            )}

            {/* A plan that was generated but not saved stays on screen: it is the
                only copy the athlete has. */}
            {generatedPlan && (
              <div className="space-y-2 pt-1">
                <p className="text-[12px] font-semibold text-muted-foreground">Your generated plan</p>
                <PlanBody plan={generatedPlan} expandedWeek={expandedPlanWeek} onToggleWeek={(w) => setExpandedPlanWeek((prev) => (prev === w ? null : w))} />
              </div>
            )}
          </motion.div>
        )}

        {/* Log Meal */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Today's Meals</h3>
          <button onClick={() => setShowAddMeal(!showAddMeal)} className="text-xs text-electric-purple font-semibold"><Plus size={14} className="inline" /> Add Meal</button>
        </div>

        {showAddMeal && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-2xl p-4 space-y-3 mb-4">
            <input type="text" placeholder="Meal name *" value={mealName} onChange={e => setMealName(e.target.value)} className={inputClass} />
            <div className="flex gap-1.5">
              {["breakfast", "lunch", "dinner", "snack", "pre-workout", "post-workout"].map(t => (
                <button key={t} onClick={() => setMealType(t)} className={`px-2 py-1 text-[12px] capitalize ${mealType === t ? "bg-electric-purple/15 border-electric-purple text-electric-purple" : "bg-card border-border text-foreground"} rounded-lg border`}>{t}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" placeholder="Calories" value={mealCalories} onChange={e => setMealCalories(e.target.value)} className={inputClass} />
              <input type="number" placeholder="Protein (g)" value={mealProtein} onChange={e => setMealProtein(e.target.value)} className={inputClass} />
              <input type="number" placeholder="Carbs (g)" value={mealCarbs} onChange={e => setMealCarbs(e.target.value)} className={inputClass} />
              <input type="number" placeholder="Fat (g)" value={mealFat} onChange={e => setMealFat(e.target.value)} className={inputClass} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAddMeal(false)} className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground">Cancel</button>
              <motion.button onClick={addMeal} disabled={!mealName.trim() || saving} whileTap={{ scale: 0.98 }}
                className="flex-1 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl disabled:opacity-40 shadow-glow">Log Meal</motion.button>
            </div>
          </motion.div>
        )}

        <div ref={mealsRef} className="space-y-2 mb-5">
          {meals.map((meal, i) => (
            <motion.div key={meal.id} initial={{ opacity: 0, x: -10 }} animate={mealsInView ? { opacity: 1, x: 0 } : {}} transition={{ delay: i * 0.05 }}
              className="bg-card border border-border rounded-xl p-3 flex items-center justify-between hover:border-electric-purple/20 transition-colors">
              <div>
                <span className="text-sm font-semibold">{meal.name}</span>
                <p className="text-[12px] text-muted-foreground capitalize">{meal.meal_type} · {meal.calories ? `${meal.calories} kcal` : ""}{meal.protein_g ? ` · ${meal.protein_g}g P` : ""}</p>
              </div>
              <button onClick={() => deleteMeal(meal.id, meal.name)} aria-label={`Delete meal: ${meal.name}`} disabled={deleting} className="text-muted-foreground hover:text-destructive"><Trash2 size={14} aria-hidden /></button>
            </motion.div>
          ))}
          {meals.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No meals logged today.</p>}
        </div>

        {/* Nutrition Plans — the AI plan, and the target-only rows written
            before it existed. One reader, so neither can be a dead card. */}
        {plans.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Your Plans</h3>
            <div className="space-y-2">
              {plans.map((plan, i) => {
                const parsed = parseGeneratedPlan({ weeks: plan.plan_data });
                const open = expandedStoredPlan === plan.id;
                return (
                  <motion.div key={plan.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
                    className="bg-card border border-border rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold">{plan.title}</h4>
                        <p className="text-[12px] text-muted-foreground">{plan.goal} · {plan.weeks}w{plan.calories_target ? ` · ${plan.calories_target} kcal` : ""}{plan.protein_target ? ` · ${plan.protein_target}g P` : ""}</p>
                      </div>
                      {plan.active && <span className="text-[12px] bg-electric-purple/10 text-electric-purple px-2 py-0.5 rounded-full font-semibold shrink-0">Active</span>}
                    </div>
                    {parsed.plan ? (
                      <>
                        <button type="button" onClick={() => setExpandedStoredPlan(open ? null : plan.id)}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-[12px] font-semibold text-foreground">
                          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {open ? "Hide" : "View"} the plan ({parsed.plan.weeks.length} weeks)
                        </button>
                        {open && (
                          <div className="mt-2">
                            <PlanBody plan={parsed.plan} expandedWeek={expandedPlanWeek} onToggleWeek={(w) => setExpandedPlanWeek((prev) => (prev === w ? null : w))} />
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="mt-1 text-[12px] text-muted-foreground">Targets only — written before AI meal plans.</p>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};

/**
 * One week of a generated plan: the theme and the daily targets on the header,
 * then the days themselves. Collapsed by default — a 12-week plan expanded is
 * thousands of words, and the athlete reads one week at a time in practice.
 */
const PlanWeekCard = ({
  week,
  expanded,
  onToggle,
}: {
  week: PlanWeek;
  expanded: boolean;
  onToggle: () => void;
}) => (
  <div className="rounded-xl border border-border bg-card overflow-hidden">
    <button type="button" onClick={onToggle} aria-expanded={expanded} className="w-full flex items-center gap-2 px-3 py-2.5 text-start">
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold">Week {week.week} · {week.focus}</span>
        <span className="block text-[12px] text-muted-foreground tabular-nums">
          {week.calories} kcal · {week.protein_g}g P · {week.carbs_g}g C · {week.fat_g}g F per day
        </span>
      </span>
      {expanded
        ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        : <ChevronRight size={14} className="shrink-0 text-muted-foreground" aria-hidden />}
    </button>
    {expanded && (
      <div className="border-t border-border divide-y divide-border">
        {week.days.length === 0 && (
          <p className="px-3 py-2.5 text-[12px] text-muted-foreground">This week came back without days.</p>
        )}
        {week.days.map((day) => {
          const totals = dayTotals(day);
          return (
            <div key={day.day} className="px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-bold uppercase tracking-wider text-electric-purple">
                  {day.dayName || DAY_NAMES[day.day - 1]}
                </span>
                {/* What the meals actually add up to, so the day can be checked
                    against the week's target at a glance. */}
                {totals.calories > 0 && (
                  <span className="text-[12px] tabular-nums text-muted-foreground">{totals.calories} kcal · {totals.protein_g}g P</span>
                )}
              </div>
              {day.meals.length === 0 ? (
                <p className="mt-1 text-[12px] text-muted-foreground">No meals for this day.</p>
              ) : (
                <ul className="mt-1.5 space-y-1.5">
                  {day.meals.map((meal, i) => (
                    <li key={`${day.day}-${i}-${meal.name}`} className="rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2">
                      <span className="block text-[12px] font-semibold">
                        {meal.slot ? `${meal.slot} · ` : ""}{meal.name}
                      </span>
                      {meal.description && (
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">{meal.description}</span>
                      )}
                      <span className="mt-1 block text-[12px] tabular-nums text-muted-foreground">
                        {meal.calories} kcal · {meal.protein_g}g P · {meal.carbs_g}g C · {meal.fat_g}g F
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {day.notes && <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{day.notes}</p>}
            </div>
          );
        })}
      </div>
    )}
  </div>
);

/**
 * The whole plan: a summary the athlete can read without expanding anything,
 * then a collapsible card per week. Used for a freshly generated plan and for
 * one stored in `nutrition_plans.plan_data` — the same code, so the two can
 * never drift apart.
 */
const PlanBody = ({
  plan,
  expandedWeek,
  onToggleWeek,
}: {
  plan: GeneratedPlan;
  expandedWeek: number | null;
  onToggleWeek: (week: number) => void;
}) => {
  const header = planHeader(plan);
  const firstWeek = plan.weeks[0];
  const mealAverage = firstWeek ? planTotals(firstWeek) : null;
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-electric-purple/20 bg-electric-purple/5 px-3 py-2">
        <p className="text-[12px] font-semibold tabular-nums">
          {header.weeks}-week plan · {header.targets.calories} kcal/day · {header.targets.protein_g}g protein/day
        </p>
        {plan.summary && (
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{plan.summary}</p>
        )}
        {mealAverage && mealAverage.calories > 0 && (
          <p className="mt-1 text-[12px] tabular-nums text-muted-foreground">
            Week 1's meals add up to ~{mealAverage.calories} kcal/day.
          </p>
        )}
      </div>
      {plan.weeks.map((w) => (
        <PlanWeekCard key={w.week} week={w} expanded={expandedWeek === w.week} onToggle={() => onToggleWeek(w.week)} />
      ))}
    </div>
  );
};

export default Nutrition;
