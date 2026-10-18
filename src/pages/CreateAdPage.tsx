import { useState, useRef, useEffect, useCallback } from "react";
import {
  Film,
  Paperclip,
  Send,
  Sparkles,
  Loader2,
  Check,
  AlarmClock,
  MessageSquare,
  Plus,
  Trash2,
  FolderOpen,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select } from "@/components/ui/select";
import { useWorkflowStore, type AdFormat } from "@/store/workflowStore";

type MessageRole = "user" | "assistant" | "system" | "tool";

interface Message {
  role: MessageRole;
  text: string;
  tool?: string;
}

const MOCK_PLAN_ITEMS: { id: string; name: string; format: AdFormat }[] = [
  { id: "plan-1", name: "First video ad — app intro", format: "video" },
  { id: "plan-2", name: "Second picture ad — training plans", format: "image" },
  { id: "plan-3", name: "Both formats — feature highlight", format: "both" },
];

function planLabel(item: (typeof MOCK_PLAN_ITEMS)[0]) {
  return `${item.name} · ${item.format === "both" ? "image + video" : item.format}`;
}

export default function CreateAdPage() {
  const store = useWorkflowStore();
  const [format, setFormat] = useState<AdFormat>("auto");
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "system",
      text:
        "Describe the ad you want to create. You can ask for a video ad, a picture ad, or leave the format automatic. You can also pick a planned ad from the campaign.",
    },
  ]);
  const [fileList, setFileList] = useState<Array<{ id: string; name: string; size: number }>>([]);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, fileList]);

  const effectiveFormat = useCallback((): AdFormat => {
    if (format !== "auto") return format;
    const planItem = MOCK_PLAN_ITEMS.find((p) => p.id === selectedPlanId);
    return (planItem?.format ?? "auto");
  }, [format, selectedPlanId]);

  const simulateRun = async () => {
    if (!prompt.trim()) return;
    const planItem = MOCK_PLAN_ITEMS.find((p) => p.id === selectedPlanId);

    const fmt = effectiveFormat();
    const isBoth = fmt === "both";
    const isVideo = fmt === "video" || isBoth;
    const isImage = fmt === "image" || isBoth;

    store.dispatch({
      type: "set_campaign",
      campaign: {
        id: "camp-" + Date.now(),
        name: planItem?.name || "New campaign",
        planId: planItem?.id || "",
        planItemIndex: MOCK_PLAN_ITEMS.findIndex((p) => p.id === selectedPlanId),
        format: isBoth ? "both" : fmt,
        status: "planning",
        versions: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const startTime = new Date().toISOString();
    store.dispatch({ type: "set_started_at", startedAt: startTime });

    setMessages((prev) => [
      ...prev,
      { role: "user", text: prompt.trim() },
    ]);
    setPrompt("");

    const addAssistant = (text: string, tool?: string) => {
      setMessages((prev) => [...prev, { role: "assistant", text, tool }]);
    };

    addAssistant(
      planItem
        ? `I’ve selected “${planItem.name}” from the advertising plan.`
        : "I’m using the next uncompleted ad in the plan.",
      "plan",
    );

    store.dispatch({ type: "set_workflow_status", status: "planning" });
    store.dispatch({
      type: "set_stage",
      id: "plan",
      patch: {
        status: "running",
        note: "Reading your request and selecting the plan item",
        startedAt: new Date().toISOString(),
        logs: ["Planning campaign"],
      },
    });

    await sleep(700);
    store.dispatch({
      type: "set_stage",
      id: "plan",
      patch: {
        status: "done",
        note: "Plan item selected",
        finishedAt: new Date().toISOString(),
      },
    });

    if (isVideo || isBoth) {
      store.dispatch({ type: "set_workflow_status", status: "researching" });
      store.dispatch({
        type: "set_stage",
        id: "research",
        patch: {
          status: "running",
          note: "Looking at competitor ads and campaign brief",
          startedAt: new Date().toISOString(),
          logs: ["Researching competitor advertising"],
        },
      });

      await sleep(700);
      store.dispatch({
        type: "set_stage",
        id: "research",
        patch: {
          status: "done",
          note: "Research complete",
          finishedAt: new Date().toISOString(),
        },
      });
      addAssistant("I reviewed some public competitor ads and pulled out a few patterns worth testing.", "research");
    }

    store.dispatch({ type: "set_workflow_status", status: "generating" });
    store.dispatch({
      type: "set_stage",
      id: "script",
      patch: {
        status: "running",
        note: "Writing the hook and storyboard",
        startedAt: new Date().toISOString(),
        logs: ["Drafting script and storyboard"],
      },
    });

    await sleep(800);
    store.dispatch({
      type: "set_stage",
      id: "script",
      patch: {
        status: "done",
        note: "Storyboard ready",
        finishedAt: new Date().toISOString(),
      },
    });

    if (isImage) {
      store.dispatch({
        type: "set_stage",
        id: "image",
        patch: {
          status: "running",
          note: "Generating picture ad with the requested image model",
          startedAt: new Date().toISOString(),
          logs: ["Generating picture creative"],
        },
      });

      await sleep(900);
      store.dispatch({
        type: "set_stage",
        id: "image",
        patch: {
          status: "done",
          note: "Picture ad generated",
          finishedAt: new Date().toISOString(),
        },
      });

      addAssistant(
        isBoth
          ? "I also generated a picture ad."
          : "I generated the picture ad. Open the Ad Studio to inspect it.",
        "image",
      );
    }

    if (isVideo) {
      store.dispatch({
        type: "set_stage",
        id: "video",
        patch: {
          status: "running",
          note: "Generating video with Veo 3.1",
          startedAt: new Date().toISOString(),
          logs: ["Requesting video generation from Veo 3.1"],
        },
      });

      await sleep(1200);
      store.dispatch({
        type: "set_stage",
        id: "video",
        patch: {
          status: "done",
          note: "Video clip generated",
          finishedAt: new Date().toISOString(),
        },
      });

      addAssistant(
        isBoth
          ? "I also generated the video ad."
          : "I generated the video ad with Veo 3.1. Open the Ad Studio to inspect it.",
        "video",
      );
    }

    if (isBoth || (!isImage && !isVideo && fmt === "auto")) {
      store.dispatch({ type: "set_workflow_status", status: "editing" });
      store.dispatch({
        type: "set_stage",
        id: "edit",
        patch: {
          status: "running",
          note: "Assembling and applying branding",
          startedAt: new Date().toISOString(),
          logs: ["Assembling final creative"],
        },
      });

      await sleep(800);
      store.dispatch({
        type: "set_stage",
        id: "edit",
        patch: {
          status: "done",
          note: "Final creative assembled",
          finishedAt: new Date().toISOString(),
        },
      });
    }

    store.dispatch({ type: "set_workflow_status", status: "review" });
    store.dispatch({
      type: "set_stage",
      id: "review",
      patch: {
        status: "running",
        note: "Running automated quality checks",
        startedAt: new Date().toISOString(),
        logs: ["Checking branding, text and file integrity"],
      },
    });

    await sleep(700);
    store.dispatch({
      type: "set_stage",
      id: "review",
      patch: {
        status: "done",
        note: "Quality checks passed",
        finishedAt: new Date().toISOString(),
      },
    });

    store.dispatch({ type: "set_workflow_status", status: "awaiting_approval" });
    store.dispatch({
      type: "set_stage",
      id: "approve",
      patch: {
        status: "done",
        note: "Manual approval required",
        finishedAt: new Date().toISOString(),
      },
    });

    addAssistant(
      isVideo
        ? "The video ad is ready for your review and approval."
        : isImage
          ? "The picture ad is ready for your review and approval."
          : "The ad is ready for your review and approval.",
    );
  };

  const attachFile = (name: string, sizeMB: number) => {
    const id = "file-" + Date.now() + Math.random().toString(36).slice(2, 7);
    setFileList((prev) => [...prev, { id, name, size: sizeMB * 1024 * 1024 }]);
  };

  const removeFile = (id: string) => {
    setFileList((prev) => prev.filter((f) => f.id !== id));
  };

  const startUpload = (name: string) => {
    const id = "upload-" + Date.now();
    setUploadingId(id);
    setUploadProgress(0);
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 25) + 5;
      if (progress > 100) progress = 100;
      setUploadProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        attachFile(name, Math.floor((Math.random() * 18 + 2) * 1));
        setUploadingId(null);
        setUploadProgress(0);
      }
    }, 220);
  };

  const formatOptions: { value: AdFormat; label: string }[] = [
    { value: "auto", label: "Automatic" },
    { value: "image", label: "Picture ad" },
    { value: "video", label: "Video ad" },
    { value: "both", label: "Both formats" },
  ];

  const statusLabel =
    store.campaign?.status === "awaiting_approval"
      ? "awaiting approval"
      : store.campaign?.status === "ready_for_download"
        ? "ready to download"
        : store.campaign?.status ?? "draft";

  return (
    <div className="flex min-h-[calc(100vh-57px)] flex-col bg-[#07090f] text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
            <Film className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium">Create ad</p>
            <p className="text-xs text-white/70">Chat-first ad workflow</p>
          </div>
        </div>
        <Badge
          className="bg-white/10 text-white/80 border-white/10"
          variant="secondary"
        >
          {statusLabel}
        </Badge>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="flex flex-1 flex-col gap-4 p-4 lg:w-2/3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/70">Campaign selection</p>
            <div className="flex items-center gap-2">
              <Select
                value={selectedPlanId}
                onValueChange={setSelectedPlanId}
              >
                {MOCK_PLAN_ITEMS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {planLabel(item)}
                  </option>
                ))}
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => store.dispatch({ type: "set_campaign", campaign: { id: "", name: "", planId: "", status: "draft", versions: [] } })}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-white/70">Format</p>
            <div className="flex items-center gap-2">
              {formatOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={format === option.value ? "default" : "outline"}
                  size="sm"
                  className="gap-1"
                  onClick={() => setFormat(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>

          <Card className="border-white/10 bg-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Attachments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => startUpload("screen-recording.mp4")}
                  disabled={!!uploadingId}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Upload file
                </Button>
                <span className="text-xs text-white/60">
                  screen recordings, videos, images, logos, scripts, docs
                </span>
              </div>

              {uploadingId && (
                <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <div className="flex-1">
                    <p className="text-sm text-white/90">Uploading file…</p>
                    <Progress value={uploadProgress} className="mt-1" />
                  </div>
                </div>
              )}

              {fileList.length === 0 ? (
                <p className="text-xs text-white/60">
                  No files attached yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {fileList.map((file) => (
                    <li
                      key={file.id}
                      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white/80"
                    >
                      <Paperclip className="h-4 w-4 text-white/60" />
                      <span className="flex-1 truncate">{file.name}</span>
                      <span className="text-xs text-white/50">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-white/60 hover:text-white"
                        onClick={() => removeFile(file.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <ScrollArea className="flex-1 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-4">
              {messages.map((message, i) => (
                <div
                  key={i}
                  className={`flex gap-3 ${
                    message.role === "user" ? "flex-row-reverse" : ""
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-4 py-3 ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : message.role === "system"
                          ? "bg-white/5 text-white/80"
                          : message.role === "tool"
                            ? "bg-white/10 text-white border-l-2 border-primary"
                            : "bg-white/10 text-white"
                    }`}
                  >
                    <p className="text-sm">{message.text}</p>
                    {message.tool && (
                      <p className="mt-1 text-xs text-primary">
                        tool: {message.tool}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {messages.length === 0 && (
                <p className="text-sm text-white/60">No messages yet.</p>
              )}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              simulateRun();
            }}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2"
          >
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the ad you want to create…"
              className="min-h-[28px] resize-none border-0 bg-transparent px-2 py-1 text-sm focus-visible:ring-0"
              rows={1}
            />
            <Button
              type="submit"
              disabled={store.campaign?.status === "generating" ||
                       store.campaign?.status === "editing" ||
                       !prompt.trim()}
            >
              {store.campaign?.status === "generating" ||
              store.campaign?.status === "editing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send
            </Button>
          </form>
        </div>

        <aside className="flex w-full shrink-0 flex-col border-t lg:border-t-0 lg:border-l border-white/10 p-4">
          <div className="mb-3 flex items-center justify-between text-sm text-white/70">
            <span>Ad progress</span>
            <Badge className="bg-white/10 text-white/80 border-white/10">
              {store.stages[
                store.stages.findIndex((s) =>
                  ["plan", "research", "script", "image", "video", "edit", "review", "approve"].includes(
                    s.id,
                  ),
                ) ?? 0
              ].note ?? "Start"}
            </Badge>
          </div>

          <ScrollArea className="flex-1 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-3">
              {store.stages.map((stage, i) => {
                const done = stage.status === "done";
                const active = stage.status === "running";
                return (
                  <div
                    key={stage.id}
                    className={`flex items-center gap-3 rounded-lg ${
                      active ? "bg-primary/10 border border-primary/30" : ""
                    }`}
                  >
                    <div
                      className={`flex size-7 items-center justify-center rounded-full border ${
                        done
                          ? "border-emerald-500 bg-emerald-500/20 text-emerald-500"
                          : active
                            ? "border-primary bg-primary/20 text-primary animate-pulse"
                            : "border-white/10 bg-white/5 text-white/50"
                      }`}
                    >
                      {done ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : active ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MessageSquare className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="flex-1 flex flex-col gap-1">
                      <span
                        className={`text-sm ${
                          done || active ? "text-white" : "text-white/50"
                        }`}
                      >
                        {stage.label}
                      </span>
                      <span className="text-xs text-white/60 truncate">
                        {stage.note}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <div className="mt-3 flex items-center gap-2 text-xs text-white/60">
            <AlarmClock className="h-3 w-3" />
            {store.campaign?.status === "generating" ||
            store.campaign?.status === "editing" ? (
              <span className="text-white/90">Workflow is executing</span>
            ) : store.campaign?.status === "awaiting_approval" ? (
              <span className="text-emerald-500 font-medium">Awaiting your approval</span>
            ) : (
              "Waiting for request"
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
