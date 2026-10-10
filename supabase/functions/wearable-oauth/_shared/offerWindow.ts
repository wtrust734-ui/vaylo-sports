// ============================================================================
// OFFER WINDOWS — edge-side mirror of `src/lib/offerWindow.ts`
// ----------------------------------------------------------------------------
// `special_offers` rows stay `active = true` after their own `ends_at` passes,
// because nothing in the database clears the flag. `process-purchase` reads
// those rows with the SERVICE ROLE, so the SELECT policy added by
// `20260927140000_offer_windows.sql` does not apply to it: without this check an
// expired promo would still be a purchasable `offer_<slug>` product and an
// expired `double_credits` row would still multiply the credits actually granted.
//
// Pure and dependency-free so it can live in the Deno bundle and be asserted
// from the app's vitest suite — `src/lib/offerWindow.test.ts` pins this file and
// the client copy to identical behaviour, so the two cannot drift.
// ============================================================================

/** The window fields any offer-like row must expose. */
export type OfferWindow = {
  starts_at?: string | null;
  ends_at?: string | null;
};

/** Parses a timestamp, treating null/blank/garbage as "no bound on that side". */
export function parseOfferTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
}

/**
 * True when `now` sits inside the offer's own window.
 *
 * An absent or unparseable bound is open-ended rather than expired: a malformed
 * timestamp must not silently delete a live offer, and `welcome-starter`
 * intentionally has no `ends_at` (its 72h account-age window is enforced in code).
 *
 * Boundaries: `starts_at` inclusive, `ends_at` exclusive.
 */
export function isOfferLive(offer: OfferWindow, now: number = Date.now()): boolean {
  const startsAt = parseOfferTime(offer.starts_at);
  if (startsAt !== null && startsAt > now) return false;

  const endsAt = parseOfferTime(offer.ends_at);
  if (endsAt !== null && endsAt <= now) return false;

  return true;
}
