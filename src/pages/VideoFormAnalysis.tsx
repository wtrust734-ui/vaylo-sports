import { getAiLocale } from "@/i18n";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Video, Upload, Loader2, Sparkles, TrendingUp, AlertTriangle, Target,
  ChevronRight, History, Trash2, Crown, Save, X, Clock,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { getLocalPBs } from "@/lib/athleteDossier";
import { formatShortDate } from "@/i18n/format";
import { AI_NOT_READY_MESSAGE, isNotReadyMessage } from "@/lib/edgeErrors";
import { creditCost } from "@/lib/credits";
import {
  FORM_VIDEO_BUCKET,
  FORM_VIDEO_LIMITS_COPY,
  checkFormVideo,
  formVideoPath,
  readVideoDuration,
} from "@/lib/formVideo";

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
  /**
   * The clip's timeline: what the coach saw, in order, at timestamps the
   * athlete can scrub to. Every other line in the report traces back to one of
   * these, which is what makes the feedback checkable rather than confident.
   */
  moments?: { t: string; what: string; why: string }[];
  focus_next_session?: string;
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
  const activeRequestId = useRef<string | null>(null);

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
    activeRequestId.current = null;
  };

  /**
   * Choose → check → upload → analyse.
   *
   * The clip never passes through this JavaScript function's request body: it
   * goes to a private Storage bucket under the athlete's own id, and the edge
   * function is told the path. That is what lifted the old six-megabyte ceiling
   * (base64 inside a JSON body) and allows a clip long enough to show a whole
   * rep. The limits themselves live in src/lib/formVideo.ts, the same rules the
   * server applies, so the athlete is told before a 25MB upload rather than
   * after a refusal.
   */
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!user) { toast({ title: "Sign in to analyse videos", variant: "destructive" }); return; }

    reset();
    setFileName(file.name);
    setVideoUrl(URL.createObjectURL(file));
    setStage("uploading");
    setProgress(10);

    // Read the clip's own length before uploading anything: a two-minute file
    // is rejected here rather than moved and then refused by the server.
    const seconds = await readVideoDuration(file);
    const check = checkFormVideo({ mimeType: file.type, bytes: file.size, seconds });
    if (!check.ok) {
      toast({ title: "Cannot analyse this clip", description: check.message, variant: "destructive" });
      reset();
      return;
    }

    activeRequestId.current = crypto.randomUUID();
    const path = formVideoPath(user.id, file.type, activeRequestId.current);
    let uploaded = false;

    try {
      const { error: uploadError } = await supabase.storage
        .from(FORM_VIDEO_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error("The clip could not be uploaded. Check your connection and try again.");
      uploaded = true;
      setProgress(55);
      setStage("analysing");
      setProgress(80);

      const { data, error } = await supabase.functions.invoke("video-form-analysis", {
        body: { request_id: activeRequestId.current, storage_path: path, mime_type: file.type, duration_seconds: seconds, sport_type: sport, video_name: file.name, userLocale: getAiLocale(), pbs: getLocalPBs().slice(0, 20).map((p) => ({ metric: p.metric, value: p.value, unit: p.unit, date: p.date })) },
      });

      if (error) {
        let msg = error.message;
        const err = error as { context?: { text?: () => Promise<string> } };
        try { const ctx = err.context; if (ctx?.text) { const parsed = JSON.parse(await ctx.text()); msg = parsed.error || msg; } } catch { /* ignore */ }
        throw new Error(isNotReadyMessage(msg) ? AI_NOT_READY_MESSAGE : msg);
      }
      const payload = (data ?? {}) as { error?: string; result?: AnalysisResult; model?: string; saved_id?: string | null; cost?: number };
      if (payload.error) throw new Error(isNotReadyMessage(payload.error) ? AI_NOT_READY_MESSAGE : payload.error);

      setProgress(100);
      setResult(payload.result as AnalysisResult);
      setModelUsed(payload.model);
      setLastId(payload.saved_id ?? null);
      setStage("idle");
      loadHistory();
      toast({
        title: "Analysis ready 🎯",
        description: (payload.cost ?? 0) > 0 ? `${payload.cost} credits used.` : undefined,
      });
    } catch (err) {
      // Nothing was analysed, so the upload is removed here instead of being
      // left for a retention sweep. If the call did reach the function, it has
      // already deleted the object itself and this is a no-op.
      if (uploaded) await supabase.storage.from(FORM_VIDEO_BUCKET).remove([path]);
      setStage("idle");
      setProgress(0);
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    }
  };

  // Clearing the workspace only clears the screen. The analysis the athlete
  // paid for stays saved in History: the old behaviour unsaved the row here
  // (saved=false), which took a paid report out of History and put it on the
  // 30-day retention sweep — an X button that deletes what you just bought is
  // a footgun, not a dismissal. Deleting lives in History, next to the report,
  // where the athlete can see what they are removing. The clip itself is
  // already gone — it is deleted when the analysis returns, and only the
  // structured report row is kept.
  const discardAnalysis = async () => {
    const kept = !!lastId;
    loadHistory();
    reset();
    toast({
      title: kept ? "Workspace cleared — analysis kept in History" : "Workspace cleared",
    });
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
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2">
          <Video size={20} className="text-electric-purple" />
          <h1 className="text-2xl font-display font-bold">AI Video Form Analysis</h1>
        </motion.div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
          className="text-sm text-muted-foreground mt-1">
          Upload a clip and get an elite-coach breakdown of what your body actually does — with the
          timestamps to check it.
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
          <div className="flex items-center gap-2 text-[12px] rounded-xl border border-border bg-card px-3 py-2">
            {isPremium ? <Crown size={14} className="text-amber-400" /> : <Sparkles size={14} className="text-electric-blue" />}
            <span className="text-muted-foreground">
              {isPremium
                ? `Up to 10 highest-accuracy analyses per month; further analyses cost ${creditCost("video_form_analysis")} credits.`
                : `1 Flash analysis per week, then ${creditCost("video_form_analysis")} credits per analysis.`}
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
                  {/* The clip is uploaded in one piece — Storage reports no
                      per-chunk progress to the browser — so the bar is staged
                      rather than measured, and the stage text carries the
                      meaning. */}
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <motion.div className="h-full bg-gradient-primary" animate={{ width: `${progress}%` }} transition={{ ease: "easeOut" }} />
                </div>
              </div>
            ) : (
              <>
                <h3 className="font-display font-bold text-lg mb-1">Upload your clip</h3>
                <p className="text-sm text-muted-foreground mb-3">{FORM_VIDEO_LIMITS_COPY}</p>
                <div className="flex gap-2">
                  <motion.button whileTap={{ scale: 0.98 }} onClick={() => fileRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">
                    <Upload size={18} /> {result ? "Analyse another video" : "Choose video"}
                  </motion.button>
                  {result && (
                    <button onClick={discardAnalysis}
                      aria-label="Clear workspace (keeps the saved analysis in History)"
                      title="Clear workspace — the saved analysis stays in History"
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
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Overall form score</p>
                  <motion.p initial={{ scale: 0.8 }} animate={{ scale: 1 }}
                    className={`text-5xl font-display font-bold mt-1 ${scoreColor(result.overall_score)}`}>
                    {result.overall_score}
                    <span className="text-lg text-muted-foreground">/100</span>
                  </motion.p>
                  <div className="h-2 rounded-full bg-muted overflow-hidden mt-4">
                    <motion.div className="h-full bg-gradient-primary" initial={{ width: 0 }}
                      animate={{ width: `${result.overall_score}%` }} transition={{ duration: 0.8 }} />
                  </div>
                  {modelUsed && <p className="text-[12px] text-muted-foreground mt-2">Analysed with Vaylo Sports AI vision</p>}
                </div>

                {/* Coach summary */}
                <div className="bg-card border border-border rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles size={14} className="text-electric-purple" />
                    <span className="text-[12px] font-bold uppercase tracking-wider text-electric-purple">Coach summary</span>
                  </div>
                  <p className="text-sm leading-relaxed">{result.coach_summary}</p>
                </div>

                {/* What happens in the clip — the timeline the rest of the
                    report is built from. It sits directly under the summary
                    because it is the part the athlete can check: every row is a
                    timestamp they can scrub to, and the coach was asked to make
                    every other claim traceable to one of them. */}
                {!!result.moments?.length && (
                  <div className="bg-card border border-border rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Clock size={14} className="text-electric-blue" />
                      <span className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">What happens in the clip</span>
                    </div>
                    <ol className="space-y-3">
                      {result.moments.map((m, i) => (
                        <li key={`${m.t}-${i}`} className="flex gap-3">
                          <span className="mt-0.5 h-fit shrink-0 rounded-md bg-electric-blue/10 px-2 py-0.5 font-mono text-[12px] font-bold text-electric-blue">
                            {m.t}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm leading-relaxed">{m.what}</span>
                            <span className="block text-[12px] leading-relaxed text-muted-foreground">{m.why}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* One change, chosen for them. A report with eight
                    improvements is a report nobody acts on. */}
                {!!result.focus_next_session && (
                  <div className="rounded-2xl border border-primary/25 bg-gradient-card p-4 shadow-card">
                    <p className="text-[12px] font-bold uppercase tracking-wider text-primary">Focus next session</p>
                    <p className="mt-1 text-sm leading-relaxed">{result.focus_next_session}</p>
                  </div>
                )}

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
                        <span className="text-[12px] font-bold text-electric-purple">{i + 1}</span>
                      </div>
                      <span>{d}</span>
                    </div>
                  ))}
                </Section>

                <div className="flex items-center gap-2 text-[12px] text-muted-foreground bg-muted/40 border border-border rounded-xl p-3">
                  <Save size={14} className="text-emerald-400 flex-shrink-0" />
                  Saved to your athlete profile. The clip is deleted from our servers the moment the
                  report is written — only the report is kept.
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
                  <p className="text-[12px] text-muted-foreground">
                    {formatShortDate(row.created_at)} {row.video_name ? `· ${row.video_name}` : ""}
                  </p>
                </div>
                <motion.div animate={{ rotate: openHistory === row.id ? 90 : 0 }}>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </motion.div>
              </button>
              {openHistory === row.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="px-3 pb-3 space-y-2">
                  <p className="text-sm border-t border-border pt-2 leading-relaxed">{row.result?.coach_summary}</p>
                  {!!row.result?.focus_next_session && (
                    <p className="text-[12px] leading-relaxed text-primary">Focus: {row.result.focus_next_session}</p>
                  )}
                  {!!row.result?.areas_to_improve?.length && (
                    <div>
                      <p className="text-[12px] font-bold uppercase tracking-wider text-amber-400 mb-1">Improve</p>
                      {row.result.areas_to_improve.map((s, i) => <Bullet key={i} text={s} tone="amber" />)}
                    </div>
                  )}
                  {!!row.result?.recommended_drills?.length && (
                    <div>
                      <p className="text-[12px] font-bold uppercase tracking-wider text-electric-purple mb-1">Drills</p>
                      {row.result.recommended_drills.map((s, i) => <Bullet key={i} text={s} tone="purple" />)}
                    </div>
                  )}
                  <button onClick={() => deleteHistory(row.id)}
                    className="flex items-center gap-1.5 text-[12px] text-destructive font-semibold pt-1">
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
      <span className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
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
