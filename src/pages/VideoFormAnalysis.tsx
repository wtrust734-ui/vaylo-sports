import { getAiLocale } from "@/i18n";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Video, Upload, Loader2, Sparkles, TrendingUp, AlertTriangle, Target,
  ChevronRight, History, Trash2, Crown, Save, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { getLocalPBs } from "@/lib/athleteDossier";

interface AnalysisResult {
  overall_score: number;
  strengths: string[];
  areas_to_improve: string[];
  technical_analysis: {
    posture: string;
    movement_efficiency: string;
    arm_mechanics: string;
    leg_mechanics: string;
    balance_and_control: string;
  };
  recommended_drills: string[];
  coach_summary: string;
}

interface HistoryRow {
  id: string;
  sport_type: string;
  video_name: string | null;
  overall_score: number | null;
  model_used: string | null;
  created_at: string;
  result: AnalysisResult;
}

const SPORTS = [
  { id: "running", label: "Running" },
  { id: "sprint", label: "Sprint" },
  { id: "general", label: "General movement" },
];

const ALLOWED = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_BYTES = 18 * 1024 * 1024;

const scoreColor = (s: number) =>
  s >= 80 ? "text-emerald-400" : s >= 60 ? "text-electric-blue" : s >= 40 ? "text-amber-400" : "text-destructive";

const TECH_LABELS: Record<string, string> = {
  posture: "Posture",
  movement_efficiency: "Movement efficiency",
  arm_mechanics: "Arm mechanics",
  leg_mechanics: "Leg mechanics",
  balance_and_control: "Balance & control",
};

const VideoFormAnalysis = () => {
  const { user } = useAuth();
  const { hasUnlimitedCredits } = useSubscription();
  const isPremium = hasUnlimitedCredits;
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [sport, setSport] = useState("running");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<"idle" | "uploading" | "analysing">("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [tab, setTab] = useState<"analyse" | "history">("analyse");
  const [openHistory, setOpenHistory] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("video_form_analyses")
      .select("id, sport_type, video_name, overall_score, model_used, created_at, result")
      .eq("user_id", user.id)
      .eq("saved", true)
      .order("created_at", { ascending: false })
      .limit(30);
    setHistory((data || []) as unknown as HistoryRow[]);
  }, [user]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const reset = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null); setFileName(null); setResult(null); setLastId(null); setProgress(0); setStage("idle");
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!user) { toast({ title: "Sign in to analyse videos", variant: "destructive" }); return; }

    if (!ALLOWED.includes(file.type)) {
      toast({ title: "Unsupported file", description: "Upload an MP4, MOV or WebM video.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "Video too large", description: "Keep clips under 18MB (5–15 seconds works best).", variant: "destructive" });
      return;
    }

    reset();
    setFileName(file.name);
    setVideoUrl(URL.createObjectURL(file));
    setStage("uploading");
    setProgress(0);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (ev) => { if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 70)); };
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Could not read the video file."));
        reader.readAsDataURL(file);
      });

      setProgress(80);
      setStage("analysing");

      const { data, error } = await supabase.functions.invoke("video-form-analysis", {
        body: { video_base64: base64, mime_type: file.type, sport_type: sport, video_name: file.name, userLocale: getAiLocale(), pbs: getLocalPBs().slice(0, 20).map((p) => ({ metric: p.metric, value: p.value, unit: p.unit, date: p.date })) },
      });

      if (error) {
        let msg = error.message;
        const err = error as { context?: { text?: () => Promise<string> } };
        try { const ctx = err.context; if (ctx?.text) { const parsed = JSON.parse(await ctx.text()); msg = parsed.error || msg; } } catch { /* ignore */ }
        throw new Error(msg);
      }
      const payload = (data ?? {}) as { error?: string; result?: AnalysisResult; model?: string; saved_id?: string | null };
      if (payload.error) throw new Error(payload.error);

      setProgress(100);
      setResult(payload.result as AnalysisResult);
      setModelUsed(payload.model);
      setLastId(payload.saved_id ?? null);
      setStage("idle");
      loadHistory();
      toast({ title: "Analysis ready 🎯" });
    } catch (err) {
      setStage("idle");
      setProgress(0);
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    }
  };

  const discardAnalysis = async () => {
    if (lastId) {
      const { error } = await supabase.from("video_form_analyses").update({ saved: false }).eq("id", lastId);
      if (error) { toast({ title: "Couldn't discard the analysis", description: error.message, variant: "destructive" }); return; }
    }
    loadHistory();
    reset();
    toast({ title: "Analysis discarded" });
  };

  const deleteHistory = async (id: string) => {
    const { error } = await supabase.from("video_form_analyses").delete().eq("id", id);
    if (error) { toast({ title: "Couldn't delete the analysis", description: error.message, variant: "destructive" }); return; }
    setHistory((h) => h.filter((r) => r.id !== id));
  };

  const busy = stage !== "idle";

  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Header */}
      <div className="px-5 pt-14 pb-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2">
          <Video size={20} className="text-electric-purple" />
          <h1 className="text-2xl font-display font-bold">AI Video Form Analysis</h1>
        </motion.div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
          className="text-sm text-muted-foreground mt-1">
          Upload a short clip and get an elite-coach breakdown of your technique.
        </motion.p>
      </div>

      {/* Tabs */}
      <div className="px-5 flex gap-2 mb-4">
        {(["analyse", "history"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === t ? "bg-gradient-primary text-primary-foreground shadow-glow" : "bg-card border border-border text-muted-foreground"
            }`}>
            {t === "analyse" ? "Analyse" : `History${history.length ? ` (${history.length})` : ""}`}
          </button>
        ))}
      </div>

      {tab === "analyse" && (
        <div className="px-5 space-y-4">
          {/* Plan banner */}
          <div className="flex items-center gap-2 text-[11px] rounded-xl border border-border bg-card px-3 py-2">
            {isPremium ? <Crown size={14} className="text-amber-400" /> : <Sparkles size={14} className="text-electric-blue" />}
            <span className="text-muted-foreground">
              {isPremium ? "Unlimited: analyses on our highest-accuracy model." : "Free plan: 1 analysis per week."}
            </span>
            {!isPremium && (
              <button onClick={() => navigate("/market")} className="ml-auto font-semibold text-electric-purple">Upgrade</button>
            )}
          </div>

          {/* Sport selector */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Movement type</h3>
            <div className="flex gap-2">
              {SPORTS.map((s) => (
                <button key={s.id} onClick={() => setSport(s.id)} disabled={busy}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-semibold border transition-colors ${
                    sport === s.id ? "border-electric-purple bg-electric-purple/10 text-electric-purple" : "border-border bg-card text-muted-foreground"
                  }`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Upload card */}
          <div className="bg-gradient-card border border-electric-purple/20 rounded-2xl p-4 shadow-card">
            <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" onChange={handleFile} className="hidden" />

            {videoUrl && (
              <div className="mb-3 rounded-xl overflow-hidden border border-border bg-black">
                <video src={videoUrl} controls playsInline className="w-full max-h-64" />
              </div>
            )}

            {busy ? (
              <div className="py-2">
                <div className="flex items-center gap-2 mb-2 text-sm">
                  <Loader2 size={16} className="animate-spin text-electric-purple" />
                  <span className="text-muted-foreground">
                    {stage === "uploading" ? "Uploading video…" : "Coach is analysing your movement…"}
                  </span>
                  <span className="ml-auto font-mono text-xs">{progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <motion.div className="h-full bg-gradient-primary" animate={{ width: `${progress}%` }} transition={{ ease: "easeOut" }} />
                </div>
              </div>
            ) : (
              <>
                <h3 className="font-display font-bold text-lg mb-1">Upload your clip</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  MP4, MOV or WebM · under 18MB · 5–15 seconds, full body in frame, side-on view works best.
                </p>
                <div className="flex gap-2">
                  <motion.button whileTap={{ scale: 0.98 }} onClick={() => fileRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">
                    <Upload size={18} /> {result ? "Analyse another video" : "Choose video"}
                  </motion.button>
                  {result && (
                    <button onClick={discardAnalysis}
                      className="flex items-center justify-center gap-2 bg-card border border-border px-4 py-3 rounded-xl text-muted-foreground">
                      <X size={18} />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Result */}
          <AnimatePresence>
            {result && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                {/* Score */}
                <div className="bg-gradient-card border border-border rounded-2xl p-5 shadow-card text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Overall form score</p>
                  <motion.p initial={{ scale: 0.8 }} animate={{ scale: 1 }}
                    className={`text-5xl font-display font-bold mt-1 ${scoreColor(result.overall_score)}`}>
                    {result.overall_score}
                    <span className="text-lg text-muted-foreground">/100</span>
                  </motion.p>
                  <div className="h-2 rounded-full bg-muted overflow-hidden mt-4">
                    <motion.div className="h-full bg-gradient-primary" initial={{ width: 0 }}
                      animate={{ width: `${result.overall_score}%` }} transition={{ duration: 0.8 }} />
                  </div>
                  {modelUsed && <p className="text-[10px] text-muted-foreground mt-2">Analysed with Vaylo Sports AI vision</p>}
                </div>

                {/* Coach summary */}
                <div className="bg-card border border-border rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles size={14} className="text-electric-purple" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-electric-purple">Coach summary</span>
                  </div>
                  <p className="text-sm leading-relaxed">{result.coach_summary}</p>
                </div>

                {/* Strengths */}
                <Section title="Strengths" icon={<TrendingUp size={14} className="text-emerald-400" />} accent="emerald">
                  {result.strengths?.map((s, i) => <Bullet key={i} text={s} tone="emerald" />)}
                </Section>

                {/* Improvements */}
                <Section title="Areas to improve" icon={<AlertTriangle size={14} className="text-amber-400" />} accent="amber">
                  {result.areas_to_improve?.map((s, i) => <Bullet key={i} text={s} tone="amber" />)}
                </Section>

                {/* Technique breakdown */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Technique breakdown</h3>
                  <div className="space-y-2">
                    {Object.entries(result.technical_analysis || {}).map(([k, v]) => (
                      <div key={k} className="bg-card border border-border rounded-xl p-3">
                        <p className="text-xs font-bold text-electric-blue mb-1">{TECH_LABELS[k] || k}</p>
                        <p className="text-sm text-muted-foreground leading-relaxed">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Drills */}
                <Section title="Recommended drills" icon={<Target size={14} className="text-electric-purple" />} accent="purple">
                  {result.recommended_drills?.map((d, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <div className="w-5 h-5 rounded-full bg-electric-purple/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[10px] font-bold text-electric-purple">{i + 1}</span>
                      </div>
                      <span>{d}</span>
                    </div>
                  ))}
                </Section>

                <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/40 border border-border rounded-xl p-3">
                  <Save size={14} className="text-emerald-400 flex-shrink-0" />
                  Saved to your athlete profile. Your video is never stored — only the report.
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {tab === "history" && (
        <div className="px-5 space-y-2">
          {history.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <History size={28} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No saved analyses yet.</p>
            </div>
          )}
          {history.map((row) => (
            <div key={row.id} className="bg-card border border-border rounded-xl overflow-hidden">
              <button onClick={() => setOpenHistory(openHistory === row.id ? null : row.id)}
                className="w-full p-3 flex items-center gap-3 text-start">
                <div className={`text-xl font-display font-bold ${scoreColor(row.overall_score || 0)}`}>{row.overall_score ?? "–"}</div>
                <div className="flex-1">
                  <p className="text-sm font-semibold capitalize">{row.sport_type} analysis</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(row.created_at).toLocaleDateString()} {row.video_name ? `· ${row.video_name}` : ""}
                  </p>
                </div>
                <motion.div animate={{ rotate: openHistory === row.id ? 90 : 0 }}>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </motion.div>
              </button>
              {openHistory === row.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="px-3 pb-3 space-y-2">
                  <p className="text-sm border-t border-border pt-2 leading-relaxed">{row.result?.coach_summary}</p>
                  {!!row.result?.areas_to_improve?.length && (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400 mb-1">Improve</p>
                      {row.result.areas_to_improve.map((s, i) => <Bullet key={i} text={s} tone="amber" />)}
                    </div>
                  )}
                  {!!row.result?.recommended_drills?.length && (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-electric-purple mb-1">Drills</p>
                      {row.result.recommended_drills.map((s, i) => <Bullet key={i} text={s} tone="purple" />)}
                    </div>
                  )}
                  <button onClick={() => deleteHistory(row.id)}
                    className="flex items-center gap-1.5 text-[11px] text-destructive font-semibold pt-1">
                    <Trash2 size={12} /> Delete analysis
                  </button>
                </motion.div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Section = ({ title, icon, children }: { title: string; icon: React.ReactNode; accent?: string; children: React.ReactNode }) => (
  <div className="bg-card border border-border rounded-2xl p-4">
    <div className="flex items-center gap-2 mb-2">
      {icon}
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
    </div>
    <div className="space-y-1.5">{children}</div>
  </div>
);

const Bullet = ({ text, tone }: { text: string; tone: "emerald" | "amber" | "purple" }) => {
  const dot = tone === "emerald" ? "bg-emerald-400" : tone === "amber" ? "bg-amber-400" : "bg-electric-purple";
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${dot}`} />
      <span className="leading-relaxed">{text}</span>
    </div>
  );
};

export default VideoFormAnalysis;
