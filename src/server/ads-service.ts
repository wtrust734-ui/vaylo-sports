import type { AdFormat, WorkflowStatus } from "@/store/workflowStore";
import type { AdServiceConfig } from "./ads-service-config";
import {
  generateImage,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  resolveImageModel,
} from "./providers/image";
import {
  generateVideo,
  type VideoGenerationRequest,
  type VideoGenerationResult,
  acceptsVideoModel,
  resolveVideoModel,
} from "./providers/video";
import { validateStoredAsset, type StoredAsset } from "./storage";
import type { StageKind } from "@/store/workflowStore";

export interface AdServiceExecution {
  config: AdServiceConfig;
  store: {
    stages: Array<{ id: StageKind; status: string; note: string; logs?: string[] }>;
    campaignStatus: WorkflowStatus;
    currentFormat?: AdFormat;
  };
}

export function createAdsService(config: AdServiceConfig): {
  generate: (request: AdGenerationRequest) => Promise<AdGenerationResult>;
  config: AdServiceConfig;
} {
  return {
    config,
    generate: async (request: AdGenerationRequest): Promise<AdGenerationResult> => {
      const imageModel = resolveImageModel(request.imageModel);
      const videoModel = resolveVideoModel(request.videoModel);
      const isVideo = request.format === "video" || request.format === "both";
      const isImage = request.format === "image" || request.format === "both";
      const hasVideo = isVideo && acceptsVideoModel(videoModel);
      const hasImage = isImage;

      if (isVideo && !hasVideo) {
        return {
          success: false,
          provider: "unavailable",
          model: "video",
          error: "Video generation was requested but the requested video model is not permitted or not configured. Veo 3.1 is required for Vaylo Sports video ads.",
          errorCode: "video_not_allowed",
        };
      }

      if (request.format === "both") {
        const imageResult = await generateImage({
          model: imageModel,
          prompt: request.prompt,
          aspectRatio: request.aspectRatio,
          size: request.imageSize,
        });

        const videoResult = await generateVideo({
          model: videoModel,
          prompt: request.prompt,
          aspectRatio: request.aspectRatio,
          durationSeconds: request.durationSeconds,
        });

        if (!imageResult.success || !videoResult.success) {
          return {
            success: false,
            provider: "mixed",
            model: "both",
            error: [
              imageResult.error ?? "image generation failed",
              videoResult.error ?? "video generation failed",
            ]
              .filter(Boolean)
              .join("; "),
            errorCode: "partial_failure",
            failedProvider: [imageResult.provider, videoResult.provider].filter(
                (p, i, a) => p && !a.slice(0, i).includes(p),
              )[0],
          };
        }

        return {
          success: true,
          provider: "both",
          model: "both",
          imageUrl: imageResult.imageUrl ?? undefined,
          videoOperationId: videoResult.operationId ?? undefined,
        };
      }

      if (isImage) {
        const result = await generateImage({
          model: imageModel,
          prompt: request.prompt,
          aspectRatio: request.aspectRatio,
          size: request.imageSize,
        });
        return {
          success: result.success,
          provider: result.provider,
          model: result.model,
          imageUrl: result.imageUrl ?? undefined,
          error: result.error ?? undefined,
          errorCode: result.errorCode ?? undefined,
        };
      }

      if (isVideo) {
        const result = await generateVideo({
          model: videoModel,
          prompt: request.prompt,
          aspectRatio: request.aspectRatio,
          durationSeconds: request.durationSeconds,
        });
        return {
          success: result.success,
          provider: result.provider,
          model: result.model,
          videoOperationId: result.operationId ?? undefined,
          error: result.error ?? undefined,
          errorCode: result.errorCode ?? undefined,
        };
      }

      return {
        success: false,
        provider: "unavailable",
        model: "unknown",
        error: "No supported format was requested.",
        errorCode: "unknown_format",
      };
    },
  };
}

export interface AdGenerationRequest {
  format: AdFormat;
  prompt: string;
  imageModel?: string;
  videoModel?: string;
  aspectRatio?: string;
  imageSize?: string;
  durationSeconds?: number;
}

export interface AdGenerationResult {
  success: boolean;
  provider: string;
  model: string;
  imageUrl?: string;
  videoOperationId?: string;
  error?: string;
  errorCode?: string;
  failedProvider?: string;
}

export function validateDownload(asset: StoredAsset | null): {
  ok: boolean;
  error?: string;
} {
  if (!asset) return { ok: false, error: "Asset not found." };
  if (!validateStoredAsset(asset)) return { ok: false, error: "Asset is invalid." };
  if (asset.type !== "image" && asset.type !== "video") return { ok: false, error: "Asset has an unsupported type." };
  return { ok: true };
}
