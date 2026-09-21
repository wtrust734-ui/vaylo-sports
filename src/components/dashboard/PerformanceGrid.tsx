import { motion, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Flame, Wind, Target } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { calculateVPR, type VPRScores } from "@/lib/performance";

const indices = [
  { key: "speed_index" as const, label: "Speed", icon: Wind, color: "hsl(var(--electric-purple))", path: "/vpr" },
  { key: "power_index" as const, label: "Power", icon: Zap, color: "hsl(var(--energy))", path: "/vpr" },
  { key: "endurance_capacity" as const, label: "Endurance", icon: Flame, color: "hsl(var(--primary))", path: "/load" },
  { key: "skill_consistency" as const, label: "Skill", icon: Target, color: "hsl(var(--success))", path: "/skills" },
];

const PerformanceGrid = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [vpr, setVpr] = useState<VPRScores | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("performance_metrics").select("*").eq("user_id", user.id).then(({ data }) => {
      if (data?.length) {
        const sport = (profile as any)?.sport || "default";
        setVpr(calculateVPR(data as any, Array.isArray(sport) ? sport[0] : sport));
      }
    });
  }, [user, profile]);

  return (
    <div ref={ref} className="px-5 mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">Performance Indices</h3>
        <button onClick={() => navigate("/vpr")} className="text-[11px] font-semibold text-primary hover:text-primary/80">
          Details →
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {indices.map((idx, i) => {
          const value = vpr?.[idx.key] ?? 0;
          return (
            <motion.button
              key={idx.key}
              onClick={() => navigate(idx.path)}
              initial={{ opacity: 0, y: 16 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.07, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              className="text-left bg-gradient-card border border-border rounded-2xl p-3.5 hover:border-primary/30 transition-all relative overflow-hidden"
            >
              <div
                className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-10 blur-2xl"
                style={{ background: idx.color }}
              />
              <div className="flex items-center justify-between mb-3 relative">
                <idx.icon size={15} style={{ color: idx.color }} />
                <span className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">{idx.label}</span>
              </div>
              <div className="flex items-baseline gap-1 mb-2 relative">
                <span className="text-2xl font-display font-bold tabular-nums">{value || "—"}</span>
                <span className="text-[10px] text-muted-foreground">/100</span>
              </div>
              <div className="h-1 bg-muted/40 rounded-full overflow-hidden relative">
                <motion.div
                  initial={{ width: 0 }}
                  animate={inView ? { width: `${value}%` } : {}}
                  transition={{ delay: 0.3 + i * 0.08, duration: 1, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full rounded-full"
                  style={{ background: idx.color, boxShadow: `0 0 8px ${idx.color}` }}
                />
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};

export default PerformanceGrid;
