import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ChevronRight, X } from "lucide-react";

const scenarios = [
  {
    id: "bad-start",
    title: "Bad Start",
    situation: "You've fallen behind early. Panic is rising.",
    think: "This event is long. Stay patient.",
    actions: ["Relax shoulders and jaw", "Lock onto the competitor ahead"],
  },
  {
    id: "boxed-in",
    title: "Trapped / Stuck",
    situation: "You're stuck behind slower competitors with no gap.",
    think: "Wait for the gap. It will come.",
    actions: ["Drop back slightly to find space", "Move wide at the next opportunity"],
  },
  {
    id: "overtaken",
    title: "Being Overtaken",
    situation: "An opponent is surging past you mid-competition.",
    think: "Their move, not my problem. Play my game.",
    actions: ["Maintain rhythm — don't chase", "Focus on form and breathing"],
  },
  {
    id: "final-push",
    title: "Final Push Fatigue",
    situation: "Your body is burning. The finish feels impossible.",
    think: "Pain is temporary. This is what I trained for.",
    actions: ["Increase effort in short bursts", "Focus on one rep / one stride at a time"],
  },
  {
    id: "pre-event",
    title: "Pre-Event Nerves",
    situation: "Your heart is pounding. Hands are shaking.",
    think: "Nerves mean I care. Channel it.",
    actions: ["3 deep breaths — 4 in, 6 out", "Visualize your first move perfectly"],
  },
  {
    id: "mistake",
    title: "After a Mistake",
    situation: "You just made a big error. Frustration is building.",
    think: "Next play. One mistake doesn't define me.",
    actions: ["Reset with a deep exhale", "Focus only on the next action"],
  },
  {
    id: "behind-score",
    title: "Losing / Behind",
    situation: "You're down on the scoreboard or behind on time.",
    think: "Comebacks happen. Control what I can.",
    actions: ["Stick to fundamentals", "Break it into small chunks — next 5 minutes only"],
  },
  {
    id: "crowd-pressure",
    title: "Crowd Pressure",
    situation: "The crowd is loud, expectations are heavy.",
    think: "I perform for me. Everything else is noise.",
    actions: ["Narrow your focus — cue word or breathing", "Eyes on your task, not the crowd"],
  },
  {
    id: "injury-scare",
    title: "Niggle / Pain During Event",
    situation: "A muscle twinge or pain appears mid-competition.",
    think: "Assess, don't panic. Pain isn't always injury.",
    actions: ["Slow down briefly to assess severity", "Adjust technique to protect the area"],
  },
  {
    id: "equipment-fail",
    title: "Equipment Issue",
    situation: "Something breaks or malfunctions mid-event.",
    think: "Adapt. Champions solve problems.",
    actions: ["Stay calm — assess options quickly", "Focus on what you CAN control right now"],
  },
];

const PressureScenarios = () => {
  const [active, setActive] = useState<string | null>(null);
  const scenario = scenarios.find(s => s.id === active);

  return (
    <div className="px-5">
      <AnimatePresence mode="wait">
        {!scenario ? (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            <p className="text-xs text-muted-foreground mb-4">Select a pressure scenario to rehearse your response.</p>
            {scenarios.map((s, i) => (
              <motion.button key={s.id} onClick={() => setActive(s.id)}
                initial={{ opacity: 0, x: -15 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                whileTap={{ scale: 0.97 }}
                className="w-full bg-card border border-border rounded-xl p-4 flex items-center justify-between hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-3">
                  <AlertTriangle size={16} className="text-primary" />
                  <span className="text-sm font-semibold">{s.title}</span>
                </div>
                <ChevronRight size={16} className="text-muted-foreground" />
              </motion.button>
            ))}
          </motion.div>
        ) : (
          <motion.div key="detail" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }}
            className="bg-card border border-primary/20 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-lg">{scenario.title}</h3>
              <button onClick={() => setActive(null)}><X size={18} className="text-muted-foreground" /></button>
            </div>
            <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4">
              <p className="text-xs font-semibold text-destructive/80 mb-1">SITUATION</p>
              <p className="text-sm">{scenario.situation}</p>
            </div>
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
              <p className="text-xs font-semibold text-primary mb-1">THINK THIS</p>
              <p className="text-sm font-medium">{scenario.think}</p>
            </div>
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
              <p className="text-xs font-semibold text-primary mb-1">DO THIS</p>
              <ul className="space-y-1">
                {scenario.actions.map((a, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">{i + 1}.</span> {a}
                  </li>
                ))}
              </ul>
            </div>
            <button onClick={() => setActive(null)} className="w-full bg-primary/10 text-primary font-semibold py-2.5 rounded-xl text-sm">Done</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PressureScenarios;
