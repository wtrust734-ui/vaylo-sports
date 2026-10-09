// ============================================================================
// PLAN GENERATION — the estimate the progress bar runs on
// ----------------------------------------------------------------------------
// Creating a plan is one long request, and the server does not stream progress,
// so the wait screen needs an estimate: how long this plan is expected to take,
// which sets how fast the bar moves before it settles and how long "still
// working" takes to appear.
//
// It lives here, pure and tested, rather than inside the component, because it
// encodes a real fact about the server. `generate-plan` writes the plan in
// PARALLEL chunks (see `supabase/functions/_shared/planPeriodisation.ts`), and
// every chunk is in flight at once, so the wall clock is the time the SLOWEST
// chunk takes — which grows with the weeks INSIDE a chunk, not with the number
// of chunks. One week per call is therefore the fastest shape, and the server
// uses exactly that up to twelve weeks.
//
// Measured against the deployed function: ~27s for a one-week call, ~55s for a
// two-week one. So the model here is a fixed cost per call plus a per-week
// writing cost, and the per-week term below is deliberately generous. The
// failure mode of an underestimate is an athlete who believes their plan is
// stuck; the failure mode of an overestimate is a bar that finishes early and
// waits, which is invisible.
// ============================================================================

/**
 * Weeks per call, mirrored from the server's `planChunkWeeks`. Guarded by
 * `planGeneration.test.ts`, which imports the server's own constants — a client
 * predicting a different shape from the one the server runs is a progress bar
 * that lies about the wait.
 */
export const ONE_WEEK_CHUNK_MAX_WEEKS = 12;
export const PLAN_CHUNK_WEEKS = 2;

/** Ignores anything below this — a plan is never instant, so never claim it is. */
export const MIN_EXPECTED_SECONDS = 12;

const safeWeeks = (weeks: number): number =>
  Number.isFinite(weeks) ? Math.max(1, Math.min(52, Math.floor(weeks))) : 4;

/** Chunk size for a plan of this length. Mirrors the server's rule exactly. */
export function planChunkWeeks(weeks: number): number {
  return safeWeeks(weeks) <= ONE_WEEK_CHUNK_MAX_WEEKS ? 1 : PLAN_CHUNK_WEEKS;
}

/**
 * Expected seconds to write a plan of `weeks` weeks.
 *
 * ~9s of fixed work (auth, charge, dossier, phase skeleton, validation) plus
 * ~12s of fixed cost in each model call plus ~16s per week written — the
 * slowest call, not their sum — plus a small per-week term for the merge and
 * the larger payloads. Capped, because past this the screen stops claiming to
 * know and switches to "still working".
 */
export function expectedPlanSeconds(weeks: number, chunkWeeks = planChunkWeeks(weeks)): number {
  const total = safeWeeks(weeks);
  const perCall = Math.max(1, Math.floor(chunkWeeks));
  const estimate = 9 + 12 + perCall * 16 + total * 0.6;
  return Math.max(MIN_EXPECTED_SECONDS, Math.min(90, Math.round(estimate)));
}

/**
 * How many chunk blocks the wait screen shows. Not a claim that each one
 * finishes in order — they run at the same time — just how many pieces of work
 * the plan is being written in.
 */
export function planChunkCount(weeks: number, chunkWeeks = planChunkWeeks(weeks)): number {
  const total = safeWeeks(weeks);
  return Math.max(1, Math.ceil(total / Math.max(1, Math.floor(chunkWeeks))));
}
