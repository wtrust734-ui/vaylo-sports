import { supabase } from "@/integrations/supabase/client";
import { getAiLocale } from "@/i18n";

/**
 * Client wrapper for the central AI service (`ai-service` edge function).
 *
 * Models and prompts live server-side in `supabase/functions/_shared/aiModels.ts`.
 * Never call OpenAI or name a model from the frontend.
 */

export type AIFeature =
  | "connection_test"
  | "running_plan"
  | "strength_plan"
  | "meal_plan"
  | "ai_coach"
  | "running_technique"
  | "form_analysis"
  | "race_strategy"
  | "competitor_analysis"
  | "recovery_advice"
  | "daily_recommendation"
  | "cognitive_reframing"
  | "calorie_scanner"
  | "limiter_analysis"
  | "performance_analysis"
  | "injury_guidance"
  | "learning_recommend"
  | "weekly_review"
  | "tactical_prep"
  | "ignition"
  | "mental_checkin"
  | "music_recommendations"
  | "light_chat"
  | "summary"
  | "reinforcement"
  | "encouragement";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RunAIOptions {
  feature: AIFeature;
  userPrompt: string;
  /** Extra guidance appended to the feature's server-side system prompt. */
  systemPrompt?: string;
  /** Structured athlete data (profile, logs, metrics) — sent as data, not instructions. */
  userData?: Record<string, unknown>;
  /** Conversation history for history-enabled features. */
  history?: ChatTurn[];
  /** Image data URLs for vision features (form analysis, calorie scanner). */
  images?: string[];
  maxOutputTokens?: number;
}

export interface AIResult {
  text: string;
  feature: string;
  model: string;
  durationMs: number;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
}

/** Calls the central AI service and returns the full result (text + metadata). */
export async function runAIDetailed(options: RunAIOptions): Promise<AIResult> {
  const prompt = options.userPrompt?.trim();
  if (!prompt) throw new Error("Please enter a prompt.");
  if (prompt.length > 8000) throw new Error("That prompt is too long (8000 character limit).");

  // Auto-attach dossier if caller didn't provide rich userData — every AI should know the athlete
  let enrichedUserData = options.userData;
  const hasRich = enrichedUserData && typeof enrichedUserData === "object" && ("pbs" in enrichedUserData || "profile" in enrichedUserData || "dossier" in enrichedUserData);
  if (!hasRich) {
    try {
      const { buildClientDossier } = await import("./athleteDossier");
      const dossier = await buildClientDossier();
      const d = dossier as { pbs?: unknown; pbs_text?: string };
      enrichedUserData = { ...(enrichedUserData || {}), dossier, pbs: d.pbs, pbs_text: d.pbs_text };
    } catch { /* best-effort */ }
  }

  // The athlete's UI language rides along with every AI request so generated
  // coaching, plans and insights come back in that language. The edge function
  // injects it into the system prompt; English requests are unaffected.
  const { data, error } = await supabase.functions.invoke("ai-service", {
    body: { ...options, userData: enrichedUserData, userPrompt: prompt, userLocale: getAiLocale() },
  });

  if (error) {
    const message = (data as { error?: string } | null)?.error || error.message;
    throw new Error(message || "AI request failed.");
  }
  const result = data as AIResult | { error?: string };
  if ("error" in result && result.error) throw new Error(result.error);
  if (!(result as AIResult).text) throw new Error("The AI returned an empty response.");
  return result as AIResult;
}

/** Calls the central AI service and returns just the response text. */
export async function runAI(options: RunAIOptions): Promise<string> {
  return (await runAIDetailed(options)).text;
}

/** Server-side model/prompt catalog — used by the developer testing page. */
export async function fetchAICatalog(): Promise<
  Array<{ name: AIFeature; label: string; model: string; system: string; maxOutputTokens: number; allowImages: boolean; useHistory: boolean }>
> {
  const { data, error } = await supabase.functions.invoke("ai-service", { method: "GET" });
  if (error) throw new Error(error.message);
  return (data as { features: Array<{ name: AIFeature; label: string; model: string; system: string; maxOutputTokens: number; allowImages: boolean; useHistory: boolean }> }).features;
}

/* -------- Feature helpers: thin wrappers, all share the one service -------- */

const make = (feature: AIFeature) =>
  (userPrompt: string, userData?: Record<string, unknown>) => runAI({ feature, userPrompt, userData });

export const generateRunningPlan = make("running_plan");
export const generateStrengthPlan = make("strength_plan");
export const generateMealPlan = make("meal_plan");
export const generateRunningTechnique = make("running_technique");
export const generateRaceStrategy = make("race_strategy");
export const analyzeCompetitor = make("competitor_analysis");
export const getRecoveryAdvice = make("recovery_advice");
export const getDailyRecommendation = make("daily_recommendation");
export const reframeThought = make("cognitive_reframing");
export const analyzeLimiterTest = make("limiter_analysis");
export const analyzePerformance = make("performance_analysis");
export const getInjuryGuidance = make("injury_guidance");
export const getTacticalPrep = make("tactical_prep");
export const getIgnitionMessage = make("ignition");
export const getMentalCheckIn = make("mental_checkin");
export const getMusicRecommendations = make("music_recommendations");
export const summarize = make("summary");
export const getReinforcement = make("reinforcement");
export const getEncouragement = make("encouragement");

/** Full AI coach with conversation history. */
export const askCoach = (userPrompt: string, history?: ChatTurn[], userData?: Record<string, unknown>) =>
  runAI({ feature: "ai_coach", userPrompt, history, userData });

/** Short, cheap chat for quick in-app questions. */
export const askLightChat = (userPrompt: string, history?: ChatTurn[]) =>
  runAI({ feature: "light_chat", userPrompt, history });

/** Form analysis from one or more image data URLs. */
export const analyzeForm = (userPrompt: string, images: string[], userData?: Record<string, unknown>) =>
  runAI({ feature: "form_analysis", userPrompt, images, userData });

/** Calorie scanner — returns the parsed JSON estimate. */
export async function scanMealPhoto(imageDataUrl: string, note?: string) {
  const text = await runAI({
    feature: "calorie_scanner",
    userPrompt: note?.trim() ||
      "Analyse this meal photo. Identify every component, estimate grams from visual cues, return the JSON schema exactly.",
    images: [imageDataUrl],
  });
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned) as {
      name: string; description: string; calories: number; protein: number;
      carbs: number; fat: number; fiber: number; serving: string;
      confidence: string; disclaimer?: string;
    };
  } catch {
    throw new Error("Could not read the scan result. Try a clearer photo.");
  }
}

/** Verification helper used by the developer AI testing page. */
export const testAIConnection = () =>
  runAIDetailed({
    feature: "connection_test",
    userPrompt: "Say 'VAYLO AI integration successful.'",
  });
