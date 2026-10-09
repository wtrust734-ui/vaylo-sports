// ============================================================================
// SUBSCRIPTION FLAGS — the one derivation of "what can this athlete do"
// ----------------------------------------------------------------------------
// Extracted from SubscriptionContext so it can be tested without a database.
//
// The rules below mirror get_my_entitlements() exactly (verified against the
// live function body, 2026-09-30):
//
//   • plan_key / monthly_credit_allowance / unlimited_credits are returned
//     zeroed unless status ∈ ('active','trial') OR is_lifetime;
//   • 'expired' is computed server-side when expires_at/trial_ends_at passed;
//   • 'cancelled' is set by cancel_my_subscription() only when nothing paid-for
//     remains (no future period end) — access is already over;
//   • cancelling WITH a remaining period keeps status 'active' and sets
//     cancel_at_period_end — access continues until that date.
//
// So the client must treat exactly { active, trial } + lifetime as active.
// Treating 'cancelled' as active would show paid UI to an athlete whose access
// has already been revoked server-side.
// ============================================================================

/** Statuses the server honours as paid access. Must match the SQL checks. */
export const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["active", "trial"]);

export interface EntitlementRow {
  status: string;
  is_lifetime: boolean;
  cancel_at_period_end: boolean;
  monthly_credit_allowance: number;
  credit_rollover_limit: number;
  unlimited_credits: boolean;
}

export interface DerivedFlags {
  /** Paid access exists (or a lifetime purchase does). */
  active: boolean;
  /** The monthly credit refill may run for this athlete. */
  mayAutoRefill: boolean;
}

const positive = (n: unknown): boolean =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

export function deriveEntitlementFlags(e: EntitlementRow): DerivedFlags {
  const active = e.is_lifetime === true || ACTIVE_STATUSES.has(e.status);

  // The server's apply_credit_refill() independently refuses refill for
  // inactive rows, rows without allowance, and rows not yet due — this flag
  // only decides whether the CLIENT asks, so a false negative is harmless and
  // a false positive is stopped server-side anyway.
  const mayAutoRefill = active && positive(e.monthly_credit_allowance);

  return { active, mayAutoRefill };
}
