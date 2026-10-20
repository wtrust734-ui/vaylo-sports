// ============================================================================
// GOOGLE GEMINI — the shared adapter for FORM ANALYSIS
// ----------------------------------------------------------------------------
// The product decision is that every form-analysis feature runs on the Google
// API (photo analysis in ai-analyze, video analysis in video-form-analysis),
// and every other AI feature runs on OpenAI. This module is the ONE place that
// speaks Gemini's Generative Language API, mirroring _shared/openai.ts for the
// other provider: one URL shape, one secret (GOOGLE_API), one place that can
// ever leak a provider body into a log.
//
// Log hygiene, deliberately: failures return { ok: false, status } and log the
// HTTP status plus a fixed marker. The raw provider body is never read on the
// error path — it can echo request metadata back into our logs — and client
// facing messages are chosen by the caller, never passed through.
// ============================================================================

/** A Gemini content part: text, or an inline (data-URL payload) image. */
export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export interface GeminiCall {
  /** Model id — always from GEMINI_MODELS in aiModels.ts, never a literal. */
  model: string;
  apiKey: string;
  /** System instruction. Optional: some prompts are fully inlined by design. */
  systemText?: string;
  /** User content parts, in order (text prompt first, then images). */
  parts: GeminiPart[];
  /** Optional generation config (responseMimeType / responseSchema, etc.). */
  generationConfig?: Record<string, unknown>;
}

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; status: number };

/**
 * One generateContent call. Resolves with the concatenated candidate text on
 * success, or the HTTP status on failure — never the response body.
 */
export async function geminiGenerate(call: GeminiCall): Promise<GeminiResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${call.model}:generateContent?key=${call.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: call.parts }],
        ...(call.systemText
          ? { systemInstruction: { parts: [{ text: call.systemText }] } }
          : {}),
        ...(call.generationConfig ? { generationConfig: call.generationConfig } : {}),
      }),
    },
  );

  if (!res.ok) {
    // Status + marker only — never the raw provider body.
    console.error("Gemini request failed", res.status, "upstream_error");
    return { ok: false, status: res.status };
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return { ok: true, text: parts.map((p) => p.text ?? "").join("") };
}
