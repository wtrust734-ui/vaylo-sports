// ============================================================================
// stripe-signature — verifying a webhook came from Stripe
// ----------------------------------------------------------------------------
// Stripe signs every webhook with an HMAC over `timestamp + "." + rawBody`, using
// the endpoint's signing secret, and sends it in a `Stripe-Signature` header:
//
//   Stripe-Signature: t=1728300000,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
//
// The scheme is small and completely specified, which is why this is written by
// hand rather than by adding `npm:stripe` to an edge function: the repository has
// no Stripe dependency, a webhook endpoint that only needs to verify a signature
// and read four fields does not justify one, and this file — unlike an SDK
// upgrade — can be read in full and unit-tested against the algorithm Stripe
// documents. `supabase/functions/_shared/email.ts` makes the same call about
// SMTP for the same reason.
//
// Three properties this has to get right, because each one is a way a webhook
// endpoint is exploited:
//
//   1. Signature, over the RAW body. Re-serialising the JSON before hashing
//      changes the bytes and every signature would fail; worse, a scheme that
//      hashed a parsed-and-rebuilt body could be made to collide.
//   2. Constant-time comparison. A byte-by-byte early-exit comparison leaks how
//      much of a guess was right, one character at a time, to anyone who can
//      send a few thousand requests.
//   3. A freshness window. A signature is valid forever otherwise, so a webhook
//      body captured once (from a log, a proxy, a misconfigured endpoint) could
//      be replayed at leisure. Stripe recommends a tolerance; five minutes is
//      their default in every library.
// ============================================================================

/** How far a webhook timestamp may be from now. Stripe's own libraries use 300s. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureVerdict = { ok: true } | { ok: false; reason: string };

interface ParsedSignatureHeader {
  /** Seconds since epoch, or null when the header carried no usable `t=`. */
  timestamp: number | null;
  /** Every `v1=` value, in order. Stripe may send more than one during rotation. */
  signatures: string[];
}

/**
 * Read the header. Deliberately permissive about anything it does not need — an
 * unknown scheme (Stripe added `v0=` in the past) is ignored rather than
 * rejected, because rejecting on an unknown field turns a harmless header
 * addition into an outage.
 */
export function parseStripeSignatureHeader(header: string | null): ParsedSignatureHeader {
  const parsed: ParsedSignatureHeader = { timestamp: null, signatures: [] };
  if (!header) return parsed;

  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!value) continue;

    if (key === "t") {
      const seconds = Number(value);
      // `Number("")` is 0 and `Number("now")` is NaN: both would be worse than
      // no timestamp at all, since a bogus 0 makes every request look stale
      // while NaN makes the freshness check silently pass.
      if (Number.isFinite(seconds) && seconds > 0) parsed.timestamp = Math.floor(seconds);
    } else if (key === "v1") {
      parsed.signatures.push(value.toLowerCase());
    }
  }

  return parsed;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256 of `payload`, hex-encoded, using the Web Crypto API. */
export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/**
 * Compare two hex strings without leaking where they differ.
 *
 * `crypto.subtle.verify` would be the natural tool, but it takes a key and a
 * signature rather than two strings, and the signature here has to be compared
 * against possibly several candidates from the header. The loop below always
 * touches every character and accumulates differences in an integer instead of
 * returning early — the standard constant-time comparison.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify one webhook delivery.
 *
 * Returns a verdict rather than throwing, because the caller logs the reason and
 * answers Stripe with a status code, and an exception would lose the difference
 * between "not signed at all" and "signed with the wrong secret" — the two have
 * very different causes in production.
 */
export async function verifyStripeSignature(opts: {
  header: string | null;
  /** The raw request body. NOT a re-serialisation of the parsed JSON. */
  payload: string;
  secret: string;
  toleranceSeconds?: number;
  /** Injected in tests; seconds since epoch. */
  now?: number;
}): Promise<SignatureVerdict> {
  const { header, payload, secret } = opts;
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  if (!secret) return { ok: false, reason: "no signing secret configured" };
  if (!header) return { ok: false, reason: "no Stripe-Signature header" };

  const parsed = parseStripeSignatureHeader(header);
  if (parsed.timestamp === null) return { ok: false, reason: "signature header has no timestamp" };
  if (parsed.signatures.length === 0) return { ok: false, reason: "signature header has no v1 value" };

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const age = Math.abs(now - parsed.timestamp);
  if (age > tolerance) {
    return { ok: false, reason: `webhook timestamp is ${age}s old, outside the ${tolerance}s window` };
  }

  const expected = await hmacSha256Hex(secret, `${parsed.timestamp}.${payload}`);
  // Every candidate is compared even after a match, so the number of HMACs and
  // comparisons does not depend on which one is right.
  let matched = false;
  for (const candidate of parsed.signatures) {
    if (constantTimeEquals(candidate, expected)) matched = true;
  }

  return matched ? { ok: true } : { ok: false, reason: "signature does not match the signing secret" };
}
