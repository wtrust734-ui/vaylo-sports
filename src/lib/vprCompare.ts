// ============================================================================
// STACK UP VS ELITE — what has already been paid for
// ----------------------------------------------------------------------------
// A comparison costs 2 credits ONCE PER TARGET: the screen says so in as many
// words ("comparing again to a target already paid for does not charge twice").
// That promise was kept in component state, which made it true inside one visit
// to the screen and false the moment the athlete navigated away and came back —
// the same target cost another 2 credits.
//
// The receipt for a paid comparison is the `credit_transactions` row that
// `credits_spend()` wrote, so the target id travels in the spend's metadata and
// is read back out of it. Read from the server rather than kept on the device on
// purpose: a credit balance lives on the account, so an unlock that "restores on
// every device you sign in to" has to live there too. Device storage would
// restore on one phone and charge again on the next.
//
// Both halves are here rather than inline in the screen so the round trip can be
// tested without a database: what is written is what is read.
// ============================================================================

/** The feature key the spend is charged to, and the key its receipts carry. */
export const VPR_COMPARE_FEATURE = "vpr_compare";

/** What a comparison spend records about itself. */
export const compareSpendMetadata = (eliteId: string): Record<string, unknown> => ({
  elite_id: eliteId,
});

/**
 * The target ids an athlete has already paid to compare against.
 *
 * Total by construction: a row with no metadata, a metadata value that is not an
 * object, an array, and a non-string id are all simply skipped. This runs on
 * every mount of a paid screen, and a malformed receipt from an old build must
 * cost the athlete a re-read, never a crash or — worse — a phantom unlock.
 */
export function paidTargetsFrom(rows: ReadonlyArray<{ metadata?: unknown }>): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const metadata = row?.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
    const id = (metadata as Record<string, unknown>).elite_id;
    if (typeof id === "string" && id.trim() !== "") ids.add(id);
  }
  return [...ids];
}
