// ============================================================================
// edgeErrorMessage — turn a supabase.functions.invoke error into readable text
// ----------------------------------------------------------------------------
// With FunctionsHttpError the useful message lives in the response body
// ({ error: "..." }); FunctionsRelayError/FetchError carry it on `message`.
// Callers: `throw new Error(await edgeErrorMessage(error))` so the catch block
// can show the server's reason (e.g. "Not enough credits…") directly.
// ============================================================================

// An AI feature whose provider key has not been set yet answers 500 with the
// name of the missing environment variable. That is an operator's fact, not the
// athlete's, and "Coach Error — OPENAI_API_KEY not configured" reads as a fault
// in the app rather than a feature that is still being switched on. Recognise
// the shape and say the thing a player can act on.
const NOT_READY = /(API key not configured|API_KEY(?: missing| not configured)|not configured|is not configured)/i;

export const AI_NOT_READY_MESSAGE =
  "This feature isn't switched on yet. Everything else works — check back soon.";

export function isNotReadyMessage(message: string): boolean {
  return NOT_READY.test(message);
}

export async function edgeErrorMessage(error: unknown): Promise<string> {
  if (error && typeof error === "object" && "context" in error) {
    try {
      const payload = await (error as { context: Response }).context.json();
      if (payload && typeof payload.error === "string" && payload.error) {
        return isNotReadyMessage(payload.error) ? AI_NOT_READY_MESSAGE : payload.error;
      }
    } catch {
      /* body unreadable — fall through */
    }
  }
  if (error instanceof Error && error.message) {
    return isNotReadyMessage(error.message) ? AI_NOT_READY_MESSAGE : error.message;
  }
  return "Something went wrong. Please try again.";
}
