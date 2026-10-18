import type {
  StageKind,
  StageStatus,
  Stage,
  AdFormat,
  WorkflowStatus,
  AdVersion,
  WorkflowDefect,
} from "@/store/workflowStore";

export type BrainCommand =
  | { kind: "start_campaign"; planItemId?: string; format?: AdFormat; prompt?: string }
  | {
      kind: "continue_campaign"
      planItemId?: string
      format?: AdFormat
      prompt?: string
    }
  | { kind: "edit_asset"; versionId: string; stage: StageKind; prompt: string }
  | { kind: "retry_stage"; stage: StageKind }
  | { kind: "approve_version"; versionId: string }
  | { kind: "reject_version"; versionId: string }
  | { kind: "request_changes"; prompt: string };

export interface WorkflowExecution {
  id: string;
  campaignId: string;
  status: WorkflowStatus;
  stages: Stage[];
  currentVersionId?: string;
  approvedVersionId?: string;
  startedAt: string;
  updatedAt: string;
  errors: WorkflowError[];
}

export interface WorkflowError {
  stage: StageKind;
  code: string;
  message: string;
  occurredAt: string;
}

const VALID_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  draft: ["planning"],
  planning: ["researching", "generating", "editing", "review", "failed"],
  researching: ["generating", "editing", "review", "failed"],
  generating: ["editing", "review", "failed"],
  editing: ["review", "failed"],
  review: ["awaiting_approval", "reworking", "failed"],
  awaiting_approval: ["ready_for_download", "completed", "changes_requested"],
  changes_requested: ["reworking"],
  reworking: ["review", "generating", "editing", "failed"],
  approved: ["ready_for_download", "completed"],
  ready_for_download: ["completed"],
  completed: [],
  failed: ["planning", "reworking"],
};

export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStageForStatus(status: WorkflowStatus): StageKind | null {
  if (status === "planning" || status === "researching") return "plan";
  if (status === "generating") return "script";
  if (status === "editing") return "edit";
  if (status === "review") return "review";
  if (status === "awaiting_approval") return "approve";
  if (status === "reworking") return "script";
  return null;
}

export function applyStageResult(
  stages: Stage[],
  stageId: StageKind,
  status: StageStatus,
  note?: string,
  logs?: string[],
): Stage[] {
  return stages.map((s) =>
    s.id === stageId
      ? {
          ...s,
          status,
          note: note ?? s.note,
          logs: logs ? [...(s.logs ?? []), ...logs] : s.logs,
          finishedAt: status === "done" || status === "error"
            ? new Date().toISOString()
            : s.finishedAt,
        }
      : s,
  );
}

export function createInitialVersion(
  format: AdFormat,
  planId: string,
): AdVersion {
  const now = new Date().toISOString();
  return {
    id: "v1-" + Date.now(),
    version: 1,
    format,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

export function addDefect(
  version: AdVersion,
  defect: Omit<WorkflowDefect, "createdAt">,
): AdVersion {
  return {
    ...version,
    defects: [...(version.defects ?? []), { ...defect, createdAt: new Date().toISOString() }],
    updatedAt: new Date().toISOString(),
  };
}

export function clearVersionApproval(version: AdVersion): AdVersion {
  return {
    ...version,
    approvedAt: undefined,
    status: version.status === "approved" ? "review" : version.status,
    updatedAt: new Date().toISOString(),
  };
}

export function validateCommand(
  execution: WorkflowExecution,
  command: BrainCommand,
): { ok: boolean; error?: string } {
  if (command.kind === "start_campaign") {
    if (!canTransition(execution.status, "planning")) {
      return { ok: false, error: `Cannot start a new campaign from status ${execution.status}.` };
    }
    return { ok: true };
  }

  if (command.kind === "continue_campaign") {
    if (!canTransition(execution.status, "planning")) {
      return { ok: false, error: `Cannot continue the campaign from status ${execution.status}.` };
    }
    return { ok: true };
  }

  if (command.kind === "edit_asset") {
    const version = execution.approvedVersionId
      ? execution.approvedVersionId
      : execution.currentVersionId;
    if (!version) {
      return { ok: false, error: "No asset version selected for editing." };
    }
    if (!canTransition(execution.status, "reworking")) {
      return { ok: false, error: `Cannot edit the asset in status ${execution.status}.` };
    }
    return { ok: true };
  }

  if (command.kind === "retry_stage") {
    const stage = execution.stages.find((s) => s.id === command.stage);
    if (!stage) return { ok: false, error: `Unknown stage ${command.stage}.` };
    if (stage.status !== "error") {
      return { ok: false, error: `Only error stages can be retried.` };
    }
    return { ok: true };
  }

  if (command.kind === "approve_version") {
    if (!canTransition(execution.status, "ready_for_download")) {
      return { ok: false, error: `Cannot approve from status ${execution.status}.` };
    }
    const version = execution.approvedVersionId
      ? execution.approvedVersionId
      : execution.currentVersionId;
    if (!version) return { ok: false, error: "No version to approve." };
    return { ok: true };
  }

  if (command.kind === "reject_version") {
    if (!canTransition(execution.status, "changes_requested")) {
      return { ok: false, error: `Cannot reject from status ${execution.status}.` };
    }
    return { ok: true };
  }

  if (command.kind === "request_changes") {
    if (!canTransition(execution.status, "changes_requested")) {
      return { ok: false, error: `Cannot request changes from status ${execution.status}.` };
    }
    return { ok: true };
  }

  return { ok: false, error: "Unknown command." };
}

export function appendError(
  execution: WorkflowExecution,
  stage: StageKind,
  code: string,
  message: string,
): WorkflowExecution {
  return {
    ...execution,
    status: "failed",
    errors: [...execution.errors, { stage, code, message, occurredAt: new Date().toISOString() }],
    updatedAt: new Date().toISOString(),
  };
}
