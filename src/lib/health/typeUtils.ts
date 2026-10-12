// ============================================================================
// TYPE HELPERS — a tiny, dependency-free shared shape library
// ----------------------------------------------------------------------------
// The app still has a few `unknown` → actual JavaScript values that every
// module keeps re-deriving by hand. Dropping them back here keeps parsers
// compile and lets callers write `value is string` once instead of
// `typeof value === "string"` in several places.
// ============================================================================

/** True when `value` can be used as a plain string: never null, never undefined. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}
