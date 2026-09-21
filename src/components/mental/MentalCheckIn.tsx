import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  onComplete: (score: number) => void;
}

const sliders = [
  { key: "confidence", label: "Confidence", emoji: "💪" },
  { key: "stress", label: "Stress", emoji: "😤" },
  { key: "focus", label: "Focus", emoji: "🎯" },
  { key: "motivation", label: "Motivation", emoji: "🔥" },
  { key: "fatigue", label: "Fatigue", emoji: "😴" },
];

function calcReadiness(vals: Record<string, number>): { score: number; message: string } {
  const pos = vals.confidence + vals.focus + vals.motivation;
  const neg = vals.stress + vals.fatigue;
  const raw = ((pos * 2 - neg) / 40) * 100;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  let message = "You're ready. Execute.";
  if (score < 40) message = "High stress. Focus on basics.";
  else if (score < 65) message = "You're off. Stay controlled.";
  return { score, message };
}

const MentalCheckIn = ({ onComplete }: Props) => {
  const { user } = useAuth();
  const [vals, setVals] = useState<Record<string, number>>({
    confidence: 5, stress: 5, focus: 5, motivation: 5, fatigue: 5,
  });
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{ score: number; message: string } | null>(null);

  const handleSubmit = async () => {
    const r = calcReadiness(vals);
    setResult(r);
    setSubmitted(true);
    if (user) {
      const { error } = await supabase.from("mental_checkins").insert({
        user_id: user.id,
        ...vals,
        readiness_score: r.score,
        message: r.message,
      });
      if (error) toast.error(`Check-in not saved: ${error.message}`);
    }
  };

  if (submitted && result) {
    const color = result.score >= 65 ? "text-green-400" : result.score >= 40 ? "text-yellow-400" : "text-red-400";
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center min-h-[60vh] px-6">
        <motion.div
          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.2 }}
          className="w-32 h-32 rounded-full border-4 border-primary/30 bg-primary/5 flex items-center justify-center mb-6"
        >
          <span className={`text-4xl font-display font-black ${color}`}>{result.score}</span>
        </motion.div>
        <p className="text-lg font-display font-bold text-center mb-2">Readiness Score</p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="text-sm text-muted-foreground text-center max-w-xs mb-8">{result.message}</motion.p>
        <motion.button whileTap={{ scale: 0.97 }} onClick={() => onComplete(result.score)}
          className="flex items-center gap-2 bg-primary text-primary-foreground font-semibold py-3 px-8 rounded-xl">
          Continue to Training <ChevronRight size={18} />
        </motion.button>
      </motion.div>
    );
  }

  return (
    <div className="px-5 pb-8">
      <div className="flex items-center gap-2 mb-1">
        <Zap size={20} className="text-primary" />
        <h2 className="text-lg font-display font-bold">Daily Check-In</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-5">Rate each from 1–10. Be honest.</p>
      <div className="space-y-4">
        {sliders.map((s, i) => (
          <motion.div key={s.key} initial={{ opacity: 0, x: -15 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
            className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{s.emoji} {s.label}</span>
              <motion.span key={vals[s.key]} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className="text-lg font-display font-bold text-primary">{vals[s.key]}</motion.span>
            </div>
            <input type="range" min={1} max={10} value={vals[s.key]}
              onChange={e => setVals(p => ({ ...p, [s.key]: parseInt(e.target.value) }))}
              className="w-full accent-[hsl(var(--primary))]" />
          </motion.div>
        ))}
      </div>
      <motion.button whileTap={{ scale: 0.97 }} onClick={handleSubmit}
        className="w-full mt-6 bg-primary text-primary-foreground font-semibold py-3.5 rounded-xl text-sm">
        Get Readiness Score
      </motion.button>
    </div>
  );
};

export default MentalCheckIn;
