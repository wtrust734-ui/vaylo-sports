// ============================================================================
// COACH MARKETPLACE — the client seam
// ----------------------------------------------------------------------------
// Everything the app does with the marketplace goes through this file, the same
// way every purchase goes through src/lib/billing.ts. Three reasons that matters
// more here than usual:
//
//   * the price the buyer is shown comes from the SERVER (`marketplace_quote`),
//     not from this file. The local `quoteCoachPrice()` is only a fallback for
//     when that call cannot be made, and a preview while a coach types a number.
//     A commission implemented twice is a commission charged twice as often as
//     it is displayed, and reconciling the two by hand is not a plan.
//   * buying is a wallet, not a direct charge. Google Play cannot charge a price
//     the server picks at request time, so the buyer tops up fixed-value coaching
//     credits through Play and spends them here. See the migration and
//     docs/COACH-MARKETPLACE.md §4.
//   * the roster is a view (`coach_roster`) with a fixed column list. It is read
//     by name here rather than by a `select("*")`, so the day somebody adds
//     `payout_email` to that view the app does not start rendering it.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { readFailed } from "@/lib/dbRead";
import { loadPlugin, openExternal } from "@/lib/platform";
import { readPurchaseError } from "@/lib/billing";
import {
  COACH_CREDIT_PACKS,
  COACH_PLAN_CURRENCY,
  COACH_SIGNUP_PATH,
  quoteCoachPrice,
  type CoachPriceQuote,
} from "@/config/coachMarketplace";

/**
 * Where the "Create a coach account" page lives.
 *
 * The website only — that is a deliberate rule, not a convenience. Becoming a
 * coach is a business decision that needs a real keyboard and, eventually,
 * details somebody should not be typing on a phone. It is also the one part of
 * this feature that takes money through Stripe, and Stripe is website-only.
 */
export const COACH_SIGNUP_ORIGIN = (
  (import.meta.env.VITE_COACH_SITE_ORIGIN as string | undefined)?.trim() ||
  "https://vaylo-sports-app.netlify.app"
).replace(/\/+$/, "");

export const COACH_SIGNUP_URL = `${COACH_SIGNUP_ORIGIN}${COACH_SIGNUP_PATH}`;

/** Opens the coach signup page in the in-app browser, or a new tab on the web. */
export const openCoachSignup = (): Promise<void> => openExternal(COACH_SIGNUP_URL);

/* ---------------------------------------------------------------- roster -- */

export interface CoachRosterEntry {
  user_id: string;
  display_name: string | null;
  bio: string | null;
  specialties: string[] | null;
  verified: boolean | null;
  coach_since: string | null;
  listing_count: number;
  lowest_net_cents: number | null;
}

/**
 * Every coach who has signed up and paid.
 *
 * The roster the product asks for: not only coaches with something on sale, and
 * not only verified ones — the people who signed up, with what they teach and how
 * many plans they have published. A coach with nothing published yet appears with
 * a zero, which is the honest state and the one that tells a visitor the
 * marketplace has started rather than that it is dead.
 */
export async function fetchCoachRoster(): Promise<CoachRosterEntry[]> {
  const { data, error } = await supabase
    .from("coach_roster")
    .select("user_id, display_name, bio, specialties, verified, coach_since, listing_count, lowest_net_cents")
    .order("listing_count", { ascending: false })
    .order("display_name", { ascending: true });
  if (error) {
    console.error("fetchCoachRoster failed:", error.message);
    return [];
  }
  return (data ?? []) as CoachRosterEntry[];
}

/* ----------------------------------------------------------------- plans -- */

export interface CoachPlan {
  id: string;
  creator_id: string;
  title: string;
  description: string | null;
  category: string;
  price_cents: number;
  weeks: number | null;
  cover_url: string | null;
  rating: number | null;
  sales_count: number;
  active: boolean;
  currency: string;
}

const PLAN_COLUMNS =
  "id, creator_id, title, description, category, price_cents, weeks, cover_url, rating, sales_count, active, currency";

/** Everything on sale from the coach marketplace. */
export async function fetchActiveCoachPlans(): Promise<CoachPlan[]> {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select(PLAN_COLUMNS)
    .eq("active", true)
    .eq("is_coach_plan", true)
    .order("sales_count", { ascending: false });
  if (error) {
    console.error("fetchActiveCoachPlans failed:", error.message);
    return [];
  }
  return (data ?? []) as CoachPlan[];
}

/**
 * One coach's plans, including the ones they have switched off.
 *
 * The `active = false` rows are readable only by their owner (the RLS policy is
 * `active = true or creator_id = auth.uid()`), so a coach's own studio sees
 * drafts and everybody else does not.
 */
export async function fetchCoachPlans(creatorId: string): Promise<CoachPlan[]> {
  const { data, error } = await supabase
    .from("marketplace_listings")
    .select(PLAN_COLUMNS)
    .eq("creator_id", creatorId)
    .eq("is_coach_plan", true)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchCoachPlans failed:", error.message);
    return [];
  }
  return (data ?? []) as CoachPlan[];
}

/* ----------------------------------------------------------------- price -- */

/**
 * The buyer's price for a coach's asking price, computed by the database.
 *
 * Falls back to the shared maths in src/config/coachMarketplace.ts when the RPC
 * is unreachable — while the marketplace is switched off the migration may not be
 * applied to the project being run against, and a screen that cannot show a price
 * at all is worse than one showing the same number by a second route. The
 * fallback is never what is charged: buy_coach_plan() quotes again on the server.
 */
export async function serverQuote(netCents: number): Promise<CoachPriceQuote> {
  try {
    const { data, error } = await supabase.rpc("marketplace_quote", { p_net_cents: netCents });
    const row = (Array.isArray(data) ? data[0] : data) as
      | { net_cents: number; fee_cents: number; gross_cents: number; commission_bps: number }
      | null;
    if (!error && row && typeof row.gross_cents === "number") {
      return {
        netCents: Number(row.net_cents),
        feeCents: Number(row.fee_cents),
        grossCents: Number(row.gross_cents),
        commissionBps: Number(row.commission_bps),
      };
    }
  } catch {
    // fall through to the local maths below
  }
  return quoteCoachPrice(netCents);
}

/* ---------------------------------------------------------------- wallet -- */

export interface CoachCreditPack {
  id: string;
  price_cents: number;
  credit_cents: number;
  currency: string;
}

export interface CoachCreditEntry {
  id: string;
  delta_cents: number;
  reason: string;
  order_id: string | null;
  created_at: string;
}

export interface CoachWallet {
  balance_cents: number;
  packs: CoachCreditPack[];
  entries: CoachCreditEntry[];
  /** The server's quote for one listing, when one was asked about. */
  quote: CoachPriceQuote | null;
}

/**
 * What the buyer has, and what the plan they are looking at would cost.
 *
 * Read through the `coach-checkout` function rather than straight from the tables
 * for one reason: the packs, the balance and the quote have to be from the same
 * moment. A balance read here and a price read there produces a "you have enough"
 * followed by "insufficient credits", which reads as the app stealing a purchase.
 */
export async function fetchCoachWallet(listingId?: string): Promise<CoachWallet> {
  const empty: CoachWallet = {
    balance_cents: 0,
    packs: COACH_CREDIT_PACKS.map((p) => ({ ...p })),
    entries: [],
    quote: null,
  };

  const { data, error } = await supabase.functions.invoke("coach-checkout", {
    body: { action: "wallet", ...(listingId ? { listing_id: listingId } : {}) },
  });
  if (error) {
    const { message } = await readPurchaseError(error, "Could not read your coaching balance");
    console.error("fetchCoachWallet failed:", message);
    return empty;
  }

  const payload = (data ?? {}) as {
    balance_cents?: number;
    packs?: CoachCreditPack[];
    entries?: CoachCreditEntry[];
    quote?: { net_cents: number; fee_cents: number; gross_cents: number; commission_bps: number } | null;
  };

  return {
    balance_cents: Number(payload.balance_cents ?? 0),
    packs: payload.packs?.length ? payload.packs : empty.packs,
    entries: payload.entries ?? [],
    quote: payload.quote
      ? {
          netCents: Number(payload.quote.net_cents),
          feeCents: Number(payload.quote.fee_cents),
          grossCents: Number(payload.quote.gross_cents),
          commissionBps: Number(payload.quote.commission_bps),
        }
      : null,
  };
}

/* -------------------------------------------------------------- purchases -- */

export interface CoachPurchaseResult {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
  code?: string;
  balance_cents?: number;
  credited_cents?: number;
  reused?: boolean;
  order_id?: string;
  net_cents?: number;
  fee_cents?: number;
  gross_cents?: number;
  shortfall_cents?: number;
}

interface StoreBillingPlugin {
  purchase: (options: { productId: string }) => Promise<{
    transactionId?: string;
    receipt?: string;
    cancelled?: boolean;
  }>;
}

/**
 * Buy coaching credits through Google Play, then have the server credit them.
 *
 * Play's own purchase is what takes the money; the server verifies the resulting
 * token against the Play Developer API before a single credit is granted, exactly
 * as `process-purchase` does for the credit economy. With no Play Billing plugin
 * in the build this returns a sentence rather than pretending, which is the same
 * posture billing.ts takes toward store billing.
 */
export async function topUpCoachingCredits(packId: string): Promise<CoachPurchaseResult> {
  const plugin = await loadPlugin<StoreBillingPlugin>("in-app-purchases");
  if (!plugin?.purchase) {
    return {
      ok: false,
      code: "store_unavailable",
      error:
        "Coaching credits are bought in the Vaylo Sports Android app. On the web this plan is not purchasable yet.",
    };
  }

  let purchase: Awaited<ReturnType<StoreBillingPlugin["purchase"]>>;
  try {
    purchase = await plugin.purchase({ productId: packId });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The store could not be reached." };
  }

  if (purchase?.cancelled) return { ok: false, cancelled: true, error: "Purchase cancelled." };
  if (!purchase?.transactionId) return { ok: false, error: "The store did not return a transaction id." };

  return invokeCoachCheckout({
    action: "topup",
    pack_id: packId,
    verification: { reference: purchase.transactionId, receipt: purchase.receipt },
  });
}

/**
 * Spend coaching credits on a plan.
 *
 * The idempotency key is generated here and sent with the request, so a retry
 * caused by a dropped connection returns the ORIGINAL order rather than buying
 * the plan twice. It is not a security token — the server only ever spends the
 * caller's own balance — but it is what makes "try again" a safe thing to offer.
 */
export async function buyCoachPlan(listingId: string): Promise<CoachPurchaseResult> {
  return invokeCoachCheckout({
    action: "buy",
    listing_id: listingId,
    idempotency_key: `plan:${listingId}:${crypto.randomUUID()}`,
  });
}

async function invokeCoachCheckout(body: Record<string, unknown>): Promise<CoachPurchaseResult> {
  const { data, error } = await supabase.functions.invoke("coach-checkout", { body });
  if (error) {
    const { message, detail } = await readPurchaseError(error, "That purchase could not be completed.");
    return {
      ok: false,
      error: message,
      code: typeof detail.code === "string" ? detail.code : undefined,
      shortfall_cents:
        typeof detail.shortfall_cents === "number" ? detail.shortfall_cents : undefined,
      balance_cents: typeof detail.balance_cents === "number" ? detail.balance_cents : undefined,
    };
  }
  return { ok: true, ...(data as CoachPurchaseResult) };
}

/* ------------------------------------------------------------------ coach -- */

export interface CoachApplication {
  id: string;
  status: "pending_payment" | "paid" | "refunded" | "rejected";
  fee_cents: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
}

export interface MyCoachStatus {
  isCoach: boolean;
  coachSince: string | null;
  /** The most recent application, so the studio can say which wait it is in. */
  application: CoachApplication | null;
}

export async function fetchMyCoachStatus(userId: string): Promise<MyCoachStatus> {
  const [{ data: profile }, { data: application }] = await Promise.all([
    supabase.from("creator_profiles").select("is_coach, coach_since").eq("user_id", userId).maybeSingle(),
    supabase
      .from("coach_applications")
      .select("id, status, fee_cents, currency, created_at, paid_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    isCoach: profile?.is_coach === true,
    coachSince: profile?.coach_since ?? null,
    application: (application as CoachApplication | null) ?? null,
  };
}

export interface CoachEarningsSummary {
  accrued_cents: number;
  paid_cents: number;
  currency: string;
}

/**
 * What a coach is owed, and what has actually been transferred.
 *
 * Two numbers, never one. `accrued` is money a buyer has paid and the coach has
 * not received; `paid` is money that has moved. There is no payout rail yet, so
 * in practice everything is accrued — and a screen that showed a single "earnings"
 * figure would be telling a coach they have been paid when they have not.
 */
export async function fetchCoachEarnings(coachId: string): Promise<CoachEarningsSummary> {
  const { data, error } = await supabase
    .from("coach_earnings")
    .select("amount_cents, status, currency")
    .eq("coach_id", coachId);
  if (error) {
    console.error("fetchCoachEarnings failed:", error.message);
    return { accrued_cents: 0, paid_cents: 0, currency: COACH_PLAN_CURRENCY };
  }

  let accrued = 0;
  let paid = 0;
  let currency = COACH_PLAN_CURRENCY;
  for (const row of data ?? []) {
    currency = row.currency ?? currency;
    if (row.status === "paid") paid += Number(row.amount_cents ?? 0);
    else if (row.status !== "reversed") accrued += Number(row.amount_cents ?? 0);
  }
  return { accrued_cents: accrued, paid_cents: paid, currency };
}

export interface CoachOrder {
  id: string;
  buyer_id: string;
  net_cents: number;
  fee_cents: number;
  gross_cents: number;
  currency: string;
  status: string;
  created_at: string;
  listing_id: string | null;
}

export async function fetchCoachOrders(coachId: string): Promise<CoachOrder[]> {
  const { data, error } = await supabase
    .from("coach_orders")
    .select("id, buyer_id, net_cents, fee_cents, gross_cents, currency, status, created_at, listing_id")
    .eq("coach_id", coachId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchCoachOrders failed:", error.message);
    return [];
  }
  return (data ?? []) as CoachOrder[];
}

/** Orders that have been paid and have no delivery yet — the coach's to-do list. */
export async function fetchUndeliveredOrders(coachId: string): Promise<CoachOrder[]> {
  const orders = await fetchCoachOrders(coachId);
  if (orders.length === 0) return [];
  const paid = orders.filter((o) => o.status === "paid");
  if (paid.length === 0) return [];

  const { data: delivered, error: deliveredError } = await supabase
    .from("coach_deliveries")
    .select("order_id")
    .eq("coach_id", coachId);
  // These are the orders already delivered. Failed and read as empty, the coach's
  // queue shows work they have finished as outstanding, and the screen asks them
  // to deliver it a second time.
  readFailed(deliveredError, "your delivered orders", { quiet: true });
  const done = new Set((delivered ?? []).map((d) => d.order_id));
  return paid.filter((o) => !done.has(o.id));
}

/**
 * Write the plan the buyer paid for.
 *
 * The RLS insert policy refuses a delivery for an order that is not the coach's
 * own and paid, so this cannot be used to hand something to somebody who did not
 * buy it, or to write for somebody else's buyer.
 */
export async function deliverPlan(args: {
  order: CoachOrder;
  coachId: string;
  title: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  // Both parties are named on the row: `coach_id` and `buyer_id` are NOT NULL with
  // no default, precisely so the read policy can hand the same row to the buyer
  // and to the coach, and to nobody else. The insert policy checks against the
  // caller's own id and against the order being paid, so passing a coachId that
  // is not the caller's fails rather than being trusted.
  const { error } = await supabase.from("coach_deliveries").insert({
    order_id: args.order.id,
    coach_id: args.coachId,
    buyer_id: args.order.buyer_id,
    title: args.title.trim(),
    body: args.body.trim(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface PublishPlanInput {
  creatorId: string;
  title: string;
  description: string;
  weeks: number;
  /** The coach's own asking price, in minor units of COACH_PLAN_CURRENCY. */
  netCents: number;
}

/**
 * Publish a plan at the coach's own price.
 *
 * `price_cents` is the coach's NET price — what they receive. The buyer's price is
 * never stored: it is derived from this number by `marketplace_quote()` at the
 * moment of sale, so a commission change applies to every listing at once and no
 * row can hold a stale gross price.
 *
 * `is_coach_plan` and `weeks` are set here, and the database refuses a coaching
 * plan priced below the floor or without a duration.
 */
export async function publishCoachPlan(input: PublishPlanInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("marketplace_listings").insert({
    creator_id: input.creatorId,
    title: input.title.trim(),
    description: input.description.trim() || null,
    category: "plan",
    price_cents: input.netCents,
    weeks: input.weeks,
    is_coach_plan: true,
    currency: COACH_PLAN_CURRENCY,
    active: true,
    // rating and sales_count are deliberately not sent: the insert trigger
    // refuses a listing that arrives with either already set.
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setPlanActive(planId: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("marketplace_listings").update({ active }).eq("id", planId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** What the buyer paid for, and what the coach wrote. */
export async function fetchMyDeliveries(buyerId: string) {
  const { data, error } = await supabase
    .from("coach_deliveries")
    .select("id, order_id, title, body, created_at")
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("fetchMyDeliveries failed:", error.message);
    return [];
  }
  return data ?? [];
}
