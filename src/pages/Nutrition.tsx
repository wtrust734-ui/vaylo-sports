import { getAiLocale } from "@/i18n";
import { useState, useEffect, useRef } from "react";
import { localDateKey } from "@/lib/dates";
import { motion, useInView } from "framer-motion";
import { Droplets, ScanLine, UtensilsCrossed, Plus, Trash2, Zap, Camera, FileText, X, AlertTriangle, Upload, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { spendCredits, creditCost, spendErrorMessage } from "@/lib/credits";
import { getLocalPBs } from "@/lib/athleteDossier";
import { edgeErrorMessage } from "@/lib/edgeErrors";

const Nutrition = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [waterMl, setWaterMl] = useState(0);
  const [waterGoal, setWaterGoal] = useState(3000);
  const [showWaterGoalEdit, setShowWaterGoalEdit] = useState(false);
  const [newWaterGoal, setNewWaterGoal] = useState("3000");
  const [addAmount, setAddAmount] = useState("250");
  const [meals, setMeals] = useState<any[]>([]);
  const [showAddMeal, setShowAddMeal] = useState(false);
  const [mealName, setMealName] = useState("");
  const [mealCalories, setMealCalories] = useState("");
  const [mealProtein, setMealProtein] = useState("");
  const [mealCarbs, setMealCarbs] = useState("");
  const [mealFat, setMealFat] = useState("");
  const [mealType, setMealType] = useState<string>("meal");

  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [plans, setPlans] = useState<any[]>([]);
  const [planTitle, setPlanTitle] = useState("");
  const [planGoal, setPlanGoal] = useState("Maintain");
  const [planCalories, setPlanCalories] = useState("2200");
  const [planProtein, setPlanProtein] = useState("150");
  const [planCarbs, setPlanCarbs] = useState("250");
  const [planFat, setPlanFat] = useState("70");
  const [planWeeks, setPlanWeeks] = useState("4");

  const [showScan, setShowScan] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mealsRef = useRef(null);
  const mealsInView = useInView(mealsRef, { once: true, margin: "-30px" });
  const today = localDateKey();

  const getAge = () => {
    if (!profile?.date_of_birth) return null;
    return Math.floor((Date.now() - new Date(profile.date_of_birth).getTime()) / 31557600000);
  };

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
    if (!user || !mealName.trim()) return;
    const { error } = await supabase.from("meal_logs").insert({
      user_id: user.id, name: mealName.trim(), calories: parseInt(mealCalories) || null,
      protein_g: parseFloat(mealProtein) || null, carbs_g: parseFloat(mealCarbs) || null,
      fat_g: parseFloat(mealFat) || null, meal_type: mealType, log_date: today,
    });
    if (error) { toast({ title: "Couldn't log the meal", description: error.message, variant: "destructive" }); return; }
    setShowAddMeal(false); setMealName(""); setMealCalories(""); setMealProtein(""); setMealCarbs(""); setMealFat("");
    fetchMeals();
    toast({ title: "Meal logged! 🍽️" });
  };

  const deleteMeal = async (id: string) => {
    const { error } = await supabase.from("meal_logs").delete().eq("id", id);
    if (error) { toast({ title: "Couldn't delete the meal", description: error.message, variant: "destructive" }); return; }
    fetchMeals();
  };

  // AI Calorie Scan with image
  const handleScanImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !profile) return;
    // The server verifies Nutrition Pack ownership, charges credits and refunds
    // on failure — nothing is charged or validated from the client.
    const url = URL.createObjectURL(file);
    setScanPreview(url);
    setScanning(true);
    setScanResult(null);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Couldn't read the image file."));
        reader.readAsDataURL(file);
      });

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
      toast({ title: "Scan complete! 📸", description: payload.cost ? `${payload.cost} credits used.` : "Free with Nutrition Pack." });
      await refreshProfile();
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const addScanResult = async () => {
    if (!user || !scanResult) return;
    const { error } = await supabase.from("meal_logs").insert({
      user_id: user.id, name: scanResult.name || "Scanned Meal", calories: scanResult.calories || null,
      protein_g: scanResult.protein || null, carbs_g: scanResult.carbs || null, fat_g: scanResult.fat || null,
      meal_type: "meal", log_date: today,
    });
    if (error) { toast({ title: "Couldn't save the scanned meal", description: error.message, variant: "destructive" }); return; }
    setScanResult(null); setScanPreview(null); setShowScan(false);
    fetchMeals();
    toast({ title: "Scanned meal logged!" });
  };

  const createNutritionPlan = async () => {
    if (!user || !profile) return;
    const age = getAge();
    if (age !== null && age < 18) {
      toast({ title: "Age restriction", description: "Nutrition plans are for users 18+. Please consult a professional.", variant: "destructive" });
      return;
    }
    if (!profile.date_of_birth) {
      toast({ title: "Age required", description: "Please set your date of birth in Profile settings.", variant: "destructive" });
      return;
    }
    const weeks = parseInt(planWeeks) || 4;
    const { data: hasPack } = await supabase.from("user_purchases").select("product_id").eq("user_id", user.id).eq("product_id", "nutrition_pack").maybeSingle();
    const cost = hasPack ? 0 : creditCost("nutrition_plan_week", weeks);

    // Create the plan FIRST, then charge. If the save fails the athlete loses
    // nothing; if the charge fails we roll the plan back.
    const { data: created, error: insertError } = await supabase.from("nutrition_plans").insert({
      user_id: user.id, title: planTitle || `${planGoal} Plan`, goal: planGoal,
      calories_target: parseInt(planCalories) || 2200, protein_target: parseInt(planProtein) || 150,
      carbs_target: parseInt(planCarbs) || 250, fat_target: parseInt(planFat) || 70, weeks,
    }).select("id").single();
    if (insertError) { toast({ title: "Couldn't save your plan", description: insertError.message, variant: "destructive" }); return; }

    if (cost > 0) {
      const spend = await spendCredits("nutrition_plan_week", { quantity: weeks, reason: `Nutrition plan: ${planTitle || planGoal} (${weeks} weeks)` });
      if (!spend.success) {
        if (created?.id) {
          const { error: rollbackError } = await supabase.from("nutrition_plans").delete().eq("id", created.id);
          if (rollbackError) console.error("nutrition plan rollback failed:", rollbackError.message);
        }
        toast({ title: "Not enough credits", description: spendErrorMessage("nutrition_plan_week", spend, weeks), variant: "destructive" });
        return;
      }
    }

    await refreshProfile();
    setShowCreatePlan(false); setPlanTitle("");
    fetchPlans();
    toast({ title: "Nutrition plan created! 🥗", description: cost ? `${cost} credits used.` : "Free with Nutrition Pack." });
  };

  const totalCalories = meals.reduce((s, m) => s + (m.calories || 0), 0);
  const totalProtein = meals.reduce((s, m) => s + (m.protein_g || 0), 0);
  const totalCarbs = meals.reduce((s, m) => s + (m.carbs_g || 0), 0);
  const totalFat = meals.reduce((s, m) => s + (m.fat_g || 0), 0);
  const inputClass = "w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-electric-purple/50 transition-all duration-300";
  const waterQuickAmounts = [50, 100, 150, 200, 250, 330, 500];

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4">
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
                <input type="number" step="10" value={addAmount} onChange={e => setAddAmount(e.target.value)} className="flex-1 bg-muted border border-border rounded-xl px-3 py-2 text-sm text-foreground" />
                <motion.button whileTap={{ scale: 0.95 }} onClick={addWater} className="bg-electric-purple/10 text-electric-purple text-sm font-semibold px-4 py-2 rounded-xl"><Plus size={14} className="inline mr-1" /> Add</motion.button>
              </div>
            </>
          )}
        </div>

        {/* Today's Macros */}
        {meals.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[{ label: "Cal", value: totalCalories, unit: "kcal" }, { label: "Protein", value: totalProtein, unit: "g" }, { label: "Carbs", value: totalCarbs, unit: "g" }, { label: "Fat", value: totalFat, unit: "g" }].map((m, i) => (
              <motion.div key={m.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }}
                className="bg-card border border-border rounded-xl p-2.5 text-center">
                <span className="text-[10px] text-muted-foreground">{m.label}</span>
                <p className="text-sm font-display font-bold">{Math.round(m.value)}<span className="text-[10px] text-muted-foreground">{m.unit}</span></p>
              </motion.div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 mb-5">
          <motion.button whileTap={{ scale: 0.98 }} onClick={() => setShowScan(!showScan)}
            className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">
            <Camera size={18} /> Scan (2 <Zap size={12} className="inline" />)
          </motion.button>
          <motion.button whileTap={{ scale: 0.98 }} onClick={() => setShowCreatePlan(!showCreatePlan)}
            className="flex-1 flex items-center justify-center gap-2 bg-card border border-border text-foreground font-semibold py-3 rounded-xl hover:border-electric-purple/20 transition-colors">
            <FileText size={18} /> Plan (1 <Zap size={12} className="inline" />/wk)
          </motion.button>
        </div>

        {/* Scan UI with image upload */}
        {showScan && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-electric-purple/20 rounded-2xl p-4 space-y-3 mb-5">
            <div className="flex items-center justify-between"><h3 className="font-display font-bold text-sm">📸 Scan Food</h3><button onClick={() => { setShowScan(false); setScanResult(null); setScanPreview(null); }} className="text-muted-foreground"><X size={16} /></button></div>
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
                <motion.button onClick={() => fileInputRef.current?.click()} whileTap={{ scale: 0.98 }}
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
                <div className="grid grid-cols-4 gap-2 mb-3">
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
            <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle size={12} /> Nutrition plans are for users 18+ only.</p>
            <input type="text" placeholder="Plan name (optional)" value={planTitle} onChange={e => setPlanTitle(e.target.value)} className={inputClass} />
            <div className="flex gap-1.5">
              {["Cut", "Maintain", "Bulk"].map(g => (
                <button key={g} onClick={() => setPlanGoal(g)} className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-all ${planGoal === g ? "bg-electric-purple/15 border-electric-purple text-electric-purple" : "bg-card border-border text-foreground"}`}>{g}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-[10px] text-muted-foreground">Daily Calories</label><input type="number" value={planCalories} onChange={e => setPlanCalories(e.target.value)} className={inputClass} /></div>
              <div><label className="text-[10px] text-muted-foreground">Protein (g)</label><input type="number" value={planProtein} onChange={e => setPlanProtein(e.target.value)} className={inputClass} /></div>
              <div><label className="text-[10px] text-muted-foreground">Carbs (g)</label><input type="number" value={planCarbs} onChange={e => setPlanCarbs(e.target.value)} className={inputClass} /></div>
              <div><label className="text-[10px] text-muted-foreground">Fat (g)</label><input type="number" value={planFat} onChange={e => setPlanFat(e.target.value)} className={inputClass} /></div>
            </div>
            <div><label className="text-[10px] text-muted-foreground">Duration (weeks) — {creditCost("nutrition_plan_week")} credits per week (free with Nutrition Pack)</label>
              <input type="number" min={1} max={52} value={planWeeks} onChange={e => setPlanWeeks(e.target.value)} className={inputClass} /></div>
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
                <button key={t} onClick={() => setMealType(t)} className={`px-2 py-1 text-[10px] capitalize ${mealType === t ? "bg-electric-purple/15 border-electric-purple text-electric-purple" : "bg-card border-border text-foreground"} rounded-lg border`}>{t}</button>
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
              <motion.button onClick={addMeal} disabled={!mealName.trim()} whileTap={{ scale: 0.98 }}
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
                <p className="text-[10px] text-muted-foreground capitalize">{meal.meal_type} · {meal.calories ? `${meal.calories} kcal` : ""}{meal.protein_g ? ` · ${meal.protein_g}g P` : ""}</p>
              </div>
              <button onClick={() => deleteMeal(meal.id)} className="text-muted-foreground hover:text-destructive"><Trash2 size={14} /></button>
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
                      <p className="text-[10px] text-muted-foreground">{plan.goal} · {plan.weeks}w · {plan.calories_target} kcal · {plan.protein_target}g P</p>
                    </div>
                    {plan.active && <span className="text-[10px] bg-electric-purple/10 text-electric-purple px-2 py-0.5 rounded-full font-semibold">Active</span>}
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
