import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Fingerprint, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { calculateVPR, detectArchetype, archetypeReadiness, ARCHETYPE_MIN_METRICS, ARCHETYPE_MIN_BUCKETS, type MetricRow } from "@/lib/performance";

const Identity = () => {
  const { user, profile } = useAuth();
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  type SnapshotRow = { created_at: string; archetype?: string | null; [key: string]: unknown };
  const [snaps, setSnaps] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const sport = profile?.sport?.split(",")[0]?.trim() || "Running";

  useEffect(() => { if (user) load(); }, [user]);
  const load = async () => {
    if (!user) return;
    const [m, s] = await Promise.all([
      supabase.from("performance_metrics").select("*").eq("user_id", user.id).limit(200),
      supabase.from("vpr_snapshots").select("*").eq("user_id", user.id).order("created_at", { ascending: true }),
    ]);
    setMetrics(m.data || []); setSnaps(s.data || []); setLoading(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  const vpr = calculateVPR(metrics, sport);
  const readiness = archetypeReadiness(metrics);
  const arch = readiness.ready ? detectArchetype(vpr) : null;
  const evolution = snaps.map((s) => s.archetype).filter(Boolean);
  const gaps = Object.entries({
    Speed: vpr.speed_index, Power: vpr.power_index, Endurance: vpr.endurance_capacity,
    Repeatability: vpr.repeatability, Skill: vpr.skill_consistency, Reaction: vpr.reaction_efficiency,
  }).sort((a, b) => a[1] - b[1]).slice(0, 2);

  return (
    <div className="min-h-screen p-6 pt-20 pb-24 max-w-4xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><Fingerprint size={14} /> Performance Identity</div>
        <h1 className="text-4xl font-display font-bold mt-2">Your <span className="text-gradient-electric">Archetype</span></h1>
      </motion.div>

      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}
        className="relative overflow-hidden rounded-2xl border border-primary/30 p-8 bg-gradient-to-br from-primary/10 via-accent/10 to-transparent">
        <div className="absolute -right-20 -top-20 w-64 h-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative">
          <div className="text-xs uppercase tracking-widest text-primary">{arch ? "Current" : "Not enough data yet"}</div>
          {arch ? (
            <>
              <div className="text-5xl font-display font-bold mt-2">{arch.name}</div>
              <p className="text-muted-foreground mt-3 max-w-xl">{arch.description}</p>
            </>
          ) : (
            <>
              {/* "Undefined" was the internal sentinel shown as the athlete's
                  identity in 5xl type. Say what is actually true instead. */}
              <div className="text-5xl font-display font-bold mt-2 text-muted-foreground">Not set yet</div>
              <p className="text-muted-foreground mt-3 max-w-xl">
                Your archetype stays undefined until we have enough reliable stats to define it. Keep logging metrics across different tests — you need at least {ARCHETYPE_MIN_METRICS} metrics spanning {ARCHETYPE_MIN_BUCKETS}+ performance areas.
              </p>
              <p className="text-xs text-muted-foreground mt-3">Progress: {readiness.total}/{ARCHETYPE_MIN_METRICS} metrics · {readiness.filledBuckets}/{ARCHETYPE_MIN_BUCKETS} areas filled.</p>
              <div className="mt-4 h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.round((readiness.total / ARCHETYPE_MIN_METRICS) * 100))}%` }} />
              </div>
            </>
          )}
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-card/60 backdrop-blur border border-border rounded-2xl p-5">
        <h2 className="font-semibold mb-3">Identity evolution</h2>
        {evolution.length ? (
          <div className="flex flex-wrap gap-2">
            {evolution.map((e, i) => (
              <motion.span key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.05 }}
                className={`px-3 py-1 rounded-full text-xs border ${i === evolution.length - 1 ? "bg-primary/20 border-primary/40 text-primary" : "border-border text-muted-foreground"}`}>
                {e}
              </motion.span>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">Take more VPR snapshots to track evolution.</p>}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="bg-card/60 backdrop-blur border border-border rounded-2xl p-5">
        <h2 className="font-semibold mb-3">Gaps preventing next-level performance</h2>
        <div className="space-y-3">
          {gaps.map(([k, v]) => (
            <div key={k}>
              <div className="flex justify-between text-sm mb-1"><span>{k}</span><span className="font-mono">{v}/100</span></div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-destructive to-energy" style={{ width: `${v}%` }} />
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

export default Identity;
