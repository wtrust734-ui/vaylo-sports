import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * The edge client is intentionally untyped (`createClient` without the Database
 * generic — the generated types live in the web app, not the functions). These
 * helpers give the RPCs used here a minimal typed surface instead of `as any`.
 */
type LooseClient = Omit<SupabaseClient, "rpc"> & {
  rpc: (
    fn: "credit_cost" | "grant_coins" | "spend_credits" | "credits_grant" | "recompute_user_segment",
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
const asLoose = (c: SupabaseClient): LooseClient => c as unknown as LooseClient;
import {
  COIN_GRANTS,
  CREDIT_GRANTS,
  DEPRECATED_PRODUCT_IDS,
  FEATURE_PRODUCTS,
  FIRST_PURCHASE_BUNDLE,
  ONE_TIME_PRODUCTS,
  PRODUCT_PRICES,
  UNLIMITED_PACKS,
} from "../_shared/moneyCatalog.ts";
import { verifyPlayPurchase } from "../_shared/playBilling.ts";

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
// (see _shared/playBilling.ts); PAYMENT_MODE=test keeps web checkout trusted.
// See CAPACITOR.md §3 for the Play Console + secrets runbook.

const PAYMENT_MODE = Deno.env.get("PAYMENT_MODE") ?? "test";

type Verification =
  | { verified: true; reference: string }
  | { verified: false; error: string; status?: number };

interface RequestBody {
  items?: unknown[];
  platform?: string;
  verification?: { reference?: string; receipt?: string };
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
}

/**
 * Verifies a purchase before anything is granted.
 *
 * `test` mode (the current default) keeps the web app fully working: the client
 * is trusted and the reference is optional.
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
  // asked for (prevents buying pack_25 and replaying it as pack_500), and the
  // verified purchase time must not predate the request by more than 48h.
  const verifiedProductId = result.purchase.productId;
  const basketIds = (items as { product_id?: unknown }[]).map((i) => String(i?.product_id ?? ""));
  if (!basketIds.includes(verifiedProductId)) {
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
    // User-scoped client for RPCs that rely on auth.uid() (spend_credits).
    const userClient = asLoose(createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    ));
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const body = (await req.json()) as RequestBody;
    const items = Array.isArray(body?.items) ? body.items : [];

    const verification = await verifyStorePurchase(items, body);
    // Explicit comparison rather than `!verification.verified`: the negation form
    // does not narrow this union under the compiler options used here, so
    // `verification.error` would not type-check on the branch that guarantees it.
    if (verification.verified === false) {
      return new Response(
        JSON.stringify({ error: verification.error }),
        { status: verification.status ?? 402, headers: corsHeaders }
      );
    }

    // Store servers retry, and a client can retry a timeout it never saw fail.
    // One grant per store transaction: if this reference was already used by
    // this athlete, refuse instead of granting twice.
    if (body.verification?.reference) {
      const { data: priorGrant } = await supabase
        .from("user_purchases")
        .select("id")
        .eq("user_id", user.id)
        .eq("provider_reference", body.verification.reference)
        .limit(1)
        .maybeSingle();
      if (priorGrant) {
        return new Response(
          JSON.stringify({ error: "This purchase has already been applied.", duplicate: true }),
          { status: 409, headers: corsHeaders }
        );
      }
    }

    // Fetch live offers for double-credit promo
    const { data: offerRows } = await supabase.from("special_offers").select("*").eq("active", true);
    const doubleOffer = ((offerRows ?? []) as SpecialOfferRow[]).find((o) => o.offer_type === "double_credits");

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
      .select("credits, infinite_credits")
      .eq("user_id", user.id)
      .maybeSingle();
    let availableCredits = balanceRow?.infinite_credits
      ? Number.MAX_SAFE_INTEGER
      : Number(balanceRow?.credits ?? 0);

    for (const item of items as BasketItem[]) {
      const productId = String(item.product_id || "");
      const productType = String(item.product_type || "feature");

      let priceCents: number | null = PRODUCT_PRICES[productId] ?? null;

      if (priceCents === null && FEATURE_PRODUCTS[productId]) {
        priceCents = 0; // bought with credits, not money
      } else if (priceCents === null && productId.startsWith("offer_")) {
        const offer = ((offerRows ?? []) as SpecialOfferRow[]).find((o) => `offer_${o.slug}` === productId);
        if (!offer) {
          return new Response(JSON.stringify({ error: `Unknown offer: ${productId}` }), { status: 400, headers: corsHeaders });
        }
        priceCents = Number(offer.price_cents ?? 0);
      }

      if (priceCents === null) {
        return new Response(JSON.stringify({ error: `Unknown product: ${productId}` }), { status: 400, headers: corsHeaders });
      }

      // Offers and the first-purchase bundle are one redemption per account.
      const oneTime = ONE_TIME_PRODUCTS.includes(productId) || productId.startsWith("offer_");
      if (oneTime) {
        const { data: prior } = await supabase
          .from("user_purchases")
          .select("id")
          .eq("user_id", user.id)
          .eq("product_id", productId)
          .limit(1)
          .maybeSingle();
        if (prior) {
          return new Response(
            JSON.stringify({
              error: productId === FIRST_PURCHASE_BUNDLE.id
                ? "The one-time first-purchase offer has already been used."
                : "This offer has already been claimed.",
              product_id: productId,
            }),
            { status: 409, headers: corsHeaders }
          );
        }
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
          return new Response(
            JSON.stringify({ error: `Not enough credits for ${productId} (need ${cost}).` }),
            { status: 402, headers: corsHeaders }
          );
        }
        // Each unlock in the basket costs its own price, so deduct as we go.
        availableCredits -= cost;
      }

      resolved.push({ productId, productType, priceCents });
    }

    let creditsToAdd = 0;
    let bonusToAdd = 0;
    let coinsToAdd = 0;
    let infiniteGrant: { period: string } | null = null;

    for (const { productId, productType, priceCents } of resolved) {
      const { data: purchaseRow, error: purchaseErr } = await supabase
        .from("user_purchases")
        .insert({
          user_id: user.id,
          product_id: productId,
          product_type: productType,
          price_cents: priceCents,
          // Store provenance: a unique index on provider_reference is what makes
          // the idempotency check above race-proof.
          provider_reference: body.verification?.reference ?? null,
          platform: body.platform ?? null,
        })
        .select("id")
        .maybeSingle();
      const purchaseId: string | undefined = purchaseRow?.id;
      // 23505 = the unique index rejected a replayed store transaction. Bail
      // before granting, so two concurrent retries can never double-credit.
      if (purchaseErr?.code === "23505") {
        return new Response(
          JSON.stringify({ error: "This purchase has already been applied.", duplicate: true }),
          { status: 409, headers: corsHeaders }
        );
      }
      // An entitlement row must never outlive a payment that did not happen.
      const rollBackPurchase = async () => {
        if (!purchaseId) return;
        const { error } = await supabase.from("user_purchases").delete().eq("id", purchaseId);
        if (error) console.error("purchase rollback failed:", error.message);
      };

      // Unlimited credits packs
      const unlimited = UNLIMITED_PACKS.find((p) => p.id === productId);
      if (unlimited) {
        infiniteGrant = { period: unlimited.period };
        continue;
      }

      // Coin bundles + the first-purchase bundle — coins are granted through
      // the service-role-only grant_coins (add_coins is no longer callable by
      // end users, otherwise any logged-in user could mint coins).
      const coinsGrant = COIN_GRANTS[productId];
      if (coinsGrant) {
        const { error: coinsErr } = await supabase.rpc("grant_coins", {
          p_user_id: user.id,
          p_amount: coinsGrant,
          p_reason: `Coin bundle: ${productId}`,
        });
        if (coinsErr) {
          await rollBackPurchase();
          return new Response(JSON.stringify({ error: `Coin grant failed: ${coinsErr.message}` }), { status: 500, headers: corsHeaders });
        }
        coinsToAdd += coinsGrant;
        continue;
      }

      // Credit packs
      const creditGrant = CREDIT_GRANTS[productId];
      if (creditGrant) {
        creditsToAdd += creditGrant;
        continue;
      }

      // Feature unlocks — price comes from the database so the client, the DB
      // and this function can never disagree.
      const featureKey = FEATURE_PRODUCTS[productId];
      if (featureKey) {
        const { data: costRow, error: costErr } = await supabase.rpc("credit_cost", { p_feature: featureKey });
        if (costErr || costRow == null) {
          await rollBackPurchase();
          return new Response(
            JSON.stringify({ error: `Could not read the credit price for ${featureKey}` }),
            { status: 500, headers: corsHeaders }
          );
        }
        const cost = Number(costRow);

        const { data: prof } = await supabase
          .from("profiles")
          .select("credits, infinite_credits")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!prof?.infinite_credits) {
          // The up-front check in the validation pass should already have caught
          // this; it can still race, so roll the entitlement back if it does.
          if ((prof?.credits ?? 0) < cost) {
            await rollBackPurchase();
            return new Response(
              JSON.stringify({ error: `Not enough credits for ${productId} (need ${cost}).` }),
              { status: 402, headers: corsHeaders }
            );
          }
          const { error: spendErr } = await userClient.rpc("spend_credits", {
            p_amount: cost,
            p_reason: `Unlock: ${productId}`,
          });
          if (spendErr) {
            await rollBackPurchase();
            return new Response(JSON.stringify({ error: `Purchase failed: ${spendErr.message}` }), { status: 500, headers: corsHeaders });
          }
        }
        continue;
      }

      // Offers (starter / winback) — the linked pack's credits plus flat bonus.
      if (productId.startsWith("offer_")) {
        const slug = productId.replace("offer_", "");
        const offer = ((offerRows ?? []) as SpecialOfferRow[]).find((o) => o.slug === slug);
        if (offer) {
          const linkedCredits = offer.pack_id ? CREDIT_GRANTS[offer.pack_id] ?? 0 : 0;
          creditsToAdd += linkedCredits;
          bonusToAdd += Number(offer.bonus_flat ?? 0);
        }
        continue;
      }

      // Unknown ids are already rejected during validation above, so there is
      // no freeform/legacy credit path left here.
    }

    const totalGranted = creditsToAdd + bonusToAdd;
    // Prefer the store reference as the idempotency key, so a replayed receipt
    // can never double-credit even if it slips past the check above.
    const purchaseKey = body.verification?.reference
      ? `store:${body.verification.reference}`
      : `purchase:${user.id}:${Date.now()}`;
    if (totalGranted > 0) {
      // Single shared grant path: balance update + transaction record + idempotency
      const { error: grantErr } = await supabase.rpc("credits_grant", {
        p_user: user.id,
        p_amount: totalGranted,
        p_reason: bonusToAdd > 0 ? `Pack purchase: ${creditsToAdd} + ${bonusToAdd} bonus` : `Pack purchase: ${creditsToAdd}`,
        p_source: "purchase",
        p_idempotency_key: purchaseKey,
        p_metadata: { credits: creditsToAdd, bonus: bonusToAdd },
      });
      if (grantErr) {
        return new Response(JSON.stringify({ error: `Credit grant failed: ${grantErr.message}` }), { status: 500, headers: corsHeaders });
      }
    }

    if (infiniteGrant) {
      const until = infiniteGrant.period === "lifetime"
        ? null
        : infiniteGrant.period === "year"
        ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from("profiles").update({
        infinite_credits: true,
        infinite_credits_until: until,
      }).eq("user_id", user.id);
    }

    await supabase.from("basket_items").delete().eq("user_id", user.id);

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
      success: true,
      credits_added: creditsToAdd,
      bonus_added: bonusToAdd,
      coins_added: coinsToAdd,
      infinite: !!infiniteGrant,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: corsHeaders });
  }
});
