import { motion, useInView } from "framer-motion";
import { Droplets, Activity, Target, Dumbbell } from "lucide-react";
import { useRef, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const StatsRow = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const { user } = useAuth();
  const [waterMl, setWaterMl] = useState(0);
  const [waterGoal, setWaterGoal] = useState(3000);
  const [workoutCount, setWorkoutCount] = useState(0);
  const [readiness, setReadiness] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];

    Promise.all([
      supabase.from("water_logs").select("amount_ml").eq("user_id", user.id).eq("log_date", today),
      supabase.from("user_settings").select("water_goal_ml").eq("user_id", user.id).maybeSingle(),
      supabase.from("workouts").select("id", { count: "exact" }).eq("user_id", user.id).eq("completed", true),
      supabase.from("recovery_logs").select("readiness_score").eq("user_id", user.id).eq("log_date", today).maybeSingle(),
    ]).then(([waterRes, settingsRes, workoutRes, recoveryRes]) => {
      const total = (waterRes.data || []).reduce((sum, r) => sum + r.amount_ml, 0);
      setWaterMl(total);
      if (settingsRes.data?.water_goal_ml) setWaterGoal(settingsRes.data.water_goal_ml);
      setWorkoutCount(workoutRes.count || 0);
      if (recoveryRes.data?.readiness_score) setReadiness(recoveryRes.data.readiness_score);
    });
  }, [user]);

  const stats = [
    {
      icon: Droplets,
      label: "Hydration",
      value: waterMl > 0 ? `${(waterMl / 1000).toFixed(1)}L` : "—",
      sub: waterMl > 0 ? `/ ${(waterGoal / 1000).toFixed(1)}L` : "Not tracked",
      progress: waterMl > 0 ? Math.min((waterMl / waterGoal) * 100, 100) : 0,
      color: "text-info",
      bgColor: "bg-info/10",
      barColor: "bg-info",
    },
    {
      icon: Activity,
      label: "Readiness",
      value: readiness !== null ? `${readiness}/10` : "—",
      sub: readiness !== null ? "" : "Not logged",
      progress: readiness !== null ? readiness * 10 : 0,
      color: "text-primary",
      bgColor: "bg-primary/10",
      barColor: "bg-primary",
    },
    {
      icon: Dumbbell,
      label: "Workouts",
      value: workoutCount > 0 ? `${workoutCount}` : "—",
      sub: workoutCount > 0 ? "completed" : "None yet",
      progress: Math.min(workoutCount * 10, 100),
      color: "text-energy",
      bgColor: "bg-energy/10",
      barColor: "bg-energy",
    },
    {
      icon: Target,
      label: "Goals",
      value: "—",
      sub: "Set goals",
      progress: 0,
      color: "text-primary",
      bgColor: "bg-primary/10",
      barColor: "bg-primary",
    },
  ];

  return (
    <div ref={ref} className="px-5 mt-5">
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}}
            transition={{ delay: i * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ scale: 1.03, transition: { duration: 0.2 } }}
            className="bg-card border border-border rounded-xl p-3.5 hover:border-primary/20 transition-colors duration-300"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-lg ${stat.bgColor}`}>
                <stat.icon size={14} className={stat.color} />
              </div>
              <span className="text-[11px] text-muted-foreground font-medium">{stat.label}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-display font-bold">{stat.value}</span>
              {stat.sub && <span className="text-xs text-muted-foreground">{stat.sub}</span>}
            </div>
            {stat.progress > 0 && (
              <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={isInView ? { width: `${stat.progress}%` } : {}}
                  transition={{ delay: 0.4 + i * 0.1, duration: 0.8, ease: "easeOut" }}
                  className={`h-full rounded-full ${stat.barColor}`}
                />
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default StatsRow;
