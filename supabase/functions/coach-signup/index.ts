import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { COACH_SIGNUP_FEE_CENTS, COACH_SIGNUP_FEE_CURRENCY } from "../_shared/coachMarketplace.ts";
import { createCheckoutSession, stripeConfigured } from "../_shared/stripe.ts";

// ============================================================================
// coach-signup — "Create a coach account", paid once on the website
// ----------------------------------------------------------------------------
// The front half of the coach journey. A person has made a Vaylo account on the
// website, pressed "Create a coach account", and this function hands them a
// Stripe Checkout Session for the one-off $20 fee. When they pay, the
// `stripe-webhook` function turns them into a coach. This function never decides
// anybody is a coach — only a settled payment does, and only in the webhook.
//
// It ships inert. With no STRIPE_SECRET_KEY the function answers 503 with
// `code: "stripe_not_configured"` and the website says so plainly, which is the
// honest state until the business account is connected. Nothing here is
// reachable from the app either: the entrance is a page that is noindex and
// absent from the sitemap, and the feature flag that reveals the marketplace is
// off.
//
// What it deliberately does NOT do:
//
//   * accept a redirect URL from the caller. Both URLs come from server-side
//     configuration. An attacker-supplied `success_url` would otherwise let
//     anybody turn the checkout into an open redirect that collects a paying
//     coach on somebody else's page.
//   * charge anybody who is already a coach, or leave a trail of abandoned
//     sessions behind a double-tap. Both are refused with a sentence that says
//     which one happened.
//   * record anything about the payment itself. The row it creates says
//     `pending_payment` and stays that way until the webhook has a signature
//     from Stripe to prove otherwise.
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** How long a created-but-unpaid application blocks a second checkout attempt. */
const PENDING_WINDOW_MINUTES = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Where Stripe sends the coach back to, and where the website lives.
 *
 * Server-side only — see the note above. Defaulting to the deployed web app is
 * deliberate: an unset variable must not make the endpoint refuse to work for
 * somebody who has just decided to pay, and this is the origin the site is
 * actually deployed on today (it is the same value supabase/config.toml gives as
 * `site_url`). Override it with COACH_SIGNUP_ORIGIN once the site is on its own
 * domain.
 */
const RETURN_ORIGIN = (
  Deno.env.get("COACH_SIGNUP_ORIGIN")?.trim() || "https://vaylo-sports-app.netlify.app"
).replace(/\/+$/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Sign in first, then create your coach account." }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // The caller's own token, checked against the auth server. A forged or
    // expired JWT fails here, and the user id is never read from the body — a
    // client cannot ask for a checkout session on somebody else's behalf.
    const { data: { user }, error: authError } = await admin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) return json({ error: "Your session has expired. Sign in again." }, 401);

    if (!RETURN_ORIGIN.startsWith("https://")) {
      console.error(`coach-signup: COACH_SIGNUP_ORIGIN is not https (${RETURN_ORIGIN})`);
      return json(
        {
          error: "Coach signup is not configured correctly on the server yet.",
          code: "signup_urls_not_configured",
        },
        503,
      );
    }

    if (!stripeConfigured()) {
      // Not an error to shout about in the UI: the website turns this into "not
      // open yet, here is the address to email". Failing with a plain 500 would
      // read as a bug in a form that is simply not switched on.
      return json(
        {
          error:
            "Coach accounts are not open yet — payments are not connected. Nothing has been charged.",
          code: "stripe_not_configured",
        },
        503,
      );
    }

    let body: { display_name?: unknown; email?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      // An empty body is fine: the name and address can come from the account.
    }

    const displayName = typeof body.display_name === "string" ? body.display_name.trim().slice(0, 80) : "";
    const email = typeof body.email === "string" ? body.email.trim().slice(0, 200) : "";

    // Already a coach. Checked against the column the webhook is the only writer
    // of, so this cannot be talked around by a client.
    const { data: profile } = await admin
      .from("creator_profiles")
      .select("is_coach, display_name")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profile?.is_coach) {
      return json(
        { error: "This account is already a coach account.", code: "already_a_coach" },
        409,
      );
    }

    // A checkout that was started and abandoned. Handing out a second session
    // means two open payments for one membership, and the person who pays both
    // is owed a refund rather than an apology.
    const since = new Date(Date.now() - PENDING_WINDOW_MINUTES * 60 * 1000).toISOString();
    const { data: pending } = await admin
      .from("coach_applications")
      .select("id, created_at")
      .eq("user_id", user.id)
      .eq("status", "pending_payment")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pending) {
      return json(
        {
          error:
            "You already have a payment waiting to be completed. Finish it, or wait for it to expire and try again.",
          code: "application_pending",
        },
        409,
      );
    }

    // The fee from the database, so it is tunable the way feature prices are,
    // with the mirrored constant as the fallback if the row has gone missing.
    const { data: feeRow } = await admin.rpc("marketplace_config_int", {
      p_key: "coach_signup_fee_cents",
      p_fallback: COACH_SIGNUP_FEE_CENTS,
    });
    const feeCents = Number(feeRow ?? COACH_SIGNUP_FEE_CENTS);
    if (!Number.isInteger(feeCents) || feeCents <= 0) {
      console.error(`coach-signup: refusing to charge a nonsensical fee (${feeCents})`);
      return json(
        { error: "Coach accounts are not configured correctly on the server yet.", code: "bad_fee" },
        503,
      );
    }

    // The application row is written BEFORE the session, so the webhook always
    // has something to complete. The other order would leave a paid session with
    // no record if the insert failed, which is the one failure mode that costs a
    // person money.
    const { data: application, error: insertError } = await admin
      .from("coach_applications")
      .insert({
        user_id: user.id,
        display_name: displayName || (profile?.display_name ?? null),
        email: email || user.email || null,
        status: "pending_payment",
        fee_cents: feeCents,
        currency: COACH_SIGNUP_FEE_CURRENCY,
      })
      .select("id")
      .single();
    if (insertError || !application) {
      console.error("coach-signup: could not record the application", insertError);
      return json({ error: "Could not start the coach signup. Please try again." }, 500);
    }

    const session = await createCheckoutSession({
      amountCents: feeCents,
      currency: COACH_SIGNUP_FEE_CURRENCY,
      productName: "Vaylo Sports coach account",
      description:
        "One-off fee to open a coach account. You set your own prices and are paid for what you sell.",
      // Back to the coach setup page inside the deployed web app, which is on the
      // same origin as the marketing site — so this is one site, and the coach
      // lands on the page that can read their own new coach status and confirm it
      // rather than on a marketing page that can only say "thank you".
      successUrl: `${RETURN_ORIGIN}/play/coach-signup?status=paid`,
      cancelUrl: `${RETURN_ORIGIN}/play/coach-signup?status=cancelled`,
      clientReferenceId: user.id,
      metadata: { application_id: application.id, user_id: user.id, kind: "coach_signup" },
      customerEmail: email || user.email || null,
      // One session per application, even if the request is retried.
      idempotencyKey: `coach-signup-${application.id}`,
    });

    if (!session.ok) {
      // The row stays, marked for a human to look at. Deleting it would hide the
      // failure; leaving it as `pending_payment` is exactly what it is.
      await admin
        .from("coach_applications")
        .update({ note: `checkout_failed: ${session.error}`.slice(0, 500) })
        .eq("id", application.id);
      console.error("coach-signup: Stripe refused the session", session.error);
      return json(
        {
          error:
            "We could not open the payment page just now. Nothing has been charged — please try again.",
          code: "checkout_failed",
        },
        session.status && session.status >= 400 && session.status < 500 ? 502 : 503,
      );
    }

    if (!session.data.url) {
      console.error("coach-signup: Stripe returned a session with no url", session.data.id);
      return json({ error: "The payment page could not be opened. Nothing has been charged.", code: "no_url" }, 502);
    }

    const { error: linkError } = await admin
      .from("coach_applications")
      .update({ stripe_session_id: session.data.id, updated_at: new Date().toISOString() })
      .eq("id", application.id);
    if (linkError) {
      // The session exists and is payable. If this link is lost the webhook can
      // still find the row through metadata.application_id, so this is logged as
      // a degraded path rather than treated as a failed signup.
      console.error("coach-signup: could not store the session id", linkError);
    }

    return json({
      ok: true,
      url: session.data.url,
      application_id: application.id,
      fee_cents: feeCents,
      currency: COACH_SIGNUP_FEE_CURRENCY,
    });
  } catch (error) {
    console.error("coach-signup: unhandled", error);
    return json({ error: "Something went wrong starting the coach signup." }, 500);
  }
});
