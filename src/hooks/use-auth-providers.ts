// Which social sign-in providers this Supabase project actually has enabled.
//
// The auth page used to render "Continue with Google" and "Continue with Apple"
// unconditionally. This Supabase project has no OAuth credentials configured yet
// (GoTrue reports both providers as disabled), so the buttons only produce
// "provider is not enabled" errors. Asking GoTrue what it actually supports keeps
// the UI honest in both states: no credentials means no button, and entering
// credentials in the dashboard makes the button appear with no code change.

import { useEffect, useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Social providers the app can offer. Add one here only once it is wired up. */
export const SOCIAL_PROVIDERS = ["google", "apple", "azure", "discord", "facebook", "linkedin"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/** Sign-in methods GoTrue reports as available, from `/auth/v1/settings`. */
export interface AuthMethods {
  /** Social/OAuth providers enabled on the project (google, apple, azure, ...). */
  providers: SocialProvider[];
  /** Project-level passkeys_enabled flag (WebAuthn sign-in). */
  passkeys: boolean;
  /** Email provider on (password + magic links + recovery all ride on it). */
  email: boolean;
  /** Phone/SMS OTP sign-in enabled on the project. */
  phone: boolean;
}

/**
 * Pure: pick our providers out of GoTrue's public `/auth/v1/settings` payload,
 * which reports each provider as a boolean under `external`.
 */
export function enabledSocialProviders(
  external: Record<string, unknown> | null | undefined,
): SocialProvider[] {
  if (!external) return [];
  return SOCIAL_PROVIDERS.filter((provider) => external[provider] === true);
}

/**
 * Pure: full method surface from a `/auth/v1/settings` payload. Kept separate
 * from the fetch so tests can pin the parsing without a network mock.
 */
export function parseAuthMethods(body: unknown): AuthMethods {
  const payload = (body ?? {}) as {
    external?: Record<string, unknown>;
    passkeys_enabled?: unknown;
  };
  return {
    providers: enabledSocialProviders(payload.external),
    passkeys: payload.passkeys_enabled === true,
    email: payload.external?.email === true,
    phone: payload.external?.phone === true,
  };
}

/** "Password only" — the safe answer when the settings genuinely say so. */
const NO_METHODS: AuthMethods = { providers: [], passkeys: false, email: false, phone: false };

/**
 * A cold-start on mobile is exactly when the network is least reliable, and a
 * WebView fetch with no deadline can hang for minutes rather than fail. Six
 * seconds is long enough for GoTrue's tiny settings payload and short enough
 * that the sign-in buttons are not missing while a phone is still holding a
 * radio handshake.
 */
const SETTINGS_TIMEOUT_MS = 6000;

/**
 * One attempt at the settings. `null` means *unknown* (offline, timeout, HTML
 * error page) — deliberately distinct from a successful payload that says
 * "nothing enabled", because only one of those is worth retrying.
 */
function requestAuthMethods(): Promise<AuthMethods | null> {
  const signal =
    typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(SETTINGS_TIMEOUT_MS)
      : undefined;
  return fetch(`${SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY ?? "" },
    signal,
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => (body ? parseAuthMethods(body) : null))
    .catch(() => null);
}

let cached: Promise<AuthMethods> | null = null;

/**
 * One request per session — the answer only changes when an operator edits the
 * project's auth settings. Failures answer "password only" for the caller that
 * hit them, but are NOT pinned into the cache: an earlier version cached the
 * failure for the lifetime of the page, so one offline cold start hid Google /
 * Discord / passkey until the app was restarted. Dropping the cache on failure
 * makes the next mount (or the `online` listener in useAuthMethods) try again.
 */
export function fetchAuthMethods(): Promise<AuthMethods> {
  if (!cached) {
    cached = requestAuthMethods().then((methods) => {
      if (!methods) {
        cached = null;
        return NO_METHODS;
      }
      return methods;
    });
  }
  return cached;
}

/** Back-compat wrapper for the original OAuth-only consumers/tests. */
export function fetchEnabledSocialProviders(): Promise<SocialProvider[]> {
  return fetchAuthMethods().then((m) => m.providers);
}

/**
 * WebAuthn platform support. GoTrue may have passkeys on while the *device*
 * cannot do the ceremony (old browser, insecure context), so both gates must
 * pass before a passkey button renders.
 */
export function passkeySupported(): boolean {
  try {
    return typeof window !== "undefined" && !!window.PublicKeyCredential;
  } catch {
    return false;
  }
}

/**
 * E.164 phone numbers only — GoTrue rejects anything else. Loose enough to
 * tolerate spaces/dashes typed for readability, strict about the + prefix,
 * country code and total length (8–15 digits per ITU E.164).
 */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[-\s()]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** Retries while the settings are unknown: 0s, 1.5s, 3s, 5s, 8s, 13s. */
const RETRY_DELAYS_MS = [1500, 3000, 5000, 8000, 13000];

/**
 * Callers render nothing until this resolves, so a dead button never flashes.
 *
 * "Resolves" used to mean "the first attempt finished, however it went": a
 * single failed or hung request left the section hidden — no Google, no
 * Discord, no passkey — for the whole session, which is exactly the missing-
 * buttons report from the app's startup screen. Unknown now stays unknown
 * only *temporarily*: bounded backoff retries, plus an immediate retry when
 * the browser says the network came back.
 */
export function useAuthMethods(): AuthMethods | null {
  const [methods, setMethods] = useState<AuthMethods | null>(null);

  useEffect(() => {
    let active = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      requestAuthMethods().then((answer) => {
        if (!active) return;
        if (answer) {
          setMethods(answer);
          return;
        }
        const delay = RETRY_DELAYS_MS[attempt];
        attempt += 1;
        if (delay !== undefined) timer = setTimeout(load, delay);
      });
    };

    const onOnline = () => {
      if (!active) return;
      clearTimeout(timer);
      attempt = 0;
      load();
    };

    load();
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      clearTimeout(timer);
    };
  }, []);

  return methods;
}

/** OAuth-only view of useAuthMethods, for the original consumers. */
export function useAuthProviders(): SocialProvider[] | null {
  return useAuthMethods()?.providers ?? null;
}
