import { useEffect, useRef, useState } from "react";
import {
  Send,
  Loader2,
  ListPlus,
  AlertCircle,
  BrainCircuit,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  listChatSessions,
  listChatMessages,
  sendChatMessage,
  routeCampaignFromChat,
  type ChatSession,
  type LibraryItem as _Unused,
} from "./api";

interface Bubble {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent: string | null;
  plan: { type: string; options: Record<string, unknown> }[];
  classificationSource?: string;
  campaignId?: string | null;
  campaignStatus?: string | null;
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

function optionsSummary(o: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof o.format === "string") parts.push(o.format);
  if (typeof o.durationSeconds === "number")
    parts.push(`${o.durationSeconds}s`);
  if (typeof o.conceptCount === "number")
    parts.push(`${o.conceptCount} options`);
  if (Array.isArray(o.competitors) && o.competitors.length)
    parts.push(o.competitors.join(", "));
  if (typeof o.platform === "string") parts.push(o.platform);
  if (typeof o.revisionTarget === "string") parts.push(o.revisionTarget);
  return parts.join(" · ");
}

export default function ChatView() {
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // A send response already carries the assistant reply locally; loading the
  // stored history right after arriving would replace those local bubbles
  // (momentarily blanking the conversation). Skip one history load per send.
  const skipHistoryLoad = useRef(false);

  useEffect(() => {
    listChatSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
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
              (
                r.plan as {
                  steps?: { type: string; options: Record<string, unknown> }[];
                  primary?: string;
                }
              )?.steps ?? [],
            classificationSource: (r.plan as { classificationSource?: string })
              .classificationSource,
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
    if (el && typeof el.scrollIntoView === "function")
      el.scrollIntoView({ behavior: "smooth" });
  }, [bubbles.length, sending]);

  const submit = async () => {
    const content = input.trim();
    if (!content || sending) return; // duplicate-submission guard
    setSending(true);
    setError(null);
    setInput("");
    const optimistic: Bubble = {
      id: `local-${Date.now()}`,
      role: "user",
      content,
      intent: null,
      plan: [],
    };
    setBubbles((b) => [...b, optimistic]);
    try {
      const res = await sendChatMessage(sessionId, content);
      let campaignId: string | null = null;
      let campaignStatus: string | null = null;
      if (
        res.assistant.intent === "campaign_ideation" ||
        res.assistant.intent === "campaign_analyse"
      ) {
        const routed = await routeCampaignFromChat(sessionId, content);
        campaignId = routed.campaignId ?? null;
        campaignStatus = routed.status ?? null;
      } else if (
        res.assistant.plan.some(
          (s) =>
            s.type === "campaign_ideation" || s.type === "campaign_analyse",
        )
      ) {
        const routed = await routeCampaignFromChat(sessionId, content);
        campaignId = routed.campaignId ?? null;
        campaignStatus = routed.status ?? null;
      }
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
          campaignId,
          campaignStatus,
        },
      ]);
      listChatSessions()
        .then(setSessions)
        .catch(() => undefined);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The assistant is unavailable.",
      );
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

  const renderCampaignTag = (b: Bubble): React.ReactNode => {
    if (b.campaignId === null || b.campaignStatus === null) return null;
    return (
      <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80">
        campaign {b.campaignId?.slice(0, 8)}… · {b.campaignStatus}
      </span>
    );
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
              sessionId === s.id
                ? "bg-white/15 text-white"
                : "bg-white/5 text-white/70 hover:bg-white/10"
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
              Describe what you want — “Make a 15-second video ad for launch”.
            </div>
          )}
          <div className="space-y-3">
            {bubbles.map((b, i) => (
              <div
                key={`${b.id}-${i}`}
                className={
                  b.role === "user" ? "flex justify-end" : "flex justify-start"
                }
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                    b.role === "user"
                      ? "bg-[#8505D5]/80 text-white"
                      : "bg-white/10 text-white"
                  }`}
                >
                  {b.role === "assistant" && b.intent && (
                    <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px]">
                      <Badge
                        variant="outline"
                        className="border-white/20 text-white/80"
                      >
                        <BrainCircuit className="mr-1 h-3 w-3" />
                        {STEP_LABEL[b.intent] ?? b.intent}
                      </Badge>
                      {b.classificationSource && (
                        <span className="text-white/40">
                          via{" "}
                          {b.classificationSource === "model"
                            ? "model"
                            : "rules"}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{b.content}</p>
                  {b.plan.length > 0 && (
                    <ol className="mt-2 space-y-1 border-t border-white/10 pt-2 text-xs text-white/70">
                      {b.plan.map((s, si) => (
                        <li key={si} className="flex items-center gap-2">
                          <span className="rounded bg-white/10 px-1.5 py-0.5">
                            planned
                          </span>
                          <span>{STEP_LABEL[s.type] ?? s.type}</span>
                          {optionsSummary(s.options) && (
                            <span className="text-white/50">
                              ({optionsSummary(s.options)})
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-white/50">
                <Loader2 className="h-3 w-3 animate-spin" /> Routing your
                request…
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
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </form>
      </section>
    </div>
  );
}
