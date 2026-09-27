// ============================================================================
// OFFER WINDOWS — is an offer row actually live right now?
// ----------------------------------------------------------------------------
// `active` alone is not enough to decide whether an offer may grant anything.
// The seeded rows carry `ends_at = created_at + interval`, and nothing in the
// database ever flips `active` back off once that deadline passes: the row stays
// `active = true` forever. `double_weekend` proved it — expired 2026-09-23, still
// active, and still the row `getDoubleCreditsOffer` picked up.
//
// The database is authoritative (the SELECT policy hides out-of-window rows from
// clients), and this is the client-side mirror so a cached, stale or
// service-role-fetched row can never drive pricing or bonuses either.
//
// Deliberately free of supabase/billing imports so the window math stays pure
// and unit-testable — same reason `starterOffer.ts` keeps `hoursLeftInWindow`
// import-free.
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
 * An absent or unparseable bound is treated as open-ended rather than expired —
 * a malformed timestamp should not silently delete a live offer, and the
 * `welcome-starter` row intentionally has no `ends_at` (its 72h account-age
 * window is enforced in code).
 *
 * Boundaries: `starts_at` is inclusive, `ends_at` is exclusive, so an offer that
 * ends at 16:42 is no longer live at 16:42.
 */
export function isOfferLive(offer: OfferWindow, now: number = Date.now()): boolean {
  const startsAt = parseOfferTime(offer.starts_at);
  if (startsAt !== null && startsAt > now) return false;

  const endsAt = parseOfferTime(offer.ends_at);
  if (endsAt !== null && endsAt <= now) return false;

  return true;
}
