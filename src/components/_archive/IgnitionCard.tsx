import { motion, useInView } from "framer-motion";
import { Sparkles, Volume2 } from "lucide-react";
import { useRef } from "react";

const quotes = [
  "The only limit is the one you set for yourself.",
  "Champions train, losers complain.",
  "Push harder than yesterday if you want a different tomorrow.",
  "Your body can stand almost anything. It's your mind that you have to convince.",
];

const IgnitionCard = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const quote = quotes[new Date().getDate() % quotes.length];

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mx-5 mt-5 rounded-2xl bg-gradient-card border border-border p-4 shadow-card hover:border-primary/20 transition-colors duration-500"
    >
      <div className="flex items-center gap-2 mb-3">
        <motion.div animate={{ rotate: [0, 15, -15, 0] }} transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}>
          <Sparkles size={14} className="text-primary" />
        </motion.div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          Ignition
        </span>
      </div>
      <motion.p
        className="text-sm font-medium italic leading-relaxed text-foreground/90"
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : {}}
        transition={{ delay: 0.3 }}
      >
        "{quote}"
      </motion.p>
      <div className="flex items-center gap-3 mt-4">
        <motion.button
          className="flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-semibold px-3 py-2 rounded-lg"
          whileTap={{ scale: 0.95 }}
          whileHover={{ scale: 1.05 }}
        >
          <Volume2 size={14} />
          Breathe
        </motion.button>
        <motion.button
          className="flex items-center gap-1.5 bg-info/10 text-info text-xs font-semibold px-3 py-2 rounded-lg"
          whileTap={{ scale: 0.95 }}
          whileHover={{ scale: 1.05, y: -1 }}
        >
          <Sparkles size={14} />
          Focus
        </motion.button>
      </div>
    </motion.div>
  );
};

export default IgnitionCard;
