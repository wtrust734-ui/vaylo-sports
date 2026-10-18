export interface AdServiceConfig {
  imageApiKey?: string;
  imageModel?: string;
  videoApiKey?: string;
  videoProject?: string;
  veoModel?: string;
  storageUrl?: string;
  storageSecret?: string;
  requireManualApproval?: boolean;
  approvalStoreUrl?: string;
  planPath?: string;
}

export function isConfigured(config: AdServiceConfig): boolean {
  const imageReady = Boolean(
    config.imageApiKey && config.imageApiKey.trim().length > 0,
  );
  const videoReady = Boolean(
    config.videoApiKey && config.videoApiKey.trim().length > 0 &&
    config.videoProject && config.videoProject.trim().length > 0,
  );

  return imageReady && videoReady;
}

export function configGap(config: AdServiceConfig): string[] {
  const gaps: string[] = [];

  if (!config.imageApiKey || !config.imageApiKey.trim()) {
    gaps.push("OPENAI_IMAGE_API_KEY");
  }
  if (!config.videoApiKey || !config.videoApiKey.trim()) {
    gaps.push("GOOGLE_VIDEO_API_KEY");
  }
  if (!config.videoProject || !config.videoProject.trim()) {
    gaps.push("GOOGLE_VIDEO_PROJECT");
  }
  if (!config.approvalStoreUrl || !config.approvalStoreUrl.trim()) {
    gaps.push("APPROVAL_STORE_URL");
  }

  return gaps;
}

export function effectiveImageModel(config: AdServiceConfig): string {
  return config.imageModel?.trim() || "openai-image-2.5";
}

export function effectiveVeoModel(config: AdServiceConfig): string {
  return config.veoModel?.trim() || "veo-3.1";
}

export function requiresManualApproval(config: AdServiceConfig): boolean {
  return config.requireManualApproval !== false;
}
