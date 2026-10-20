// ============================================================================
// MARKET DISCOVERY — search + status filter as pure, testable functions
// ----------------------------------------------------------------------------
// Prompt 10, discovery. The Market's biggest catalog (one-off unlocks) grew //
// with every feature the app shipped, but it stayed one long letter-ordered //
// list with nothing to search or filter. The athlete who wants one unlock //
// ("do I own the mental gym?") scrolls; the athlete browsing wants locked vs //
// owned separated, which the section already does but with no control over //
// it. //
// //
// Same rule as everywhere else in the shop: this module is arithmetic and //
// string work on data the caller already owns. It cannot invent a product, //
// change a price, or create a duplicate — what it sorts and hides stays //
// exactly what the catalog held. //
// ============================================================================

export type UnlockStatus = "all" | "locked" | "owned";

export interface CatalogEntryLike {
  /** Unique catalog identity — the product id, never a display name. */
  product: string;
  /** Display label, e.g. "Mental Gym". */
  label: string;
  /** What the unlock includes, searched alongside the label. */
  unlocks: string[];
  tagline?: string;
}

/** Diacritic-folded lowercase — "Éclair" matches "eclair" without config. */
export function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * True when an entry matches a typed query: label, tagline or any entitlement
 * line contains EVERY whitespace-separated term anywhere. Multi-term queries
 * ("mental focus drills") behave like AND, which is what a phone keyboard
 * buyer does — they type the two words they know, in either order.
 */
export function entryMatchesQuery(entry: CatalogEntryLike, query: string): boolean {
  const terms = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = foldForSearch(
    [entry.label, entry.tagline ?? "", ...entry.unlocks].join(" "),
  );
  return terms.every((t) => haystack.includes(t));
}

/** Which entries a status chip shows. */
export function entryMatchesStatus(entry: CatalogEntryLike, status: UnlockStatus, isOwned: (e: CatalogEntryLike) => boolean): boolean {
  if (status === "locked") return !isOwned(entry);
  if (status === "owned") return isOwned(entry);
  return true;
}

/**
 * One filter pass for the unlock grid: status chip first (cheap, reduces
 * everything), then the text query. Owned items keep their positions at the
 * END (already the section's rule) so a purchase never reorders the list out
 * from under the athlete's finger mid-scroll.
 */
export function filterMarketEntries<T extends CatalogEntryLike>(
  entries: T[],
  query: string,
  status: UnlockStatus,
  isOwned: (e: T) => boolean,
): T[] {
  const statusFiltered = entries.filter((e) => entryMatchesStatus(e, status, isOwned));
  const queryFiltered = foldForSearch(query)
    ? statusFiltered.filter((e) => entryMatchesQuery(e, query))
    : statusFiltered;
  // Owned stays last within the filtered result, preserving relative order;
  // `filter` already returned a copy, so the sort never mutates the catalog.
  return queryFiltered.sort((a, b) => (isOwned(a) ? 1 : 0) - (isOwned(b) ? 1 : 0));
}
