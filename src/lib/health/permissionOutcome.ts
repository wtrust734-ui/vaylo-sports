// ============================================================================
// PERMISSION OUTCOME PARSER — turns the async health path's string messages
// back into the reads screens name.
// ----------------------------------------------------------------------------
// Older phone rows reported a partial grant as a plain message:
//
//   code    = "permission_partial"
//   message = "permission_partial:steps,sleep session"
//
// One of those rows is a flattened PHP/AJAX response, and it now comes in a
// single JSON element with a JSON array inside instead of a comma-joined
// message. The parser below accepts both shapes, plus the plain one-argument
// form, so both current senders parse to the same reads without another
// deploy.
// ============================================================================

import { isString } from "./typeUtils";

export type PermissionOutcome =
  | { kind: "partial"; missing: string[] }
  | { kind: "revoked"; missing: string[] }
  | { kind: null; missing: string[] };

export function permissionOutcome(input: unknown): PermissionOutcome {
  const source = typeof input === "string" ? input : (input as Record<string, unknown> | undefined);

  if (source === undefined || source === null) {
    return { kind: null, missing: [] };
  }

  // Whole-permission-list emptiness from the native plugin and the server
  // bridge. Both pin to the bare string "revoked" so stored consent clears.
  if (typeof source === "string") {
    if (source === "permission_revoked" || source === "permission_revoked:") {
      return { kind: "revoked", missing: [] };
    }
  }

  const code = (source as { code?: unknown }).code ?? undefined;
  const message = (source as { message?: unknown }).message ?? undefined;

  if (code === "permission_revoked" || message === "permission_revoked") {
    return { kind: "revoked", missing: [] };
  }

  // The plugin's message form is "permission_partial:steps,sleep session".
  // The old one-argument shape drops the code, and the flattened AJAX mode
  // packs the list into a JSON element instead of a comma-joined string.
  if (typeof message === "string" || typeof message === "object") {
    const partial = findPartial(message);

    if (partial !== null) {
      const missing = partial.trim();

      // JSON array: ["steps","sleep"]
      if (missing.startsWith("[") && missing.endsWith("]")) {
        try {
          const parsed = JSON.parse(missing.slice(1, -1)) as unknown[];
          return {
            kind: "partial",
            missing: parsed.filter(isString).map((name) => name.trim()).filter(Boolean),
          } as PermissionOutcome;
        } catch {
          // Not a valid list — this message carries no names we can trust.
          return { kind: "partial", missing: [] };
        }
      }

      // Plain comma-joined list, or a bare marker with no names.
      const plain = missing.split(",").map((name) => name.trim()).filter(Boolean);
      return { kind: "partial", missing: plain.length > 0 ? plain : [] };
    }
  }

  if (code === "permission_partial") {
    return { kind: "partial", missing: [] };
  }

  // Anything that is not a recognised permissions outcome is returned as
  // `kind: null` so a sync or availability failure cannot be read as
  // permissions missing.
  return { kind: null, missing: [] };
}

/** First `permission_partial:...` token inside an object or a raw string. */
function findPartial(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/permission_partial:(.*)/);
    return match?.[1]?.trim() ?? null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  // JSON-object message from the flattened AJAX path carries the list inside
  // a single element instead of a comma-joined message.
  if (typeof record.message === "string") {
    const match = record.message.match(/permission_partial:(.*)/);
    if (match) return match[1].trim();
  }

  if (typeof record.code === "string" && record.code === "permission_partial") {
    return "";
  }

  // Old style: object { code, message }
  if (typeof record.code === "string" && typeof record.message === "string") {
    const match = record.message.match(/permission_partial:(.*)/);
    if (match) return match[1].trim();
  }

  return null;
}
