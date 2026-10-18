export type VideoProviderModel = "veo-3.1" | "veo-3.1-fast" | "veo-unavailable";

export interface VideoGenerationRequest {
  model: VideoProviderModel;
  prompt: string;
  aspectRatio?: string;
  durationSeconds?: number;
  referenceImages?: string[];
  referenceVideoUrl?: string;
}

export interface VideoGenerationResult {
  success: boolean;
  provider: "veo" | "unavailable";
  model: VideoProviderModel;
  operationId?: string;
  error?: string;
  errorCode?: string;
}

export const DEFAULT_VIDEO_MODEL: VideoProviderModel = "veo-3.1";

export const ALLOWED_VIDEO_MODELS: VideoProviderModel[] = ["veo-3.1"];

export function resolveVideoModel(requested?: string): VideoProviderModel {
  if (!requested) return DEFAULT_VIDEO_MODEL;
  if (requested === "veo-3.1") return "veo-3.1";
  if (requested === "veo-3.1-fast") return "veo-3.1-fast";
  return DEFAULT_VIDEO_MODEL;
}

export function acceptsVideoModel(model: VideoProviderModel): boolean {
  return ALLOWED_VIDEO_MODELS.includes(model);
}

export function requiresVideoCredentials(): boolean {
  const key = process.env.GOOGLE_VIDEO_API_KEY;
  const project = process.env.GOOGLE_VIDEO_PROJECT;
  return Boolean(key && key.trim().length > 0 && project && project.trim().length > 0);
}

export async function generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
  const model = resolveVideoModel(request.model);

  if (!acceptsVideoModel(model)) {
    return {
      success: false,
      provider: "unavailable",
      model,
      error: "This request was routed to a video model that is not permitted. Veo 3.1 Fast and other video models are not allowed for Vaylo Sports video ads.",
      errorCode: "model_not_allowed",
    };
  }

  if (model === "veo-3.1-fast") {
    return {
      success: false,
      provider: "veo",
      model,
      error: "Veo 3.1 Fast is not used for Vaylo Sports video ads. Standard Veo 3.1 is required.",
      errorCode: "model_not_allowed",
    };
  }

  if (!requiresVideoCredentials()) {
    return {
      success: false,
      provider: "unavailable",
      model,
      error: "Video generation is not configured. Set the Google Veo 3.1 API key and project before generating video ads.",
      errorCode: "missing_credentials",
    };
  }

  if (model === "veo-3.1") {
    return {
      success: false,
      provider: "veo",
      model,
      error: "The Veo 3.1 video integration is reserved for the next build phase. Video ads are not generated yet because the provider is not connected to real credentials and the asynchronous lifecycle is not wired into the backend.",
      errorCode: "provider_not_ready",
    };
  }

  return {
    success: false,
    provider: "unavailable",
    model,
    error: "Video generation is not available.",
    errorCode: "unknown_model",
  };
}
