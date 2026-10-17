import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Video,
  Film,
  Send,
  CheckCircle2,
  CircleDot,
  AlertTriangle,
  ArrowRightLeft,
  PauseCircle,
  RefreshCw,
  Play,
  Square,
  Clock,
  Loader2,
  ExternalLink,
  TrendingUp,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

// Supabase v2 removed `auth.user()`; this is the way every owner-scope check
// in this file reads the caller. Returns null while the session resolves.
async function currentOwnerId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
import { useAuth } from "@/contexts/AuthContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What each stage of the ad workflow is currently doing. */
export type StageName =
  | "brain"        // OpenAI: writes the brief, concepts, script
  | "prep"         // media prep: fetch clips, transcription, captions
  | "edit"         // the AI is editing the video
  | "qc"           // quality control: harsh pass, sends back if not good enough
  | "post"         // automatic post to TikTok
  | "done";        // finished, brain knows it's posted

export type JobStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export interface PipelineJob {
  id: string;
  name: string;
  stage: StageName;
  status: JobStatus;
  progress: number; // 0-100
  message: string;
  step: number; // which step in the stage we're on
  details: Record<string, unknown> | null; // stage-specific payload for chat
  campaign_id: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
  human_input: string | null; // DB column — what the user typed into this stage's chatbot
  /** Client-side convenience marker only — NOT a pipeline_jobs column; it is
   *  stripped before every insert. */
  lastAction?: string;
}
// NOTE: the interface mirrors the DB COLUMN NAMES (snake_case) because job
// rows arrive straight from `pipeline_jobs` without a mapping pass — the old
// camelCase fields (createdAt/updatedAt/humanInput) never matched anything.

// ---------------------------------------------------------------------------
// Static stage config — the "office"
// ---------------------------------------------------------------------------

interface StageCard {
  key: StageName;
  label: string;
  subtitle: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  order: number;
}

const STAGES: StageCard[] = [
  {
    key: "brain",
    label: "BRAIN",
    subtitle: "OpenAI · decides what to say",
    icon: Brain,
    color: "text-primary",
    bg: "bg-primary/10",
    order: 0,
  },
  {
    key: "prep",
    label: "PREP",
    subtitle: "clip + caption assembly",
    icon: Film,
    color: "text-secondary",
    bg: "bg-secondary/10",
    order: 1,
  },
  {
    key: "edit",
    label: "EDIT",
    subtitle: "AI is editing the video",
    icon: Video,
    color: "text-accent",
    bg: "bg-accent/10",
    order: 2,
  },
  {
    key: "qc",
    label: "QC",
    subtitle: "harsh quality gate · auto-rejects",
    icon: AlertTriangle,
    color: "text-destructive",
    bg: "bg-destructive/10",
    order: 3,
  },
  {
    key: "post",
    label: "POST",
    subtitle: "auto post to TikTok",
    icon: Send,
    color: "text-success",
    bg: "bg-success/10",
    order: 4,
  },
  {
    key: "done",
    label: "DONE",
    subtitle: "brain knows it's published",
    icon: CheckCircle2,
    color: "text-muted-foreground",
    bg: "bg-muted/10",
    order: 5,
  },
];

// ---------------------------------------------------------------------------
// Data access — pipeline jobs persisted in Supabase
// ---------------------------------------------------------------------------

async function listPipelineJobs(): Promise<PipelineJob[]> {
  const ownerId = await currentOwnerId();
  const { data, error } = await supabase
    .from("pipeline_jobs")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as PipelineJob[];
}

/** Only DB-typed columns travel into pipeline_jobs — lastAction is client-side. */
type PipelineJobInsert = Omit<PipelineJob, "id"> & { id?: string };

async function createPipelineJob(job: PipelineJobInsert) {
  // Column-for-column mapping rather than a spread: the pipeline_jobs Insert
  // type wants exact Json-compatible values (`details` is Json, not
  // Record<string, unknown>) and must never receive lastAction.
  const ownerId = await currentOwnerId();
  const { data: inserted, error } = await supabase
    .from("pipeline_jobs")
    .insert({
      id: job.id ?? crypto.randomUUID(),
      name: job.name,
      stage: job.stage,
      status: job.status,
      progress: job.progress,
      message: job.message,
      step: job.step,
      details: (job.details ?? {}) as unknown as Json,
      campaign_id: job.campaign_id ?? null,
      owner_id: ownerId ?? "",
      created_at: job.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      human_input: job.human_input ?? null,
    })
    .select()
    .single();
  if (error || !inserted) return null;
  return inserted as unknown as PipelineJob;
}

async function updatePipelineJobStatus(jobId: string, status: JobStatus, progress: number, message: string) {
  const { error } = await supabase
    .from("pipeline_jobs")
    .update({
      status,
      progress,
      message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  return !error;
}

// ---------------------------------------------------------------------------
// Chatbot for each stage
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  text: string;
  timestamp: string;
}

async function getStageChat(stage: StageName): Promise<ChatMessage[]> {
  const ownerId = await currentOwnerId();
  const { data, error } = await supabase
    .from("pipeline_chat")
    .select("*")
    .eq("stage", stage)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data ?? []) as ChatMessage[];
}

async function saveStageChat(stage: StageName, message: ChatMessage) {
  const ownerId = await currentOwnerId();
  const { error } = await supabase
    .from("pipeline_chat")
    .insert({
      id: message.id,
      role: message.role,
      text: message.text,
      timestamp: message.timestamp,
      stage,
      owner_id: ownerId ?? "",
    });
  return !error;
}

// ---------------------------------------------------------------------------
// Pipeline step runner
// ---------------------------------------------------------------------------

/** Simulate triggering the next stage of the pipeline. Returns the new job. */
async function triggerNextStage(campaignId: string | null): Promise<PipelineJob | null> {
  // If a run already exists for this campaign, resume it
  const ownerId = await currentOwnerId();
  const { data: existing } = await supabase
    .from("pipeline_jobs")
    .select("*")
    .eq("campaign_id", campaignId ?? "")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && (existing.status === "running" || existing.status === "queued")) {
    return existing as PipelineJob;
  }

  // Start a fresh run at the first stage
  const now = new Date().toISOString();
  const newJob: PipelineJobInsert = {
    id: crypto.randomUUID(),
    name: campaignId ? `Campaign ${campaignId}` : "Unnamed campaign",
    stage: "brain",
    status: "queued",
    progress: 0,
    message: "Starting pipeline…",
    step: 1,
    details: { action: "start" },
    campaign_id: campaignId ?? null,
    owner_id: ownerId ?? "",
    created_at: now,
    updated_at: now,
    lastAction: "user",
    human_input: "",
  };

  const created = await createPipelineJob(newJob);
  return created ?? null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PipelineDashboard() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState<StageName | null>(null);
  // Loadout maps start PARTIALLY filled — stages get their entries as they are
  // written, and every reader already guards with ?? [] / ?? "".
  const [messages, setMessages] = useState<Partial<Record<StageName, ChatMessage[]>>>({});
  const [input, setInput] = useState("");
  const [userInput, setUserInput] = useState<Partial<Record<StageName, string>>>({});
  const [errored, setErrored] = useState<Partial<Record<StageName, string | null>>>({});

  // Load jobs on mount
  useEffect(() => {
    (async () => {
      if (!user) return;
      const list = await listPipelineJobs();
      setJobs(list);
      setLoading(false);
    })();
  }, [user]);

  // Load stage chat
  useEffect(() => {
    (async () => {
      if (!user) return;
      const stage = chatOpen;
      if (!stage) return;
      const msgs = await getStageChat(stage);
      setMessages((m) => ({ ...m, [stage]: msgs }));
    })();
  }, [user, chatOpen]);

  const runningJob = jobs.find((j) => j.status === "running" || j.status === "queued");
  const currentStage = runningJob?.stage ?? ("done" as StageName);

  // Stage status summary for the timeline
  const stageCounts = useMemo(() => {
    const counts: Record<StageName, number> = {
      brain: 0, prep: 0, edit: 0, qc: 0, post: 0, done: 0,
    };
    jobs.forEach((j) => {
      if (j.stage in counts) counts[j.stage as StageName] += 1;
    });
    return counts;
  }, [jobs]);

  const activeStages = useMemo(() => {
    const active: StageName[] = [];
    const seen = new Set<StageName>();
    for (const s of STAGES) {
      seen.add(s.key);
      const has = jobs.some((j) => j.stage === s.key) || stageCounts[s.key] > 0;
      if (has) active.push(s.key);
    }
    return active;
  }, [jobs, stageCounts]);

  const currentStageCard = STAGES.find((s) => s.key === currentStage)!;

  // ── Stage controls ───────────────────────────────────────────────
  const startPipeline = async () => {
    const job = await triggerNextStage(null);
    if (job) {
      setJobs((prev) => [job, ...prev]);
      setChatOpen(job.stage);
    }
  };

  const stopJob = async (jobId: string) => {
    const ok = await updatePipelineJobStatus(jobId, "stopped", 100, "User stopped — will not continue");
    if (ok) {
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: "stopped" } : j)));
    }
  };

  const retryStage = async (jobId: string, stage: StageName) => {
    const ok = await updatePipelineJobStatus(jobId, "running", 0, "Retrying after fix");
    if (ok) {
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: "running", stage, progress: 0 } : j)));
    }
  };

  // ── Chatbot send ────────────────────────────────────────────────
  const sendChat = async (stage: StageName, text: string) => {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      timestamp: new Date().toISOString(),
    };
    setUserInput((prev) => ({ ...prev, [stage]: text }));
    setMessages((prev) => ({ ...prev, [stage]: [...(prev[stage] ?? []), msg] }));
    await saveStageChat(stage, msg);

    // Simulate assistant response
    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: getAssistantReply(stage, text),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => ({ ...prev, [stage]: [...(prev[stage] ?? []), reply] }));
    await saveStageChat(stage, reply);

    // Optional: if the user says "start", kick off the pipeline
    if (text.toLowerCase().includes("start") && !runningJob) {
      const job = await triggerNextStage(null);
      if (job) {
        setJobs((prev) => [job, ...prev]);
        setChatOpen(job.stage);
      }
    }
  };

  function getAssistantReply(stage: StageName, text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes("start")) return "Starting the pipeline now. Watch the timeline above.";
    if (lower.includes("stop") || lower.includes("cancel")) {
      return "I've stopped the current stage. If needed, fix the issue and click Retry below.";
    }
    if (lower.includes("help")) {
      return `I'm ${stage.toUpperCase()}. What would you like to do? Type "start" to begin, "stop" to pause, or give me a task.`;
    }
    return `Got it. I'll act on "${text}" in ${stage}. You'll see the result on the timeline.`;
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="px-6 py-4 max-w-7xl mx-auto">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
                <Brain size={18} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">Pipeline Dashboard</h1>
                <p className="text-xs text-muted-foreground">
                  Watch the ad workflow: Brain → Prep → Edit → QC → Post → Done
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {runningJob ? (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => stopJob(runningJob.id)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-destructive/10 text-destructive border border-destructive/20 text-sm hover:bg-destructive/20 transition-colors"
                >
                  <Square size={14} /> Stop running
                </motion.button>
              ) : (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={startPipeline}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
                >
                  <Play size={14} /> Start Pipeline
                </motion.button>
              )}
              <span className="text-xs text-muted-foreground">
                {user?.email ?? "signed in"}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="px-6 py-4 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* ── Timeline ── */}
          <div className="lg:col-span-6">
            <div className="bg-card rounded-2xl border border-border p-5">
              <div className="flex items-center gap-2 mb-4">
                <Zap size={16} className="text-primary" />
                <h2 className="font-semibold text-sm">Pipeline timeline</h2>
                <span className="text-xs text-muted-foreground">
                  {jobs.length} job{jobs.length !== 1 ? "s" : ""} active
                </span>
              </div>

              {/* Progress dots */}
              <div className="flex items-center gap-1.5 mb-4">
                {STAGES.map((st) => {
                  const active = stageCounts[st.key] > 0;
                  const current = st.key === currentStage && runningJob?.status !== "stopped";
                  return (
                    <button
                      key={st.key}
                      onClick={() => setChatOpen(st.key)}
                      className={`
                        flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all
                        ${st.key === currentStage
                          ? "bg-primary/15 text-primary"
                          : active
                            ? "bg-secondary/50 text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }
                      `}
                      title={st.key === currentStage ? "Current stage" : "Click to view details"}
                    >
                      {current && <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 1.5 }}>●</motion.div>}
                      <st.icon size={11} />
                      {st.label}
                    </button>
                  );
                })}
              </div>

              {/* Active run card */}
              {runningJob ? (
                <div className={`rounded-xl border p-4 space-y-3 ${
                  runningJob.status === "running"
                    ? "border-primary/30 bg-primary/5"
                    : runningJob.status === "completed"
                      ? "border-green-500/30 bg-green-500/5"
                      : runningJob.status === "failed"
                        ? "border-destructive/30 bg-destructive/5"
                        : "border-border"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {(() => {
                        // An ElementType must be rendered as an element, not as
                        // a document-text child.
                        const StageIcon = STAGES.find((s) => s.key === runningJob.stage)?.icon ?? Zap;
                        return <StageIcon size={16} />;
                      })()}
                      <div>
                        <div className="text-sm font-semibold">{runningJob.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Stage: {runningJob.stage.toUpperCase()} · Step {runningJob.step}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{runningJob.message}</span>
                      <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          animate={{ width: `${runningJob.progress}%` }}
                          transition={{ duration: 0.5 }}
                          style={{ background: runningJob.status === "running"
                            ? "linear-gradient(90deg, #818cf8, #6366f1)"
                            : runningJob.status === "completed"
                              ? "linear-gradient(90deg, #22c55e, #16a34a)"
                              : "linear-gradient(90deg, #f59e0b, #d97706)" }}
                        />
                      </div>
                      <span className="text-xs font-mono">{runningJob.progress}%</span>
                    </div>
                  </div>
                  {runningJob.details && (
                    <pre className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2 overflow-auto max-h-20">
                      {JSON.stringify(runningJob.details, null, 2)}
                    </pre>
                  )}
                  <div className="flex gap-2">
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => stopJob(runningJob.id)}
                      className="px-2 py-1 text-xs bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20"
                    >
                      Stop
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => retryStage(runningJob.id, runningJob.stage)}
                      className="px-2 py-1 text-xs bg-secondary text-foreground rounded-lg hover:bg-secondary/80"
                    >
                      Retry
                    </motion.button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No pipeline run yet. Click "Start Pipeline" to begin.
                </div>
              )}
            </div>
          </div>

          {/* ── Stage chatbot panel ── */}
          <div className="lg:col-span-6">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center gap-2">
                <Brain size={16} className="text-primary" />
                <h2 className="font-semibold text-sm flex-1">Stage control</h2>
                <span className="text-xs text-muted-foreground">
                  {chatOpen ? `Chat: ${chatOpen.toUpperCase()}` : "No stage selected"}
                </span>
                <button
                  onClick={() => setChatOpen(null)}
                  className="p-1 rounded-lg hover:bg-muted transition-colors"
                >
                  <Square size={14} className="text-muted-foreground" />
                </button>
              </div>

              <div className="p-5 space-y-3 max-h-[420px] overflow-y-auto">
                {/* Chat messages */}
                {chatOpen && messages[chatOpen] ? (
                  <div className="space-y-2">
                    {(messages[chatOpen] ?? []).map((m) => (
                      <div
                        key={m.id}
                        className={`
                          text-xs rounded-xl px-3 py-2 max-w-[80%] leading-relaxed
                          ${m.role === "user"
                            ? "bg-primary/15 text-primary ml-auto"
                            : m.role === "assistant"
                              ? "bg-muted text-foreground mr-auto"
                              : "bg-muted/50 text-muted-foreground"
                          }
                        `}
                      >
                        {m.text}
                        <span className="text-[10px] text-muted-foreground/60 block mt-0.5">
                          {new Date(m.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-4">
                    Select a stage above, or start the pipeline.
                  </div>
                )}
              </div>

              {/* Chat input */}
              {chatOpen && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const text = userInput[chatOpen]?.trim();
                    if (!text) return;
                    await sendChat(chatOpen, text);
                    setUserInput((prev) => ({ ...prev, [chatOpen]: "" }));
                  }}
                  className="border-t border-border p-3 flex gap-2"
                >
                  <input
                    value={userInput[chatOpen] ?? ""}
                    onChange={(e) => setUserInput((prev) => ({ ...prev, [chatOpen]: e.target.value }))}
                    placeholder={`Message ${currentStageCard.label.toLowerCase()}`}
                    className="flex-1 bg-muted border border-border rounded-xl px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
                  />
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    type="submit"
                    className="px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90"
                  >
                    Send
                  </motion.button>
                </form>
              )}
            </div>
          </div>
        </div>

        {/* ── Job details (expandable) ── */}
        {jobs.map((job) => (
          <div
            key={job.id}
            className="bg-card border border-border rounded-xl p-4 mt-3 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-2 h-2 rounded-full mt-1.5 ${job.status === "completed" ? "bg-green-500" : job.status === "failed" ? "bg-red-500" : job.status === "running" ? "bg-primary animate-pulse" : "bg-yellow-500"}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold truncate">{job.name}</h3>
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                      job.status === "completed"
                        ? "bg-green-100 text-green-700"
                        : job.status === "failed"
                          ? "bg-red-100 text-red-700"
                          : job.status === "running"
                            ? "bg-primary/15 text-primary"
                            : job.status === "stopped"
                              ? "bg-muted text-muted-foreground"
                              : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {job.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {job.stage.toUpperCase()} · Step {job.step} · {job.message}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Last: {job.lastAction} · {new Date(job.updated_at).toLocaleString()}
                </p>
                {job.human_input && (
                  <p className="text-[10px] text-primary/80 mt-0.5 font-mono">
                    User: {job.human_input}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
