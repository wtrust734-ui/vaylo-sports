import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Wind, AlertTriangle, Zap, Crosshair, TrendingUp, ShoppingBag, Target, BarChart3, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { creditCost } from "@/lib/credits";
import { useUnlockFeature } from "@/hooks/useUnlockFeature";
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
  const { toast } = useToast();
  const { hasFeature, loading: entitlementsLoading, refresh } = useSubscription();
  const [unlocking, setUnlocking] = useState(false);
  const [tab, setTab] = useState<Tab>("checkin");
  const [trainTool, setTrainTool] = useState<TrainTool>(null);
  const [cueWords, setCueWords] = useState<string[]>([]);
  const [readiness, setReadiness] = useState<number | null>(null);
  const [raceMode, setRaceMode] = useState(false);

  // Access comes from the subscription context, not a query of this page's own.
  // The old check asked user_purchases for "pro" and "pro_subscription" — ids
  // the app no longer writes — so it missed every current subscriber, and it
  // could only ever see a one-time purchase. hasFeature covers the active
  // plans as well, which is what "also included with the Premium plan" on the
  // card below actually promises.
  const hasAccess = hasFeature("mental_gym");
  const loading = entitlementsLoading;
  const unlock = useUnlockFeature();

  const handleUnlock = async () => {
    setUnlocking(true);
    try {
      const res = await unlock("mental_gym");
      if (res.status === "failed") {
        toast(res.error || "Could not unlock Mental Gym");
        return;
      }
      toast("Mental Gym unlocked");
      await refresh();
    } catch (e) {
      toast((e as Error)?.message || "Failed to unlock");
    } finally {
      setUnlocking(false);
    }
  };

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
          <motion.button whileTap={{ scale: 0.98 }} onClick={handleUnlock} disabled={unlocking}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold py-3 rounded-xl mb-3 disabled:opacity-60">
            <ShoppingBag size={18} /> {unlocking ? "Unlocking…" : `Unlock for ${creditCost("mental_gym_unlock")} credits`}
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
                <div className="text-start">
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
