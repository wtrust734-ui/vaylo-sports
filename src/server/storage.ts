export interface StoredAsset {
  id: string;
  versionId: string;
  type: "image" | "video";
  contentType: string;
  filename: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: string;
  expiresAt?: string;
}

export interface DownloadGrant {
  id: string;
  versionId: string;
  assetId: string;
  grantedAt: string;
  expiresAt: string;
  userId: string;
}

export type StoreResult =
  | { ok: true; asset: StoredAsset }
  | { ok: false; error: string; code: string };

export function validateStoredAsset(asset: StoredAsset): boolean {
  if (!asset || typeof asset.id !== "string") return false;
  if (!["image", "video"].includes(asset.type)) return false;
  if (!asset.contentType || !asset.contentType.startsWith("image/") && !asset.contentType.startsWith("video/")) {
    return false;
  }
  if (asset.sizeBytes <= 0) return false;
  if (!asset.storageKey || asset.storageKey.trim().length === 0) return false;
  return true;
}

export function isExpired(grant: DownloadGrant): boolean {
  return new Date(grant.expiresAt) < new Date();
}

export function createDownloadGrant(
  versionId: string,
  assetId: string,
  userId: string,
  expiresInSeconds: number = 3600,
): DownloadGrant {
  const now = new Date();
  return {
    id: "grant-" + Date.now() + Math.random().toString(36).slice(2, 7),
    versionId,
    assetId,
    userId,
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
  };
}

export function assetUrlFromKey(_storageKey: string): string {
  return "/api/assets/download/" + _storageKey;
}

export function sanitizeFilename(name: string): string {
  const safe = name
    .replace(/[^\w.-]/g, "_")
    .replace(/_+/g, "_")
    .trim() || "asset";
  return safe.slice(0, 120);
}
