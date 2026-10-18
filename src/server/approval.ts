import type { WorkflowStatus, AdVersion } from "@/store/workflowStore";
import type { StoredAsset, DownloadGrant } from "./storage";

export interface ApprovalRecord {
  versionId: string;
  status: WorkflowStatus;
  approvedAt?: string;
  approvedById?: string;
  asset?: StoredAsset;
  downloadGrants?: DownloadGrant[];
}

export function canApprove(status: WorkflowStatus): boolean {
  return status === "awaiting_approval";
}

export function canDownload(status: WorkflowStatus, approvedAt?: string): boolean {
  return status === "ready_for_download" && Boolean(approvedAt);
}

export function approveVersion(
  record: ApprovalRecord,
  version: AdVersion,
  approvedById: string,
): ApprovalRecord {
  return {
    ...record,
    status: "ready_for_download",
    approvedAt: new Date().toISOString(),
    approvedById,
    versionId: version.id,
    asset: record.asset ?? undefined,
    downloadGrants: record.downloadGrants ?? [],
  };
}

export function rejectVersion(record: ApprovalRecord): ApprovalRecord {
  return {
    ...record,
    status: "changes_requested",
    approvedAt: undefined,
  };
}

export function requestChanges(record: ApprovalRecord): ApprovalRecord {
  return {
    ...record,
    status: "changes_requested",
    approvedAt: undefined,
  };
}

export function grantDownload(
  record: ApprovalRecord,
  asset: StoredAsset,
  userId: string,
): { ok: boolean; grant?: DownloadGrant; error?: string } {
  if (!canDownload(record.status, record.approvedAt)) {
    return { ok: false, error: "Download is not permitted for this approval state." };
  }
  if (!asset || asset.type !== "image" && asset.type !== "video") {
    return { ok: false, error: "No valid asset is attached to this approval." };
  }

  const grant: DownloadGrant = {
    id: "grant-" + Date.now() + Math.random().toString(36).slice(2, 7),
    versionId: record.versionId,
    assetId: asset.id,
    userId,
    grantedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };

  return {
    ok: true,
    grant,
  };
}

export function verifyDownloadGrant(
  record: ApprovalRecord,
  userId: string,
  grant: DownloadGrant,
): { ok: boolean; error?: string } {
  if (record.versionId !== grant.versionId) {
    return { ok: false, error: "Grant does not belong to this approved version." };
  }
  if (record.approvedById !== userId) {
    return { ok: false, error: "Download grant is not authorized for this user." };
  }
  if (grant.expiresAt < new Date().toISOString()) {
    return { ok: false, error: "Download grant has expired." };
  }
  if (!record.asset) {
    return { ok: false, error: "No asset is attached to this approval." };
  }
  return { ok: true };
}
