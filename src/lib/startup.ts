// ============================================================================
// startup — small diagnostic helpers for the app's first paint
// ----------------------------------------------------------------------------
// The boot surface (BootVeil, main.tsx, App.tsx) already has a finite hard
// stop, a real retry path through AuthProvider, and gated handoffs. This module
// is the narrow bit that was still missing: a read-only, secret-free signal that
// the build is misconfigured at the highest possible layer, so the veil can
// surface a useful, non-blank recovery screen instead of just timing out.
//
// It never throws, never performs I/O, and never reads anything that could carry
// a token, session, email or key. It answers one question only:
//   "did this client bundle boot with usable Supabase configuration?"
// ============================================================================

const PLACEHOLDER_URL_RE = /^https:\/\/placeholder(?:\.supabase)?\.co(\/|$)/i;
const INVALID_HOST_RE = /\.invalid(:\d+)?(\/|$)/;

// Vite inlines `import.meta` into the bundle; reading it off `window` (the way
// the test harness stubs it) needs one explicit — and fully-typed — bridge so
// the whole access chain is checked instead of degraded to `unknown`.
interface ImportMetaBridge {
  import?: { meta?: { env?: Record<string, unknown> } };
}
const envOf = (): Record<string, unknown> | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as ImportMetaBridge).import?.meta?.env;

/**
 * True when the browser-side Supabase client is configured with a URL that can
 * never work: a placeholder dev host, the documented `.invalid` clone host, or
 * an empty/whitespace-only value.
 *
 * This is purely a build-time/config signal. On the web it reflects the
 * `VITE_SUPABASE_URL` value baked into the bundle; in the Capacitor shell the
 * same env var is inlined by Vite into `import.meta.env` before the native
 * bundle is assembled, so the same check covers both builds.
 */
export function isConfigBootFailure(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const raw: unknown = envOf()?.VITE_SUPABASE_URL;
  if (typeof raw !== "string") {
    return true;
  }
  const url = raw.trim();
  if (url === "") {
    return true;
  }
  if (PLACEHOLDER_URL_RE.test(url)) {
    return true;
  }
  if (INVALID_HOST_RE.test(url)) {
    return true;
  }
  return false;
}

/** True when the browser-side Supabase key is missing or non-enumerable/empty. */
export function isConfigKeyMissing(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const raw: unknown = envOf()?.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof raw !== "string") {
    return false;
  }
  return raw.trim() === "";
}

/** Diagnostic shape the boot surface may read; never written to logs. */
export interface StartupDiagnostics {
  /** A build-time configuration failure that makes booting pointless. */
  configBootFailure: boolean;
  /** The browser-side Supabase URL is missing, empty, or a known dead host. */
  supabaseUrlUnusable: boolean;
  /** The browser-side Supabase key is missing or empty. */
  supabaseKeyMissing: boolean;
}

export function inspectStartup(): StartupDiagnostics {
  if (typeof window === "undefined") {
    return { configBootFailure: false, supabaseUrlUnusable: false, supabaseKeyMissing: false };
  }
  const env: Record<string, unknown> | undefined = envOf();
  const urlRaw: unknown = env?.VITE_SUPABASE_URL;
  const keyRaw: unknown = env?.VITE_SUPABASE_PUBLISHABLE_KEY;

  const urlUnusable: boolean =
    typeof urlRaw !== "string" || urlRaw.trim() === "" || PLACEHOLDER_URL_RE.test(urlRaw) || INVALID_HOST_RE.test(urlRaw);

  const keyMissing: boolean = typeof keyRaw !== "string" || keyRaw.trim() === "";

  return {
    configBootFailure: urlUnusable,
    supabaseUrlUnusable: urlUnusable,
    supabaseKeyMissing: keyMissing,
  };
}
