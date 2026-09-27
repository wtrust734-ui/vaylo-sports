// ============================================================================
// edgeErrorMessage — turn a supabase.functions.invoke error into readable text
// ----------------------------------------------------------------------------
// With FunctionsHttpError the useful message lives in the response body
// ({ error: "..." }); FunctionsRelayError/FetchError carry it on `message`.
// Callers: `throw new Error(await edgeErrorMessage(error))` so the catch block
// can show the server's reason (e.g. "Not enough credits…") directly.
// ============================================================================

export async function edgeErrorMessage(error: unknown): Promise<string> {
  if (error && typeof error === "object" && "context" in error) {
    try {
      const payload = await (error as { context: Response }).context.json();
      if (payload && typeof payload.error === "string" && payload.error) return payload.error;
    } catch {
      /* body unreadable — fall through */
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}
