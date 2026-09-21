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
export const SOCIAL_PROVIDERS = ["google", "apple"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

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

let cached: Promise<SocialProvider[]> | null = null;

/**
 * One request per page load — the answer only changes when an operator edits the
 * project's auth settings. Any failure (offline, blocked request, HTML error
 * page) means "no social sign-in", never an error the user has to read.
 */
export function fetchEnabledSocialProviders(): Promise<SocialProvider[]> {
  if (!cached) {
    cached = fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY ?? "" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => enabledSocialProviders(body?.external))
      .catch(() => []);
  }
  return cached;
}

/** Callers render nothing until this resolves, so a dead button never flashes. */
export function useAuthProviders(): SocialProvider[] | null {
  const [providers, setProviders] = useState<SocialProvider[] | null>(null);

  useEffect(() => {
    let active = true;
    fetchEnabledSocialProviders().then((list) => {
      if (active) setProviders(list);
    });
    return () => {
      active = false;
    };
  }, []);

  return providers;
}
