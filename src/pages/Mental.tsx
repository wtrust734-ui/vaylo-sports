import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Wind, AlertTriangle, Zap, Crosshair, TrendingUp, ShoppingBag, Target, BarChart3, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import MentalCheckIn from "@/components/mental/MentalCheckIn";
import BreathingTool from "@/components/mental/BreathingTool";
import PressureScenarios from "@/components/mental/PressureScenarios";
import CognitiveReset from "@/components/mental/CognitiveReset";
import CueWords from "@/components/mental/CueWords";
import RaceMode from "@/components/mental/RaceMode";
import PostReview from "@/components/mental/PostReview";
import MentalProgress from "@/components/mental/MentalProgress";

type Tab = "checkin" | "train" | "race" | "review" | "progress";
type TrainTool = "breathing" | "pressure" | "reset" | "cue" | null;

const Mental = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("checkin");
  const [trainTool, setTrainTool] = useState<TrainTool>(null);
  const [cueWords, setCueWords] = useState<string[]>([]);
  const [readiness, setReadiness] = useState<number | null>(null);
  const [raceMode, setRaceMode] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("user_purchases").select("product_id").eq("user_id", user.id)
      .in("product_id", ["mental_gym", "pro_subscription", "pro"])
      .then(({ data }) => {
        setHasAccess((data || []).length > 0);
        setLoading(false);
      });
  }, [user]);

  if (loading) return <div className="min-h-screen bg-background" />;

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-8">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center max-w-sm">
          <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 2, repeat: Infinity }}>
            <Brain size={56} className="mx-auto text-primary mb-4" />
          </motion.div>
          <h1 className="text-2xl font-display font-bold mb-2">Mental Gym</h1>
          <p className="text-sm text-muted-foreground mb-6">Elite mental training for athletes. Used before, during, and after competition.</p>
          <motion.button whileTap={{ scale: 0.98 }} onClick={() => navigate("/market")}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold py-3 rounded-xl mb-3">
            <ShoppingBag size={18} /> Unlock for 39 credits
          </motion.button>
          <p className="text-xs text-muted-foreground">One-time unlock. Also included with the Premium plan.</p>
        </motion.div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "checkin", label: "Check-In", icon: Zap },
    { id: "train", label: "Train", icon: Brain },
    { id: "race", label: "Event", icon: Target },
    { id: "review", label: "Review", icon: BarChart3 },
    { id: "progress", label: "Progress", icon: TrendingUp },
  ];

  const trainTools: { id: TrainTool; label: string; icon: React.ElementType; desc: string }[] = [
    { id: "breathing", label: "Breathing", icon: Wind, desc: "Box, Calm, Quick Reset" },
    { id: "pressure", label: "Pressure Scenarios", icon: AlertTriangle, desc: "Rehearse race situations" },
    { id: "reset", label: "Cognitive Reset", icon: Brain, desc: "Replace weak thoughts" },
    { id: "cue", label: "Cue Words", icon: Crosshair, desc: "Set your race triggers" },
  ];

  // Race mode is full-screen overlay - separate from tab system
  if (raceMode) {
    return <RaceMode cueWords={cueWords} onExit={() => { setRaceMode(false); setTab("train"); }} />;
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="px-5 pt-14 pb-3">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-xl font-display font-bold">Mental Gym</motion.h1>
        {readiness !== null && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-muted-foreground">
            Readiness: <span className="text-primary font-bold">{readiness}/100</span>
          </motion.p>
        )}
      </div>

      {/* Tab bar */}
      <div className="px-4 mb-5">
        <div className="flex gap-1 bg-card border border-border rounded-xl p-1">
          {tabs.map(t => (
            <button key={t.id} onClick={() => { 
              if (t.id === "race") {
                setRaceMode(true);
              } else {
                setTab(t.id); 
                setTrainTool(null); 
              }
            }}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-lg text-[10px] font-semibold transition-all ${
                tab === t.id && !raceMode ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}>
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {tab === "checkin" && (
          <motion.div key="checkin" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
            <MentalCheckIn onComplete={(score) => { setReadiness(score); setTab("train"); }} />
          </motion.div>
        )}

        {tab === "train" && !trainTool && (
          <motion.div key="train-menu" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            className="px-5 space-y-3">
            {trainTools.map((t, i) => (
              <motion.button key={t.id} onClick={() => setTrainTool(t.id)}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                whileTap={{ scale: 0.97 }}
                className="w-full bg-card border border-border rounded-xl p-4 flex items-center gap-3 hover:border-primary/30 transition-colors">
                <div className="p-2.5 rounded-lg bg-primary/10"><t.icon size={18} className="text-primary" /></div>
                <div className="text-left">
                  <p className="text-sm font-semibold">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.desc}</p>
                </div>
              </motion.button>
            ))}
          </motion.div>
        )}

        {tab === "train" && trainTool === "breathing" && (
          <motion.div key="breathing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button onClick={() => setTrainTool(null)} className="px-5 text-xs text-primary font-semibold mb-4 flex items-center gap-1"><ArrowLeft size={14} /> Back</button>
            <BreathingTool />
          </motion.div>
        )}
        {tab === "train" && trainTool === "pressure" && (
          <motion.div key="pressure" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button onClick={() => setTrainTool(null)} className="px-5 text-xs text-primary font-semibold mb-4 flex items-center gap-1"><ArrowLeft size={14} /> Back</button>
            <PressureScenarios />
          </motion.div>
        )}
        {tab === "train" && trainTool === "reset" && (
          <motion.div key="reset" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button onClick={() => setTrainTool(null)} className="px-5 text-xs text-primary font-semibold mb-4 flex items-center gap-1"><ArrowLeft size={14} /> Back</button>
            <CognitiveReset />
          </motion.div>
        )}
        {tab === "train" && trainTool === "cue" && (
          <motion.div key="cue" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button onClick={() => setTrainTool(null)} className="px-5 text-xs text-primary font-semibold mb-4 flex items-center gap-1"><ArrowLeft size={14} /> Back</button>
            <CueWords onWordsChange={setCueWords} />
          </motion.div>
        )}

        {tab === "review" && (
          <motion.div key="review" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
            <PostReview onComplete={() => setTab("progress")} />
          </motion.div>
        )}

        {tab === "progress" && (
          <motion.div key="progress" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
            <MentalProgress />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Mental;
