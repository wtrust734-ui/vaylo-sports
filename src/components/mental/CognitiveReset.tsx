import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, ChevronRight } from "lucide-react";

const presets = [
  "I'm not fast enough",
  "Everyone is better than me",
  "I always choke under pressure",
  "I haven't trained enough",
  "I'm going to lose",
];

const CognitiveReset = () => {
  const [step, setStep] = useState(0);
  const [thought, setThought] = useState("");
  const [verdict, setVerdict] = useState<"fact" | "feeling" | null>(null);
  const [replacement, setReplacement] = useState("");
  const [done, setDone] = useState(false);

  const reset = () => { setStep(0); setThought(""); setVerdict(null); setReplacement(""); setDone(false); };

  if (done) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="px-5 flex flex-col items-center justify-center min-h-[50vh]">
        <Brain size={40} className="text-primary mb-4" />
        <h3 className="font-display font-bold text-lg mb-2">Reset Complete</h3>
        <p className="text-xs text-muted-foreground text-center max-w-xs mb-6">You've replaced a weak thought with a strong one. Use this in competition.</p>
        <div className="bg-card border border-primary/20 rounded-xl p-4 w-full max-w-sm mb-4">
          <p className="text-xs text-muted-foreground line-through mb-1">"{thought}"</p>
          <p className="text-sm font-semibold text-primary">"{replacement}"</p>
        </div>
        <button onClick={reset} className="text-sm text-primary font-semibold">Do Another</button>
      </motion.div>
    );
  }

  return (
    <div className="px-5">
      {/* Progress */}
      <div className="flex gap-1 mb-5">
        {[0, 1, 2].map(i => (
          <div key={i} className={`flex-1 h-1 rounded-full transition-all ${i <= step ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>

      {step === 0 && (
        <motion.div key="s0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
          <h3 className="font-display font-bold">Identify the thought</h3>
          <p className="text-xs text-muted-foreground">Select or type a negative thought holding you back.</p>
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <button key={p} onClick={() => setThought(p)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${thought === p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                {p}
              </button>
            ))}
          </div>
          <textarea value={thought} onChange={e => setThought(e.target.value)} placeholder="Or type your own..."
            className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm resize-none h-20" />
          <button onClick={() => setStep(1)} disabled={!thought.trim()}
            className="w-full bg-primary text-primary-foreground font-semibold py-3 rounded-xl disabled:opacity-40 text-sm flex items-center justify-center gap-2">
            Next <ChevronRight size={16} />
          </button>
        </motion.div>
      )}

      {step === 1 && (
        <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
          <h3 className="font-display font-bold">Fact or Feeling?</h3>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm italic">"{thought}"</p>
          </div>
          <p className="text-xs text-muted-foreground">Is this thought based on evidence, or emotion?</p>
          <div className="flex gap-3">
            <button onClick={() => { setVerdict("fact"); setStep(2); }}
              className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold hover:border-primary/30">Fact</button>
            <button onClick={() => { setVerdict("feeling"); setStep(2); }}
              className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold">Feeling</button>
          </div>
        </motion.div>
      )}

      {step === 2 && (
        <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
          <h3 className="font-display font-bold">Replace it</h3>
          <div className="bg-card border border-border rounded-xl p-3">
            <p className="text-xs text-muted-foreground line-through">"{thought}"</p>
            <p className="text-xs text-primary mt-1">Identified as: {verdict}</p>
          </div>
          <p className="text-xs text-muted-foreground">Write a strong, evidence-based alternative.</p>
          <textarea value={replacement} onChange={e => setReplacement(e.target.value)}
            placeholder="e.g. 'I've trained hard and I'm ready to compete.'"
            className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm resize-none h-20" />
          <button onClick={() => setDone(true)} disabled={!replacement.trim()}
            className="w-full bg-primary text-primary-foreground font-semibold py-3 rounded-xl disabled:opacity-40 text-sm">
            Complete Reset
          </button>
        </motion.div>
      )}
    </div>
  );
};

export default CognitiveReset;
