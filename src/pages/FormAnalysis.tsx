import { getAiLocale } from "@/i18n";
import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { ScanLine, Lock, ChevronRight, ChevronDown, Dumbbell, Eye, Target, RotateCcw, Footprints, Bike, PersonStanding, Camera, Upload, Loader2, Video, Sparkles, type LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { getLocalPBs } from "@/lib/athleteDossier";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { creditCost } from "@/lib/credits";
import { DISCLAIMERS } from "@/config/disclaimers";
import { useUnlockFeature } from "@/hooks/useUnlockFeature";
import { capturePhoto, pickPhoto } from "@/lib/camera";
import { isNative } from "@/lib/platform";
import { hapticImpact } from "@/lib/haptics";

// ============================================================================
// FORM — the free drill library, and the paid AI half of the screen
// ----------------------------------------------------------------------------
// The screen used to open with two paid cards (video analysis, then the locked
// photo analysis) and push the free drills below the fold, so an athlete
// without the unlock landed on what looked like a paywall and left. The drills
// are the part of this screen that works for everybody, so they now lead when
// the unlock is missing, and the one unlock CTA sits below them.
//
// Every drill carries three things: how to do it, what to do (a prescription),
// and the cues to hold in your head. A drill that is only a list of cues is a
// definition, not something an athlete can run on a Tuesday.
// ============================================================================

type Drill = {
  icon: LucideIcon;
  title: string;
  desc: string;
  /** How to do it — the sequence, short enough to read at the gym. */
  how: string[];
  /** Sets/reps or duration — what to actually do. */
  prescription: string;
  cues: string[];
};

type DrillCategory = { category: string; drills: Drill[] };

const drillCategories: DrillCategory[] = [
  {
    category: "Gym & Strength",
    drills: [
      {
        icon: Dumbbell, title: "Squat Form Check", desc: "Depth, bracing and knee tracking",
        prescription: "3-5 sets x 3-5 reps @ RPE 6-7, filmed from the side",
        how: [
          "Set the phone level with your hip, about 2m away, side-on.",
          "Warm up, then film your working sets — not your first empty-bar set.",
          "Watch the hips and knees pass the same height on every rep.",
        ],
        cues: ["Feet shoulder-width apart", "Brace your core", "Sit back into hips", "Knees track over toes", "Break parallel depth", "Drive through heels"],
      },
      {
        icon: Target, title: "Deadlift Setup", desc: "Hip hinge and bar path",
        prescription: "4-6 sets x 2-4 reps @ RPE 6-8, reset every rep",
        how: [
          "Film side-on at hip height so the bar path is visible.",
          "Reset your setup from the floor on every rep — no touch-and-go.",
          "Check that the bar travels vertically over the mid-foot.",
        ],
        cues: ["Bar over mid-foot", "Shoulders over bar", "Neutral spine", "Engage lats", "Push floor away", "Lockout hips"],
      },
      {
        icon: RotateCcw, title: "Push-Up Mechanics", desc: "Full range with shoulder alignment",
        prescription: "3-4 sets x 6-12 reps, tempo 3s down / 1s up",
        how: [
          "Film from the side at floor level — that angle shows the elbow and hip line.",
          "Lower for three seconds, pause for one, press up.",
          "Stop the set when the hips sag or the head leads.",
        ],
        cues: ["Hands under shoulders", "Elbows at 45°", "Core tight throughout", "Full lockout at top", "Chest to floor", "Scapulae protracted at top"],
      },
      {
        icon: Dumbbell, title: "Overhead Press", desc: "Pressing mechanics and bracing",
        prescription: "4 sets x 5-8 reps @ RPE 7, no leg drive",
        how: [
          "Film front-on to catch a bar drifting forward or a side leaning away.",
          "Brace glutes and core before the first rep, not during it.",
          "Finish each rep with the bar over the mid-foot, head through.",
        ],
        cues: ["Grip just outside shoulders", "Brace core and glutes", "Press in a slight arc", "Full lockout overhead", "Head through at top", "Control the descent"],
      },
      {
        icon: Dumbbell, title: "Barbell Row", desc: "Back engagement and pull pattern",
        prescription: "4 sets x 6-10 reps @ RPE 7, torso still",
        how: [
          "Film side-on: the torso angle should not change through the set.",
          "Pull to the lower chest, then lower under control for two seconds.",
          "If the torso rises on the last reps, the weight is too heavy.",
        ],
        cues: ["Hip hinge position", "Bar under shoulders", "Pull to lower chest", "Squeeze shoulder blades", "Control eccentric", "Neutral wrist position"],
      },
      {
        icon: Dumbbell, title: "Split Squat", desc: "Single-leg strength and balance",
        prescription: "3 sets x 8-10 each side @ RPE 6-7",
        how: [
          "Step into a long stance — front knee over the mid-foot at the bottom.",
          "Lower straight down rather than drifting forward.",
          "Film front-on to see the hip drop on the working side.",
        ],
        cues: ["Long stance, feet hip-width", "Torso tall, slight forward lean", "Front knee tracks over toes", "Back knee lowers under hip", "Push through the whole front foot", "Balance comes before load"],
      },
      {
        icon: Target, title: "Hip Hinge / Romanian Deadlift", desc: "Hamstring loading without the lower back",
        prescription: "3 sets x 8-10 @ RPE 6-7, 3s lowering",
        how: [
          "Stand tall, soft knees, then push the hips back — not the chest down.",
          "Stop where the hamstrings tighten, before the back rounds.",
          "Film side-on with the bar or hands tracking the shins.",
        ],
        cues: ["Push hips back, not down", "Bar close to the legs", "Neutral spine throughout", "Stop at hamstring tension", "Drive hips forward to stand", "Chin tucked, ribs down"],
      },
      {
        icon: PersonStanding, title: "Plank & Side Plank", desc: "Trunk stiffness that transfers",
        prescription: "3 x 30-45 sec front, 3 x 20-30 sec each side",
        how: [
          "Film from the side at floor level to check the hip line.",
          "Squeeze glutes and brace as if taking a light punch.",
          "Stop the hold the moment the hips sag or pike — a long bad hold trains a bad position.",
        ],
        cues: ["Elbows under shoulders", "Ribs down, glutes squeezed", "One straight line heel to head", "Breathe behind the brace", "Side plank: hips stacked and lifted", "Push the floor away"],
      },
    ],
  },
  {
    category: "Running & Athletics",
    drills: [
      {
        icon: Eye, title: "Running Gait Analysis", desc: "Foot strike, cadence and posture",
        prescription: "Film 20-30 sec at easy, then at 5k pace",
        how: [
          "Film from the side at 10-15m, then once from behind.",
          "Run at your normal easy pace first — sprinting film flatters everything.",
          "Count steps for 30 seconds and double it for cadence.",
        ],
        cues: ["Land under hips", "180+ steps/min cadence", "Slight forward lean", "Relaxed shoulders", "Arms at 90°", "Mid-foot strike"],
      },
      {
        icon: Footprints, title: "A-Skips", desc: "Knee drive and coordination",
        prescription: "3 x 20m, walk back between sets",
        how: [
          "Drive one knee to waist height, then land under the hip.",
          "Stay tall — the drill is lost the moment you lean back.",
          "Alternate legs each step, arms swinging in time.",
        ],
        cues: ["Drive knee to waist height", "Dorsiflexed ankle", "Stay tall through trunk", "Quick ground contact", "Pump arms in sync", "Land under center of mass"],
      },
      {
        icon: Footprints, title: "B-Skips", desc: "Leg drive and power transfer",
        prescription: "3 x 20m, walk back between sets",
        how: [
          "High knee first, then extend the lower leg out and paw it down.",
          "The foot lands under the body, not out in front.",
          "Keep the rhythm quick — speed comes from turnover, not stride length.",
        ],
        cues: ["High knee then extend", "Paw the ground back", "Active ankle dorsiflexion", "Strong arm drive", "Stay tall, don't lean", "Quick cycle time"],
      },
      {
        icon: Footprints, title: "High Knees", desc: "Fast turnover and knee lift",
        prescription: "4 x 15 sec fast, 45 sec easy jog between",
        how: [
          "Run on the spot or over 10m with knees to hip height.",
          "Stay on the balls of the feet and keep the torso upright.",
          "Stop when the knees start dropping — quality over duration.",
        ],
        cues: ["Drive knees to hip height", "Stay on balls of feet", "Quick ground contact", "Pump arms aggressively", "Keep torso upright", "Maintain rhythm"],
      },
      {
        icon: Footprints, title: "Butt Kicks", desc: "Hamstring recovery speed",
        prescription: "4 x 15 sec, 45 sec easy jog between",
        how: [
          "Flick the heel up to the glute with a quick, light action.",
          "Minimal forward travel — this is a leg-speed drill, not a run.",
          "Stay tall and let the arms move with the legs.",
        ],
        cues: ["Heel to glute", "Stay tall", "Quick cadence", "Minimal forward travel", "Arms relaxed", "Light ground contact"],
      },
      {
        icon: Target, title: "Cadence Drill", desc: "Turnover work with a metronome",
        prescription: "4 x 60 sec at +5% of your normal cadence",
        how: [
          "Warm up, then set a metronome 5% above your usual steps per minute.",
          "Run relaxed for a minute per footstrike — do not lengthen the stride.",
          "Back off the moment your breathing changes; this is a skill drill.",
        ],
        cues: ["Small steps, quick contacts", "Feet land under the hips", "Relaxed shoulders and jaw", "Short ground contact time", "Same pace, higher turnover", "Breathe rhythmically"],
      },
      {
        icon: PersonStanding, title: "Single-Leg Balance & Stability", desc: "Ankle and knee control",
        prescription: "3 x 30 sec each side, eyes closed for the last 10 sec",
        how: [
          "Stand on one leg with a soft knee, hips level.",
          "Add a reach forward and back to the floor once it feels easy.",
          "Progress from barefoot on a firm floor to a folded towel.",
        ],
        cues: ["Hips level", "Soft knee, not locked", "Big toe presses down", "Reach then return under control", "Eyes on a fixed point", "Progress by closing the eyes"],
      },
      {
        icon: RotateCcw, title: "Ankle Mobility", desc: "Dorsiflexion for a deeper, safer squat",
        prescription: "2 x 10 each side, knee-to-wall test before and after",
        how: [
          "Knee-to-wall: keep the heel down and drive the knee to touch the wall.",
          "Measure how far the toes sit from the wall — the gap is your score.",
          "Do the same measurement after the drill; if nothing changed, the drill is wrong.",
        ],
        cues: ["Heel stays down", "Knee tracks over the second toe", "Move from the ankle, not the hip", "No bouncing", "Hold 2 sec at end range", "Re-test, don't guess"],
      },
    ],
  },
  {
    category: "Football & Team Sports",
    drills: [
      {
        icon: Target, title: "Agility Ladder Drills", desc: "Quick feet and coordination",
        prescription: "4-6 patterns x 2 passes, walk-back recovery",
        how: [
          "Lay the ladder out and learn one pattern slowly first.",
          "Increase speed only when every contact lands in the square.",
          "Two passes per pattern: one clean, one fast.",
        ],
        cues: ["Light on your feet", "Stay low in athletic stance", "Arms drive movement", "Eyes up, not down", "Quick in-out pattern", "Maintain rhythm"],
      },
      {
        icon: RotateCcw, title: "Cutting & Change of Direction", desc: "Sharp cuts, safer deceleration",
        prescription: "6 x 5 cuts each side, full recovery between sets",
        how: [
          "Approach at about 70% speed, plant, then accelerate out.",
          "Plant on the outside foot with the hips low — not on a straight leg.",
          "Film front-on to check the knee does not collapse inward.",
        ],
        cues: ["Plant outside foot firmly", "Lower centre of gravity", "Lean into new direction", "Explosive push-off", "Keep eyes on target", "Pre-load the cut"],
      },
      {
        icon: Target, title: "Sprint Starts", desc: "Explosive acceleration from standstill",
        prescription: "6-8 x 10m, 60-90 sec rest",
        how: [
          "Start from a two-point stance with the weight on the front foot.",
          "Stay low for the first three steps, then rise gradually.",
          "Film side-on for the first 10m only.",
        ],
        cues: ["45° body angle", "Powerful arm drive", "Short choppy steps initially", "Gradually raise torso", "Drive knees forward", "Stay low first 10m"],
      },
      {
        icon: Eye, title: "Ball Control & First Touch", desc: "Receiving under control",
        prescription: "3 x 2 min, alternate feet, then under a light press",
        how: [
          "Throw the ball against a wall and cushion it with the inside of the foot.",
          "Direct the first touch into space rather than straight down.",
          "Once it is clean, repeat with a partner applying light pressure.",
        ],
        cues: ["Cushion the ball on contact", "Use inside of foot", "Body behind the ball", "Relaxed receiving surface", "Direct touch into space", "Stay balanced"],
      },
      {
        icon: Target, title: "Passing Accuracy", desc: "Consistent striking technique",
        prescription: "20-30 passes each foot at a target, then 10 moving",
        how: [
          "Set a target 8-10m away and count only passes that hit it.",
          "Plant the foot beside the ball with the ankle locked.",
          "Finish with the same drill while jogging — technique under movement.",
        ],
        cues: ["Plant foot beside ball", "Strike with inside of foot", "Follow through to target", "Ankle locked firm", "Weight of pass matters", "Eyes on target"],
      },
      {
        icon: PersonStanding, title: "Landing & Deceleration Mechanics", desc: "Absorb force instead of braced",
        prescription: "3 x 8 landings from a low box, then 3 x 3 decelerations",
        how: [
          "Step off a low box and land on both feet, knees and hips bending.",
          "Hold the landing position for two seconds — no wobble, no sound.",
          "Progress to a sprint that stops in two steps.",
        ],
        cues: ["Land quietly, mid-foot", "Knees track over toes", "Hips back and low", "Chest up, no collapse", "Stop in two steps max", "Hold the position briefly"],
      },
    ],
  },
  {
    category: "Cycling & Swimming",
    drills: [
      {
        icon: Bike, title: "Pedal Stroke Efficiency", desc: "Smooth circular pedalling",
        prescription: "4 x 2 min single-leg focus, 90-100 rpm",
        how: [
          "On a trainer, ride with the cadence on screen in front of you.",
          "Think push across the top and scrape back along the bottom.",
          "Film the legs from the side to check the knee tracks straight.",
        ],
        cues: ["Push down, pull up", "Scrape foot at bottom", "Knee tracking straight", "Relaxed upper body", "Even power distribution", "High cadence practice"],
      },
      {
        icon: RotateCcw, title: "Freestyle Swim Stroke", desc: "Efficient front crawl",
        prescription: "6 x 50m with an emphasis, 20 sec rest",
        how: [
          "Have someone film from the side above water for one length.",
          "Swim 25m focusing only on the high-elbow catch.",
          "Then one length on rotation — one thing per set, not five.",
        ],
        cues: ["High elbow catch", "Rotate from hips", "Bilateral breathing", "Streamlined body position", "Kick from hips, not knees", "Extend and glide"],
      },
      {
        icon: Eye, title: "Open Water Sighting", desc: "Navigate without losing speed",
        prescription: "4 x 100m sighting every 6-8 strokes",
        how: [
          "In the pool, lift the eyes to the wall without lifting the head.",
          "Sight every six to eight strokes, timed with the breath.",
          "Practise returning straight back into the stroke — no pause.",
        ],
        cues: ["Lift eyes only, not head", "Sight every 6-8 strokes", "Use landmarks", "Time sight with breath", "Return to position quickly", "Practice in pool first"],
      },
      {
        icon: Footprints, title: "Kick & Streamline Set", desc: "Body position and kick timing",
        prescription: "6 x 25m kick with a board, 15-20 sec rest",
        how: [
          "Push off in a tight streamline and hold it for three kick cycles.",
          "Kick from the hip with a small, fast, relaxed foot.",
          "Rotate a slow set with a fast set so you feel the difference.",
        ],
        cues: ["Arms tight behind the head", "Kick from the hips", "Small fast kicks, not big slow ones", "Ankles relaxed", "Head in line with the spine", "Hold the glide"],
      },
      {
        icon: Bike, title: "Bike Fit & Posture Check", desc: "The cheap watts you are leaving behind",
        prescription: "Re-check after any saddle, cleat or shoe change",
        how: [
          "Film from the side while riding at a steady effort.",
          "Check the knee angle at the bottom of the stroke (about 25-35°).",
          "Check the shoulders and hips are not rocking to reach the pedals.",
        ],
        cues: ["Knee soft at the bottom", "Hips still in the saddle", "Neck and shoulders relaxed", "Elbow soft, not locked", "Knees close to the top tube", "Cleats straight"],
      },
    ],
  },
];

const FormAnalysis = () => {
  const { user } = useAuth();
  const { hasFeature, refresh } = useSubscription();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [expandedDrill, setExpandedDrill] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(drillCategories[0].category);
  // "Expand all" is a reading mode, not a second state machine: while it is on,
  // every category and drill renders open, and touching one of them drops back
  // to the single-open behaviour so the athlete is never fighting the toggle.
  const [allOpen, setAllOpen] = useState(false);
  const drillsRef = useRef(null);
  const drillsInView = useInView(drillsRef, { once: true, margin: "-30px" });

  // AI Analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Object URLs are owned by whoever created them. The web path mints one per
   * upload, and nothing released the previous one, so every photo checked in a
   * session stayed in memory until the tab closed — the preview is the biggest
   * allocation on the screen. Replacing the preview now releases the last one,
   * and unmounting releases the current one (Nutrition does the same for its
   * scan previews). Data URLs — the native capture path — are untouched: they
   * are strings, not object URLs, and revoking one is a no-op.
   */
  const previewRef = useRef<string | null>(null);
  const showPreview = (url: string) => {
    const previous = previewRef.current;
    if (previous && previous !== url && previous.startsWith("blob:")) URL.revokeObjectURL(previous);
    previewRef.current = url;
    setPreviewUrl(url);
  };
  useEffect(() => () => {
    const current = previewRef.current;
    if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
  }, []);

  const hasAccess = hasFeature("form_analysis");

  // The card quoted a price and then sent the athlete to the Market, which
  // sells packs and plans and not this unlock — so topping up bought nothing
  // they could spend it on. The purchase now happens here, and a shortfall
  // becomes a top-up for the exact gap with the unlock retried after it.
  // The price is read from the credit config rather than written into the
  // button, so the two cannot drift the way the old "54 credits" copy did.
  const [unlocking, setUnlocking] = useState(false);
  const unlock = useUnlockFeature();
  const formCost = creditCost("form_analysis_unlock");

  const handleUnlock = async () => {
    setUnlocking(true);
    try {
      const res = await unlock("form_analysis");
      if (res.status === "failed") {
        toast(res.error || "Could not unlock AI Analysis");
        return;
      }
      toast("AI Analysis unlocked");
      await refresh();
    } catch (e) {
      toast((e as Error)?.message || "Failed to unlock");
    } finally {
      setUnlocking(false);
    }
  };

  const runAnalysis = async (base64: string) => {
    setAnalyzing(true);
    setAnalysisResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-analyze", {
        body: { type: "form_analysis", image_base64: base64, prompt: "Analyze this athlete's form, posture, and technique in detail.", userLocale: getAiLocale(), pbs: getLocalPBs().slice(0, 20).map((p) => ({ metric: p.metric, value: p.value, unit: p.unit, date: p.date })) },
      });
      if (error) {
        const msg = await edgeErrorMessage(error);
        const status = (error as { context?: { status?: number } })?.context?.status ?? 0;
        if (status === 402 || status === 401 || status === 429) {
          toast({ title: msg, variant: "destructive" });
          setAnalyzing(false);
          return;
        }
        throw new Error(msg);
      }
      setAnalysisResult(data.result);
      toast({ title: "Analysis complete! 🎯" });
      setAnalyzing(false);
    } catch (err) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
      setAnalyzing(false);
    }
  };

  // Web path: the browser's own file input, which is the correct native control
  // in a browser. Kept exactly as it was, minus the analysis call it now shares.
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    showPreview(URL.createObjectURL(file));
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Couldn't read the image file."));
        reader.readAsDataURL(file);
      });
      await runAnalysis(base64);
    } catch (err) {
      toast({ title: "Couldn't read that photo", description: (err as Error).message, variant: "destructive" });
    } finally {
      // Let the same photo be chosen twice in a row.
      e.target.value = "";
    }
  };

  /**
   * Native path: the device camera, not a file picker. A cancelled capture
   * resolves null and leaves the screen exactly as it was — cancelling a camera
   * is not an error.
   */
  const handleNativeCapture = async () => {
    if (!user) return;
    const shot = await capturePhoto();
    if (!shot) return;
    showPreview(shot.previewUrl);
    hapticImpact("medium");
    await runAnalysis(shot.base64);
  };

  // "Take Photo" opens the camera; the icon-only button next to it picks an
  // existing photo. On the web the first keeps the browser's capture attribute,
  // which already opens the camera on a phone.
  const onTakePhoto = () => {
    if (isNative()) void handleNativeCapture();
    else fileInputRef.current?.click();
  };

  const onChoosePhoto = () => {
    if (isNative()) void pickPhoto().then((shot) => {
      if (!shot) return;
      showPreview(shot.previewUrl);
      void runAnalysis(shot.base64);
    });
    else fileInputRef.current?.click();
  };

  const catOpen = (category: string) => allOpen || expandedCategory === category;
  const drillOpen = (key: string) => allOpen || expandedDrill === key;

  const toggleCategory = (category: string) => {
    if (allOpen) {
      setAllOpen(false);
      setExpandedCategory(category);
      setExpandedDrill(null);
      return;
    }
    setExpandedCategory(expandedCategory === category ? null : category);
  };

  const toggleDrill = (key: string) => {
    if (allOpen) {
      setAllOpen(false);
      setExpandedDrill(key);
      return;
    }
    setExpandedDrill(expandedDrill === key ? null : key);
  };

  // ---------------------------------------------------------------- free half
  // Rendered FIRST when the unlock is missing: this is the part of the screen
  // that works for every athlete, and it was the part they could not see.
  const drillLibrary = (
    <div ref={drillsRef} className="px-5">
      <div className="mb-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-400/15">
            <Sparkles size={14} className="text-emerald-400" aria-hidden />
          </span>
          <h3 className="text-sm font-semibold">Free form drills</h3>
          <span className="ml-auto rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-400">Free</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          No unlock needed. Every drill below — how to do it, what to do, and the cues — is free, whatever
          plan you are on. Open one and it works as a session you can run today.
        </p>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {drillCategories.reduce((n, c) => n + c.drills.length, 0)} drills
        </span>
        <button
          type="button"
          onClick={() => { setAllOpen(!allOpen); setExpandedCategory(null); setExpandedDrill(null); }}
          // The label already says Expand/Collapse, but that is a repaint: a
          // screen reader hears the same name before and after. `aria-expanded`
          // is the state, and the same goes for the two toggles below.
          aria-expanded={allOpen}
          className="rounded-lg border border-border bg-card px-2.5 py-1 text-[12px] font-semibold text-foreground"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <div className="space-y-3 mb-8">
        {drillCategories.map((cat, ci) => (
          <div key={cat.category}>
            <motion.button
              onClick={() => toggleCategory(cat.category)}
              aria-expanded={catOpen(cat.category)}
              className="w-full flex items-center justify-between py-2"
              initial={{ opacity: 0 }} animate={drillsInView ? { opacity: 1 } : {}} transition={{ delay: ci * 0.05 }}
            >
              <span className="text-xs font-bold uppercase tracking-wider text-electric-purple">{cat.category}</span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-muted-foreground">{cat.drills.length}</span>
                {catOpen(cat.category) ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
              </span>
            </motion.button>
            {catOpen(cat.category) && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-2">
                {cat.drills.map((drill, i) => {
                  const key = `${cat.category}-${drill.title}`;
                  const open = drillOpen(key);
                  return (
                    <motion.div key={key}
                      initial={{ opacity: 0, x: -15 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                      className="bg-card border border-border rounded-xl overflow-hidden hover:border-electric-purple/20 transition-colors duration-300">
                      <motion.button onClick={() => toggleDrill(key)} aria-expanded={open}
                        className="w-full p-3 flex items-center justify-between gap-3" whileTap={{ scale: 0.99 }}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-1.5 rounded-lg bg-electric-purple/10 shrink-0"><drill.icon size={16} className="text-electric-purple" /></div>
                          <div className="text-start min-w-0">
                            <h4 className="font-semibold text-sm">{drill.title}</h4>
                            <p className="text-[12px] text-muted-foreground">{drill.desc}</p>
                            <p className="text-[12px] text-primary/80 mt-0.5">{drill.prescription}</p>
                          </div>
                        </div>
                        <motion.div animate={{ rotate: open ? 90 : 0 }} className="shrink-0"><ChevronRight size={14} className="text-muted-foreground" /></motion.div>
                      </motion.button>
                      {open && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="px-3 pb-3">
                          <div className="border-t border-border pt-2.5 space-y-3">
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">How to do it</p>
                              <div className="space-y-1.5">
                                {drill.how.map((step, si) => (
                                  <div key={si} className="flex items-start gap-2 text-[13px] leading-relaxed">
                                    <div className="mt-0.5 w-5 h-5 rounded-full bg-muted/60 flex items-center justify-center flex-shrink-0">
                                      <span className="text-[11px] font-bold text-muted-foreground">{si + 1}</span>
                                    </div>
                                    <span>{step}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Cues to hold</p>
                              <div className="space-y-1.5">
                                {drill.cues.map((cue, ci2) => (
                                  <motion.div key={ci2} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: ci2 * 0.04 }}
                                    className="flex items-center gap-2 text-[13px]">
                                    <div className="w-5 h-5 rounded-full bg-electric-purple/10 flex items-center justify-center flex-shrink-0">
                                      <span className="text-[11px] font-bold text-electric-purple">{ci2 + 1}</span>
                                    </div>
                                    <span>{cue}</span>
                                  </motion.div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  // ------------------------------------------------------------- paid halves
  const videoEntry = (
    <motion.button whileTap={{ scale: 0.99 }} onClick={() => navigate("/form/video")}
      initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
      className="mx-5 mb-4 w-[calc(100%-2.5rem)] text-start bg-gradient-card border border-electric-blue/25 rounded-2xl p-4 shadow-card">
      <div className="flex items-center gap-2 mb-2">
        <Video size={16} className="text-electric-blue" />
        <span className="text-[12px] font-semibold uppercase tracking-wider text-electric-blue">AI Video Analysis</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display font-bold text-lg mb-1">Analyse a movement video</h3>
          <p className="text-sm text-muted-foreground">Upload a running, sprint or general movement clip for a full coaching report.</p>
        </div>
        <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
      </div>
    </motion.button>
  );

  const aiCard = (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
      className="mx-5 mb-5 bg-gradient-card border border-electric-purple/20 rounded-2xl p-4 shadow-card">
      <div className="flex items-center gap-2 mb-2">
        <ScanLine size={16} className="text-electric-purple" />
        <span className="text-[12px] font-semibold uppercase tracking-wider text-electric-purple">AI Form Analysis</span>
      </div>
      {hasAccess ? (
        <>
          <h3 className="font-display font-bold text-lg mb-1">Upload Photo for Analysis</h3>
          <p className="text-sm text-muted-foreground mb-3">Upload a photo of your form — running, cycling, lifting, any sport. Our AI will give detailed feedback.</p>
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageUpload} className="hidden" />

          {previewUrl && (
            <div className="mb-3 rounded-xl overflow-hidden border border-border">
              <img src={previewUrl} alt="Form preview" className="w-full h-48 object-cover" />
            </div>
          )}

          {analyzing && (
            <div className="flex items-center justify-center gap-2 py-4 mb-3">
              <Loader2 size={20} className="animate-spin text-electric-purple" />
              <span className="text-sm text-muted-foreground">Analyzing your form...</span>
            </div>
          )}

          {analysisResult && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="bg-muted/50 border border-border rounded-xl p-4 mb-3 max-h-80 overflow-y-auto">
              <h4 className="font-display font-bold text-sm mb-2 text-electric-purple">Analysis Results</h4>
              <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{analysisResult}</div>
            </motion.div>
          )}

          <div className="flex gap-2">
            <motion.button whileTap={{ scale: 0.98 }} whileHover={{ scale: 1.02 }}
              onClick={onTakePhoto}
              disabled={analyzing}
              className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow disabled:opacity-60">
              <Camera size={18} /> Take Photo
            </motion.button>
            <motion.button whileTap={{ scale: 0.98 }}
              onClick={onChoosePhoto}
              disabled={analyzing}
              aria-label="Choose an existing photo"
              className="flex items-center justify-center gap-2 bg-card border border-border px-4 py-3 rounded-xl hover:border-electric-purple/20 transition-colors disabled:opacity-60">
              <Upload size={18} />
            </motion.button>
          </div>
        </>
      ) : (
        <>
          <h3 className="font-display font-bold text-lg mb-1">Unlock AI Analysis</h3>
          {/* The 54 was hard-coded and went stale the moment the unlock was
              repriced to 120 — the button below already read the live value,
              so the page quoted two different prices for the same thing. */}
          <p className="text-sm text-muted-foreground mb-3">Get AI-powered photo feedback on your form. Unlocked with the Premium plan or a one-time {formCost}-credit purchase.</p>
          <p className="text-[12px] leading-relaxed text-muted-foreground mb-3">
            The drills above are free and need no unlock — the paid half only adds a photo review of your own technique.
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground mb-3">
            {DISCLAIMERS.formAnalysis.full}
          </p>
          <motion.button whileTap={{ scale: 0.98 }}
            onClick={handleUnlock}
            disabled={unlocking}
            className="w-full flex items-center justify-center gap-2 bg-muted text-muted-foreground font-semibold py-3 rounded-xl disabled:opacity-60">
            <Lock size={18} /> {unlocking ? "Unlocking…" : `Unlock for ${formCost} credits`}
          </motion.button>

          {/* Video analysis stays reachable from here rather than leading the
              screen: it is the other paid surface, so it belongs with the
              unlock, not above the free library. */}
          <button
            type="button"
            onClick={() => navigate("/form/video")}
            className="mt-3 flex w-full items-center gap-3 rounded-xl border border-electric-blue/20 bg-white/[0.02] p-3 text-start"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-electric-blue/10">
              <Video size={15} className="text-electric-blue" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-tight">AI Video Analysis</span>
              <span className="block text-[12px] leading-snug text-muted-foreground">Upload a movement clip for a full coaching report.</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </>
      )}
    </motion.div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Form</motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">Perfect your technique.</motion.p>
      </div>

      {/* Order is the whole point of this screen: the drills are useful to
          everyone, so they lead when the AI half is locked and the paid cards
          follow it. With the unlock active, the analysis is the reason the
          athlete is here and it leads instead. */}
      {hasAccess ? (
        <>
          {videoEntry}
          {aiCard}
          {drillLibrary}
        </>
      ) : (
        <>
          {drillLibrary}
          {aiCard}
        </>
      )}
    </div>
  );
};

export default FormAnalysis;
