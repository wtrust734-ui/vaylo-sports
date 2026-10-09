// ============================================================================
// OFFER VISIBILITY — never advertise a one-time offer twice
// ----------------------------------------------------------------------------
// Every offer in this app is one-per-account, and that is enforced on the
// server, not by the client: `process-purchase` treats a `offer_<slug>` product
// id as a one-time redemption and answers 409 for a second attempt. The Market
// did not know that. It showed the Welcome Bundle card — labelled "ONE-TIME
// OFFER · Available once per account" — to an athlete who had already bought
// it, so the honest reading of the screen was "buy this", and the honest
// outcome of tapping it was a refusal.
//
// The dashboard's starter card had the right behaviour already (see
// `getStarterOfferState`), which is exactly why this bug was easy to miss:
// whether the athlete saw a dead offer depended on which screen they opened.
// This module is the shared answer, and it deliberately works for EVERY offer
// type rather than only the starter one, because the one-time rule lives in
// process-purchase and applies to all of them.
//
// The failure direction is deliberate: if the purchase history cannot be read,
// the offers are SHOWN. Hiding a live offer from every athlete during a
// read outage loses real sales, while showing a spent one costs a tap and a 409
// the app already handles. Being wrong in that direction is the cheaper error.
//
// Like `starterOffer.ts`, the Supabase client is imported lazily inside the
// async function so the pure filter can be unit-tested without a database.
// ============================================================================

/** Product-id prefix that marks a one-time offer redemption. */
export const OFFER_PRODUCT_PREFIX = "offer_";

/**
 * `offer_welcome-starter` → `welcome-starter`. Returns null for anything that
 * is not an offer product, and for a bare prefix with no slug — a row like
 * `offer_` must not be able to hide a real offer whose slug is empty.
 */
export function offerSlugFromProductId(productId: unknown): string | null {
  if (typeof productId !== "string") return null;
  if (!productId.startsWith(OFFER_PRODUCT_PREFIX)) return null;
  const slug = productId.slice(OFFER_PRODUCT_PREFIX.length).trim();
  return slug.length > 0 ? slug : null;
}

/**
 * Drops every offer the athlete has already redeemed. Pure, so the rule is
 * testable without a database and usable anywhere an offer list is rendered.
 */
export function filterUnclaimedOffers<T extends { slug: string }>(
  offers: T[],
  claimed: ReadonlySet<string>,
): T[] {
  if (claimed.size === 0) return offers;
  return offers.filter((offer) => !claimed.has(offer.slug));
}

/**
 * The offer slugs this account has already bought. An empty set means "nothing
 * known to be redeemed" — which is also what a failed read returns, on purpose
 * (see the note above).
 */
export async function claimedOfferSlugs(userId?: string | null): Promise<Set<string>> {
  if (!userId) return new Set();

  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase
      .from("user_purchases")
      .select("product_id")
      .eq("user_id", userId)
      .like("product_id", `${OFFER_PRODUCT_PREFIX}%`);

    if (error || !data) return new Set();

    const slugs = data
      .map((row) => offerSlugFromProductId((row as { product_id?: string }).product_id))
      .filter((slug): slug is string => slug !== null);

    return new Set(slugs);
  } catch {
    return new Set();
  }
}
