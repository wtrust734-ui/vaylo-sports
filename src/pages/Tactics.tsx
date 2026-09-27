import { getAiLocale } from "@/i18n";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Swords, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { creditCost } from "@/lib/credits";
import { edgeErrorMessage } from "@/lib/edgeErrors";
import { getLocalPBs } from "@/lib/athleteDossier";

const Tactics = () => {
  const { user, profile, refreshProfile } = useAuth();
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [briefing, setBriefing] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => { if (user) load(); }, [user]);
  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("tactical_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);
    setPlans(data || []); setLoading(false);
  };

  const generate = async () => {
    if (!user || !profile) return;
    if (!briefing.trim() || briefing.trim().length < 20) { toast.error("Give the AI more detail — at least a couple of sentences."); return; }
    setGenerating(true);
    try {
      // The ai-analyze function charges tactical_prep credits server-side
      // (with auto-refund if the AI call fails).
      // Try AI generation, fall back to a structured scaffold if unavailable
      let priorities: string[] = [];
      let warmup = "Extended dynamic warmup + 3× sport-specific bursts at 70–85% effort. Include sport-specific movement patterns for 6–8 min.";
      let mindset = "One play at a time. Trust the prep. Reset breath after every stoppage.";
      let adjustments = "Reduce volume 20% in the 48h before, keep intensity but drop total sets. Add activation drills day-of.";
      let risks = "Watch for early fatigue if the opponent forces high-tempo exchanges. Have a plan B for adverse conditions.";

      try {
        const { data, error } = await supabase.functions.invoke("ai-analyze", {
          body: { type: "tactical_prep", briefing, userLocale: getAiLocale(), sport: profile.sport || "General", pbs: getLocalPBs().slice(0, 20).map((p) => ({ metric: p.metric, value: p.value, unit: p.unit, date: p.date })) },
        });
        if (error) {
          const msg = await edgeErrorMessage(error);
          const status = (error as { context?: { status?: number } })?.context?.status ?? 0;
          // Auth/limit/charge failures must stop the flow — otherwise a free
          // fallback plan would silently replace the paid AI result.
          if (status === 401 || status === 402 || status === 429) {
            toast.error(msg);
            return;
          }
          // Other AI errors: fall through to the offline scaffold below.
          console.warn("tactical AI unavailable, using fallback:", msg);
        } else if (data?.result) {
          try {
            const parsed = JSON.parse(data.result);
            priorities = parsed.priorities || [];
            warmup = parsed.warmup || warmup;
            mindset = parsed.mindset || mindset;
            adjustments = parsed.adjustments || adjustments;
            risks = parsed.risks || risks;
          } catch {
            // Split lines into priorities as fallback
            priorities = String(data.result).split("\n").map((s: string) => s.replace(/^[-•\d.\s]+/, "").trim()).filter(Boolean).slice(0, 6);
          }
        }
      } catch {}

      if (priorities.length === 0) {
        priorities = [
          "Dictate tempo in the first 5 minutes to set a physical tone.",
          "Neutralize opponent's primary weapon by shifting positioning early.",
          "Convert transitions — first 3 seconds after possession change.",
          "Manage energy: sustained pressure over highlight moments.",
        ];
      }

      const { error } = await supabase.from("tactical_plans").insert({
        user_id: user.id,
        opponent_style: briefing.slice(0, 500),
        match_format: "", environment: "", competition_level: "", position: "",
        generated_priorities: priorities,
        training_adjustments: adjustments,
        warmup_customization: warmup,
        psychological_cues: mindset,
        risk_notes: risks,
      });
      if (error) throw error;

      await refreshProfile();
      setBriefing("");
      toast.success("Tactical plan generated");
      load();
    } catch (e: any) {
      toast.error(e.message || "Failed to generate");
    } finally { setGenerating(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  const sportLabel = (profile?.sport || "").split(",")[0].trim() || "Multi-Sport";

  return (
    <div className="min-h-screen p-6 pt-20 pb-24 max-w-4xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-xs text-primary uppercase tracking-widest"><Swords size={14} /> Tactical Intelligence</div>
        <h1 className="text-4xl font-display font-bold mt-2">Tactical <span className="text-gradient-electric">Prep</span></h1>
        <p className="text-xs text-muted-foreground mt-1">Tuned for <span className="text-primary font-semibold">{sportLabel}</span>. Describe your matchup in your own words — {creditCost("tactical_prep")} credits per plan.</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="bg-card/60 backdrop-blur border border-border rounded-2xl p-6 space-y-3">
        <label className="text-xs text-muted-foreground">Free-form briefing — opponent, format, environment, your role, anything else the AI should factor in.</label>
        <Textarea
          placeholder={`e.g. "Semi-final vs. a high-press 4-3-3 side that transitions fast on turnovers. Wet pitch, 20°C. I'm playing #6 — need to disrupt their #10 and recycle possession under pressure. We're a possession team but the surface will punish slow passes..."`}
          value={briefing}
          onChange={(e) => setBriefing(e.target.value)}
          rows={7}
        />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{briefing.length} chars</span>
          <span>Balance: {profile?.credits ?? 0} credits</span>
        </div>
        <Button onClick={generate} disabled={generating} className="w-full"><Sparkles size={16} className="mr-2" /> {generating ? "Generating..." : `Generate plan (${creditCost("tactical_prep")} credits)`}</Button>
      </motion.div>

      <div className="space-y-3">
        {plans.map((p, i) => (
          <motion.div key={p.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }}
            className="bg-card/60 backdrop-blur border border-border rounded-2xl p-5">
            <div className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</div>
            <div className="font-semibold mt-1 text-sm whitespace-pre-wrap">{p.opponent_style || "General prep"}</div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {(p.generated_priorities || []).map((pr: string, j: number) => (
                <li key={j} className="flex gap-2"><span className="text-primary">▸</span>{pr}</li>
              ))}
            </ul>
            {p.warmup_customization && <p className="text-xs text-muted-foreground mt-3"><b>Warmup:</b> {p.warmup_customization}</p>}
            {p.psychological_cues && <p className="text-xs text-muted-foreground mt-1"><b>Mindset:</b> {p.psychological_cues}</p>}
            {p.risk_notes && <p className="text-xs text-muted-foreground mt-1"><b>Risks:</b> {p.risk_notes}</p>}
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Tactics;
