// ============================================================================
// STARTER OFFER — one discounted Welcome Bundle per new account
// ----------------------------------------------------------------------------
// The offer row lives in the `special_offers` table (slug `welcome-starter`),
// which means:
//   * the PRICE comes from the database — process-purchase re-reads it and
//     never trusts the client,
//   * redemption is one-per-account by construction: every `offer_*` product id
//     goes through the 409 duplicate guard in process-purchase,
//   * timing (72h window) is part of the row — the same offer engine the Market
//     and Admin already use, so nothing new to monitor or configure.
//
// Client eligibility mirrors the server rules but is presentation-only: even a
// tampered client cannot buy twice or at the wrong price.
//
// NOTE: this module is deliberately free of top-level supabase/billing imports
// (they are pulled in lazily inside the async functions) so the pure window
// math stays unit-testable — same reason moneyCatalog has its own mirror test.
// ============================================================================

/** The special_offers slug that backs the Welcome Bundle. */
export const STARTER_OFFER_SLUG = "welcome-starter";

/** Product id sent to process-purchase (offer_ prefix = one-time redemption). */
export const STARTER_OFFER_PRODUCT_ID = `offer_${STARTER_OFFER_SLUG}`;

/** How long a new account can see the offer. Mirrored by the row's ends_at. */
export const STARTER_OFFER_WINDOW_HOURS = 72;

export type StarterOfferInfo = {
  title: string;
  description: string | null;
  /** Credits granted = linked pack credits + bonus_flat. */
  credits: number;
  bonus: number;
  priceCents: number | null;
  /** ISO deadline (row's ends_at) — null means no server deadline. */
  endsAt: string | null;
};

export type StarterOfferState =
  | { status: "loading" }
  | { status: "eligible"; info: StarterOfferInfo; hoursLeft: number }
  | { status: "claimed" }
  | { status: "unavailable" };

/** Pure date math so the window logic is unit-testable without a database. */
export function hoursLeftInWindow(
  now: number,
  accountCreatedAt: string | Date | null | undefined,
  windowHours = STARTER_OFFER_WINDOW_HOURS
): number {
  if (!accountCreatedAt) return 0;
  const created = new Date(accountCreatedAt).getTime();
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, (created + windowHours * 3600_000 - now) / 3600_000);
}

/**
 * Works out whether the signed-in athlete should see the Welcome Bundle.
 * Eligible = active offer row exists + no prior redemption + inside the window.
 */
export async function getStarterOfferState(userId?: string | null): Promise<StarterOfferState> {
  if (!userId) return { status: "unavailable" };

  const { supabase } = await import("@/integrations/supabase/client");

  // 1. Already bought? (user_purchases is readable for own rows.)
  try {
    const { data: prior } = await supabase
      .from("user_purchases")
      .select("id")
      .eq("user_id", userId)
      .eq("product_id", STARTER_OFFER_PRODUCT_ID)
      .limit(1)
      .maybeSingle();
    if (prior) return { status: "claimed" };
  } catch {
    // RLS/tables unavailable — treat as unavailable rather than blocking the UI.
    return { status: "unavailable" };
  }

  // 2. Active offer row (price and window come from here).
  const { data: offer } = await supabase
    .from("special_offers")
    .select("title, description, pack_id, bonus_flat, price_cents, ends_at")
    .eq("slug", STARTER_OFFER_SLUG)
    .eq("active", true)
    .maybeSingle();

  if (!offer) return { status: "unavailable" };

  // 3. Within the account-age window (and the row's own ends_at, if set).
  const { data: profile } = await supabase
    .from("profiles")
    .select("created_at")
    .eq("user_id", userId)
    .maybeSingle();

  const accountHoursLeft = hoursLeftInWindow(Date.now(), profile?.created_at);
  const rowHoursLeft = offer.ends_at ? hoursLeftInWindow(Date.now(), offer.ends_at, 0) : accountHoursLeft;
  const hoursLeft = offer.ends_at ? Math.min(accountHoursLeft, rowHoursLeft) : accountHoursLeft;
  if (hoursLeft <= 0) return { status: "unavailable" };

  // Credits the bundle grants: linked pack's total + flat bonus. The pack
  // lookup only reads the config for display — process-purchase re-derives the
  // real grant server-side, so a stale config can only mislabel, never overpay.
  const { CREDIT_PACKS } = await import("@/config/credits");
  const pack = CREDIT_PACKS.find((p) => p.id === offer.pack_id);
  const credits = (pack ? pack.credits + (pack.bonus || 0) : 0) + Number(offer.bonus_flat ?? 0);

  if (credits <= 0) return { status: "unavailable" };

  return {
    status: "eligible",
    info: {
      title: offer.title,
      description: offer.description ?? null,
      credits,
      bonus: Number(offer.bonus_flat ?? 0),
      priceCents: offer.price_cents == null ? null : Number(offer.price_cents),
      endsAt: offer.ends_at ?? null,
    },
    hoursLeft,
  };
}

// Deliberately NOT a discriminated union: this project compiles with
// strict:false, and optional fields keep every call site simple.
export type StarterOfferPurchaseResult = {
  ok: boolean;
  creditsGranted?: number;
  error?: string;
  alreadyClaimed?: boolean;
};

/**
 * Buys the Welcome Bundle through the standard billing seam. The server treats
 * `offer_welcome-starter` as a one-time product: a second attempt from any
 * client returns 409, reflected here as `alreadyClaimed`.
 */
export async function purchaseStarterOffer(): Promise<StarterOfferPurchaseResult> {
  const [{ purchaseItems }, { trackEconomyEvent }] = await Promise.all([
    import("@/lib/billing"),
    import("@/lib/creditEconomy"),
  ]);

  const result = await purchaseItems([
    {
      product_id: STARTER_OFFER_PRODUCT_ID,
      product_type: "offer",
      product_name: "Welcome Bundle",
    },
  ]);

  if (!result.ok) {
    return {
      ok: false,
      error: result.error ?? "Purchase failed",
      alreadyClaimed: result.error?.toLowerCase().includes("already"),
    };
  }

  const creditsGranted = Number(result.data?.credits_added ?? 0) + Number(result.data?.bonus_added ?? 0);
  void trackEconomyEvent({
    event_type: "offer_convert",
    offer_slug: STARTER_OFFER_SLUG,
    credits_granted: creditsGranted,
  });

  return { ok: true, creditsGranted };
}
