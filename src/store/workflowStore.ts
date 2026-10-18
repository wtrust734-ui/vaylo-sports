import { create } from "zustand";

export type StageKind =
  | "plan"
  | "research"
  | "script"
  | "image"
  | "video"
  | "edit"
  | "review"
  | "approve";

export type StageStatus = "idle" | "running" | "done" | "error";

export interface Stage {
  id: StageKind;
  label: string;
  status: StageStatus;
  note: string;
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
  logs?: string[];
}

export type AdFormat = "auto" | "image" | "video" | "both";

export type WorkflowStatus =
  | "draft"
  | "planning"
  | "researching"
  | "generating"
  | "editing"
  | "review"
  | "awaiting_approval"
  | "changes_requested"
  | "reworking"
  | "approved"
  | "ready_for_download"
  | "completed"
  | "failed";

export interface AdVersion {
  id: string;
  version: number;
  format: AdFormat;
  status: WorkflowStatus;
  assetUrl?: string;
  assetType?: "image" | "video";
  assetName?: string;
  assetSize?: number;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  defects?: WorkflowDefect[];
}

export interface WorkflowDefect {
  stage: StageKind;
  severity: "low" | "medium" | "high";
  message: string;
  recommendation: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  planId: string;
  planItemIndex?: number;
  format?: AdFormat;
  status: WorkflowStatus;
  currentVersionId?: string;
  versions: AdVersion[];
  startedAt?: string;
  updatedAt?: string;
}

export interface WorkflowState {
  campaign: Campaign | null;
  stages: Stage[];
  selectedStageId: StageKind | null;
  openStageId: StageKind | null;
  projectId: string;
  startedAt: string | null;
  lastSyncedAt: string | null;
}

type Action =
  | { type: "set_campaign"; campaign: Campaign }
  | { type: "set_stages"; stages: Stage[] }
  | { type: "set_stage"; id: StageKind; patch: Partial<Stage> }
  | { type: "set_selected_stage"; id: StageKind | null }
  | { type: "set_open_stage"; id: StageKind | null }
  | { type: "set_workflow_status"; status: WorkflowStatus }
  | { type: "set_started_at"; startedAt: string }
  | { type: "sync_last_seen" }
  | { type: "reset" };

const initialStages: Stage[] = [
  { id: "plan", label: "Plan", status: "idle", note: "Waiting for campaign item" },
  { id: "research", label: "Research", status: "idle", note: "Competitor signals" },
  { id: "script", label: "Script", status: "idle", note: "Hook and storyboard" },
  { id: "image", label: "Picture ad", status: "idle", note: "ChatGPT Image 2.5" },
  { id: "video", label: "Video ad", status: "idle", note: "Veo 3.1" },
  { id: "edit", label: "Edit", status: "idle", note: "Assembly and branding" },
  { id: "review", label: "Review", status: "idle", note: "Quality check" },
  { id: "approve", label: "Approval", status: "idle", note: "Manual sign-off" },
];

const initialCampaign: Campaign = {
  id: "",
  name: "",
  planId: "",
  status: "draft",
  versions: [],
};

export const useWorkflowStore = create<WorkflowState & { dispatch: (action: Action) => void }>(
  (set, get) => ({
    campaign: initialCampaign,
    stages: initialStages,
    selectedStageId: null,
    openStageId: null,
    projectId: "",
    startedAt: null,
    lastSyncedAt: null,
    dispatch: (action) => {
      switch (action.type) {
        case "set_campaign":
          return set({ campaign: action.campaign });
        case "set_stages":
          return set({ stages: action.stages });
        case "set_stage": {
          return set({
            stages: get().stages.map((s) =>
              s.id === action.id ? { ...s, ...action.patch } : s,
            ),
          });
        }
        case "set_selected_stage":
          return set({ selectedStageId: action.id });
        case "set_open_stage":
          return set({ openStageId: action.id });
        case "set_workflow_status": {
          const campaign = get().campaign;
          return set({
            campaign: campaign
              ? { ...campaign, status: action.status, updatedAt: new Date().toISOString() }
              : campaign,
          });
        }
        case "set_started_at":
          return set({ startedAt: action.startedAt });
        case "sync_last_seen":
          return set({ lastSyncedAt: new Date().toISOString() });
        case "reset":
          return set({
            campaign: initialCampaign,
            stages: initialStages,
            selectedStageId: null,
            openStageId: null,
            projectId: "",
            startedAt: null,
            lastSyncedAt: null,
          });
        default:
          return;
      }
    },
  }),
);
