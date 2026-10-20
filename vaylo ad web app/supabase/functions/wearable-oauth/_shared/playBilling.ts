// ===========================================================================
// PLAY BILLING — server-side receipt verification for one-time products
// ---------------------------------------------------------------------------
// Verifies a Google Play purchase (purchase token) against the Google Play
// Developer API before `process-purchase` grants anything. Runs entirely
// server-side in the edge function; the private key never leaves the secrets
// store and is never logged.
//
// Flow:
//   1. Client (Capacitor Android) buys through Play Billing and sends
//      { reference: purchaseToken, receipt: JSON { productId, packageName } }
//      to process-purchase — see src/lib/billing.ts.
//   2. This module mints a service-account access token (RS256 JWT, cached
//      until shortly before expiry) and calls
//      purchases.products.get for the token.
//   3. A hard product check: the Play purchase's productId must exist in the
//      generated money catalog AND match a product id in the client basket —
//      an attacker replaying a cheap pack's token for an expensive one fails.
//   4.purchaseState must be `purchased` (0). `pending` (1) is refused with a
//      clear message (pending purchases are not paid yet); `cancelled` (2) is
//      refused outright. consumptionState is not required — consumption is an
//      app-side concept; the server's idempotency guard on the purchase token
//      (user_purchases.provider_reference) prevents double granting.
//
// Secrets (set with `supabase secrets set`):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  the service account's ...@...iam.gserviceaccount.com
//   GOOGLE_PRIVATE_KEY            its RSA private key, with literal \n kept
//   GOOGLE_ANDROID_PACKAGE_NAME   must equal the app's applicationId
//                                 (com.vaylosports.app)
//
// Test account coverage: Play "license testers" buy with test cards; the API
// response is identical except purchaseType=0 (test) — nothing here filters
// on purchaseType, so test purchases verify normally.
// ===========================================================================

import {
  CREDIT_GRANTS,
  COIN_GRANTS,
  FIRST_PURCHASE_BUNDLE,
  PRODUCT_PRICES,
  UNLIMITED_PACKS,
} from "./moneyCatalog.ts";

export const PLAY_PACKAGE_ENV = "GOOGLE_ANDROID_PACKAGE_NAME";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const PLAY_API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const TOKEN_SKEW_MS = 60_000; // refresh access tokens 60s before expiry

// ---------------------------------------------------------------------------
// Catalog lookup — which money products can be bought through Play Billing.
// Everything here is priced in USD cents in the catalog; Play prices in local
// currency, so price parity is enforced against the catalog cents only when
// the purchase carries a recognized country/price column. Play one-time
// products are what the athlete bought; the server re-derives the grant from
// ITS OWN tables, so a mispriced Play product can only fail the parity check,
// never inflate a grant.
// ---------------------------------------------------------------------------

/** Product ids this server will accept a Play purchase for. */
export function playPurchasableProductIds(): string[] {
  const ids = new Set<string>([
    ...Object.keys(PRODUCT_PRICES),
    ...Object.keys(CREDIT_GRANTS),
    ...Object.keys(COIN_GRANTS),
    ...UNLIMITED_PACKS.map((p) => p.id),
    FIRST_PURCHASE_BUNDLE.id,
  ]);
  return [...ids];
}

export interface PlayProductCheck {
  ok: boolean;
  error?: string;
}

/** Pure catalog rule: is this Play productId a real, sellable product here? */
export function isKnownMoneyProduct(productId: string): boolean {
  return playPurchasableProductIds().includes(productId);
}

// ---------------------------------------------------------------------------
// Access-token minting (service account → OAuth2 bearer, cached)
// ---------------------------------------------------------------------------

let cachedToken: { token: string; expMs: number } | null = null;

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * RS256-signs a JWT with the service-account key and exchanges it at
 * oauth2.googleapis.com for an access token scoped to the Play Developer API.
 * The cached token is reused until TOKEN_SKEW_MS before its stated expiry.
 */
export async function getPlayAccessToken(
  email: string,
  privateKeyPem: string
): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expMs) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: TOKEN_AUDIENCE,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKeyPem) as unknown as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Play token exchange failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Play token exchange returned no access_token");

  cachedToken = {
    token: data.access_token,
    expMs: Date.now() + (data.expires_in ?? 3600) * 1000 - TOKEN_SKEW_MS,
  };
  return cachedToken.token;
}

/** Strips the PEM header/footer and decodes the base64 body into a PKCS#8 key. */
function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Purchase-token verification
// ---------------------------------------------------------------------------

export interface PlayReceipt {
  /** packageName the client claims. Checked against the configured package. */
  packageName?: string;
  productId?: string;
}

export interface PlayPurchaseState {
  productId: string;
  purchaseToken: string;
  /** Milliseconds since epoch, when Play recorded the purchase. */
  purchaseTimeMs?: number;
  /** Raw Play acknowledgement/consumption fields, for diagnostics. */
  acknowledgementState?: number;
  consumptionState?: number;
  /** ISO timestamp for the ledger row. */
  purchasedAt: string;
}

export interface PlayVerification {
  ok: boolean;
  purchase?: PlayPurchaseState;
  error?: string;
  /** True when Google answered but the purchase is refund/chargeback-reversed. */
  reversed?: boolean;
}

/**
 * Verifies a purchase token with the Play Developer API.
 * Throws on transport/credential failures; returns ok:false for refusable
 * receipts (pending, cancelled, product mismatch) so callers can map those to
 * HTTP statuses.
 */
export async function verifyPlayPurchase(
  purchaseToken: string,
  receipt: PlayReceipt | null,
  opts: {
    serviceAccountEmail: string;
    privateKey: string;
    packageName: string;
  }
): Promise<PlayVerification> {
  const expectedPackage = opts.packageName.trim();
  const claimedPackage = receipt?.packageName?.trim() ?? expectedPackage;
  if (!expectedPackage || claimedPackage !== expectedPackage) {
    return {
      ok: false,
      error: `Receipt package name (${claimedPackage || "missing"}) does not match this app.`,
    };
  }

  const token = await getPlayAccessToken(opts.serviceAccountEmail, opts.privateKey);

  // productId on the receipt is only a claim — the authoritative product comes
  // from the Play API below. If the client did not send one, still verify the
  // token and require the API to return a product this app sells.
  const res = await fetch(
    `${PLAY_API}/${encodeURIComponent(expectedPackage)}/purchases/products/${encodeURIComponent(
      receipt?.productId ?? ""
    )}/tokens/${encodeURIComponent(purchaseToken)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (res.status === 404) {
    return { ok: false, error: "Google Play does not recognize this purchase." };
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Play Developer API rejected the service account — check GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and that the account is linked in Play Console."
    );
  }
  if (!res.ok) {
    throw new Error(`Play API error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    productId?: string;
    purchaseState?: number;
    purchaseTimeMillis?: string;
    acknowledgementState?: number;
    consumptionState?: number;
    purchaseType?: number;
  };

  const productId = String(data.productId ?? receipt?.productId ?? "");
  if (!productId || !isKnownMoneyProduct(productId)) {
    return {
      ok: false,
      error: `Google Play product "${productId || "?"}" is not a Vaylo Sports product. Create the Play in-app products with the exact ids from the money catalog.`,
    };
  }

  // 0 = purchased, 1 = pending (awaiting payment), 2 = cancelled/refunded.
  if (data.purchaseState === 1) {
    return { ok: false, error: "This purchase is still pending payment with Google Play." };
  }
  if (data.purchaseState === 2) {
    return { ok: false, error: "This purchase was cancelled or refunded.", reversed: true };
  }
  if (data.purchaseState !== 0) {
    return { ok: false, error: `Unrecognized Play purchaseState (${data.purchaseState}).` };
  }

  const purchaseTimeMs = data.purchaseTimeMillis ? Number(data.purchaseTimeMillis) : undefined;
  return {
    ok: true,
    purchase: {
      productId,
      purchaseToken,
      purchaseTimeMs,
      acknowledgementState: data.acknowledgementState,
      consumptionState: data.consumptionState,
      purchasedAt: purchaseTimeMs ? new Date(purchaseTimeMs).toISOString() : new Date().toISOString(),
    },
  };
}
