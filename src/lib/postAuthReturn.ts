// ============================================================================
// POST-AUTH RETURN — take someone back where they were going
// ----------------------------------------------------------------------------
// The refund review link in the administrator email opens /admin/refunds?case=...
// If the reader is signed out, they must sign in first — and then land on the
// case, not on the dashboard. The sign-in screen only knows how to send people
// to "/" or "/onboarding", so the intended path is parked here for one trip.
//
// Only same-origin absolute paths are kept. A value such as "//evil.example" or
// "https://evil.example" is a redirect target, not a route, and is discarded.
// ============================================================================

const KEY = "vaylo:post-auth-path";

function safePath(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.startsWith("/auth")) return null;
  return path;
}

export function rememberPostAuthPath(path?: string): void {
  const intended =
    path ??
    (typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "");
  const safe = safePath(intended);
  if (!safe) return;
  try {
    sessionStorage.setItem(KEY, safe);
  } catch {
    /* storage unavailable — sign-in still works, it just lands home */
  }
}

export function consumePostAuthPath(): string | null {
  try {
    const stored = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return safePath(stored);
  } catch {
    return null;
  }
}

export function clearPostAuthPath(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
