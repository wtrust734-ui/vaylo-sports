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

let cached: Promise<AuthMethods> | null = null;

/**
 * One request per page load — the answer only changes when an operator edits the
 * project's auth settings. Any failure (offline, blocked request, HTML error
 * page) means "password only", never an error the user has to read.
 */
export function fetchAuthMethods(): Promise<AuthMethods> {
  if (!cached) {
    cached = fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY ?? "" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => parseAuthMethods(body))
      .catch(() => ({ providers: [], passkeys: false, email: false, phone: false }) as AuthMethods);
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

/** Callers render nothing until this resolves, so a dead button never flashes. */
export function useAuthMethods(): AuthMethods | null {
  const [methods, setMethods] = useState<AuthMethods | null>(null);

  useEffect(() => {
    let active = true;
    fetchAuthMethods().then((m) => {
      if (active) setMethods(m);
    });
    return () => {
      active = false;
    };
  }, []);

  return methods;
}

/** OAuth-only view of useAuthMethods, for the original consumers. */
export function useAuthProviders(): SocialProvider[] | null {
  return useAuthMethods()?.providers ?? null;
}
