// ============================================================================
// READING A JWT'S CLAIMS — the base64URL trap, in one place
// ----------------------------------------------------------------------------
// A JWT segment is base64URL, not base64: `-` and `_` stand in for `+` and `/`,
// and the segment is not padded. `atob` accepts none of that, so a bare
// `JSON.parse(atob(token.split(".")[1]))` throws for any token whose payload
// happens to contain those characters — a large fraction of real tokens, not a
// rare edge. That trap cost this app two things:
//
//   * delete-account answered 403 reauth_required, which turns a coin flip on
//     the payload's bytes into "you cannot delete your account" — a published
//     capability, offered in the terms banner, with no way forward;
//   * export-my-data swallowed the same throw and carried on, so a bulk read of
//     everything about an athlete silently lost the freshness check it was
//     written for.
//
// waitlist-broadcast was the only function that got it right (translate, pad,
// then decode). That is now this module, and the three call sites use it.
//
// Nothing here verifies a signature. Every caller relies on the gateway's
// verify_jwt, or on `admin.auth.getUser(token)`, having already done that; this
// only reads claims off a token that is known to be genuine.
// ============================================================================

/** The claims of a JWT, or null for anything that is not a readable JWT. */
export function jwtClaims(token: string): Record<string, unknown> | null {
  const segment = typeof token === "string" ? token.split(".")[1] : undefined;
  if (!segment) return null;

  try {
    // base64URL → base64, then pad. Without both steps `atob` throws on `-`,
    // `_`, or a length that is not a multiple of four.
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `iat` in seconds since the epoch, or null when it is absent or unreadable. */
export function jwtIssuedAt(token: string): number | null {
  const issuedAt = Number(jwtClaims(token)?.iat);
  return Number.isFinite(issuedAt) && issuedAt > 0 ? issuedAt : null;
}

/** How long ago the token was issued, in seconds, or null when that is unknown. */
export function jwtAgeSeconds(token: string, now: number = Date.now()): number | null {
  const issuedAt = jwtIssuedAt(token);
  return issuedAt === null ? null : Math.floor(now / 1000) - issuedAt;
}

/** The token's `role` claim, or "" when it cannot be read. */
export function jwtRole(token: string): string {
  const role = jwtClaims(token)?.role;
  return typeof role === "string" ? role : "";
}
