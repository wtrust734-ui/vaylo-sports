import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Eye, Mic, MicOff, Save, Sparkles, Camera, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AR_PERSONAS, AR_METRICS, AR_THEMES, AR_POSITIONS, MAX_AR_METRICS,
  type ArPersonaId,
} from "@/lib/arOverlay";

const DEFAULTS = {
  ar_persona: "coach_pro" as ArPersonaId,
  ar_metrics: ["pace", "heart_rate", "power", "cadence"] as string[],
  ar_theme: "electric",
  ar_position: "top",
  ar_voice_enabled: true,
};

const ArOverlay = () => {
  const { user } = useAuth();
  const [persona, setPersona] = useState<ArPersonaId>(DEFAULTS.ar_persona);
  const [metrics, setMetrics] = useState<string[]>(DEFAULTS.ar_metrics);
  const [theme, setTheme] = useState(DEFAULTS.ar_theme);
  const [position, setPosition] = useState(DEFAULTS.ar_position);
  const [voice, setVoice] = useState(DEFAULTS.ar_voice_enabled);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle().then(({ data }) => {
      if (!data) return;
      const d = data as {
        ar_persona?: string | null;
        ar_metrics?: string[];
        ar_theme?: string | null;
        ar_position?: string | null;
        ar_voice_enabled?: boolean | null;
      } | null;
      if (!d) return;
      if (d.ar_persona && AR_PERSONAS.some((p) => p.id === d.ar_persona)) setPersona(d.ar_persona as ArPersonaId);
      if (Array.isArray(d.ar_metrics)) setMetrics(d.ar_metrics);
      if (d.ar_theme) setTheme(d.ar_theme);
      if (d.ar_position) setPosition(d.ar_position);
      if (typeof d.ar_voice_enabled === "boolean") setVoice(d.ar_voice_enabled);
    });
  }, [user]);

  const activePersona = useMemo(() => AR_PERSONAS.find((p) => p.id === persona)!, [persona]);
  const themeColor = AR_THEMES.find((t) => t.id === theme)?.color || "hsl(var(--primary))";

  const toggleMetric = (id: string) => {
    setMetrics((cur) => {
      if (cur.includes(id)) return cur.filter((m) => m !== id);
      if (cur.length >= MAX_AR_METRICS) {
        toast.error(`Max ${MAX_AR_METRICS} metrics on screen.`);
        return cur;
      }
      return [...cur, id];
    });
  };

  const reset = () => {
    setPersona(DEFAULTS.ar_persona);
    setMetrics(DEFAULTS.ar_metrics);
    setTheme(DEFAULTS.ar_theme);
    setPosition(DEFAULTS.ar_position);
    setVoice(DEFAULTS.ar_voice_enabled);
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const payload = {
      user_id: user.id,
      ar_persona: persona,
      ar_metrics: metrics,
      ar_theme: theme,
      ar_position: position,
      ar_voice_enabled: voice,
    };
    const { error } = await supabase.from("user_settings").upsert(payload, { onConflict: "user_id" });
    setSaving(false);
    if (error) { toast.error("Couldn't save AR preferences"); return; }
    toast.success("AR overlay saved");
  };

  const previewMetrics = AR_METRICS.filter((m) => metrics.includes(m.id));

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <div className="px-5 pt-12 pb-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">Field of View</p>
        <h1 className="text-3xl font-display font-bold mt-1">AR <span className="text-gradient-electric">Overlay</span></h1>
        <p className="text-sm text-muted-foreground mt-1">Customize what you see and hear during a session.</p>
      </div>

      {/* LIVE PREVIEW */}
      <div className="px-5">
        <div className="relative aspect-[16/10] rounded-2xl overflow-hidden border border-border shadow-card">
          {/* Simulated feed — this is a design preview, not a live camera. */}
          <div className="absolute left-3 top-3 z-10 rounded-full bg-background/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
            Preview
          </div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,hsl(var(--electric-purple)/.4),transparent_60%),radial-gradient(circle_at_70%_70%,hsl(var(--primary)/.5),transparent_55%),linear-gradient(180deg,hsl(var(--navy-deep)),hsl(var(--background)))]" />
          {/* grid */}
          <div className="absolute inset-0 opacity-[0.08]"
               style={{ backgroundImage: "linear-gradient(hsl(var(--foreground)) 1px,transparent 1px),linear-gradient(90deg,hsl(var(--foreground)) 1px,transparent 1px)", backgroundSize: "32px 32px" }} />
          {/* viewfinder */}
          <div className="absolute inset-4 border border-foreground/15 rounded-xl pointer-events-none" />
          <div className="absolute top-4 left-4 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: themeColor, boxShadow: `0 0 8px ${themeColor}` }} />
            <span className="text-[9px] tracking-wider font-bold" style={{ color: themeColor }}>LIVE · AR</span>
          </div>
          <div className="absolute top-4 right-4 flex items-center gap-1 text-[9px] text-foreground/60 font-mono">
            <Camera size={10} /> 1920×1080
          </div>

          {/* persona chip */}
          <motion.div
            layout
            className="absolute left-4 right-4 flex items-center gap-2 bg-card/40 backdrop-blur-md border border-border/40 rounded-xl px-3 py-2"
            style={{ [position === "bottom" ? "bottom" : position === "center" ? "top" : "top"]: position === "center" ? "50%" : "auto", top: position === "top" ? "44px" : position === "center" ? "50%" : "auto", bottom: position === "bottom" ? "16px" : "auto", transform: position === "center" ? "translateY(-50%)" : undefined }}
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${activePersona.accent}25` }}>
              <activePersona.icon size={14} style={{ color: activePersona.accent }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold truncate" style={{ color: themeColor }}>{activePersona.name}</p>
              <p className="text-[9px] text-foreground/60 truncate">"{activePersona.voicePromptStyle}"</p>
            </div>
            {voice ? <Mic size={12} style={{ color: themeColor }} /> : <MicOff size={12} className="text-muted-foreground" />}
          </motion.div>

          {/* metrics HUD */}
          <div className={`absolute left-4 right-4 grid gap-1.5 ${previewMetrics.length > 3 ? "grid-cols-3" : "grid-cols-" + Math.max(1, previewMetrics.length)}`}
               style={{ bottom: position === "top" ? "16px" : position === "center" ? "16px" : "64px" }}>
            <AnimatePresence mode="popLayout">
              {previewMetrics.map((m) => (
                <motion.div
                  key={m.id}
                  layout
                  initial={{ opacity: 0, y: 8, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 320, damping: 26 }}
                  className="bg-background/40 backdrop-blur-md border rounded-lg px-2 py-1.5"
                  style={{ borderColor: `${themeColor}40` }}
                >
                  <p className="text-[8px] uppercase tracking-wider text-foreground/60 font-semibold truncate">{m.label}</p>
                  <p className="text-sm font-display font-bold tabular-nums" style={{ color: themeColor, textShadow: `0 0 12px ${themeColor}` }}>
                    {sample(m.id)}
                  </p>
                </motion.div>
              ))}
            </AnimatePresence>
            {previewMetrics.length === 0 && (
              <p className="text-[10px] text-muted-foreground text-center col-span-3">No metrics selected</p>
            )}
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-2 flex items-center justify-center gap-1">
          <Eye size={11} /> Live preview · changes update instantly
        </p>
      </div>

      {/* PERSONA */}
      <Section title="AI Coach Persona" subtitle="Pick the voice in your ear">
        <div className="grid grid-cols-2 gap-2.5">
          {AR_PERSONAS.map((p) => {
            const active = persona === p.id;
            return (
              <motion.button
                key={p.id}
                onClick={() => setPersona(p.id)}
                whileTap={{ scale: 0.97 }}
                className={`text-start p-3 rounded-xl border transition-all relative overflow-hidden ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/30"}`}
              >
                <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full opacity-15 blur-2xl" style={{ background: p.accent }} />
                <div className="flex items-center gap-2 mb-1.5 relative">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${p.accent}20` }}>
                    <p.icon size={15} style={{ color: p.accent }} />
                  </div>
                  {active && <Check size={14} className="ml-auto text-primary" />}
                </div>
                <p className="text-sm font-bold relative">{p.name}</p>
                <p className="text-[10px] text-muted-foreground relative">{p.tagline}</p>
                <p className="text-[9px] text-muted-foreground/70 mt-1 relative">{p.sports.join(" · ")}</p>
              </motion.button>
            );
          })}
        </div>
      </Section>

      {/* METRICS */}
      <Section title="On-Screen Metrics" subtitle={`${metrics.length}/${MAX_AR_METRICS} selected`}>
        {(["core", "advanced", "ai"] as const).map((cat) => (
          <div key={cat} className="mb-3 last:mb-0">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
              {cat === "ai" && <Sparkles size={10} className="text-electric-purple" />}
              {cat === "core" ? "Core" : cat === "advanced" ? "Advanced" : "AI Predictive"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {AR_METRICS.filter((m) => m.category === cat).map((m) => {
                const active = metrics.includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleMetric(m.id)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                      active
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    }`}
                  >
                    {active && "✓ "}{m.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </Section>

      {/* THEME */}
      <Section title="Overlay Theme">
        <div className="flex flex-wrap gap-2">
          {AR_THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                theme === t.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/30"
              }`}
            >
              <span className="w-3 h-3 rounded-full" style={{ background: t.color, boxShadow: `0 0 8px ${t.color}` }} />
              <span className="text-xs font-semibold">{t.label}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* POSITION + VOICE */}
      <Section title="Display & Voice">
        <div className="space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">HUD Position</p>
            <div className="grid grid-cols-3 gap-2">
              {AR_POSITIONS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPosition(p.id)}
                  className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                    position === p.id ? "bg-primary/10 border-primary text-primary" : "bg-card border-border text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => setVoice(!voice)}
            className="w-full flex items-center justify-between bg-card border border-border rounded-xl px-4 py-3 hover:border-primary/30 transition-all"
          >
            <div className="flex items-center gap-2.5">
              {voice ? <Mic size={16} className="text-primary" /> : <MicOff size={16} className="text-muted-foreground" />}
              <div className="text-start">
                <p className="text-sm font-semibold">Voice cues</p>
                <p className="text-[10px] text-muted-foreground">Persona speaks during sessions</p>
              </div>
            </div>
            <div className={`w-10 h-6 rounded-full p-0.5 transition-colors ${voice ? "bg-primary" : "bg-muted"}`}>
              <motion.div layout className="w-5 h-5 bg-background rounded-full" style={{ marginLeft: voice ? "auto" : 0 }} />
            </div>
          </button>
        </div>
      </Section>

      {/* Sticky save bar */}
      <div className="fixed bottom-20 left-0 right-0 px-5 z-30">
        <div className="max-w-md mx-auto flex gap-2">
          <button
            onClick={reset}
            className="flex items-center justify-center gap-1.5 bg-card/85 backdrop-blur-xl border border-border rounded-xl px-4 py-3 text-xs font-semibold text-muted-foreground hover:text-foreground transition-all"
          >
            <RotateCcw size={13} /> Reset
          </button>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={save}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-gradient-electric text-primary-foreground font-bold py-3 rounded-xl shadow-electric disabled:opacity-50"
          >
            <Save size={15} /> {saving ? "Saving…" : "Save Overlay"}
          </motion.button>
        </div>
      </div>
    </div>
  );
};

const Section = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
  <div className="px-5 mt-6">
    <div className="flex items-end justify-between mb-3">
      <h2 className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">{title}</h2>
      {subtitle && <span className="text-[10px] text-muted-foreground">{subtitle}</span>}
    </div>
    {children}
  </div>
);

// Sample preview values (UI demo only)
function sample(id: string) {
  const map: Record<string, string> = {
    pace: "4:32", speed: "13.2", heart_rate: "162", hr_zone: "Z3",
    distance: "5.2", elapsed: "23:14", cadence: "176", power: "284",
    stride: "1.42", elevation: "+128", calories: "412", vo2: "52",
    fatigue_predict: "18%", vpr_live: "78", form_score: "92", next_cue: "Stay tall",
  };
  return map[id] ?? "—";
}

export default ArOverlay;
