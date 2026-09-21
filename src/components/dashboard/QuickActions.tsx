import { motion, useInView } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Dumbbell, Apple, Brain, Trophy, Activity, Gamepad2, ShoppingBag, ScanLine } from "lucide-react";
import { useRef } from "react";

const actions = [
  { icon: Dumbbell, label: "Train", path: "/training", color: "text-primary", bg: "bg-primary/10" },
  { icon: Activity, label: "Workouts", path: "/workouts", color: "text-primary", bg: "bg-primary/10" },
  { icon: Apple, label: "Nutrition", path: "/nutrition", color: "text-success", bg: "bg-success/10" },
  { icon: ScanLine, label: "Form", path: "/form", color: "text-info", bg: "bg-info/10" },
  { icon: Gamepad2, label: "Arcade", path: "/arcade", color: "text-energy", bg: "bg-energy/10" },
  { icon: ShoppingBag, label: "Market", path: "/market", color: "text-primary", bg: "bg-primary/10" },
];

const QuickActions = () => {
  const navigate = useNavigate();
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-30px" });

  return (
    <div ref={ref} className="px-5 mt-5 mb-6">
      <motion.h3 className="text-sm font-semibold text-muted-foreground mb-3"
        initial={{ opacity: 0 }} animate={isInView ? { opacity: 1 } : {}}>
        Quick Actions
      </motion.h3>
      <div className="grid grid-cols-3 gap-3">
        {actions.map((action, i) => (
          <motion.button key={action.label} onClick={() => navigate(action.path)}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}}
            transition={{ delay: i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ scale: 1.08, y: -4 }} whileTap={{ scale: 0.95 }}
            className="flex flex-col items-center gap-2 bg-card border border-border rounded-xl p-3 hover:border-primary/30 transition-colors duration-300">
            <div className={`p-2.5 rounded-xl ${action.bg}`}>
              <action.icon size={20} className={action.color} />
            </div>
            <span className="text-xs font-medium text-foreground">{action.label}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
};

export default QuickActions;
