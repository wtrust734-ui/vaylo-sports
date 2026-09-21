import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";

const HeroGreeting = () => {
  const { profile } = useAuth();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = profile?.full_name?.split(" ")[0] || "Athlete";

  return (
    <div className="px-5 pt-14 pb-4">
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className="text-2xl font-display font-bold">
          {greeting}, <span className="text-gradient-electric">{name}</span>
        </h1>
        <motion.p
          className="text-sm text-muted-foreground mt-1"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
        >
          Let's make today count.
        </motion.p>
      </motion.div>
    </div>
  );
};

export default HeroGreeting;
