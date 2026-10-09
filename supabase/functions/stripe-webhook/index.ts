import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailConfigured, sendMail } from "../_shared/email.ts";
import { stripeWebhookSecret } from "../_shared/stripe.ts";
import { verifyStripeSignature } from "../_shared/stripeSignature.ts";

// ============================================================================
// stripe-webhook — the only place a person becomes a coach
// ----------------------------------------------------------------------------
// Stripe calls this after the $20 coach signup fee is paid. It is the single
// writer of `creator_profiles.is_coach`, and it is deliberately the least
// trusting function in the project:
//
//   * the request is authenticated by HMAC signature over the RAW body, not by a
//     JWT — Stripe has no Vault account, so `verify_jwt` is off for this function
//     in supabase/config.toml and the signature is the whole security model;
//   * the signature has a five-minute freshness window, so a captured delivery
//     cannot be replayed later;
//   * the amount is not taken from the request. The application row already
//     records the fee that was quoted, and the row's status is what changes —
//     this function grants membership, it does not price it.
//
// It answers Stripe honestly, because the status code decides whether Stripe
// retries:
//
//   2xx  handled, or deliberately ignored (an event type we do not use)
//   400  the signature did not verify — a retry will not fix it
//   503  no signing secret configured, so nothing can be verified yet. Stripe
//        retries for three days, which is what makes "connect the account later"
//        safe: deliveries that arrive before the secret is set are retried once
//        it is.
//   500  the signature was good and something failed afterwards. Also a retry,
//        because a coach who has paid must end up with an account.
//
// Nothing here is reachable by a browser: the function refuses anything that is
// not signed, so discovering the URL is not enough to use it.
// ============================================================================

/** The one inbox a person reads. */
const OPERATOR_EMAIL = "vaylosportssupport@gmail.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface StripeEvent {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
}

/** Fields we read off a Checkout Session or a Charge. Everything optional. */
interface StripeObject {
  id?: string;
  payment_intent?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  amount_refunded?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
  metadata?: Record<string, string> | null;
}

/**
 * Tell the operator that a coach has joined, and the coach that they are in.
 *
 * Runs after the database has already been changed, so a mail failure can only
 * ever cost a notification — never a membership. That is why it returns nothing
 * and its failure is logged rather than raised: the response to Stripe must stay
 * a 2xx once the row is written, or Stripe retries a signup that already
 * happened.
 */
async function notify(args: {
  kind: "paid" | "refunded" | "expired";
  email: string | null;
  displayName: string | null;
  amountCents: number | null;
  currency: string | null;
  sessionId: string | null;
  alreadyApplied: boolean;
}): Promise<void> {
  if (!emailConfigured()) {
    console.error("stripe-webhook: mail is not configured; the coach was not emailed");
    return;
  }

  const money =
    args.amountCents === null
      ? "(amount unknown)"
      : `${(args.amountCents / 100).toFixed(2)} ${(args.currency ?? "").toUpperCase()}`.trim();

  const subject =
    args.kind === "paid"
      ? `Vaylo Sports: coach account opened — ${args.displayName ?? args.email ?? "unknown"}`
      : args.kind === "refunded"
        ? `Vaylo Sports: coach fee REFUNDED — ${args.displayName ?? args.email ?? "unknown"}`
        : `Vaylo Sports: coach checkout expired — ${args.email ?? "unknown"}`;

  const lines = [
    args.kind === "paid"
      ? "A coach signup fee was paid, and the account is now a coach account."
      : args.kind === "refunded"
        ? "A coach signup fee was refunded. The account has NOT been un-made a coach."
        : "A coach checkout session expired without being paid.",
    "",
    `Name: ${args.displayName ?? "(none given)"}`,
    `Email: ${args.email ?? "(none given)"}`,
    `Amount: ${money}`,
    `Checkout session: ${args.sessionId ?? "(unknown)"}`,
  ];

  if (args.kind === "paid") {
    lines.push(
      "",
      args.alreadyApplied
        ? "This was a duplicate delivery: the membership was already granted."
        : "This person can now publish plans and set their own prices.",
      "",
      "Before they can be PAID, two things are still missing and neither is",
      "automatic: a payout rail, and the tax treatment of a coach's earnings.",
      "Every sale is recorded in coach_earnings with status 'accrued', which",
      "means owed and not yet transferred. See docs/COACH-MARKETPLACE.md §5.",
    );
  }

  if (args.kind === "refunded") {
    lines.push(
      "",
      "Decide this by hand. Membership was left in place on purpose: an",
      "automated revoke would take a coach's published plans off sale on any",
      "partial or disputed refund, and the buyer of a plan is not who asked for",
      "this. If the membership should end, set creator_profiles.is_coach = false",
      "and deactivate their listings yourself.",
    );
  }

  try {
    await sendMail({ to: OPERATOR_EMAIL, subject, text: lines.join("\n") });
  } catch (error) {
    console.error("stripe-webhook: operator email failed", error);
  }

  if (args.kind === "paid" && args.email) {
    try {
      await sendMail({
        to: args.email,
        subject: "Your Vaylo Sports coach account is open",
        text: [
          "Hello,",
          "",
          `Your $${((args.amountCents ?? 0) / 100).toFixed(2)} coach signup fee has been`,
          "received and your Vaylo Sports coach account is open.",
          "",
          "You can now publish plans and set your own prices. You receive exactly the",
          "price you set; the buyer pays that price plus Vaylo's commission, shown",
          "before you publish.",
          "",
          "One thing to be straight about: earning money as a coach may create tax",
          "and record-keeping obligations for you where you live, and we cannot give",
          "you advice on them. Keep your own records of what you sell.",
          "",
          "Vaylo Sports",
        ].join("\n"),
      });
    } catch (error) {
      console.error("stripe-webhook: coach email failed", error);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = stripeWebhookSecret();
  if (!secret) {
    console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET is not set; refusing to trust the request");
    return json({ error: "Webhook is not configured.", code: "stripe_not_configured" }, 503);
  }

  // The RAW body. A re-serialised parse would change the bytes and no signature
  // would ever verify — see _shared/stripeSignature.ts.
  const raw = await req.text();

  const verdict = await verifyStripeSignature({
    header: req.headers.get("Stripe-Signature"),
    payload: raw,
    secret,
  });
  if (!verdict.ok) {
    console.error(`stripe-webhook: rejected a delivery — ${verdict.reason}`);
    return json({ error: "Invalid signature." }, 400);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return json({ error: "Malformed event body." }, 400);
  }

  const type = String(event.type ?? "");
  const object = (event.data?.object ?? {}) as StripeObject;
  const sessionId = typeof object.id === "string" ? object.id : null;
  const metadata = object.metadata ?? {};
  const applicationId = typeof metadata.application_id === "string" ? metadata.application_id : null;
  const kind = String(metadata.kind ?? "");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    switch (type) {
      case "checkout.session.completed": {
        // Only our own checkout. A session created for something else (there is
        // nothing else today, but there will be) must not open a coach account.
        if (kind && kind !== "coach_signup") {
          return json({ ok: true, ignored: type, reason: "not a coach signup" });
        }
        if (object.payment_status && object.payment_status !== "paid") {
          // Async payment methods can complete later. The next event will carry
          // payment_status=paid; granting now would be granting unpaid.
          return json({ ok: true, ignored: type, reason: `payment_status=${object.payment_status}` });
        }

        // Find the application by session id, falling back to the metadata id —
        // coach-signup writes the row first, so a session whose id was never
        // stored still has a path back to it.
        let target = applicationId;
        if (!target) {
          const { data } = await admin
            .from("coach_applications")
            .select("id")
            .eq("stripe_session_id", sessionId ?? "")
            .maybeSingle();
          target = data?.id ?? null;
        }
        if (!target) {
          console.error(`stripe-webhook: no coach application for session ${sessionId}`);
          // Nothing to retry: the row genuinely is not there. Answering 500
          // would make Stripe redeliver for three days with no chance of success.
          return json({ ok: true, ignored: type, reason: "no matching application" });
        }

        const { data: applied, error } = await admin.rpc("apply_coach_signup_payment", {
          p_session_id: sessionId,
          p_payment_intent: object.payment_intent ?? null,
          p_email: object.customer_details?.email ?? object.customer_email ?? null,
        });
        if (error) {
          // A real failure. The fee is paid and the membership is not granted, so
          // this must be retried rather than swallowed.
          console.error("stripe-webhook: could not apply the payment", error);
          return json({ error: "Could not complete the signup." }, 500);
        }

        const row = Array.isArray(applied) ? applied[0] : applied;
        await notify({
          kind: "paid",
          email: row?.email ?? object.customer_details?.email ?? null,
          displayName: row?.display_name ?? null,
          amountCents: object.amount_total ?? null,
          currency: object.currency ?? null,
          sessionId,
          alreadyApplied: row?.already_applied === true,
        });

        return json({ ok: true, applied: row?.already_applied !== true });
      }

      case "checkout.session.expired": {
        if (!applicationId && !sessionId) return json({ ok: true, ignored: type });
        const query = admin.from("coach_applications").update({
          status: "rejected",
          note: "checkout session expired unpaid",
          updated_at: new Date().toISOString(),
        });
        const { data: updated } = applicationId
          ? await query.eq("id", applicationId).eq("status", "pending_payment").select("email")
          : await query.eq("stripe_session_id", sessionId!).eq("status", "pending_payment").select("email");

        const email = Array.isArray(updated) ? updated[0]?.email ?? null : null;
        if (email) {
          await notify({
            kind: "expired",
            email,
            displayName: null,
            amountCents: object.amount_total ?? null,
            currency: object.currency ?? null,
            sessionId,
            alreadyApplied: false,
          });
        }
        return json({ ok: true, expired: true });
      }

      case "charge.refunded": {
        // Recorded, not acted on. See the note in notify(): taking a coach's
        // published plans off sale automatically, on a partial or disputed
        // refund, breaks the buyers who did nothing wrong.
        const { data: refunded } = await admin
          .from("coach_applications")
          .update({
            status: "refunded",
            refunded_at: new Date().toISOString(),
            note: "Stripe charge.refunded — membership left in place for a human to decide",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_payment_intent", object.payment_intent ?? object.id ?? "")
          .select("email, display_name")
          .maybeSingle();

        await notify({
          kind: "refunded",
          email: refunded?.email ?? null,
          displayName: refunded?.display_name ?? null,
          amountCents: object.amount_refunded ?? object.amount_total ?? null,
          currency: object.currency ?? null,
          sessionId,
          alreadyApplied: false,
        });
        return json({ ok: true, refunded: Boolean(refunded) });
      }

      default:
        // Everything else is acknowledged so Stripe stops retrying it.
        return json({ ok: true, ignored: type });
    }
  } catch (error) {
    console.error(`stripe-webhook: unhandled error handling ${type}`, error);
    // 500 so Stripe retries: a paid coach must not be lost to a transient fault.
    return json({ error: "Unexpected error." }, 500);
  }
});
