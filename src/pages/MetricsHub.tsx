import { useEffect, useState } from "react";
import { localDateKey } from "@/lib/dates";
import { motion } from "framer-motion";
import { Activity, Loader2, Plus, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { analyzeLoads, type LoadRow } from "@/lib/performance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

const TYPES = ["shoes", "wearable", "bike", "racquet", "other"];
const TYPE_LABELS: Record<string, string> = {
  shoes: "Shoes",
  wearable: "Wearable",
  bike: "Bike",
  racquet: "Racquet",
  other: "Other",
};

const MetricsHub = () => {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loads, setLoads] = useState<LoadRow[]>([]);
  const [recovery, setRecovery] = useState<Tables<"recovery_logs">[]>([]);
  const [meals, setMeals] = useState<Tables<"meal_logs">[]>([]);
  const [equipment, setEquipment] = useState<Tables<"equipment">[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", type: "shoes", max_km: 800 });

  useEffect(() => { if (user) load(); }, [user]);
  const load = async () => {
    if (!user) return;
    const today = localDateKey();
    const [l, r, m, e] = await Promise.all([
      supabase.from("training_loads").select("*").eq("user_id", user.id).order("log_date").limit(60),
      supabase.from("recovery_logs").select("*").eq("user_id", user.id).order("log_date", { ascending: false }).limit(7),
      supabase.from("meal_logs").select("*").eq("user_id", user.id).eq("log_date", today),
      supabase.from("equipment").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    setLoads(l.data || []);
    setRecovery(r.data || []);
    setMeals(m.data || []);
    setEquipment(e.data || []);
    setLoading(false);
  };

  const analysis = analyzeLoads(loads);
  // With no logs there is no readiness, no ratio and no workload status — only
  // the absence of data. Defaulting to 50 colored the tile red and made a new
  // athlete look like they were in trouble on day one, and a ratio of 0 counts
  // as "undertrained", so the tile said MODERATE out of nothing at all.
  const hasRecovery = recovery.length > 0;
  const hasLoads = loads.length > 0;
  const NO_DATA = "—";
  const MUTED = "text-muted-foreground";
  const recoveryAvg = hasRecovery
    ? Math.round(recovery.reduce((a, b) => a + (b.readiness_score || 50), 0) / recovery.length)
    : 0;
  const calsToday = meals.reduce((a, b) => a + (b.calories || 0), 0);
  const proteinToday = meals.reduce((a, b) => a + (b.protein_g || 0), 0);
  const carbsToday = meals.reduce((a, b) => a + (b.carbs_g || 0), 0);
  const fatToday = meals.reduce((a, b) => a + (b.fat_g || 0), 0);
  const mealsCount = meals.length;
  const snacksCount = meals.filter((m) => m.meal_type === "snack").length;
  const weightKg = profile?.weight_kg ? Number(profile.weight_kg) : null;
  const proteinPerKg = weightKg ? (proteinToday / weightKg).toFixed(1) : "—";
  const macroSum = proteinToday * 4 + carbsToday * 4 + fatToday * 9;
  const proteinPct = macroSum ? Math.round((proteinToday * 4 / macroSum) * 100) : 0;
  const carbsPct = macroSum ? Math.round((carbsToday * 4 / macroSum) * 100) : 0;
  const fatPct = macroSum ? Math.round((fatToday * 9 / macroSum) * 100) : 0;
  /**
   * What the acute:chronic ratio actually says, in words an athlete can act on.
   *
   * This tile used to read "Injury risk: HIGH", which is the one kind of claim
   * this product does not make: nothing here has been validated against an
   * injury outcome, so a risk score is a number invented from a ratio and
   * dressed as a medical finding. The ratio is real and useful — it compares the
   * last 7 days with the 28 before them — so it is reported as a workload
   * status with the action attached, not as a verdict on the athlete's body.
   */
  const workloadStatus = !hasLoads
    ? NO_DATA
    : analysis.ratio > 1.5
      ? "SPIKING"
      : analysis.ratio > 1.3
        ? "RISING"
        : analysis.ratio < 0.7 && analysis.chronic > 0
          ? "DROPPING"
          : "STEADY";
  // `analyzeLoads` already writes the actionable sentence for this case; it was
  // being computed and then thrown away. Reusing it keeps the words and the
  // number in one place.
  const workloadAdvice = hasLoads
    ? analysis.alerts.find(
        (a) => a.type === "overtraining" || a.type === "spike" || a.type === "undertraining",
      )?.message ?? null
    : null;

  const addEquipment = async () => {
    if (!user || !form.name) return;
    const { error } = await supabase.from("equipment").insert({ user_id: user.id, ...form });
    if (error) toast.error(error.message);
    else { toast.success("Equipment added"); setShowForm(false); setForm({ name: "", type: "shoes", max_km: 800 }); load(); }
  };

  const logUsage = async (id: string, current: number, add: number) => {
    const { error } = await supabase.from("equipment").update({ usage_km: current + add }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const retire = async (id: string) => {
    const { error } = await supabase.from("equipment").update({ active: false }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  const cards = [
    { label: "Readiness (7d avg)", value: hasRecovery ? `${recoveryAvg}/100` : NO_DATA, color: !hasRecovery ? MUTED : recoveryAvg > 70 ? "text-primary" : recoveryAvg > 50 ? "text-energy" : "text-destructive" },
    { label: "A:C Ratio", value: hasLoads ? analysis.ratio.toFixed(2) : NO_DATA, color: !hasLoads ? MUTED : analysis.ratio > 1.3 || analysis.ratio < 0.7 ? "text-energy" : "text-primary" },
    { label: "Acute load", value: hasLoads ? Math.round(analysis.acute) : NO_DATA, color: hasLoads ? "text-foreground" : MUTED },
    { label: "Calories today", value: calsToday, color: "text-foreground" },
    { label: "Protein today", value: `${Math.round(proteinToday)}g`, color: "text-foreground" },
    { label: "Workload", value: workloadStatus, color: !hasLoads ? MUTED : workloadStatus === "SPIKING" ? "text-destructive" : workloadStatus === "RISING" || workloadStatus === "DROPPING" ? "text-energy" : "text-primary" },
  ];

  return (
    <div className="min-h-screen bg-background px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-5xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><Activity size={14} /> Holistic Metrics</div>
        <h1 className="text-2xl font-display font-bold mt-1">Performance Dashboard</h1>
      </motion.div>

      {workloadAdvice && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Workload: </span>
          {workloadAdvice} The ratio compares the load of your last 7 days with the 28 before
          them — it is a training measure, not a medical assessment.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((c, i) => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            transition={{ delay: i * 0.05 }}
            className="p-4 rounded-2xl bg-card/40 border border-border">
            <div className="text-xs text-muted-foreground mb-1">{c.label}</div>
            <div className={`text-2xl font-display font-bold ${c.color}`}>{c.value}</div>
          </motion.div>
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
        className="p-5 rounded-2xl bg-card/40 border border-border">
        <div className="flex items-center justify-between mb-4">
          <div><h3 className="font-semibold">Equipment Tracker</h3><p className="text-xs text-muted-foreground">Rotate gear before it kills your performance.</p></div>
          <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus size={14} className="mr-1" /> Add</Button>
        </div>

        {showForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
            className="space-y-2 mb-4 p-4 rounded-xl bg-background/40 border border-border">
            <Input placeholder="Name (e.g. Nike Vaporfly)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" placeholder="Max km" value={form.max_km} onChange={(e) => setForm({ ...form, max_km: Number(e.target.value) })} />
            </div>
            <Button onClick={addEquipment} className="w-full">Save</Button>
          </motion.div>
        )}

        <div className="space-y-2">
          {equipment.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3">No equipment tracked yet.</p>
          ) : equipment.map((e) => {
            const pct = e.max_km ? Math.min(100, (e.usage_km / e.max_km) * 100) : 0;
            const tier = pct > 90 ? "destructive" : pct > 70 ? "energy" : "primary";
            return (
              <div key={e.id} className={`p-3 rounded-xl border ${e.active ? "border-border bg-background/40" : "border-border bg-background/20 opacity-60"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm break-words">{e.name} <span className="text-xs font-normal text-muted-foreground">· {TYPE_LABELS[e.type] ?? e.type}{!e.active && " · retired"}</span></div>
                    <div className="text-xs text-muted-foreground tabular-nums">{Math.round(e.usage_km)} / {e.max_km > 0 ? `${e.max_km} km` : "no limit set"}</div>
                  </div>
                  {e.active && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => logUsage(e.id, e.usage_km, 5)}>+5 km</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => logUsage(e.id, e.usage_km, 10)}>+10 km</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => retire(e.id)}>Retire</Button>
                    </div>
                  )}
                </div>
                {e.max_km > 0 && (
                  <>
                    <div className="w-full bg-muted/30 h-1.5 rounded-full overflow-hidden">
                      <motion.div initial={{ width: 0 }} whileInView={{ width: `${pct}%` }} viewport={{ once: true }}
                        className={`h-full ${tier === "destructive" ? "bg-destructive" : tier === "energy" ? "bg-energy" : "bg-primary"}`} />
                    </div>
                    {/* Phase 6 reworded this from "performance and injury risk climb
                        past 90%". Worn-out cushioning is a fact about the shoe and
                        worth acting on; a claim that it raises injury risk is a
                        medical statement this product has nothing to back. The
                        nudge survives; the diagnosis does not. */}
                    {pct > 90 && <div className="text-xs text-destructive mt-1">⚠ Replace soon — this pair is past its rated distance, and worn cushioning changes how a run feels.</div>}
                    {pct > 70 && pct <= 90 && <div className="text-xs text-energy mt-1">Plan a replacement in the next few weeks.</div>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
};

export default MetricsHub;
