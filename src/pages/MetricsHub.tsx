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
  // With no logs there is no readiness, no ratio and no injury risk — only the
  // absence of data. Defaulting to 50 colored the tile red and made a new
  // athlete look like they were in trouble on day one, and a ratio of 0 counts
  // as "undertrained", so the risk tile said MODERATE out of nothing at all.
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
    { label: "Injury risk", value: hasLoads ? analysis.injuryRisk.toUpperCase() : NO_DATA, color: !hasLoads ? MUTED : analysis.injuryRisk === "high" ? "text-destructive" : analysis.injuryRisk === "moderate" ? "text-energy" : "text-primary" },
  ];

  return (
    <div className="min-h-screen p-6 pt-20 pb-24 max-w-5xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><Activity size={14} /> Holistic Metrics</div>
        <h1 className="text-4xl font-display font-bold mt-2">Performance <span className="text-gradient-electric">Dashboard</span></h1>
      </motion.div>

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
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
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
                <div className="flex items-center justify-between mb-1">
                  <div><div className="font-semibold text-sm">{e.name} <span className="text-xs text-muted-foreground">· {e.type}</span></div>
                    <div className="text-xs text-muted-foreground">{Math.round(e.usage_km)} / {e.max_km || "∞"} km</div>
                  </div>
                  <div className="flex gap-1">
                    {e.active && <>
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => logUsage(e.id, e.usage_km, 5)}>+5km</Button>
                      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => logUsage(e.id, e.usage_km, 10)}>+10km</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => retire(e.id)}>Retire</Button>
                    </>}
                  </div>
                </div>
                {e.max_km && (
                  <>
                    <div className="w-full bg-muted/30 h-1.5 rounded-full overflow-hidden">
                      <motion.div initial={{ width: 0 }} whileInView={{ width: `${pct}%` }} viewport={{ once: true }}
                        className={`h-full ${tier === "destructive" ? "bg-destructive" : tier === "energy" ? "bg-energy" : "bg-primary"}`} />
                    </div>
                    {pct > 90 && <div className="text-xs text-destructive mt-1">⚠ Replace soon — performance and injury risk climb past 90%.</div>}
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
