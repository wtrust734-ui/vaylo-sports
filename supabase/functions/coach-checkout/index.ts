import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyPlayPurchase } from "../_shared/playBilling.ts";

// ============================================================================
// coach-checkout — buying a real coach's plan, inside the app
// ----------------------------------------------------------------------------
// The in-app half of the marketplace. Website payments go through Stripe; the
// app's go through Google Play Billing, because a digital good sold inside an
// Android app has to. That rule creates one real problem and this function is
// the answer to it:
//
//   Play cannot charge a price the server picks at request time. A one-time
//   product is created in the Play Console with its price, and a coach's price is
//   different for every coach. So a plan is not a Play product.
//
//   A top-up is. The buyer buys coaching credits in fixed amounts through Play —
//   an ordinary consumable purchase, which is exactly what Play supports — and
//   then spends the balance on a listing at the listing's own price. One credit
//   is one penny, so a £5 top-up and a £5.00 plan are the same number.
//   `coach_credit_packs` holds the product ids, and Play must have matching
//   products before this is switched on (docs/COACH-MARKETPLACE.md §4).
//
// Three actions, and the split is why they are separate:
//
//   wallet  what the buyer has, and what a plan would cost. Read-only.
//   topup   a verified Play purchase, credited to the wallet. Money in.
//   buy     spend the wallet on a listing. Money out of the wallet, and the
//           order, the coach's earning and the sales count are written by
//           `buy_coach_plan()` in ONE transaction — never by this function,
//           which cannot make a partial write.
//
// The price is never taken from the client. `buy_coach_plan()` re-reads the
// listing's price and calls `marketplace_quote()` on it, so the arithmetic in
// this file (used only to answer "you need £1 more") cannot become the
// arithmetic that is charged.
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Same gate as process-purchase, and the same code string, so the app's existing
 * `isPaymentsUnavailable()` helper shows its existing honest sentence rather than
 * a red failure. `store` verifies a Play token; `test` trusts the client and is
 * for local work only; anything else — including the default — takes no money at
 * all.
 */
const PAYMENT_MODE = Deno.env.get("PAYMENT_MODE") ?? "disabled";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** PostgREST answers a table-returning function with an array. Take the row. */
function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  if (value && typeof value === "object") return value as T;
  return null;
}

interface Quote {
  net_cents: number;
  fee_cents: number;
  gross_cents: number;
  commission_bps: number;
}

interface WalletRow {
  balance_cents: number;
}

/**
 * A client-chosen idempotency key for the wallet spend.
 *
 * A plan purchase has no store transaction of its own — the store transaction
 * was the top-up — so there is nothing external to key on. The client sends a
 * value it keeps for the duration of one attempt, and a double-submitted request
 * returns the original order instead of buying twice. Bounded and type-checked,
 * because it is stored on the row that proves what was bought.
 */
function readIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 80) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) return null;
  return trimmed;
}

/** Turn the database's short error token into a status code and a sentence. */
function buyFailure(message: string, shortfallCents: number | null): Response {
  const text = String(message ?? "");
  if (text.includes("insufficient_credits")) {
    const extra = shortfallCents && shortfallCents > 0 ? { shortfall_cents: shortfallCents } : {};
    return json(
      {
        ok: false,
        code: "insufficient_credits",
        error:
          shortfallCents && shortfallCents > 0
            ? `You need ${(shortfallCents / 100).toFixed(2)} more in coaching credits for this plan.`
            : "There are not enough coaching credits for this plan.",
        ...extra,
      },
      402,
    );
  }
  if (text.includes("own_listing")) {
    return json({ ok: false, code: "own_listing", error: "This is your own plan." }, 409);
  }
  if (text.includes("listing_not_for_sale")) {
    return json(
      { ok: false, code: "listing_not_for_sale", error: "This plan is not on sale any more." },
      410,
    );
  }
  if (text.includes("listing_not_found")) {
    return json({ ok: false, code: "listing_not_found", error: "That plan no longer exists." }, 404);
  }
  if (text.includes("unknown_credit_pack")) {
    return json({ ok: false, code: "unknown_credit_pack", error: "Unknown credit pack." }, 400);
  }
  console.error("coach-checkout: unexpected database error", text);
  return json({ ok: false, code: "checkout_failed", error: "That purchase could not be completed." }, 500);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No auth" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: { user }, error: authError } = await admin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      listing_id?: string;
      pack_id?: string;
      idempotency_key?: string;
      verification?: { reference?: string; receipt?: string };
    };
    const action = String(body.action ?? "");

    const { data: balanceRow } = await admin
      .from("coach_credit_wallet")
      .select("balance_cents")
      .eq("user_id", user.id)
      .maybeSingle();
    const balance = Number((balanceRow as WalletRow | null)?.balance_cents ?? 0);

    // ---------------------------------------------------------------- wallet --
    if (action === "wallet") {
      const [{ data: packs }, { data: entries }] = await Promise.all([
        admin
          .from("coach_credit_packs")
          .select("id, price_cents, credit_cents, currency")
          .eq("active", true)
          .order("price_cents", { ascending: true }),
        admin
          .from("coach_credit_entries")
          .select("id, delta_cents, reason, order_id, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      let quote: Quote | null = null;
      if (typeof body.listing_id === "string" && body.listing_id) {
        const { data: listing } = await admin
          .from("marketplace_listings")
          .select("price_cents, active")
          .eq("id", body.listing_id)
          .maybeSingle();
        if (listing?.active) {
          const { data: quoted } = await admin.rpc("marketplace_quote", {
            p_net_cents: listing.price_cents,
          });
          quote = firstRow<Quote>(quoted);
        }
      }

      return json({
        ok: true,
        balance_cents: balance,
        packs: packs ?? [],
        entries: entries ?? [],
        quote,
      });
    }

    // ----------------------------------------------------------------- topup --
    if (action === "topup") {
      if (PAYMENT_MODE !== "store" && PAYMENT_MODE !== "test") {
        return json(
          {
            ok: false,
            code: "payments_not_available",
            error:
              "Coaching credits are not on sale yet. Nothing has been charged — the coach marketplace is not switched on.",
          },
          503,
        );
      }

      const packId = String(body.pack_id ?? "");
      if (!packId) return json({ error: "Which credit pack?" }, 400);

      const { data: pack } = await admin
        .from("coach_credit_packs")
        .select("id, credit_cents, price_cents, active")
        .eq("id", packId)
        .maybeSingle();
      if (!pack || !pack.active) {
        return json({ ok: false, code: "unknown_credit_pack", error: "Unknown credit pack." }, 400);
      }

      const reference = body.verification?.reference?.trim();
      const receipt = body.verification?.receipt;

      if (PAYMENT_MODE === "store") {
        if (!reference || !receipt) {
          return json(
            { ok: false, code: "missing_verification", error: "Missing store purchase verification." },
            402,
          );
        }

        const serviceAccountEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL")?.trim();
        const privateKey = Deno.env.get("GOOGLE_PRIVATE_KEY");
        const packageName = Deno.env.get("GOOGLE_ANDROID_PACKAGE_NAME")?.trim();
        if (!serviceAccountEmail || !privateKey || !packageName) {
          console.error(
            "coach-checkout: PAYMENT_MODE=store requires GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and GOOGLE_ANDROID_PACKAGE_NAME",
          );
          return json(
            {
              ok: false,
              code: "play_not_configured",
              error: "Play Billing is not fully configured on the server yet. Please try again later.",
            },
            503,
          );
        }

        let parsedReceipt: { packageName?: string; productId?: string } | null = null;
        try {
          const parsed: unknown = JSON.parse(receipt);
          if (parsed && typeof parsed === "object") {
            const obj = parsed as Record<string, unknown>;
            parsedReceipt = {
              packageName: typeof obj.packageName === "string" ? obj.packageName : undefined,
              productId: typeof obj.productId === "string" ? obj.productId : undefined,
            };
          }
        } catch {
          return json({ ok: false, code: "bad_receipt", error: "Malformed store receipt." }, 400);
        }

        const verified = await verifyPlayPurchase(reference, parsedReceipt, {
          serviceAccountEmail,
          privateKey,
          packageName,
        });
        if (!verified.ok || !verified.purchase) {
          return json(
            {
              ok: false,
              code: "verification_failed",
              error: verified.error ?? "Purchase verification failed.",
            },
            402,
          );
        }

        // The verified product must be the pack the client asked for, or a
        // £5 purchase could be replayed as a £25 top-up.
        if (verified.purchase.productId !== packId) {
          return json(
            {
              ok: false,
              code: "product_mismatch",
              error: "Verified purchase does not match the requested pack.",
            },
            400,
          );
        }
      }

      // PAYMENT_MODE=test has no purchase token. Mint a stable one so the
      // database's idempotency index is still exercised locally.
      const grantReference = reference || `test:${user.id}:${packId}:${Date.now()}`;

      const { data: granted, error: grantError } = await admin.rpc("grant_coach_credits", {
        p_user: user.id,
        p_pack_id: packId,
        p_reference: grantReference,
      });
      if (grantError) {
        // A grant that failed after a real Play purchase is the one error here
        // that must never be swallowed: the buyer has been charged. Answering 500
        // makes the client's retry re-run the grant, and the reference index is
        // what stops the retry crediting twice.
        console.error("coach-checkout: could not grant credits", grantError);
        return json(
          {
            ok: false,
            code: "grant_failed",
            error:
              "Your purchase could not be credited just now. It has not been lost — please try again, and nothing will be charged twice.",
          },
          500,
        );
      }

      const row = firstRow<{ balance_cents: number; credited_cents: number; reused: boolean }>(granted);
      return json({
        ok: true,
        balance_cents: Number(row?.balance_cents ?? balance),
        credited_cents: Number(row?.credited_cents ?? 0),
        reused: row?.reused === true,
      });
    }

    // ------------------------------------------------------------------- buy --
    if (action === "buy") {
      const listingId = String(body.listing_id ?? "");
      if (!listingId) return json({ error: "Which plan?" }, 400);

      const idempotencyKey = readIdempotencyKey(body.idempotency_key);
      if (!idempotencyKey) {
        return json(
          {
            ok: false,
            code: "bad_idempotency_key",
            error: "This purchase attempt could not be identified. Please try again.",
          },
          400,
        );
      }

      // Advisory only — used to tell the buyer how much MORE they need, and to
      // refuse a price that cannot be quoted before touching the wallet. The
      // authoritative quote is inside buy_coach_plan().
      let shortfall: number | null = null;
      const { data: listing } = await admin
        .from("marketplace_listings")
        .select("price_cents, active")
        .eq("id", listingId)
        .maybeSingle();
      if (listing?.active) {
        const { data: quoted } = await admin.rpc("marketplace_quote", {
          p_net_cents: listing.price_cents,
        });
        const quote = firstRow<Quote>(quoted);
        if (quote) shortfall = Math.max(0, quote.gross_cents - balance);
      }

      const { data: bought, error: buyError } = await admin.rpc("buy_coach_plan", {
        p_buyer: user.id,
        p_listing_id: listingId,
        p_reference: idempotencyKey,
      });
      if (buyError) return buyFailure(buyError.message ?? String(buyError), shortfall);

      const order = firstRow<{
        order_id: string;
        net_cents: number;
        fee_cents: number;
        gross_cents: number;
        balance_cents: number;
        reused: boolean;
      }>(bought);
      if (!order) {
        console.error("coach-checkout: buy_coach_plan returned nothing");
        return json({ ok: false, code: "checkout_failed", error: "That purchase could not be completed." }, 500);
      }

      return json({
        ok: true,
        order_id: order.order_id,
        net_cents: Number(order.net_cents),
        fee_cents: Number(order.fee_cents),
        gross_cents: Number(order.gross_cents),
        balance_cents: Number(order.balance_cents),
        reused: order.reused === true,
      });
    }

    return json({ error: `Unknown action: ${action || "(none)"}` }, 400);
  } catch (error) {
    console.error("coach-checkout: unhandled", error);
    return json({ error: "Something went wrong completing that purchase." }, 500);
  }
});
