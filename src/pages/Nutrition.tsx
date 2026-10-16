import { getAiLocale } from "@/i18n";
import { useState, useEffect, useRef } from "react";
import { localDateKey } from "@/lib/dates";
import { motion, useInView } from "framer-motion";
import { Droplets, ScanLine, UtensilsCrossed, Plus, Trash2, Zap, Camera, FileText, X, AlertTriangle, Upload, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { creditCost } from "@/lib/credits";
import { getLocalPBs } from "@/lib/athleteDossier";
import { dietPlanRefusalReason, isAdultDob, validateDob } from "@/lib/age";
import { disclaimerShort } from "@/config/disclaimers";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { shortfallFromEdgeError } from "@/lib/shortfall";
import { requestCreditTopUp } from "@/lib/topUpStore";
import NutritionPlanWizard, { type PlanDraft } from "@/components/nutrition/NutritionPlanWizard";
import PlanGenerationProgress from "@/components/training/PlanGenerationProgress";
import SavedNutritionPlan from "@/components/nutrition/SavedNutritionPlan";
import {
  normalizeIntake,
  prefillIntake,
  targetsForRequest,
  type NutritionIntake,
} from "@/lib/nutritionTargets";
import { newNutritionPlanRequestId, parseGeneratedPlan } from "@/lib/nutritionPlan";
import { capturePhoto, pickPhoto } from "@/lib/camera";
import { isNative } from "@/lib/platform";
import { hapticImpact } from "@/lib/haptics";
import type { Json, Tables } from "@/integrations/supabase/types";

/**
 * What the `nutrition_review` call returns.
 *
 * Every field optional, because the shape comes back as model JSON and nothing
 * has validated it beyond the prompt: a missing sentence renders as nothing,
 * rather than crashing a screen the athlete paid to see.
 */
type FoodReview = {
  headline?: string;
  verdict?: "good" | "thin" | "unclear";
  fuel?: string;
  protein?: string;
  around_training?: string;
  what_works?: string[];
  suggestions?: string[];
  limits?: string;
};

/**
 * The questionnaire answers, as the brief the model is given.
 *
 * Kept in the athlete's own terms and short: `generate-nutrition-plan` caps
 * `notes` and puts them in the user turn as "Athlete's own request", so this is
 * read as the instruction rather than mined out of the dossier. Allergies are
 * stated as hard exclusions because that is what they are.
 */
function buildPlanNotes(intake: NutritionIntake): string {
  return [
    `Goal: ${intake.goal}.`,
    `Training ${intake.trainingDaysPerWeek} day${intake.trainingDaysPerWeek === 1 ? "" : "s"} a week, about ${intake.sessionMinutes} minutes a session.`,
    `They can fit ${intake.mealsPerDay} meal${intake.mealsPerDay === 1 ? "" : "s"} into a day.`,
    intake.dietaryPattern !== "omnivore"
      ? `Dietary pattern: ${intake.dietaryPattern} — every meal must respect it.`
      : "",
    intake.foodDislikes.trim()
      ? `Hard exclusions (allergies or foods they avoid): ${intake.foodDislikes.trim()}. Do not include these in any meal.`
      : "",
    intake.weightKg ? `Body weight ${intake.weightKg}kg${intake.heightCm ? `, height ${intake.heightCm}cm` : ""}.` : "",
    intake.notes.trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 800);
}

/**
 * How much of the log a review reads.
 *
 * A week, not a day: one day cannot tell "eating enough" from "logged one big
 * meal", and the question the feature answers is about the training week.
 */
const REVIEW_WINDOW_DAYS = 7;

const Nutrition = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
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
  // The questionnaire's starting answers: whatever the athlete saved on a
  // previous visit (fetchSettings), with the profile filled in where it knows
  // something. Nothing here is a target until they accept the recommendation.
  const [planIntake, setPlanIntake] = useState<NutritionIntake>(() => prefillIntake({}));
  const [writingPlan, setWritingPlan] = useState(false);
  // Dismissible wait for the AI-written plan: hiding drops to the inline card
  // rather than cancelling — the plan lands either way.
  const [planWaitHidden, setPlanWaitHidden] = useState(false);
  const [planWaitWeeks, setPlanWaitWeeks] = useState(4);
  const [savingDob, setSavingDob] = useState(false);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);

  // One job per tab instead of one long scroll: Today (water, macros, meals),
  // Scan (photo estimate), Plans (AI meal plans), Review (week reading).
  // Everything stays mounted in this component, so a half-filled meal form
  // survives a tab switch.
  const [nutriTab, setNutriTab] = useState<"today" | "scan" | "plans" | "review">("today");
  const [showScan, setShowScan] = useState(false);
  // Everything the estimator returns that the screen can show. `fiber`,
  // `serving` and `confidence` used to be dropped on the floor — the model
  // returns them, and the confidence in particular is the honest answer to
  // "how much should I trust this number".
  const [scanResult, setScanResult] = useState<{ name?: string; calories?: number; protein?: number; carbs?: number; fat?: number; fiber?: number; serving?: string; confidence?: "low" | "medium" | "high"; description?: string; verdict?: "fuel" | "light" | "treat"; verdict_reason?: string } | null>(null);
  // The values as the athlete will log them. Prefilled from the estimate the
  // moment it lands, but editable: a photo cannot weigh the plate, so the
  // person who cooked it gets the last word before anything is logged.
  const [scanEdits, setScanEdits] = useState<{ name: string; calories: string; protein: string; carbs: string; fat: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  // One in-flight destructive mutation at a time; a double-tap on a meal's
  // delete fired two DELETEs and a double reload.
  const [deleting, setDeleting] = useState(false);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  // The AI food review: a reading of the week's log against the training. Not
  // stored anywhere — it is a reading of a moment, like the scan result, and
  // saving it would turn a comment into a record the athlete has to keep true.
  const [foodReview, setFoodReview] = useState<FoodReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The gallery input is a SECOND input, and the difference is the whole point:
  // a single `<input type="file" accept="image/*" capture="environment">`
  // opens the camera from BOTH buttons on Android, because `capture` overrides
  // the picker. "Upload" then silently took a photo instead of letting the
  // athlete choose one they already had. Only the camera button now carries
  // `capture`; this one has no capture attribute, so it opens the real picker.
  const galleryInputRef = useRef<HTMLInputElement>(null);

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

  // A food review is nutrition advice, so it is adult-only for exactly the same
  // reason the scan and the plans are (src/lib/age.ts): the product does not
  // analyse food for under-18s at all. Unknown date of birth is not an adult.
  const canReviewFood = isAdultDob(profile?.date_of_birth);
  const REVIEW_REFUSAL =
    "Reviewing your food is built for adult athletes (18+). If you are under 18, we do not analyse your food or estimate calories for you — this is deliberate, not a missing setting.";

  useEffect(() => { if (user) { fetchWater(); fetchMeals(); fetchSettings(); fetchPlans(); } }, [user]);

  const fetchSettings = async () => {
    if (!user) return;
    const { data } = await supabase.from("user_settings").select("water_goal_ml").eq("user_id", user.id).maybeSingle();
    if (data?.water_goal_ml) { setWaterGoal(data.water_goal_ml); setNewWaterGoal(String(data.water_goal_ml)); }
    // The saved questionnaire answers, so a returning athlete is not asked
    // twelve questions again. Fetched in its own tolerant call: a build running
    // ahead of the intake migration must still load the water goal, and a
    // missing column is not something the screen needs to report.
    const { data: intakeRow, error: intakeError } = await supabase
      .from("user_settings")
      // `*` lets older deployed schemas return their known columns rather than
      // generating a PostgREST 400 for intake fields added by a newer migration.
      // Newer schemas still include those fields in the same row.
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (intakeError) {
      console.warn("nutrition intake not available:", intakeError.message);
      return;
    }
    if (intakeRow) {
      setPlanIntake((current) => normalizeIntake(intakeRow as unknown as Partial<NutritionIntake>, current));
    }
  };

  const fetchWater = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("water_logs").select("amount_ml").eq("user_id", user.id).eq("log_date", today);
    if (error) {
      toast({ title: "Couldn't load water log", description: error.message, variant: "destructive" });
      return;
    }
    setWaterMl((data || []).reduce((sum, r) => sum + r.amount_ml, 0));
  };

  const fetchMeals = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("meal_logs").select("*").eq("user_id", user.id).eq("log_date", today).order("logged_at", { ascending: true });
    if (error) {
      toast({ title: "Couldn't load meals", description: error.message, variant: "destructive" });
      return;
    }
    setMeals(data || []);
  };

  const fetchPlans = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("nutrition_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Couldn't load nutrition plans", description: error.message, variant: "destructive" });
      return;
    }
    setPlans(data || []);
  };

  const addWater = async () => {
    if (!user) return;
    // A water entry is a measured pour: whole millilitres, more than nothing,
    // and no more than a large bottle at once. Zero, negative, fractional
    // and excessive entries are rejected rather than stored — the same rule
    // the meal fields keep via the numeric-bounds constraint.
    const ml = Number(addAmount);
    if (!Number.isInteger(ml) || ml < 1 || ml > 5000) {
      toast({ title: "Enter 1–5000 ml", description: "That amount cannot be logged as a drink of water.", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("water_logs").insert({ user_id: user.id, amount_ml: ml, log_date: today });
    if (error) { toast({ title: "Couldn't log water", description: error.message, variant: "destructive" }); return; }
    fetchWater();
    toast({ title: `+${ml}ml 💧` });
  };

  const saveWaterGoal = async () => {
    if (!user) return;
    // A daily goal of zero (or less) would make the progress bar divide by
    // nothing and tell the athlete they are done before drinking anything.
    const goal = Number(newWaterGoal);
    if (!Number.isInteger(goal) || goal < 500 || goal > 10000) {
      toast({ title: "Enter a goal of 500–10000 ml", description: "That goal cannot be saved.", variant: "destructive" });
      return;
    }
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

  /**
   * The last week of the log, as text for the model.
   *
   * A readable per-day digest rather than raw rows or JSON: the prompt reads a
   * list of days, and a compact digest is both cheaper and harder to misread
   * than a table. Capped at 3,000 characters because the server caps `summary`
   * at 4,000 — and days are appended oldest first, so if anything is ever
   * dropped it is the oldest day, never today's.
   */
  const buildFoodLogDigest = async (): Promise<{ digest: string; mealCount: number; daysLogged: number }> => {
    if (!user) return { digest: "", mealCount: 0, daysLogged: 0 };
    const since = localDateKey(new Date(Date.now() - (REVIEW_WINDOW_DAYS - 1) * 86_400_000));
    const { data, error } = await supabase
      .from("meal_logs")
      .select("log_date, meal_type, name, calories, protein_g, carbs_g, fat_g")
      .eq("user_id", user.id)
      .gte("log_date", since)
      .order("log_date", { ascending: true })
      .order("logged_at", { ascending: true });
    if (error) throw new Error(`Couldn't load your food log: ${error.message}`);

    const rows = data ?? [];
    const byDay = new Map<string, typeof rows>();
    for (const row of rows) {
      const day = String(row.log_date);
      const list = byDay.get(day) ?? [];
      list.push(row);
      byDay.set(day, list);
    }

    const lines: string[] = [];
    for (const [day, meals] of byDay) {
      const total = meals.reduce(
        (acc, meal) => ({
          kcal: acc.kcal + (meal.calories ?? 0),
          protein: acc.protein + (meal.protein_g ?? 0),
          carbs: acc.carbs + (meal.carbs_g ?? 0),
          fat: acc.fat + (meal.fat_g ?? 0),
        }),
        { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      );
      lines.push(
        `${day} — about ${Math.round(total.kcal)} kcal, ${Math.round(total.protein)}g protein, ${Math.round(total.carbs)}g carbs, ${Math.round(total.fat)}g fat`,
      );
      for (const meal of meals) {
        lines.push(
          `  ${meal.meal_type ?? "meal"}: ${meal.name}${meal.calories ? ` (${meal.calories} kcal${meal.protein_g ? `, ${meal.protein_g}g protein` : ""})` : ""}`,
        );
      }
    }

    let digest = lines.join("\n");
    if (digest.length > 3000) digest = `${digest.slice(0, 3000)}\n… (log truncated)`;
    return { digest, mealCount: rows.length, daysLogged: byDay.size };
  };

  /**
   * Ask the AI to read the log against the athlete's training.
   *
   * An empty log is refused BEFORE the call, so a review of nothing costs
   * nothing: the one thing this must never do is invent a week of food and
   * charge for the invention.
   */
  const runFoodReview = async () => {
    if (!user || !profile) return;
    if (!canReviewFood) {
      toast({ title: "Age restriction", description: REVIEW_REFUSAL, variant: "destructive" });
      return;
    }
    setReviewing(true);
    setFoodReview(null);
    try {
      const log = await buildFoodLogDigest();
      if (log.mealCount === 0) {
        toast({
          title: "Nothing to review yet",
          description: "Log or scan a few meals first — a review of an empty log would be invented. Nothing was charged.",
          variant: "destructive",
        });
        return;
      }
      // Nutrition is a standard tab: the server charges nutrition_review per
      // use and refunds on failure. Nothing is charged or priced here.
      const { data, error } = await supabase.functions.invoke("ai-analyze", {
        body: {
          type: "nutrition_review",
          summary: log.digest,
          userLocale: getAiLocale(),
          pbs: getLocalPBs().slice(0, 20).map((p) => ({ metric: p.metric, value: p.value, unit: p.unit, date: p.date })),
        },
      });
      if (error) throw new Error(await edgeErrorMessage(error));
      const payload = (data ?? {}) as { result?: string; cost?: number };
      let parsed: FoodReview | null = null;
      try {
        parsed = JSON.parse(payload.result ?? "") as FoodReview;
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== "object") {
        // Answered, but not in a shape the screen can show. Say that rather
        // than rendering an empty card over a charge.
        toast({
          title: "The review came back unreadable",
          description: "Nothing was shown because the answer could not be read. Try again.",
          variant: "destructive",
        });
        return;
      }
      setFoodReview(parsed);
      toast({
        title: "Food review ready",
        description: payload.cost ? `${payload.cost} credits used.` : "Included with Unlimited.",
      });
      await refreshProfile();
    } catch (err) {
      toast({ title: "Review failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setReviewing(false);
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
    setScanEdits(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-analyze", {
        body: { type: "calorie_scan", image_base64: base64, userLocale: getAiLocale(), pbs: getLocalPBs().slice(0, 20).map((p) => ({ metric: p.metric, value: p.value, unit: p.unit, date: p.date })) },
      });
      if (error) throw new Error(await edgeErrorMessage(error));
      const payload = (data ?? {}) as { result?: string; cost?: number; balance?: number | null };
      let parsed: NonNullable<typeof scanResult>;
      try {
        parsed = JSON.parse(payload.result ?? "");
      } catch {
        parsed = null as unknown as NonNullable<typeof scanResult>;
      }
      // The old code invented a meal here (300 kcal, 15g protein…) when the
      // answer could not be read — a confident-looking lie logged as food.
      // An unreadable answer is a failed scan: the server has already refunded
      // the charge, and the athlete retries with the photo still on screen.
      const num = (v: unknown): number | undefined => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : undefined;
      };
      const calories = num(parsed?.calories);
      if (!parsed || typeof parsed !== "object" || calories === undefined) {
        throw new Error("The scan came back unreadable — nothing was logged and the cost was refunded. Try a clearer, closer photo.");
      }
      const clean: NonNullable<typeof scanResult> = {
        name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim().slice(0, 80) : "Scanned meal",
        description: typeof parsed.description === "string" ? parsed.description.slice(0, 400) : undefined,
        calories,
        protein: num(parsed.protein),
        carbs: num(parsed.carbs),
        fat: num(parsed.fat),
        fiber: num((parsed as { fiber?: unknown }).fiber),
        serving: typeof (parsed as { serving?: unknown }).serving === "string"
          ? ((parsed as { serving?: string }).serving ?? "").slice(0, 60) || undefined
          : undefined,
        confidence: (parsed as { confidence?: unknown }).confidence === "high" || (parsed as { confidence?: unknown }).confidence === "low"
          ? (parsed as { confidence?: "low" | "high" }).confidence
          : "medium",
        verdict: parsed.verdict === "fuel" || parsed.verdict === "light" || parsed.verdict === "treat" ? parsed.verdict : undefined,
        verdict_reason: typeof parsed.verdict_reason === "string" ? parsed.verdict_reason.slice(0, 200) : undefined,
      };
      setScanResult(clean);
      setScanEdits({
        name: clean.name,
        calories: String(clean.calories),
        protein: clean.protein !== undefined ? String(clean.protein) : "",
        carbs: clean.carbs !== undefined ? String(clean.carbs) : "",
        fat: clean.fat !== undefined ? String(clean.fat) : "",
      });
      toast({ title: "Scan complete! 📸", description: payload.cost ? `${payload.cost} credits used.` : "Included with Unlimited." });
      await refreshProfile();
    } catch (err) {
      toast({ title: "Scan failed", description: (err as Error).message, variant: "destructive" });
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

  /**
   * Native "choose from my photos". Same age gate and same scan path as the
   * camera route: the picker is reachable on its own, so the check cannot live
   * only on the button that opens it.
   */
  const scanFromLibrary = async () => {
    if (!user || !profile) return;
    if (!canScanCalories) {
      toast({ title: "Age restriction", description: CALORIE_SCAN_REFUSAL, variant: "destructive" });
      return;
    }
    const picked = await pickPhoto();
    if (!picked) return; // cancelled
    setScanPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return picked.previewUrl;
    });
    hapticImpact("light");
    await runScan(picked.base64);
  };

  const onScanPhoto = () => {
    if (isNative()) void scanFromCamera();
    else fileInputRef.current?.click();
  };

  /** Upload / choose an existing photo — the camera is never opened from here. */
  const onScanUpload = () => {
    if (isNative()) void scanFromLibrary();
    else galleryInputRef.current?.click();
  };

  const addScanResult = async () => {
    if (!user || !scanResult) return;
    // What is logged is what the athlete sees in the fields above — the
    // estimate prefilled them, but a correction here is what lands in the log.
    const edits = scanEdits ?? {
      name: scanResult.name || "Scanned meal",
      calories: scanResult.calories !== undefined ? String(scanResult.calories) : "",
      protein: scanResult.protein !== undefined ? String(scanResult.protein) : "",
      carbs: scanResult.carbs !== undefined ? String(scanResult.carbs) : "",
      fat: scanResult.fat !== undefined ? String(scanResult.fat) : "",
    };
    const toNum = (v: string): number | null => {
      const n = Number(v);
      return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
    };
    const { error } = await supabase.from("meal_logs").insert({
      user_id: user.id, name: edits.name.trim().slice(0, 80) || "Scanned meal", calories: toNum(edits.calories),
      protein_g: toNum(edits.protein), carbs_g: toNum(edits.carbs), fat_g: toNum(edits.fat),
      meal_type: "meal", log_date: today,
    });
    if (error) { toast({ title: "Couldn't save the scanned meal", description: error.message, variant: "destructive" }); return; }
    setScanResult(null); setScanEdits(null); setShowScan(false);
    setScanPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setNutriTab("today");
    fetchMeals();
    toast({ title: "Scanned meal logged!" });
  };

  /**
   * The paid, AI-written plan.
   *
   * The order matters, and it is not the old order. The server charges
   * `nutrition_plan_week` per week and refunds on every failure path, so
   * nothing is charged from here and nothing is saved before the provider call
   * comes back: an athlete who is short of credits, or whose plan cannot be
   * written, ends up with exactly what they had. The questionnaire answers go
   * to user_settings first, because they belong to the athlete whether or not
   * the plan gets written.
   */
  /**
   * Save the one fact that decides whether a plan is allowed at all.
   *
   * A nutrition plan needs an adult age, and `profiles.date_of_birth` is
   * optional — which left every account without one (all but one of them, in
   * practice) unable to build a plan, with the refusal pointing at a Profile
   * screen it did not link to. The date can be given here instead, validated by
   * the same helper the field uses, and it lands in the same column Profile
   * writes: one fact, one place to find it.
   *
   * The 18+ rule itself is untouched, and the server applies it again.
   */
  const saveDob = async (dob: string): Promise<string | null> => {
    if (!user) return "You are not signed in.";
    const problem = validateDob(dob);
    if (problem) return problem;
    setSavingDob(true);
    try {
      const { error } = await supabase.from("profiles").update({ date_of_birth: dob }).eq("user_id", user.id);
      if (error) return error.message;
      // refreshProfile is what re-renders the wizard with a real age: the
      // recommendation panel and the button both read it, so the form answers
      // the question it just asked instead of asking it twice.
      await refreshProfile();
      toast({ title: "Date of birth saved", description: "The plan can be written now." });
      return null;
    } finally {
      setSavingDob(false);
    }
  };

  const submitPlan = async (draft: PlanDraft) => {
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

    const { intake, targets, title } = draft;
    const weeks = Math.max(1, Math.min(12, intake.weeks));
    setWritingPlan(true);
    setPlanWaitHidden(false);
    setPlanWaitWeeks(weeks);

    try {
      const { error: intakeError } = await supabase.from("user_settings").upsert({
        user_id: user.id,
        dietary_pattern: intake.dietaryPattern,
        food_dislikes: intake.foodDislikes.trim().slice(0, 300) || null,
        meals_per_day: intake.mealsPerDay,
        training_days_per_week: intake.trainingDaysPerWeek,
        typical_session_minutes: intake.sessionMinutes,
        activity_level: intake.activityLevel,
        sex: intake.sex,
      }, { onConflict: "user_id" });
      if (intakeError) console.warn("nutrition intake not saved:", intakeError.message);

      const projected = targetsForRequest(targets);
      const { data, error } = await supabase.functions.invoke("generate-nutrition-plan", {
        body: {
          // The function validates this spelling, lowercase.
          goal: intake.goal.toLowerCase(),
          weeks,
          sport: profile.sport ?? "",
          level: profile.experience_level ?? "intermediate",
          notes: buildPlanNotes(intake),
          userLocale: getAiLocale(),
          request_id: newNutritionPlanRequestId(),
          calories_target: projected.calories,
          protein_target: projected.protein,
          carbs_target: projected.carbs,
          fat_target: projected.fat,
        },
      });

      if (error) {
        const message = await edgeErrorMessage(error);
        const status = (error as { context?: { status?: number } })?.context?.status ?? 0;
        if (status === 402) {
          // Charge failure = purchase opportunity. Not a credit was spent, so
          // after a top-up the same button can be pressed again.
          const short = await shortfallFromEdgeError(error);
          if (short) {
            const outcome = await requestCreditTopUp({ shortfall: short.shortfall, reasonLabel: "Nutrition plan" });
            if (outcome.purchased) {
              toast({ title: "Credits added — tap Write my plan again." });
              return;
            }
          }
        }
        toast({ title: "Couldn't write your plan", description: message, variant: "destructive" });
        return;
      }

      const payload = (data ?? {}) as { plan?: unknown; cost?: number };
      const parsed = parseGeneratedPlan(payload.plan);
      if (!parsed.plan) {
        // Charged but unreadable. The server refunds a failed call; an answer we
        // cannot read is reported here rather than stored as an empty plan.
        toast({
          title: "The plan could not be read",
          description: parsed.error || "Nothing was saved. Try again — a failed call is refunded.",
          variant: "destructive",
        });
        return;
      }

      const row = {
        user_id: user.id,
        title: title || `${intake.goal} plan · ${weeks} week${weeks === 1 ? "" : "s"}`,
        goal: intake.goal,
        calories_target: targets.calories,
        protein_target: targets.protein_g,
        carbs_target: targets.carbs_g,
        fat_target: targets.fat_g,
        weeks,
        plan_data: parsed.plan.weeks as unknown as Json,
      };
      // One retry, then the honest failure. The plan exists and was paid for, so
      // a transient write is the one case worth a second attempt — but it must
      // never be GENERATED again, because that would charge a second time.
      let { error: insertError } = await supabase.from("nutrition_plans").insert(row);
      if (insertError) {
        ({ error: insertError } = await supabase.from("nutrition_plans").insert(row));
      }
      if (insertError) {
        toast({
          title: "Your plan was written but not saved",
          description: `Do not generate it again — that would charge you a second time. Contact support from Profile if this persists. ${insertError.message}`,
          variant: "destructive",
        });
        return;
      }

      await refreshProfile();
      fetchPlans();
      setShowCreatePlan(false);
      toast({
        title: "Your plan is ready 🥗",
        description: payload.cost
          ? `${payload.cost} credits used · ${parsed.plan.weeks.length} weeks.`
          : "Included with Unlimited.",
      });
    } finally {
      setWritingPlan(false);
    }
  };

  const totalCalories = meals.reduce((s, m) => s + (m.calories || 0), 0);
  const totalProtein = meals.reduce((s, m) => s + (m.protein_g || 0), 0);
  const totalCarbs = meals.reduce((s, m) => s + (m.carbs_g || 0), 0);
  const totalFat = meals.reduce((s, m) => s + (m.fat_g || 0), 0);
  const inputClass = "w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-electric-purple/50 transition-all duration-300";
  const waterQuickAmounts = [50, 100, 150, 200, 250, 330, 500];

  // Read at open time rather than at mount, so the profile's own numbers are
  // used if they exist by then, and a saved answer still wins over them.
  const profileFacts = profile as { weight_kg?: number | null; height_cm?: number | null; goals?: unknown } | null;
  const intakeInitial = prefillIntake({
    weightKg: typeof profileFacts?.weight_kg === "number" ? profileFacts.weight_kg : null,
    heightCm: typeof profileFacts?.height_cm === "number" ? profileFacts.height_cm : null,
    goals: String(profileFacts?.goals ?? ""),
    saved: planIntake,
  });

  return (
    <div className="min-h-screen bg-background">
      {writingPlan && !planWaitHidden && (
        <PlanGenerationProgress weeks={planWaitWeeks} kind="nutrition" onHide={() => setPlanWaitHidden(true)} />
      )}
      {writingPlan && planWaitHidden && (
        <div className="px-5 pt-[var(--vaylo-screen-top)]">
          <PlanGenerationProgress weeks={planWaitWeeks} kind="nutrition" variant="inline" />
        </div>
      )}
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Nutrition</motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">Fuel your performance.</motion.p>
      </div>

      {/* One job per tab. 44px floors, one active pill — the same segmented
          control shape the rest of the app uses for two-option switches. */}
      <div className="px-5" role="tablist" aria-label="Nutrition sections">
        <div className="grid grid-cols-4 gap-1 rounded-2xl border border-border bg-card p-1">
          {([
            ["today", "Today"],
            ["scan", "Scan"],
            ["plans", "Plans"],
            ["review", "Review"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={nutriTab === id}
              onClick={() => { setNutriTab(id); if (id === "scan") setShowScan(true); }}
              className={`min-h-[44px] rounded-xl text-sm font-semibold transition-colors ${
                nutriTab === id ? "bg-gradient-primary text-primary-foreground shadow-glow" : "text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Under-18 refusal, stated once above the tabs rather than only in a
          toast after a tap. */}
      {!isAdultDob(profile?.date_of_birth) && (
        <div className="px-5">
          <p className="text-xs text-muted-foreground flex items-start gap-1 mt-3 mb-1">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
            <span>{disclaimerShort("minor")}</span>
          </p>
        </div>
      )}

      {nutriTab === "today" && (
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="px-5 pt-4">
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

        {/* Log Meal */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Today's meals</h3>
          <button onClick={() => setShowAddMeal(!showAddMeal)} className="text-xs text-electric-purple font-semibold min-h-[44px] px-2"><Plus size={14} className="inline" /> Add meal</button>
        </div>

        {showAddMeal && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-2xl p-4 space-y-3 mb-4">
            <input type="text" placeholder="Meal name *" value={mealName} onChange={e => setMealName(e.target.value)} className={inputClass} />
            <div className="flex gap-1.5 flex-wrap">
              {["breakfast", "lunch", "dinner", "snack", "pre-workout", "post-workout"].map(t => (
                <button key={t} onClick={() => setMealType(t)} className={`px-2 py-1.5 min-h-[36px] text-[12px] capitalize ${mealType === t ? "bg-electric-purple/15 border-electric-purple text-electric-purple" : "bg-card border-border text-foreground"} rounded-lg border`}>{t}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" placeholder="Calories" value={mealCalories} onChange={e => setMealCalories(e.target.value)} className={inputClass} />
              <input type="number" placeholder="Protein (g)" value={mealProtein} onChange={e => setMealProtein(e.target.value)} className={inputClass} />
              <input type="number" placeholder="Carbs (g)" value={mealCarbs} onChange={e => setMealCarbs(e.target.value)} className={inputClass} />
              <input type="number" placeholder="Fat (g)" value={mealFat} onChange={e => setMealFat(e.target.value)} className={inputClass} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAddMeal(false)} className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground min-h-[44px]">Cancel</button>
              <motion.button onClick={addMeal} disabled={!mealName.trim() || saving} whileTap={{ scale: 0.98 }}
                className="flex-1 bg-gradient-primary text-primary-foreground font-semibold py-2.5 rounded-xl disabled:opacity-40 shadow-glow min-h-[44px]">Log meal</motion.button>
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
              <button onClick={() => deleteMeal(meal.id, meal.name)} aria-label={`Delete meal: ${meal.name}`} disabled={deleting} className="text-muted-foreground hover:text-destructive min-h-[44px] min-w-[44px] flex items-center justify-center"><Trash2 size={14} aria-hidden /></button>
            </motion.div>
          ))}
          {meals.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No meals logged today.</p>}
        </div>

        {/* Shortcuts into the other tabs, so Today stays a summary rather than
            growing its buttons back. */}
        <div className="flex gap-2 mb-8">
          <button onClick={() => { if (!canScanCalories) { toast({ title: "Age restriction", description: CALORIE_SCAN_REFUSAL, variant: "destructive" }); return; } setNutriTab("scan"); setShowScan(true); }} className="flex-1 flex items-center justify-center gap-2 bg-card border border-border font-semibold py-3 rounded-xl min-h-[48px] text-sm">
            <Camera size={16} /> Scan a meal
          </button>
          <button onClick={() => setNutriTab("review")} className="flex-1 flex items-center justify-center gap-2 bg-card border border-border font-semibold py-3 rounded-xl min-h-[48px] text-sm">
            <UtensilsCrossed size={16} /> Review my week
          </button>
        </div>
      </motion.div>
      )}

      {nutriTab === "review" && (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="px-5 pt-4">
        {/* AI food review. A reading of the week's log against the training the
            athlete is actually doing — not a diet plan, and deliberately not a
            target to hit. The disclaimer is the same one the plan carries. */}
        <div className="bg-card border border-border rounded-2xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-1.5">
            <UtensilsCrossed size={16} className="text-electric-glow" />
            <span className="text-sm font-semibold">Review my food</span>
            <span className="ml-auto rounded-full border border-electric-purple/40 bg-electric-purple/10 px-2 py-0.5 text-[11px] font-semibold text-electric-purple">
              {creditCost("nutrition_review")} credits
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            An AI read of the last {REVIEW_WINDOW_DAYS} days of your log against the training you are
            doing: whether you are eating enough for it, protein and fuel around sessions, and a few
            ordinary food suggestions — with what is already working said first.
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground/80 mt-1">
            {disclaimerShort("nutrition")}
          </p>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              if (!canReviewFood) {
                toast({ title: "Age restriction", description: REVIEW_REFUSAL, variant: "destructive" });
                return;
              }
              void runFoodReview();
            }}
            disabled={reviewing}
            aria-disabled={!canReviewFood}
            className={`mt-3 w-full flex items-center justify-center gap-2 font-semibold py-2.5 rounded-xl disabled:opacity-60 ${
              canReviewFood ? "bg-gradient-primary text-primary-foreground shadow-glow" : "bg-muted text-muted-foreground"
            }`}
          >
            {reviewing ? <Loader2 size={16} className="animate-spin" /> : <UtensilsCrossed size={16} />}
            {reviewing ? "Reading your log…" : `Review my food (${creditCost("nutrition_review")} credits)`}
          </motion.button>

          {foodReview && (
            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
              className="mt-3 rounded-xl border border-electric-purple/20 bg-gradient-card p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{foodReview.headline ?? "Your review"}</p>
                {foodReview.verdict && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    foodReview.verdict === "good" ? "bg-emerald-500/10 text-emerald-300"
                    : foodReview.verdict === "thin" ? "bg-amber-500/10 text-amber-300"
                    : "bg-muted text-muted-foreground"
                  }`}>
                    {foodReview.verdict === "good" ? "Eating enough" : foodReview.verdict === "thin" ? "Looks light" : "Not enough logged"}
                  </span>
                )}
              </div>
              {[foodReview.fuel, foodReview.protein, foodReview.around_training]
                .filter((line): line is string => !!line)
                .map((line, i) => (
                  <p key={i} className="text-xs text-muted-foreground mt-2 leading-relaxed">{line}</p>
                ))}
              {(foodReview.what_works?.length ?? 0) > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] uppercase tracking-wider text-emerald-300 font-semibold">Going well</p>
                  <ul className="mt-1 space-y-0.5">
                    {foodReview.what_works?.map((item, i) => (
                      <li key={i} className="text-xs text-muted-foreground leading-relaxed">• {item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(foodReview.suggestions?.length ?? 0) > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] uppercase tracking-wider text-electric-purple font-semibold">A few suggestions</p>
                  <ul className="mt-1 space-y-0.5">
                    {foodReview.suggestions?.map((item, i) => (
                      <li key={i} className="text-xs text-foreground leading-relaxed">• {item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {foodReview.limits && (
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80">{foodReview.limits}</p>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>
      )}

      {nutriTab === "scan" && (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="px-5 pt-4">
        {/* Scan UI with image upload. The tab itself opens the panel (see the
            tab bar), so there is no separate collapsed state to discover. */}
        {showScan && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-electric-purple/20 rounded-2xl p-4 space-y-3 mb-5">
            <div className="flex items-center justify-between"><h3 className="font-display font-bold text-sm">📸 Scan food</h3><button onClick={() => { setShowScan(false); setScanResult(null); setScanEdits(null); setScanPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; }); }} className="text-muted-foreground" aria-label="Close scan"><X size={16} aria-hidden /></button></div>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">1.</span> Photograph the plate · <span className="font-semibold text-foreground">2.</span> check the estimate · <span className="font-semibold text-foreground">3.</span> log it. Each scan costs {creditCost("calorie_scan")} credits; a failed scan is refunded automatically.
            </p>
            {/* Camera: `capture` asks the device for the camera. */}
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleScanImage} className="hidden" />
            {/* Upload: no `capture`, so this is the gallery / file picker. */}
            <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleScanImage} className="hidden" />
            
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
                <motion.button onClick={onScanUpload} whileTap={{ scale: 0.98 }}
                  className="bg-card border border-border px-4 py-2.5 rounded-xl flex items-center gap-2 hover:border-electric-purple/20">
                  <Upload size={16} /> {isNative() ? "Choose Photo" : "Upload"}
                </motion.button>
              </div>
            )}

            {scanResult && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="bg-gradient-card border border-electric-purple/20 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h4 className="font-semibold text-sm">{scanResult.name}</h4>
                  {scanResult.confidence && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      scanResult.confidence === "high" ? "bg-emerald-500/10 text-emerald-300"
                      : scanResult.confidence === "low" ? "bg-amber-500/10 text-amber-300"
                      : "bg-muted text-muted-foreground"
                    }`}>
                      {scanResult.confidence === "high" ? "Confident estimate" : scanResult.confidence === "low" ? "Rough estimate — check it" : "Fair estimate"}
                    </span>
                  )}
                </div>
                {scanResult.description && <p className="text-xs text-muted-foreground mb-1">{scanResult.description}</p>}
                {(scanResult.serving !== undefined || scanResult.fiber !== undefined) && (
                  <p className="text-[11px] text-muted-foreground mb-2">
                    {[scanResult.serving ? `Portion ~${scanResult.serving}` : null, scanResult.fiber !== undefined ? `Fibre ${scanResult.fiber}g` : null].filter(Boolean).join(" · ")}
                  </p>
                )}
                {scanResult.verdict && (
                  <div className={`mb-3 rounded-xl px-3 py-2 text-xs leading-relaxed ${
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
                {/* The estimate is a starting point, not a verdict: a photo cannot
                    weigh the plate. Whatever stands here is what gets logged. */}
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Check before you log</p>
                <div className="space-y-2 mb-3">
                  <input
                    aria-label="Meal name"
                    value={scanEdits?.name ?? ""}
                    onChange={(e) => setScanEdits((prev) => ({ ...(prev ?? { name: "", calories: "", protein: "", carbs: "", fat: "" }), name: e.target.value }))}
                    className={inputClass}
                  />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {([
                      ["calories", "Calories"],
                      ["protein", "Protein (g)"],
                      ["carbs", "Carbs (g)"],
                      ["fat", "Fat (g)"],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="block">
                        <span className="mb-0.5 block text-[11px] text-muted-foreground">{label}</span>
                        <input
                          type="number" min={0} inputMode="decimal"
                          aria-label={label}
                          value={scanEdits?.[key] ?? ""}
                          onChange={(e) => setScanEdits((prev) => ({ ...(prev ?? { name: "", calories: "", protein: "", carbs: "", fat: "" }), [key]: e.target.value }))}
                          className={inputClass}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <motion.button onClick={addScanResult} whileTap={{ scale: 0.98 }} className="w-full bg-electric-purple/10 text-electric-purple font-semibold py-2.5 rounded-xl text-sm min-h-[44px]">Log this meal</motion.button>
              </motion.div>
            )}
          </motion.div>
        )}
        {!showScan && !scanResult && !scanning && (
          <button onClick={() => setShowScan(true)} className="w-full mt-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow min-h-[48px] text-sm">
            <Camera size={16} /> Scan a meal ({creditCost("calorie_scan")} credits)
          </button>
        )}
      </motion.div>
      )}

      {nutriTab === "plans" && (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="px-5 pt-4">
        {/* Build a plan: the questionnaire asks what decides an intake, and the
            recommendation panel answers the target question itself. */}
        {!showCreatePlan && plans.length === 0 && (
          <div className="bg-gradient-card border border-electric-purple/20 rounded-2xl p-5 mb-4 text-center">
            <FileText size={22} className="mx-auto text-electric-purple" />
            <h3 className="font-display font-bold mt-2">Eat for your training</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              A week-by-week plan built around your goal, training days and foods you avoid — {creditCost("nutrition_plan_week")} credits per week.
            </p>
            <motion.button whileTap={{ scale: 0.98 }} onClick={() => setShowCreatePlan(true)}
              className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow min-h-[48px] text-sm">
              Build my plan
            </motion.button>
          </div>
        )}
        {!showCreatePlan && plans.length > 0 && (
          <button onClick={() => setShowCreatePlan(true)} className="w-full mb-4 flex items-center justify-center gap-2 bg-card border border-border font-semibold py-3 rounded-xl min-h-[48px] text-sm">
            <Plus size={16} /> Build another plan ({creditCost("nutrition_plan_week")}/wk)
          </button>
        )}
        {showCreatePlan && (
          <NutritionPlanWizard
            initial={intakeInitial}
            age={getAge()}
            onSaveDob={saveDob}
            savingDob={savingDob}
            costPerWeek={creditCost("nutrition_plan_week")}
            busy={writingPlan}
            onSubmit={submitPlan}
            onClose={() => setShowCreatePlan(false)}
          />
        )}

        {/* Nutrition Plans */}
        {plans.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Your plans</h3>
            <div className="space-y-2">
              {plans.map((plan, i) => (
                <motion.div key={plan.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
                  className="bg-card border border-border rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold truncate">{plan.title}</h4>
                      <p className="text-[12px] text-muted-foreground">{plan.goal} · {plan.weeks}w · {plan.calories_target} kcal · {plan.protein_target}g P</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {plan.active && <span className="text-[12px] bg-electric-purple/10 text-electric-purple px-2 py-0.5 rounded-full font-semibold">Active</span>}
                      {/* The plan itself, not just the receipt for it. */}
                      <button
                        type="button"
                        onClick={() => setOpenPlanId(openPlanId === plan.id ? null : plan.id)}
                        aria-expanded={openPlanId === plan.id}
                        className="text-xs font-semibold text-electric-purple"
                      >
                        {openPlanId === plan.id ? "Hide" : "View plan"}
                      </button>
                    </div>
                  </div>
                  {openPlanId === plan.id && <SavedNutritionPlan plan={plan} />}
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
      )}
    </div>
  );
};

export default Nutrition;
