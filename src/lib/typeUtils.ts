// ============================================================================
// TYPE HELPERS — a tiny, dependency-free shared shape library
// ----------------------------------------------------------------------------
// The app still has a few `unknown` → actual JavaScript values that every
// module keeps re-deriving by hand. Dropping them back here keeps the parser
// tests compile and lets the caller write `value is string` once instead of
// `typeof value === "string"` in three callsites.
// ============================================================================

/** True when `value` can be used as a plain string: never null, never undefined. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}
