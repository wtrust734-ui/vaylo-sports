import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * The edge client is intentionally untyped (`createClient` without the Database
 * generic — the generated types live in the web app, not the functions). These
 * helpers give the RPCs used here a minimal typed surface instead of `as any`.
 */
type LooseClient = Omit<SupabaseClient, "rpc"> & {
  rpc: (
    fn: "credit_cost" | "grant_coins" | "spend_credits" | "credits_grant" | "recompute_user_segment" | "grant_infinite_credits" | "deliver_purchase",
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
const asLoose = (c: SupabaseClient): LooseClient => c as unknown as LooseClient;
import {
  COIN_GRANTS,
  CREDIT_GRANTS,
  DEPRECATED_PRODUCT_IDS,
  FEATURE_PRODUCTS,
  ONE_TIME_PRODUCTS,
  PRODUCT_PRICES,
  UNLIMITED_PACKS,
} from "../_shared/moneyCatalog.ts";
import { verifyPlayPurchase } from "../_shared/playBilling.ts";
import { isOfferLive } from "../_shared/offerWindow.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// All prices, grants and product ids come from the generated mirror of the
// client configs (supabase/functions/_shared/moneyCatalog.ts) — regenerate with
// `node scripts/gen-money-mirror.cjs`. Feature-unlock PRICES come from the
// database (`public.credit_cost`), which is what actually charges them.
//
// NOTE ON PAYMENT VERIFICATION: Google Play Billing is the store provider. In
// PAYMENT_MODE=store the purchase token from the client is verified in
// `verifyStorePurchase()` below against the Google Play Developer API
// (see _shared/playBilling.ts); PAYMENT_MODE=test keeps web checkout trusted;
// anything else — including the default — takes no money at all.
// See CAPACITOR.md §3 for the Play Console + secrets runbook.

// Modes: `store` verifies a Google Play token, `free` grants credits without
// payment (closed testing only — see src/config/closedTesting.ts), `test`
// trusts the client (local work only, and it grants nothing that is priced in
// money), anything else is inert. The default used to be `test`, which meant
// losing the secret silently restored a mode that trusts the client — a footgun
// aimed at production, since a missing secret is exactly what a deploy goes
// wrong on. Failing shut is the better default: nobody is charged, and the
// reason is in the log.
const PAYMENT_MODE = Deno.env.get("PAYMENT_MODE") ?? "disabled";

type Verification =
  | { verified: true; reference: string }
  | { verified: false; error: string; status?: number };

interface RequestBody {
  items?: unknown[];
  platform?: string;
  verification?: { reference?: string; receipt?: string };
  /**
   * Set by the client when it believes credits are free (closed testing).
   * NOT trusted on its own: it is only honoured when the server's PAYMENT_MODE
   * secret is `free`, so the client flag and the secret have to agree. A stale
   * client cannot start granting for free, and a forgotten secret cannot start
   * charging a tester.
   */
  closed_testing?: boolean;
}

/**
 * The only two fields a basket item may carry. Declared so the loop below reads
 * from a known shape instead of `unknown`; every value in it is still untrusted
 * and re-derived from the server tables further down.
 */
type BasketItem = { product_id?: string; product_type?: string };

interface SpecialOfferRow {
  slug: string;
  offer_type: string;
  price_cents?: number | null;
  pack_id?: string | null;
  bonus_flat?: number | null;
  bonus_multiplier?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

/**
 * Verifies a purchase before anything is granted.
 *
 * `test` mode keeps the web app working during local development: the client is
 * trusted and the reference is optional. It is not the default, and it is never
 * used for a product priced in money — the caller only reaches this function for
 * those, and the price loop refuses them again on the way out.
 *
 * `PAYMENT_MODE=store` is the native Google Play Billing path. The client buys
 * through Play Billing and sends the purchase token + a JSON receipt
 * (see src/lib/billing.ts); the token is then verified against the Google Play
 * Developer API with the linked service account, and the purchase's productId
 * must exist in the money catalog. Pending, cancelled/refunded and
 * unknown-product purchases are refused — nothing is granted on trust.
 */
async function verifyStorePurchase(items: unknown[], body: RequestBody): Promise<Verification> {
  if (!Array.isArray(items) || items.length === 0) {
    return { verified: false, error: "Empty basket", status: 400 };
  }

  const reference = body.verification?.reference?.trim();

  if (PAYMENT_MODE === "test") {
    return { verified: true, reference: reference || `test:${Date.now()}` };
  }

  if (PAYMENT_MODE !== "store") {
    // Fail shut on anything priced in money. Reached only for a basket that
    // contains a money-priced product (see the call site), so this can never
    // block a credit-paid unlock.
    console.error(`PAYMENT_MODE is "${PAYMENT_MODE}"; no payment path is enabled`);
    return {
      verified: false,
      error: "Paid purchases are not available yet. Credits earned in the app can still be spent on unlocks and Event Packs.",
      status: 503,
    };
  }

  // A Play token proves one product. Never let it authorize a whole basket.
  if (items.length !== 1) {
    return { verified: false, error: "Store purchases are one product at a time.", status: 400 };
  }

  if (!reference || !body.verification?.receipt) {
    return { verified: false, error: "Missing store purchase verification", status: 402 };
  }

  const serviceAccountEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL")?.trim();
  const privateKey = Deno.env.get("GOOGLE_PRIVATE_KEY");
  const packageName = Deno.env.get("GOOGLE_ANDROID_PACKAGE_NAME")?.trim();
  if (!serviceAccountEmail || !privateKey || !packageName) {
    console.error(
      "PAYMENT_MODE=store requires GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and GOOGLE_ANDROID_PACKAGE_NAME"
    );
    return {
      verified: false,
      error: "Play Billing is not fully configured on the server yet. Please try again later.",
      status: 503,
    };
  }

  let receipt: { packageName?: string; productId?: string } | null = null;
  try {
    const parsed: unknown = JSON.parse(body.verification.receipt);
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      receipt = {
        packageName: typeof obj.packageName === "string" ? obj.packageName : undefined,
        productId: typeof obj.productId === "string" ? obj.productId : undefined,
      };
    }
  } catch {
    return { verified: false, error: "Malformed store receipt.", status: 400 };
  }

  const result = await verifyPlayPurchase(reference, receipt, {
    serviceAccountEmail,
    privateKey,
    packageName,
  });
  if (!result.ok || !result.purchase) {
    return { verified: false, error: result.error ?? "Purchase verification failed.", status: 402 };
  }

  // Cross-check: the Play-verified product must be one the athlete actually
  // asked for (prevents buying pack_25 and replaying it as pack_500).
  const verifiedProductId = result.purchase.productId;
  const basketIds = (items as { product_id?: unknown }[]).map((i) => String(i?.product_id ?? ""));
  if (basketIds[0] !== verifiedProductId) {
    return {
      verified: false,
      error: "Verified purchase does not match the requested product.",
      status: 400,
    };
  }

  return { verified: true, reference };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No auth" }), { status: 401, headers: corsHeaders });

    const supabase = asLoose(createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    ));
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const body = (await req.json()) as RequestBody;
    const items = Array.isArray(body?.items) ? body.items : [];

    // An empty or id-less basket is a malformed request, not a purchase. It
    // used to fall through the loop untouched and answer `{"success": true}`
    // with nothing granted, which taught the client to show a success toast for
    // a request that bought nothing — the one signal an athlete relies on when a
    // purchase genuinely fails.
    if (items.length === 0 || items.length > 50) {
      return new Response(
        JSON.stringify({ error: "Your basket is empty." }),
        { status: 400, headers: corsHeaders }
      );
    }
    if (items.some((i) => !String((i as { product_id?: unknown } | null)?.product_id || "").trim())) {
      return new Response(
        JSON.stringify({ error: "One of the items has no product id." }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Closed-testing free grants. Both switches must agree: the server secret
    // (the authority) and the client's own flag (so the UI and the server are
    // describing the same deal to the athlete).
    const freeGrant = PAYMENT_MODE === "free" && body.closed_testing === true;
    let verifiedReference: string | null = null;

    // Payment verification is only meaningful for a basket that contains a
    // product priced in money. A feature unlock or an Event Pack is paid for in
    // credits the athlete earned, and the credit balance is the authority — it
    // is checked per item below. Requiring a store receipt for those would make
    // an in-app unlock unbuyable, which is the opposite of the intent.
    //
    // This predicate is deliberately coarse — it only decides whether to ask for
    // proof. The authoritative price for every item is resolved in the loop
    // below, and that loop is what refuses an unaffordable or unpriced basket.
    const basketHasMoney = items.some((i) => {
      const id = String((i as { product_id?: unknown } | null)?.product_id || "");
      return PRODUCT_PRICES[id] != null || id.startsWith("offer_");
    });

    if (basketHasMoney && !freeGrant) {
      const verification = await verifyStorePurchase(items, body);
      // Explicit comparison rather than `!verification.verified`: the negation
      // form does not narrow this union under the compiler options used here, so
      // `verification.error` would not type-check on the branch that guarantees it.
      if (verification.verified === false) {
        return new Response(
          JSON.stringify({ error: verification.error, code: "payments_not_available" }),
          { status: verification.status ?? 402, headers: corsHeaders }
        );
      }
      verifiedReference = verification.reference;
    }

    // Fetch live offers for double-credit promo.
    //
    // Filtered on the window, not just `active`: nothing clears `active` when an
    // offer's `ends_at` passes, and this function reads with the SERVICE ROLE, so
    // the RLS policy that hides out-of-window rows does not apply here. Without
    // this filter an expired promo would still multiply granted credits and an
    // expired `offer_<slug>` product would still be purchasable.
    const { data: offerRows } = await supabase.from("special_offers").select("*").eq("active", true);
    const liveOffers = ((offerRows ?? []) as SpecialOfferRow[]).filter((o) => isOfferLive(o));

    // PHASE 1: legacy tier subscriptions can no longer be purchased.
    const blocked = (items as BasketItem[]).find((i) =>
      DEPRECATED_PRODUCT_IDS.includes(String(i?.product_id || ""))
    );
    if (blocked) {
      return new Response(JSON.stringify({
        error: "This plan is no longer available. Credits and unlimited packs are still purchasable.",
        deprecated_product: String(blocked?.product_id),
      }), { status: 410, headers: corsHeaders });
    }

    // ---- Validate the basket before granting anything ----------------------
    // Everything here arrives from the browser, so nothing in it is trusted:
    // every product id must exist in a server table, the recorded price comes
    // from those tables, and one-time products are checked against history.
    const resolved: { productId: string; productType: string; priceCents: number }[] = [];

    // Credit-priced products are checked for affordability HERE, before any row
    // is written. The grant loop below used to insert the `user_purchases` row
    // first and only then check the balance, so a refused unlock (402) still
    // left its entitlement behind — and since the apps decide "unlocked" by the
    // presence of that row, an athlete who could not afford the unlock got it
    // anyway on the next page load.
    const { data: balanceRow } = await supabase
      .from("profiles")
      .select("credits, infinite_credits, infinite_credits_until")
      .eq("user_id", user.id)
      .maybeSingle();
    let availableCredits = balanceRow?.infinite_credits && (!balanceRow.infinite_credits_until || new Date(balanceRow.infinite_credits_until).getTime() > Date.now())
      ? Number.MAX_SAFE_INTEGER
      : Number(balanceRow?.credits ?? 0);

    for (const item of items as BasketItem[]) {
      const productId = String(item.product_id || "");
      const productType = String(item.product_type || "feature");

      let priceCents: number | null = PRODUCT_PRICES[productId] ?? null;

      if (priceCents === null && FEATURE_PRODUCTS[productId]) {
        priceCents = 0; // bought with credits, not money
      } else if (priceCents === null && productId.startsWith("offer_")) {
        const offer = liveOffers.find((o) => `offer_${o.slug}` === productId);
        if (!offer) {
          return new Response(JSON.stringify({ error: `Unknown offer: ${productId}` }), { status: 400, headers: corsHeaders });
        }
        priceCents = Number(offer.price_cents ?? 0);
      }

      if (priceCents === null) {
        return new Response(JSON.stringify({ error: `Unknown product: ${productId}` }), { status: 400, headers: corsHeaders });
      }

      // -------------------------------------------------------------------------
      // A product that costs MONEY may only be granted with proof of payment.
      //
      // PAYMENT_MODE=test means there is no payment step, so anything priced in
      // cents is granted for the asking — one HTTP call bought 650 credits,
      // twice in a row, from an account holding 50. Feature unlocks and event
      // packs are different: they are paid for with credits the athlete earned,
      // and the credit balance is the authority, so they still work here.
      //
      // The honest state of affairs is that no money can be collected yet, so
      // refusing is not a revenue decision — it is the difference between a
      // catalogue and an open wallet. Set PAYMENT_MODE=store once Play Billing
      // is live and this branch stops applying.
      // -------------------------------------------------------------------------
      // The free path skips this: it is the deliberate exception, and it is
      // gated on the secret above, not on anything the client sent.
      if (priceCents > 0 && PAYMENT_MODE !== "store" && !freeGrant) {
        // Distinguish "the client thinks this is free but the server disagrees"
        // from "nobody has configured payments". They need different messages:
        // the first is a deployment mistake to report, the second is expected.
        const mismatched = PAYMENT_MODE === "free" && body.closed_testing !== true;
        return new Response(
          JSON.stringify({
            error: mismatched
              ? "Free credits are not switched on for this build. Nothing has been charged."
              : "Paid purchases are not available yet. Credits earned in the app can still be spent on unlocks and Event Packs.",
            code: mismatched ? "free_grant_unavailable" : "payments_not_available",
            product_id: productId,
          }),
          { status: 503, headers: corsHeaders }
        );
      }

      // Spendable with credits: make sure this basket can actually pay for it.
      const featureKeyForCheck = FEATURE_PRODUCTS[productId];
      if (featureKeyForCheck) {
        const { data: costRow, error: costErr } = await supabase.rpc("credit_cost", { p_feature: featureKeyForCheck });
        if (costErr || costRow == null) {
          return new Response(
            JSON.stringify({ error: `Could not read the credit price for ${featureKeyForCheck}` }),
            { status: 500, headers: corsHeaders }
          );
        }
        const cost = Number(costRow);
        if (cost > availableCredits) {
          // 402 with a machine-readable shortfall as well as the sentence: the
          // client's top-up sheet needs the gap, not a number it has to parse
          // out of prose. Without this an unlock was a dead end — the athlete
          // saw "need 39" and nothing else they could do about it.
          return new Response(
            JSON.stringify({
              error: `Not enough credits for ${productId} (need ${cost}).`,
              code: "insufficient_credits",
              required: cost,
              balance: availableCredits,
              shortfall: cost - availableCredits,
            }),
            { status: 402, headers: corsHeaders }
          );
        }
        // Each unlock in the basket costs its own price, so deduct as we go.
        availableCredits -= cost;
      }

      resolved.push({ productId, productType, priceCents: freeGrant ? 0 : priceCents });
    }

    const grants = resolved.map(({ productId, productType, priceCents }) => {
      const offer = liveOffers.find((o) => `offer_${o.slug}` === productId);
      return {
        product_id: productId,
        product_type: productType,
        price_cents: priceCents,
        credits: CREDIT_GRANTS[productId] ?? (offer?.pack_id ? CREDIT_GRANTS[offer.pack_id] ?? 0 : 0),
        bonus: Number(offer?.bonus_flat ?? 0),
        coins: COIN_GRANTS[productId] ?? 0,
        feature_key: FEATURE_PRODUCTS[productId] ?? null,
        unlimited_period: UNLIMITED_PACKS.find((p) => p.id === productId)?.period ?? null,
        one_time: ONE_TIME_PRODUCTS.includes(productId) || productId.startsWith("offer_") || !!FEATURE_PRODUCTS[productId],
      };
    });
    // Receipt, grants, credit deductions and entitlements commit together.
    // A verified store token identifies the delivery across transport retries.
    const { data: delivery, error: deliveryError } = await supabase.rpc("deliver_purchase", {
      p_user: user.id,
      p_key: verifiedReference ? `store:${verifiedReference}` : `free:${user.id}:${crypto.randomUUID()}`,
      p_items: grants,
      p_reference: verifiedReference,
      p_platform: body.platform ?? null,
    });
    if (deliveryError) {
      console.error("Purchase delivery failed", deliveryError.message);
      return new Response(JSON.stringify({ error: "Could not deliver this purchase. Please retry." }), { status: 409, headers: corsHeaders });
    }
    if (!delivery || typeof delivery !== "object" || !(delivery as Record<string, unknown>).success) {
      return new Response(JSON.stringify({ error: "Purchase delivery was not confirmed. Please retry." }), { status: 503, headers: corsHeaders });
    }
    const { error: clearError } = await supabase.from("basket_items").delete().eq("user_id", user.id);
    if (clearError) console.error("Basket cleanup failed", clearError.message);

    // Recompute the spending segment after any purchase. Best-effort by design:
    // the purchase is already granted and recorded by this point, so a failure
    // here must never be reported to the athlete as a failed purchase. (The
    // previous form — `supabase.rpc(...).catch()` — threw a TypeError, because a
    // PostgREST builder has `.then` but no `.catch`, which turned every
    // completed checkout into a 500 while the credits had already landed.)
    try {
      const { error: segmentErr } = await supabase.rpc("recompute_user_segment", { p_user: user.id });
      if (segmentErr) console.error("segment recompute failed:", segmentErr.message);
    } catch (e) {
      console.error("segment recompute threw:", e);
    }

    return new Response(JSON.stringify({
      ...delivery,
      free: freeGrant,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: corsHeaders });
  }
});
