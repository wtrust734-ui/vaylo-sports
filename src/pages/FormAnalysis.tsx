import { getAiLocale } from "@/i18n";
import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { ScanLine, Lock, ChevronRight, Dumbbell, Eye, Target, RotateCcw, Footprints, Bike, PersonStanding, ArrowUp, Camera, Upload, Loader2, Video } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { getLocalPBs } from "@/lib/athleteDossier";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { creditCost } from "@/lib/credits";
import { useUnlockFeature } from "@/hooks/useUnlockFeature";

const drillCategories = [
  {
    category: "Gym & Strength",
    drills: [
      { icon: Dumbbell, title: "Squat Form Check", desc: "Key cues for proper squat depth and alignment", cues: ["Feet shoulder-width apart", "Brace your core", "Sit back into hips", "Knees track over toes", "Break parallel depth", "Drive through heels"] },
      { icon: Target, title: "Deadlift Setup", desc: "Perfect your hip hinge and barbell path", cues: ["Bar over mid-foot", "Shoulders over bar", "Neutral spine", "Engage lats", "Push floor away", "Lockout hips"] },
      { icon: RotateCcw, title: "Push-Up Mechanics", desc: "Full range of motion with shoulder alignment", cues: ["Hands under shoulders", "Elbows at 45°", "Core tight throughout", "Full lockout at top", "Chest to floor", "Scapulae protracted at top"] },
      { icon: Dumbbell, title: "Overhead Press", desc: "Proper pressing mechanics and core bracing", cues: ["Grip just outside shoulders", "Brace core and glutes", "Press in a slight arc", "Full lockout overhead", "Head through at top", "Control the descent"] },
      { icon: Dumbbell, title: "Barbell Row", desc: "Back engagement and pull pattern", cues: ["Hip hinge position", "Bar under shoulders", "Pull to lower chest", "Squeeze shoulder blades", "Control eccentric", "Neutral wrist position"] },
    ],
  },
  {
    category: "Running & Athletics",
    drills: [
      { icon: Eye, title: "Running Gait Analysis", desc: "Foot strike, cadence, and posture", cues: ["Land under hips", "180+ steps/min cadence", "Slight forward lean", "Relaxed shoulders", "Arms at 90°", "Mid-foot strike"] },
      { icon: Footprints, title: "A-Skips", desc: "Improve knee drive and coordination", cues: ["Drive knee to waist height", "Dorsiflexed ankle", "Stay tall through trunk", "Quick ground contact", "Pump arms in sync", "Land under center of mass"] },
      { icon: Footprints, title: "B-Skips", desc: "Extend leg drive for power transfer", cues: ["High knee then extend", "Paw the ground back", "Active ankle dorsiflexion", "Strong arm drive", "Stay tall, don't lean", "Quick cycle time"] },
      { icon: Footprints, title: "High Knees", desc: "Develop fast turnover and knee lift", cues: ["Drive knees to hip height", "Stay on balls of feet", "Quick ground contact", "Pump arms aggressively", "Keep torso upright", "Maintain rhythm"] },
      { icon: Footprints, title: "Butt Kicks", desc: "Develop hamstring recovery speed", cues: ["Heel to glute", "Stay tall", "Quick cadence", "Minimal forward travel", "Arms relaxed", "Light ground contact"] },
    ],
  },
  {
    category: "Football & Team Sports",
    drills: [
      { icon: Target, title: "Agility Ladder Drills", desc: "Quick feet and coordination patterns", cues: ["Light on your feet", "Stay low in athletic stance", "Arms drive movement", "Eyes up, not down", "Quick in-out pattern", "Maintain rhythm"] },
      { icon: RotateCcw, title: "Cutting & Change of Direction", desc: "Sharp cuts and deceleration mechanics", cues: ["Plant outside foot firmly", "Lower centre of gravity", "Lean into new direction", "Explosive push-off", "Keep eyes on target", "Pre-load the cut"] },
      { icon: Target, title: "Sprint Starts", desc: "Explosive acceleration from standstill", cues: ["45° body angle", "Powerful arm drive", "Short choppy steps initially", "Gradually raise torso", "Drive knees forward", "Stay low first 10m"] },
      { icon: Eye, title: "Ball Control & First Touch", desc: "Receiving and controlling the ball", cues: ["Cushion the ball on contact", "Use inside of foot", "Body behind the ball", "Relaxed receiving surface", "Direct touch into space", "Stay balanced"] },
      { icon: Target, title: "Passing Accuracy", desc: "Technique for consistent passing", cues: ["Plant foot beside ball", "Strike with inside of foot", "Follow through to target", "Ankle locked firm", "Weight of pass matters", "Eyes on target"] },
    ],
  },
  {
    category: "Cycling & Swimming",
    drills: [
      { icon: Bike, title: "Pedal Stroke Efficiency", desc: "Smooth circular pedalling technique", cues: ["Push down, pull up", "Scrape foot at bottom", "Knee tracking straight", "Relaxed upper body", "Even power distribution", "High cadence practice"] },
      { icon: RotateCcw, title: "Freestyle Swim Stroke", desc: "Efficient front crawl technique", cues: ["High elbow catch", "Rotate from hips", "Bilateral breathing", "Streamlined body position", "Kick from hips, not knees", "Extend and glide"] },
      { icon: Eye, title: "Open Water Sighting", desc: "Navigation without losing speed", cues: ["Lift eyes only, not head", "Sight every 6-8 strokes", "Use landmarks", "Time sight with breath", "Return to position quickly", "Practice in pool first"] },
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
  const drillsRef = useRef(null);
  const drillsInView = useInView(drillsRef, { once: true, margin: "-30px" });

  // AI Analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setAnalyzing(true);
    setAnalysisResult(null);

    try {
      // Convert to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Couldn't read the image file."));
        reader.readAsDataURL(file);
      });
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

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Form</motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">Perfect your technique.</motion.p>
      </div>


      {/* AI Video Form Analysis entry */}
      <motion.button whileTap={{ scale: 0.99 }} onClick={() => navigate("/form/video")}
        initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}
        className="mx-5 mb-4 w-[calc(100%-2.5rem)] text-start bg-gradient-card border border-electric-blue/25 rounded-2xl p-4 shadow-card">
        <div className="flex items-center gap-2 mb-2">
          <Video size={16} className="text-electric-blue" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-electric-blue">AI Video Analysis</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-bold text-lg mb-1">Analyse a movement video</h3>
            <p className="text-sm text-muted-foreground">Upload a running, sprint or general movement clip for a full coaching report.</p>
          </div>
          <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
        </div>
      </motion.button>

      {/* AI Form Analysis */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="mx-5 mb-5 bg-gradient-card border border-electric-purple/20 rounded-2xl p-4 shadow-card">
        <div className="flex items-center gap-2 mb-2">
          <ScanLine size={16} className="text-electric-purple" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-electric-purple">AI Form Analysis</span>
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
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">
                <Camera size={18} /> Take Photo
              </motion.button>
              <motion.button whileTap={{ scale: 0.98 }}
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 bg-card border border-border px-4 py-3 rounded-xl hover:border-electric-purple/20 transition-colors">
                <Upload size={18} />
              </motion.button>
            </div>
          </>
        ) : (
          <>
            <h3 className="font-display font-bold text-lg mb-1">Unlock AI Analysis</h3>
            <p className="text-sm text-muted-foreground mb-3">Get AI-powered photo feedback on your form. Unlocked with the Premium plan or a one-time 54-credit purchase.</p>
            <motion.button whileTap={{ scale: 0.98 }}
              onClick={handleUnlock}
              disabled={unlocking}
              className="w-full flex items-center justify-center gap-2 bg-muted text-muted-foreground font-semibold py-3 rounded-xl disabled:opacity-60">
              <Lock size={18} /> {unlocking ? "Unlocking…" : `Unlock for ${formCost} credits`}
            </motion.button>
          </>
        )}
      </motion.div>

      {/* Free Form Drills by Category */}
      <div ref={drillsRef} className="px-5">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Form Drills & Cues (Free)</h3>
        <div className="space-y-3 mb-8">
          {drillCategories.map((cat, ci) => (
            <div key={cat.category}>
              <motion.button
                onClick={() => setExpandedCategory(expandedCategory === cat.category ? null : cat.category)}
                className="w-full flex items-center justify-between py-2"
                initial={{ opacity: 0 }} animate={drillsInView ? { opacity: 1 } : {}} transition={{ delay: ci * 0.05 }}
              >
                <span className="text-xs font-bold uppercase tracking-wider text-electric-purple">{cat.category}</span>
                <motion.div animate={{ rotate: expandedCategory === cat.category ? 90 : 0 }}><ChevronRight size={14} className="text-muted-foreground" /></motion.div>
              </motion.button>
              {expandedCategory === cat.category && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-2">
                  {cat.drills.map((drill, i) => {
                    const key = `${cat.category}-${drill.title}`;
                    return (
                      <motion.div key={key}
                        initial={{ opacity: 0, x: -15 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                        className="bg-card border border-border rounded-xl overflow-hidden hover:border-electric-purple/20 transition-colors duration-300">
                        <motion.button onClick={() => setExpandedDrill(expandedDrill === key ? null : key)}
                          className="w-full p-3 flex items-center justify-between" whileTap={{ scale: 0.99 }}>
                          <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-lg bg-electric-purple/10"><drill.icon size={16} className="text-electric-purple" /></div>
                            <div className="text-start"><h4 className="font-semibold text-sm">{drill.title}</h4><p className="text-[11px] text-muted-foreground">{drill.desc}</p></div>
                          </div>
                          <motion.div animate={{ rotate: expandedDrill === key ? 90 : 0 }}><ChevronRight size={14} className="text-muted-foreground" /></motion.div>
                        </motion.button>
                        {expandedDrill === key && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="px-3 pb-3">
                            <div className="space-y-1.5 border-t border-border pt-2">
                              {drill.cues.map((cue, ci) => (
                                <motion.div key={ci} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: ci * 0.04 }}
                                  className="flex items-center gap-2 text-sm">
                                  <div className="w-5 h-5 rounded-full bg-electric-purple/10 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[10px] font-bold text-electric-purple">{ci + 1}</span>
                                  </div>
                                  <span>{cue}</span>
                                </motion.div>
                              ))}
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
    </div>
  );
};

export default FormAnalysis;
