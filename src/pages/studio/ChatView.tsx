import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, ListPlus, AlertCircle, BrainCircuit, CheckCircle2, CircleDashed } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  listChatSessions,
  listChatMessages,
  sendChatMessage,
  type ChatSession,
  type LibraryItem as _Unused,
} from "./api";
import {
  isRunnable,
  runChatBuild,
  persistRunResult,
  type PlanStep,
  type RunDeliverable,
  type RunEvent,
} from "./chatRun";

type Deliverable = Exclude<RunDeliverable, { kind: "failed" }>;

interface Bubble {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent: string | null;
  plan: { type: string; options: Record<string, unknown> }[];
  classificationSource?: string;
  // Live build state — never loaded from history; only the FINAL result is
  // persisted (as a plain message with refs), progress lines stay local.
  run?: {
    status: "running" | "done" | "failed";
    lines: RunEvent[];
    deliverable?: Deliverable | null;
  };
}

const STEP_LABEL: Record<string, string> = {
  image_ad: "Image ad",
  video_ad: "Video ad",
  competitor_research: "Competitor research",
  campaign_ideation: "Concepts",
  creative_revision: "Revision",
  asset_library: "Asset library",
  platform_question: "Question",
  campaign_analyse: "Campaign review",
  export_asset: "Export",
};

/**
 * The brief for a planned step is the user's own message: find the nearest
 * preceding user bubble to this assistant bubble so a plan shown from stored
 * history still carries its original wording.
 */
function userBriefBefore(bubbles: Bubble[], index: number): string {
  for (let i = index - 1; i >= 0; i -= 1) {
    const b = bubbles[i];
    if (b.role === "user" && b.content.trim()) return b.content.trim();
  }
  return "";
}

function optionsSummary(o: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof o.format === "string") parts.push(o.format);
  if (typeof o.durationSeconds === "number") parts.push(`${o.durationSeconds}s`);
  if (typeof o.conceptCount === "number") parts.push(`${o.conceptCount} options`);
  if (Array.isArray(o.competitors) && o.competitors.length) parts.push(o.competitors.join(", "));
  if (typeof o.platform === "string") parts.push(o.platform);
  if (typeof o.revisionTarget === "string") parts.push(o.revisionTarget);
  return parts.join(" · ");
}

function describeDeliverable(d: Deliverable): string {
  if (d.kind === "video") {
    return [
      `Video ad complete — ${d.shotsDone} shot${d.shotsDone === 1 ? "" : "s"} generated${d.researchProjectId ? ", grounded in the research run above" : ""}.`,
      d.notes.length ? d.notes[0] + ". " : "",
      d.publicUrl
        ? "The finished file is playing above and is stored in your private ads library."
        : "The render stayed queued with the editor; the shots and narration are safe in the Video Ads workspace and the library — ask here again to check on it.",
    ].filter(Boolean).join(" ");
  }
  return [
    `Image ad complete${d.researchProjectId ? " — grounded in the research run above" : ""}.`,
    ` Headline: “${d.headline}” · CTA: ${d.cta}.`,
    d.previewUrl
      ? " The finished ad is shown above; export it in the Image Ads workspace."
      : d.notes.length
        ? " The compose step failed, so the generated background is shown instead — retry compose in the Image Ads workspace."
        : " The finished ad is in the Image Ads workspace.",
  ].join("");
}

export default function ChatView({ onOpenVideoWorkflow }: { onOpenVideoWorkflow?: (brief: string) => void }) {
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // A send response already carries the assistant reply locally; loading the
  // stored history right after arriving would replace those local bubbles
  // (momentarily blanking the conversation). Skip one history load per send.
  const skipHistoryLoad = useRef(false);

  useEffect(() => {
    listChatSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setBubbles([]);
      return;
    }
    if (skipHistoryLoad.current) {
      skipHistoryLoad.current = false;
      return;
    }
    setLoadingHistory(true);
    let alive = true;
    listChatMessages(sessionId)
      .then((rows) => {
        if (!alive) return;
        setBubbles(
          rows.map((r) => ({
            id: r.id,
            role: r.role === "assistant" ? "assistant" : "user",
            content: r.content,
            intent: r.intent,
            // plan is { steps, primary, clarification? } persisted by the function
            plan:
              (r.plan as { steps?: { type: string; options: Record<string, unknown> }[]; primary?: string })?.steps ?? [],
            classificationSource: (r.plan as { classificationSource?: string }).classificationSource,
          })),
        );
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoadingHistory(false));
    return () => {
      alive = false;
    };
  }, [sessionId]);

  useEffect(() => {
    // scrollIntoView exists in every browser but not under jsdom — guard it.
    const el = bottomRef.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth" });
  }, [bubbles.length, sending, runningIndex]);

  const patchBubble = useCallback((index: number, patch: (b: Bubble) => Bubble) => {
    setBubbles((bs) => bs.map((b, i) => (i === index ? patch(b) : b)));
  }, []);

  const submit = async () => {
    const content = input.trim();
    if (!content || sending) return; // duplicate-submission guard
    if (runningIndex !== null) return; // one build at a time
    setSending(true);
    setError(null);
    setInput("");
    const optimistic: Bubble = { id: `local-${Date.now()}`, role: "user", content, intent: null, plan: [] };
    setBubbles((b) => [...b, optimistic]);
    try {
      const res = await sendChatMessage(sessionId, content);
      skipHistoryLoad.current = true;
      setSessionId(res.sessionId);
      setBubbles((b) => [
        ...b,
        {
          id: res.assistant.id,
          role: "assistant",
          content: res.assistant.content,
          intent: res.assistant.intent,
          plan: res.assistant.plan,
          classificationSource: res.assistant.classificationSource,
        },
      ]);
      listChatSessions().then(setSessions).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The assistant is unavailable.");
      setBubbles((b) => b.filter((x) => x !== optimistic || true));
    } finally {
      setSending(false);
    }
  };

  const startNew = () => {
    setSessionId(null);
    setBubbles([]);
    setError(null);
  };

  // ------------------------------------------------------------------ build
  const startBuild = async (index: number, brief: string) => {
    const bubble = bubbles[index];
    if (!bubble || runningIndex !== null || !isRunnable(bubble.plan)) return;
    setRunningIndex(index);
    setError(null);
    patchBubble(index, (b) => ({ ...b, run: { status: "running", lines: [{ level: "start", text: "Build started — everything now runs automatically, live updates below" }] } }));

    const push = (event: RunEvent) => {
      // Keep the timeline bounded so long shot polls do not flood the thread.
      patchBubble(index, (b) => {
        const lines = [...(b.run?.lines ?? []), event];
        const trimmed = lines.length > 60 ? lines.slice(lines.length - 60) : lines;
        return { ...b, run: { status: b.run?.status ?? "running", lines: trimmed, deliverable: b.run?.deliverable ?? null } };
      });
    };

    try {
      const outcome = await runChatBuild({ brief, steps: bubble.plan }, push);
      if (outcome.kind === "failed") {
        push({ level: "error", text: `Build stopped: ${outcome.reason}` });
      }
      if (sessionId) {
        const intent = bubble.intent ?? outcome.kind;
        const content =
          outcome.kind === "failed" ? `Build finished with a stop: ${outcome.reason}` : describeDeliverable(outcome);
        try {
          await persistRunResult(sessionId, intent, content, {
            steps: bubble.plan,
            primary: intent,
            run: {
              brief,
              deliverable: outcome.kind === "failed" ? null : { kind: outcome.kind, publicUrl: outcome.kind === "video" ? outcome.publicUrl : outcome.previewUrl },
            },
          });
        } catch {
          // The message still shows in the live thread; a persistence failure is
          // surfaced as a small error without losing the deliverable.
          setError("The build result could not be saved to the conversation history.");
        }
      }
      patchBubble(index, (b) => ({
        ...b,
        run: {
          status: outcome.kind === "failed" ? "failed" : "done",
          lines: b.run?.lines ?? [],
          deliverable: outcome.kind === "failed" ? null : outcome,
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The build failed.";
      push({ level: "error", text: msg });
      patchBubble(index, (b) => ({ ...b, run: { status: "failed", lines: b.run?.lines ?? [], deliverable: null } }));
    } finally {
      setRunningIndex(null);
    }
  };

  return (
    <div className="flex h-full min-h-[70vh] flex-col lg:flex-row gap-4">
      {/* Session list */}
      <aside className="flex w-full shrink-0 gap-2 overflow-x-auto lg:w-56 lg:flex-col lg:overflow-y-auto">
        <button
          onClick={startNew}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-[#8505D5] px-3 py-2 text-sm text-white"
        >
          <ListPlus className="h-4 w-4" /> New request
        </button>
        {(sessions ?? []).map((s) => (
          <button
            key={s.id}
            onClick={() => setSessionId(s.id)}
            className={`shrink-0 truncate rounded-lg px-3 py-2 text-left text-sm lg:w-full ${
              sessionId === s.id ? "bg-white/15 text-white" : "bg-white/5 text-white/70 hover:bg-white/10"
            }`}
            title={s.title}
          >
            {s.title}
          </button>
        ))}
      </aside>

      {/* Conversation */}
      <section className="flex min-w-0 flex-1 flex-col rounded-xl bg-white/5 border border-white/10">
        <ScrollArea className="min-h-0 flex-1 p-4">
          {loadingHistory && (
            <div className="flex items-center gap-2 text-xs text-white/50">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading conversation…
            </div>
          )}
          {!loadingHistory && bubbles.length === 0 && (
            <div className="flex h-40 items-center justify-center text-sm text-white/40">
              Describe what you want — "Make a 15-second video ad for launch".
            </div>
          )}
          <div className="space-y-3">
            {bubbles.map((b, i) => {
              const runnable = isRunnable(b.plan);
              return (
                <div key={`${b.id}-${i}`} className={b.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                      b.role === "user" ? "bg-[#8505D5]/80 text-white" : "bg-white/10 text-white"
                    }`}
                  >
                    {b.role === "assistant" && b.intent && (
                      <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px]">
                        <Badge variant="outline" className="border-white/20 text-white/80">
                          <BrainCircuit className="mr-1 h-3 w-3" />
                          {STEP_LABEL[b.intent] ?? b.intent}
                        </Badge>
                        {b.classificationSource && (
                          <span className="text-white/40">via {b.classificationSource === "model" ? "model" : "rules"}</span>
                        )}
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{b.content}</p>

                    {/* ---- finished deliverable ---- */}
                    {b.run?.status === "done" && b.run.deliverable?.kind === "video" && b.run.deliverable.publicUrl && (
                      <video data-testid="chat-delivered-video" className="mt-2 w-full rounded-lg border border-white/10" controls src={b.run.deliverable.publicUrl} />
                    )}
                    {b.run?.status === "done" && b.run.deliverable?.kind === "image" && b.run.deliverable.previewUrl && (
                      <img
                        className="mt-2 w-full rounded-lg border border-white/10"
                        src={b.run.deliverable.previewUrl}
                        alt={b.run.deliverable.headline}
                      />
                    )}

                    {/* ---- plan ---- */}
                    {b.plan.length > 0 && (
                      <ol className="mt-2 space-y-1 border-t border-white/10 pt-2 text-xs text-white/70">
                        {b.plan.map((s, si) => (
                          <li key={si} className="flex items-center gap-2">
                            <span className="rounded bg-white/10 px-1.5 py-0.5">planned</span>
                            <span>{STEP_LABEL[s.type] ?? s.type}</span>
                            {optionsSummary(s.options) && <span className="text-white/50">({optionsSummary(s.options)})</span>}
                          </li>
                        ))}
                      </ol>
                    )}

                    {/* ---- one-time approval card ---- */}
                    {runnable && !b.run && i === bubbles.length - 1 && (
                      <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-2 text-xs">
                        <p className="text-white/70">Press Run and I'll build it end to end, posting live updates while I work:</p>
                        <button
                          type="button"
                          disabled={runningIndex !== null || !userBriefBefore(bubbles, i)}
                          className="mt-2 rounded-lg bg-[#8505D5] px-2.5 py-1 text-[11px] text-white disabled:opacity-40"
                          onClick={() => {
                            const brief = userBriefBefore(bubbles, i);
                            if (brief) void startBuild(i, brief);
                          }}
                        >
                          {runningIndex === null ? "Run it →" : "A build is running…"}
                        </button>
                      </div>
                    )}

                    {/* ---- live build timeline ---- */}
                    {b.run && (
                      <div className="mt-2 space-y-1 rounded-lg border border-white/10 bg-black/30 p-2 text-xs">
                        <div className="flex items-center gap-1.5 text-white/80">
                          {b.run.status === "running" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : b.run.status === "done" ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <CircleDashed className="h-3 w-3 text-amber-400" />
                          )}
                          {b.run.status === "running" ? "Building…" : b.run.status === "done" ? "Build complete" : "Build stopped early"}
                        </div>
                        {b.run.lines.map((line, li) => (
                          <p
                            key={li}
                            className={`whitespace-pre-wrap ${
                              line.level === "error" ? "text-red-300" : line.level === "done" ? "text-emerald-300/90" : "text-white/60"
                            }`}
                          >
                            {line.level === "error" ? "✕ " : line.level === "done" ? "✓ " : line.level === "start" ? "→ " : "· "}
                            {line.text}
                          </p>
                        ))}
                        {b.run.status === "done" && b.run.deliverable && (
                          <p className="whitespace-pre-wrap text-white/80">{describeDeliverable(b.run.deliverable)}</p>
                        )}
                      </div>
                    )}

                    {/* ---- manual hand-off stays available ---- */}
                    {b.plan.some((s) => s.type === "video_ad") && !b.run && onOpenVideoWorkflow && i === bubbles.length - 1 && (
                      <button
                        type="button"
                        className="mt-1 text-[11px] text-white/50 underline hover:text-white"
                        disabled={runningIndex !== null || !userBriefBefore(bubbles, i)}
                        onClick={() => {
                          const brief = userBriefBefore(bubbles, i);
                          if (brief) onOpenVideoWorkflow(brief);
                        }}
                      >
                        Open in the Video Ads workspace instead →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-white/50">
                <Loader2 className="h-3 w-3 animate-spin" /> Routing your request…
              </div>
            )}
          </div>
          <div ref={bottomRef} />
        </ScrollArea>

        {error && (
          <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-300">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </div>
        )}

        <form
          className="flex gap-2 border-t border-white/10 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            className="bg-black/40"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your request… (Enter to send)"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-lg bg-[#8505D5] px-3 py-2 text-white disabled:opacity-40"
            aria-label="Send message"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>
      </section>
    </div>
  );
}
