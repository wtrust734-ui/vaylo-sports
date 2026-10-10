import { getAiLocale } from "@/i18n";
import { useState, useEffect, useRef } from "react";
import { localDateKey } from "@/lib/dates";
import { motion, useInView } from "framer-motion";
import { Droplets, ScanLine, UtensilsCrossed, Plus, Trash2, Zap, Camera, FileText, X, AlertTriangle, Upload, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { spendCredits, creditCost, spendErrorMessage } from "@/lib/credits";
import { useSpendWithTopUp } from "@/hooks/useSpendWithTopUp";
import { getLocalPBs } from "@/lib/athleteDossier";
import { dietPlanRefusalReason, isAdultDob } from "@/lib/age";
import { DISCLAIMERS, disclaimerShort } from "@/config/disclaimers";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { capturePhoto } from "@/lib/camera";
import { isNative } from "@/lib/platform";
import { hapticImpact } from "@/lib/haptics";
import type { Tables } from "@/integrations/supabase/types";

const Nutrition = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const spendWithTopUp = useSpendWithTopUp();
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
  const [planGoal, setPlanGoal] = useState("Maintain");
  const [planCalories, setPlanCalories] = useState("2200");
  const [planProtein, setPlanProtein] = useState("150");
  const [planCarbs, setPlanCarbs] = useState("250");
  const [planFat, setPlanFat] = useState("70");
  const [planWeeks, setPlanWeeks] = useState("4");

  const [showScan, setShowScan] = useState(false);
  const [scanResult, setScanResult] = useState<{ name?: string; calories?: number; protein?: number; carbs?: number; fat?: number; description?: string; verdict?: "fuel" | "light" | "treat"; verdict_reason?: string } | null>(null);
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
    // Nutrition is a standard tab: every scan is charged per use. The server
    // charges the credits and refunds on failure — nothing is charged or
    // validated from the client.
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
        setScanResult(parsed);
      } catch {
        setScanResult({ name: "Scanned Meal", calories: 300, protein: 15, carbs: 35, fat: 12, description: payload.result });
      }
      toast({ title: "Scan complete! 📸", description: payload.cost ? `${payload.cost} credits used.` : "Included with Unlimited." });
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

  const createNutritionPlan = async () => {
    if (!user || !profile) return;
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
    const weeks = Math.max(1, Math.min(52, parseInt(planWeeks, 10) || 4));
    // Nutrition is a standard tab, not a purchase: every plan charges per week
    // for everyone. No pack, no free pass — the server enforces the same price.
    const cost = creditCost("nutrition_plan_week", weeks);

    // Create the plan FIRST, then charge. If the save fails the athlete loses
    // nothing; if the charge fails we roll the plan back. Targets are clamped
    // to physiological/product bounds; invalid input falls back to the
    // product defaults rather than storing 0 or NaN.
    const clampTarget = (v: string, min: number, max: number, fallback: number) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
    };
    const { data: created, error: insertError } = await supabase.from("nutrition_plans").insert({
      user_id: user.id, title: planTitle || `${planGoal} Plan`, goal: planGoal,
      calories_target: clampTarget(planCalories, 800, 6000, 2200),
      protein_target: clampTarget(planProtein, 20, 400, 150),
      carbs_target: clampTarget(planCarbs, 0, 1200, 250),
      fat_target: clampTarget(planFat, 10, 300, 70),
      weeks,
    }).select("id").single();
    if (insertError) { toast({ title: "Couldn't save your plan", description: insertError.message, variant: "destructive" }); return; }

    if (cost > 0) {
      // Insufficient credits open the global top-up sheet; on purchase the same
      // spend is retried, so the plan (already saved) just completes.
      const spend = await spendWithTopUp("nutrition_plan_week", { quantity: weeks, reason: `Nutrition plan: ${planTitle || planGoal} (${weeks} weeks)` });
      if (!spend.success) {
        if (created?.id) {
          const { error: rollbackError } = await supabase.from("nutrition_plans").delete().eq("id", created.id);
          if (rollbackError) console.error("nutrition plan rollback failed:", rollbackError.message);
        }
        if (spend.dismissedTopUp) toast({ title: "Not enough credits", description: spendErrorMessage("nutrition_plan_week", spend, weeks), variant: "destructive" });
        return;
      }
    }

    await refreshProfile();
    setShowCreatePlan(false); setPlanTitle("");
    fetchPlans();
    toast({ title: "Nutrition plan created! 🥗", description: `${cost} credits used.` });
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
            <Camera size={18} /> Scan ({creditCost("calorie_scan")} <Zap size={12} className="inline" />)
          </motion.button>
          <motion.button whileTap={{ scale: 0.98 }} onClick={() => setShowCreatePlan(!showCreatePlan)}
            className="flex-1 flex items-center justify-center gap-2 bg-card border border-border text-foreground font-semibold py-3 rounded-xl hover:border-electric-purple/20 transition-colors">
            <FileText size={18} /> Plan ({creditCost("nutrition_plan_week")} <Zap size={12} className="inline" />/wk)
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
                {scanResult.verdict && (
                  <div className={`mb-2 rounded-xl px-3 py-2 text-xs leading-relaxed ${
                    scanResult.verdict === "fuel" ? "bg-emerald-500/10 text-emerald-300"
                    : scanResult.verdict === "light" ? "bg-amber-500/10 text-amber-300"
                    : "bg-electric-purple/10 text-electric-purple"
                  }`}>
                    <span className="font-bold">
                      {scanResult.verdict === "fuel" ? "Solid fuel for your training" : scanResult.verdict === "light" ? "A bit light for an athlete" : "A treat, not training fuel"}
                    </span>
                    {scanResult.verdict_reason && <span> — {scanResult.verdict_reason}</span>}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 mb-3 sm:grid-cols-4">
                  <div className="text-center"><p className="text-xs text-muted-foreground">Cal</p><p className="text-sm font-bold">{scanResult.calories}</p></div>
                  <div className="text-center"><p className="text-xs text-muted-foreground">P</p><p className="text-sm font-bold">{scanResult.protein}g</p></div>
                  <div className="text-center"><p className="text-xs text-muted-foreground">C</p><p className="text-sm font-bold">{scanResult.carbs}g</p></div>
                  <div className="text-center"><p className="text-xs text-muted-foreground">F</p><p className="text-sm font-bold">{scanResult.fat}g</p></div>
                </div>
                <motion.button onClick={addScanResult} whileTap={{ scale: 0.98 }} className="w-full bg-electric-purple/10 text-electric-purple font-semibold py-2 rounded-xl text-sm">Log This Meal</motion.button>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Create Nutrition Plan */}
        {showCreatePlan && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-2xl p-4 space-y-3 mb-5">
            <div className="flex items-center justify-between"><h3 className="font-display font-bold text-sm">Create Nutrition Plan</h3><button onClick={() => setShowCreatePlan(false)} className="text-muted-foreground"><X size={16} /></button></div>
            <p className="text-xs text-muted-foreground flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> <span>{disclaimerShort("minor")}</span></p>
            <input type="text" placeholder="Plan name (optional)" value={planTitle} onChange={e => setPlanTitle(e.target.value)} className={inputClass} />
            <div className="flex gap-1.5">
              {["Cut", "Maintain", "Bulk"].map(g => (
                <button key={g} onClick={() => setPlanGoal(g)} className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-all ${planGoal === g ? "bg-electric-purple/15 border-electric-purple text-electric-purple" : "bg-card border-border text-foreground"}`}>{g}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[12px] text-muted-foreground">Daily Calories</label><input type="number" value={planCalories} onChange={e => setPlanCalories(e.target.value)} className={inputClass} /></div>
              <div><label className="text-[12px] text-muted-foreground">Protein (g)</label><input type="number" value={planProtein} onChange={e => setPlanProtein(e.target.value)} className={inputClass} /></div>
              <div><label className="text-[12px] text-muted-foreground">Carbs (g)</label><input type="number" value={planCarbs} onChange={e => setPlanCarbs(e.target.value)} className={inputClass} /></div>
              <div><label className="text-[12px] text-muted-foreground">Fat (g)</label><input type="number" value={planFat} onChange={e => setPlanFat(e.target.value)} className={inputClass} /></div>
            </div>
            <div><label className="text-[12px] text-muted-foreground">Duration (weeks) — {creditCost("nutrition_plan_week")} credits per week</label>
              <input type="number" min={1} max={52} value={planWeeks} onChange={e => setPlanWeeks(e.target.value)} className={inputClass} /></div>
            {/* The plan stores targets the athlete typed in themselves, so the
                honest statement is that these are their numbers and the app is
                not a dietitian. Not a liability clause — a description. */}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {DISCLAIMERS.nutrition.full}
            </p>
            <motion.button onClick={createNutritionPlan} whileTap={{ scale: 0.98 }}
              className="w-full bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl shadow-glow flex items-center justify-center gap-2">
              Create Plan ({creditCost("nutrition_plan_week", parseInt(planWeeks) || 4)} credits · {creditCost("nutrition_plan_week")}/wk)
            </motion.button>
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

        {/* Nutrition Plans */}
        {plans.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Your Plans</h3>
            <div className="space-y-2">
              {plans.map((plan, i) => (
                <motion.div key={plan.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
                  className="bg-card border border-border rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold">{plan.title}</h4>
                      <p className="text-[12px] text-muted-foreground">{plan.goal} · {plan.weeks}w · {plan.calories_target} kcal · {plan.protein_target}g P</p>
                    </div>
                    {plan.active && <span className="text-[12px] bg-electric-purple/10 text-electric-purple px-2 py-0.5 rounded-full font-semibold">Active</span>}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default Nutrition;
