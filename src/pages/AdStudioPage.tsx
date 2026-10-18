import { useEffect, useRef, useState, useCallback } from "react";
import {
  Film,
  Brain,
  Loader2,
  Check,
  AlertCircle,
  Clock,
  Wrench,
  Download,
  RefreshCw,
  MessageSquare,
  Mic,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  useWorkflowStore,
  type StageKind,
  type StageStatus,
  type Stage,
} from "@/store/workflowStore";

type StatusIcon =
  | typeof Film
  | typeof Loader2
  | typeof Check
  | typeof AlertCircle;

function statusIcon(status: StageStatus): StatusIcon {
  if (status === "running") return Loader2;
  if (status === "done") return Check;
  if (status === "error") return AlertCircle;
  return Film;
}

const STAGE_COLOR: Record<StageStatus, string> = {
  idle: "border-muted text-muted",
  running: "border-primary text-primary",
  done: "border-emerald-500 text-emerald-500",
  error: "border-red-500 text-red-500",
};

export default function AdStudioPage() {
  const store = useWorkflowStore();
  const [open, setOpen] = useState(false);
  const stageRefs = useRef<Record<StageKind, HTMLDivElement | null>>({
    plan: null,
    research: null,
    script: null,
    image: null,
    video: null,
    edit: null,
    review: null,
    approve: null,
  });

  const clearSelectedDetail = useCallback(() => {
    store.dispatch({ type: "set_selected_stage", id: null });
  }, [store.dispatch]);



  const openStage = (stage: Stage) => {
    store.dispatch({ type: "set_selected_stage", id: stage.id });
    store.dispatch({ type: "set_open_stage", id: stage.id });
    setOpen(true);
  };

  const retryStage = (stageId: StageKind) => {
    store.dispatch({
      type: "set_stage",
      id: stageId,
      patch: {
        status: "running",
        note: "Retrying stage…",
        startedAt: new Date().toISOString(),
        logs: [],
      },
    });
  };

  const stageIdLabel: Record<StageKind, string> = {
    plan: "Plan",
    research: "Research",
    script: "Script",
    image: "Picture ad",
    video: "Video ad",
    edit: "Edit",
    review: "Review",
    approve: "Approval",
  };

  const currentStage = store.stages.find(
    (s) => s.id === store.selectedStageId,
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#07090f] text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
            <Brain className="h-4 w-4" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Ad Studio</span>
            <Badge className="bg-white/10 text-white/80 border-white/10">
              {store.campaign?.name || "no campaign"}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => store.dispatch({ type: "reset" })}
          >
            <RefreshCw className="h-4 w-4" />
            Reset
          </Button>
          <Button size="sm" className="gap-2">
            <Sparkles className="h-4 w-4" />
            New campaign
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <section className="flex flex-1 flex-col gap-4 p-4 lg:w-2/3">
          <div className="flex items-center justify-between text-sm text-white/70">
            <span>Workflow</span>
            <span>
              {store.campaign?.status || "draft"} ·{" "}
              {store.startedAt ? new Date(store.startedAt).toLocaleTimeString() : "—"}
            </span>
          </div>

          <div className="relative">
            <div className="absolute left-6 top-0 h-full w-px bg-white/10" />

            <div className="flex flex-col gap-4">
              {store.stages.map((stage, index) => (
                <StageNode
                  key={stage.id}
                  stage={stage}
                  index={index}
                  last={index === store.stages.length - 1}
                  selected={store.selectedStageId === stage.id}
                  onClick={() => openStage(stage)}
                  ref={(el) => {
                    if (el) stageRefs.current[stage.id] = el;
                  }}
                />
              ))}
            </div>
          </div>
        </section>

        <aside className="flex h-[300px] w-full shrink-0 flex-col border-t lg:border-t-0 lg:border-l border-white/10 p-4">
          <div className="flex items-center justify-between text-sm text-white/70">
            <span>Brain</span>
            {store.campaign?.status === "approved" ? (
              <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30">
                ready
              </Badge>
            ) : store.campaign?.status === "failed" ? (
              <Badge className="bg-red-500/20 text-red-500 border-red-500/30">
                failed
              </Badge>
            ) : (
              <Badge className="bg-white/10 text-white/80 border-white/10">
                orchestrating
              </Badge>
            )}
          </div>
          <div className="mt-3 flex size-24 items-center justify-center rounded-2xl bg-white/5 border border-white/10 shadow-inner">
            <Brain className="h-10 w-10 text-primary" />
          </div>
          <p className="mt-2 text-sm text-white/80">
            {currentStage ? (
              <>
                <span className="font-medium text-white">{currentStage.label}</span>
                {" — "}
                <span className="text-white/70">{currentStage.note}</span>
              </>
            ) : (
              "Select a stage to inspect it."
            )}
          </p>
          {store.campaign?.status === "ready_for_download" && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <Download className="h-4 w-4 text-emerald-500" />
              <span className="text-emerald-500 font-medium">Download available</span>
            </div>
          )}
          <div className="mt-auto flex items-center gap-2 text-xs text-white/60">
            <Clock className="h-3 w-3" />
            {store.campaign?.format === "video" ||
            store.stages.some((s) => s.id === "video" && s.status !== "idle") ? (
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                Veo 3.1
              </span>
            ) : store.stages.some(
                (s) => s.id === "image" && s.status !== "idle",
              ) ? (
              <span className="flex items-center gap-1">
                <Mic className="h-3 w-3" />
                OpenAI image model
              </span>
            ) : (
              <span className="text-white/50">awaiting request</span>
            )}
          </div>
        </aside>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" onCloseAutoFocus={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              {currentStage?.label || "Stage"}
            </DialogTitle>
            <DialogDescription>
              Inspect the selected workflow stage, its inputs, outputs, progress,
              logs and errors.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[300px]">
            <div className="flex flex-col gap-4">
              {currentStage ? (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Current state</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex items-center justify-between text-white/80">
                        <span>Status</span>
                        <Badge
                          className={`${STAGE_COLOR[currentStage.status]} border-0 bg-transparent`}
                        >
                          {currentStage.status}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-white/80">
                        <span>Note</span>
                        <span className="text-white/70">{currentStage.note}</span>
                      </div>
                      {currentStage.startedAt && (
                        <div className="flex items-center justify-between text-white/80">
                          <span>Started</span>
                          <span className="text-white/70">
                            {new Date(currentStage.startedAt).toLocaleString()}
                          </span>
                        </div>
                      )}
                      {currentStage.finishedAt && (
                        <div className="flex items-center justify-between text-white/80">
                          <span>Finished</span>
                          <span className="text-white/70">
                            {new Date(currentStage.finishedAt).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {currentStage.logs && currentStage.logs.length ? (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Logs</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-32 rounded-md border border-white/10 bg-white/5 p-2">
                          <ul className="flex flex-col gap-1 text-xs text-white/70">
                            {currentStage.logs.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  ) : null}

                  {currentStage.status === "error" && (
                    <Card className="border-red-500/30">
                      <CardContent className="flex items-start gap-3 text-sm text-red-500">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{currentStage.note || "Stage failed."}</span>
                      </CardContent>
                    </Card>
                  )}

                  <div className="flex gap-2">
                    {currentStage.status === "error" && (
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => retryStage(currentStage.id)}
                      >
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Retry
                      </Button>
                    )}
                    <Button className="flex-1">
                      <MessageSquare className="mr-2 h-4 w-4" />
                      Open in chat
                    </Button>
                    {currentStage.id === "approve" &&
                      store.campaign?.status === "approved" && (
                        <Button className="flex-1 gap-2">
                          <Download className="h-4 w-4" />
                          Download
                        </Button>
                      )}
                  </div>
                </>
              ) : (
                <Card>
                  <CardContent className="text-sm text-white/70">
                    Select a stage to inspect it.
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StageNode({
  stage,
  index,
  last,
  selected,
  onClick,
  ref,
}: {
  stage: Stage;
  index: number;
  last: boolean;
  selected: boolean;
  onClick: () => void;
  ref: (el: HTMLDivElement | null) => void;
}) {
  const Icon = statusIcon(stage.status);

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`
        relative flex items-center gap-4 rounded-xl border bg-white/5 px-4 py-3 transition-all
        ${
          selected
            ? "border-primary ring-2 ring-primary/30"
            : "hover:border-white/20"
        }
      `}
    >
      <div
        className={`flex size-8 items-center justify-center rounded-full border bg-white/10 ${
          stage.status === "running" ? "border-primary" : ""
        }`}
      >
        {stage.status === "running" ? (
          <Icon className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{stage.label}</span>
          <Badge
            className={`text-xs ${STAGE_COLOR[stage.status]} border-0 bg-transparent`}
          >
            {stage.status}
          </Badge>
        </div>
        <p className="text-xs text-white/70">{stage.note}</p>
      </div>

      {!last && (
        <div className="flex flex-col items-center">
          <div className="flex h-0.5 w-4 bg-white/20" />
          <div className="mt-1 flex h-0.5 w-4 bg-white/10" />
        </div>
      )}
    </div>
  );
}
