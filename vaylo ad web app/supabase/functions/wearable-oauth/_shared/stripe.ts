// ============================================================================
// stripe — the two Stripe REST calls this project needs
// ----------------------------------------------------------------------------
// Stripe is used for exactly one thing: the $20 fee a coach pays on the website
// to become a coach. Website payments only. Nothing in the Android app goes
// through Stripe — digital goods bought inside the app must go through Google
// Play Billing, which is what src/lib/billing.ts and process-purchase already
// enforce.
//
// This is a hand-written client over Stripe's REST API rather than `npm:stripe`:
//
//   * It uses two endpoints (create a Checkout Session, and nothing else — the
//     webhook arrives as a request we only have to verify a signature on).
//   * The project has no Stripe dependency and this does not add a version to
//     keep current in an edge runtime.
//   * The request format is form-encoded key/value pairs, which is a `fetch`
//     call, not a library.
//   * Every secret is read at call time from the environment, so a deploy with
//     no Stripe keys is a deploy where this module says "not configured"
//     instead of throwing on import. That is the same posture the closed-testing
//     build takes toward PAYMENT_MODE, and it is why the marketplace can ship
//     before the Stripe account exists.
//
// The whole module fails shut: `stripeConfigured()` is false, `createCheckoutSession`
// returns an error, and the calling function answers 503 with a code the client
// can recognise — never a charge attempted with half the configuration.
// ============================================================================

const API_BASE = "https://api.stripe.com/v1";

/** The secret key, or null. Present only once the business account is connected. */
export function stripeSecretKey(): string | null {
  const value = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
  return value ? value : null;
}

/** The signing secret for the coach webhook endpoint (`whsec_…`). */
export function stripeWebhookSecret(): string | null {
  const value = Deno.env.get("STRIPE_WEBHOOK_SECRET")?.trim();
  return value ? value : null;
}

export function stripeConfigured(): boolean {
  return stripeSecretKey() !== null;
}

/**
 * Percent-encode a form body.
 *
 * Stripe's API is `application/x-www-form-urlencoded` and expresses nesting in
 * the KEY, not in JSON: `line_items[0][price_data][unit_amount]`. That is why
 * callers pass flat pairs with bracket-shaped keys — the shape of the request is
 * visible at the call site rather than assembled by a helper nobody reads.
 */
export function formEncode(pairs: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(pairs)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.join("&");
}

export type StripeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

interface StripeErrorBody {
  error?: { message?: string; type?: string; code?: string };
}

/**
 * One form-encoded POST to Stripe.
 *
 * The Stripe error message is passed through rather than flattened, because the
 * difference between `api_key_invalid` and `amount_too_small` is the difference
 * between "your secret is wrong" and "the fee is misconfigured", and both of
 * those are things a person has to fix in a different place.
 */
export async function stripePost<T>(
  path: string,
  body: Record<string, string>,
  idempotencyKey?: string,
): Promise<StripeResult<T>> {
  const secret = stripeSecretKey();
  if (!secret) return { ok: false, error: "stripe_not_configured", status: 503 };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/x-www-form-urlencoded",
    // Pin the API version. Without it Stripe serves whatever the account's
    // default is, which can change under a running deployment.
    "Stripe-Version": "2024-06-20",
  };
  // Makes a double-submitted checkout idempotent: two identical requests with
  // the same key produce one session, not two charges waiting to happen.
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: formEncode(body),
    });
  } catch (error) {
    return {
      ok: false,
      error: `Could not reach Stripe: ${error instanceof Error ? error.message : String(error)}`,
      status: 502,
    };
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body from Stripe means something is in the way (a proxy, an
    // outage page). Say that rather than reporting a JSON parse error.
    return { ok: false, error: `Stripe returned a non-JSON response (${response.status})`, status: 502 };
  }

  if (!response.ok) {
    const body = parsed as StripeErrorBody;
    return {
      ok: false,
      error: body?.error?.message ?? `Stripe rejected the request (${response.status})`,
      status: response.status,
    };
  }

  return { ok: true, data: parsed as T };
}

export interface CheckoutSession {
  id: string;
  /** Null on a session that has already completed; we only ever create new ones. */
  url: string | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_intent?: string | null;
  payment_status?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  customer_email?: string | null;
}

/**
 * Create a Stripe Checkout Session for the coach signup fee.
 *
 * `successUrl` and `cancelUrl` are built by the CALLER from server-side
 * configuration, never taken from the request. A checkout URL is the one place
 * an attacker could otherwise turn this endpoint into an open redirect: send a
 * crafted success_url, and the person who just paid $20 lands on somebody else's
 * page holding a receipt. Refusing to accept the URL from the client removes the
 * question rather than trying to filter it.
 */
export async function createCheckoutSession(args: {
  amountCents: number;
  currency: string;
  productName: string;
  description?: string;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
  customerEmail?: string | null;
  idempotencyKey?: string;
}): Promise<StripeResult<CheckoutSession>> {
  const pairs: Record<string, string> = {
    mode: "payment",
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    client_reference_id: args.clientReferenceId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": args.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(args.amountCents),
    "line_items[0][price_data][product_data][name]": args.productName,
  };
  if (args.description) {
    pairs["line_items[0][price_data][product_data][description]"] = args.description;
  }
  if (args.customerEmail) pairs.customer_email = args.customerEmail;
  for (const [key, value] of Object.entries(args.metadata)) {
    pairs[`metadata[${key}]`] = value;
  }

  return stripePost<CheckoutSession>("/checkout/sessions", pairs, args.idempotencyKey);
}
