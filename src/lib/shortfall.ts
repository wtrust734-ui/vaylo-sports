// ============================================================================
// SHORTFALL FROM EDGE ERROR — structured 402 parsing for edge-charged features
// ----------------------------------------------------------------------------
// Edge functions (ai-analyze, generate-plan, video-form-analysis…) charge
// credits server-side and answer 402 with { error, shortfall, cost, balance }.
// This mirrors edgeErrorMessage() but returns the numbers, so a screen can
// offer the top-up sheet with the exact gap instead of a guess.
// ============================================================================

export type EdgeShortfall = {
  shortfall: number;
  cost: number;
  balance: number;
  message: string;
};

export async function shortfallFromEdgeError(error: unknown): Promise<EdgeShortfall | null> {
  if (!error || typeof error !== "object" || !("context" in error)) return null;
  try {
    const payload = await (error as { context: Response }).context.json();
    if (!payload || typeof payload !== "object") return null;
    const p = payload as { error?: unknown; shortfall?: unknown; cost?: unknown; balance?: unknown };
    if (typeof p.shortfall !== "number" || p.shortfall <= 0) return null;
    return {
      shortfall: p.shortfall,
      cost: typeof p.cost === "number" ? p.cost : 0,
      balance: typeof p.balance === "number" ? p.balance : 0,
      message: typeof p.error === "string" && p.error ? p.error : "Not enough credits.",
    };
  } catch {
    return null;
  }
}
