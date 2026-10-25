// ============================================================================
// DEMO MODE — the keyless web-app clone (docs/WEB-CLONE.md)
// ----------------------------------------------------------------------------
// What this is
//
// `npm run build:clone` produces a static, downloadable copy of the app — the
// same React source the APK ships — with NO API keys and NO backend. This
// module is the seam that makes such a build usable rather than a sign-in wall
// over empty screens:
//
//   1. DEMO_MODE — true only when the build sets VITE_DEMO_MODE=true. Every
//      normal build (the APK, the Play bundle, the standalone web build) reads
//      false here and compiles every demo branch away, so the clone can never
//      change behaviour for a build that has a backend.
//
//   2. A local guest session. Supabase auth cannot run without a project, so
//      the clone mints a stable, browser-local guest instead: a real-shaped
//      Session/User object (anonymous, no email) held in React state only. The
//      session gate opens, the header says "Guest", and nothing is sent
//      anywhere. It is NOT written into supabase-js's own storage — the real
//      client in this build points at a reserved `.invalid` hostname in clone
//      builds.
//
//   3. Free purchases. Every purchase in the app funnels through
//      `purchaseItems()` in lib/billing.ts; in demo mode that call grants the
//      product locally (localStorage) and returns ok without charging, paying
//      or calling a server — "purchases should all be free". Feature unlocks
//      are granted and read back through demoPurchases(), so the paywall opens.
//      Credit and coin packs record nothing: balances stay at zero, which is
//      the documented "credits are non-functional" behaviour of the clone.
//
// What stays honest
//
// Everything else — training data, AI, profiles, community — has no backend
// and simply fails or renders empty, exactly as the clone's README says. This
// file never fabricates data; it only opens the door (guest) and makes the
// buy buttons free (grants).
// ============================================================================

import type { Session, User } from "@supabase/supabase-js";

/** True only in builds made by `npm run build:clone` (VITE_DEMO_MODE=true). */
export const DEMO_MODE: boolean = import.meta.env.VITE_DEMO_MODE === "true";

const GUEST_ID_KEY = "vaylo:demo:guest-id";
const PURCHASES_KEY = "vaylo:demo:purchases";

const readKey = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeKey = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode / storage disabled: the demo still runs, it just forgets.
  }
};

const base64url = (input: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(input)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * A stable local guest id.
 *
 * Stable on purpose: a reload must not look like a new athlete, so the same
 * browser keeps the same guest (and therefore the same free grants) for as
 * long as localStorage lasts.
 */
export function demoGuestId(): string {
  const existing = readKey(GUEST_ID_KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `demo-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  writeKey(GUEST_ID_KEY, id);
  return id;
}

/**
 * A Session-shaped local guest, handed straight to AuthContext's state.
 *
 * The JWT is syntactically valid (decodable, far-future exp) because parts of
 * supabase-js decode tokens they are handed, but it is signed with nothing and
 * is never sent: the client's URL is a reserved `.invalid` hostname in clone
 * builds. `as Session`/`as User` rather than a literal match — the exact GoTrue
 * shape is the server's to define, and only the fields the app reads matter
 * here (id, is_anonymous, no email → the "Guest" display name path).
 */
export function demoGuestSession(): Session {
  const id = demoGuestId();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60 * 24 * 365 * 100; // far future: never refreshes
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: id,
      aud: "authenticated",
      role: "authenticated",
      is_anonymous: true,
      iat: now,
      exp,
    })
  );
  const access_token = `${header}.${payload}.local-demo`;

  const user = {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: null,
    phone: "",
    is_anonymous: true,
    app_metadata: { provider: "anonymous", providers: ["anonymous"] },
    user_metadata: {},
    identities: [],
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    is_sso_user: false,
  } as unknown as User;

  return {
    access_token,
    refresh_token: "local-demo",
    expires_in: exp - now,
    expires_at: exp,
    token_type: "bearer",
    user,
  } as Session;
}

/** Product ids the demo guest has "bought" (free), read back by hasFeature. */
export function demoPurchases(): string[] {
  try {
    const raw = readKey(PURCHASES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Record a free purchase so entitlement checks (hasFeature) see it. */
export function demoGrant(productIds: readonly string[]): void {
  const current = new Set(demoPurchases());
  for (const id of productIds) current.add(id);
  writeKey(PURCHASES_KEY, JSON.stringify([...current]));
}
