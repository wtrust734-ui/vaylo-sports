export type ImageProviderModel =
  | "openai-image-2.5"
  | "openai-image-2"
  | "fallback-unavailable";

export interface ImageGenerationRequest {
  model: ImageProviderModel;
  prompt: string;
  aspectRatio?: string;
  size?: string;
}

export interface ImageGenerationResult {
  success: boolean;
  provider: "openai" | "unavailable";
  model: ImageProviderModel;
  imageUrl?: string;
  error?: string;
  errorCode?: string;
}

export const OPENAI_IMAGE_DEFAULT_MODEL: ImageProviderModel = "openai-image-2.5";

export const KNOWN_IMAGE_MODELS: ImageProviderModel[] = [
  "openai-image-2.5",
  "openai-image-2",
];

export function resolveImageModel(requested?: string): ImageProviderModel {
  if (!requested) return OPENAI_IMAGE_DEFAULT_MODEL;
  if (KNOWN_IMAGE_MODELS.includes(requested as ImageProviderModel)) {
    return requested as ImageProviderModel;
  }
  return OPENAI_IMAGE_DEFAULT_MODEL;
}

export function requiresImageCredentials(model: ImageProviderModel): boolean {
  if (model === "fallback-unavailable") return false;
  return true;
}

export async function generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const model = resolveImageModel(request.model);

  if (!processImageCredentials()) {
    return {
      success: false,
      provider: "unavailable",
      model,
      error: "Image generation is not configured. Set the OpenAI image API credentials before generating picture ads.",
      errorCode: "missing_credentials",
    };
  }

  if (model === "openai-image-2.5") {
    return {
      success: false,
      provider: "openai",
      model,
      error: "The requested image model is reserved for the next build phase. For now, picture ads cannot be rendered until the OpenAI image integration is connected to real credentials.",
      errorCode: "provider_not_ready",
    };
  }

  if (model === "openai-image-2") {
    return {
      success: false,
      provider: "openai",
      model,
      error: "The fallback image model path is reserved for the next build phase. No image was generated.",
      errorCode: "provider_not_ready",
    };
  }

  return {
    success: false,
    provider: "unavailable",
    model,
    error: "Image generation is not available.",
    errorCode: "unknown_model",
  };
}

function processImageCredentials(): boolean {
  const key = process.env.OPENAI_IMAGE_API_KEY;
  return Boolean(key && key.trim().length > 0);
}
