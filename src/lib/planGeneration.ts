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

/** The per-call generation cost used by `expectedPlanSeconds` for one-week chunks. */
export const EXPECTED_PER_CALL_SECONDS = 24;
/** The per-week merge/payload term used by `expectedPlanSeconds`. */
export const EXPECTED_PER_WEEK_SECONDS = 1.2;
/** The fixed pre-call cost used by `expectedPlanSeconds`. */
export const EXPECTED_FIXED_SECONDS = 11;

const safeWeeks = (weeks: number): number =>
  Number.isFinite(weeks) ? Math.max(1, Math.min(52, Math.floor(weeks))) : 4;

/**
 * A guarded chunk size, for the same reason `safeWeeks` exists: the second
 * parameter is public too, and `Math.max(1, Math.floor(NaN))` is NaN, which
 * would make the whole estimate NaN and the bar jump to its ceiling. A bad
 * chunk size falls back to the one the server would really use.
 */
const safeChunk = (chunkWeeks: number, weeks: number): number =>
  Number.isFinite(chunkWeeks) ? Math.max(1, Math.floor(chunkWeeks)) : planChunkWeeks(weeks);

/** Chunk size for a plan of this length. Mirrors the server's rule exactly. */
export function planChunkWeeks(weeks: number): number {
  return safeWeeks(weeks) <= ONE_WEEK_CHUNK_MAX_WEEKS ? 1 : PLAN_CHUNK_WEEKS;
}

/**
 * Expected seconds to write a plan of `weeks` weeks.
 *
 * The server writes the plan in parallel chunks, so wall-clock time is set by
 * the slowest call, not the sum of the calls. The shape of each call is one
 * week up to twelve weeks, then two weeks beyond that, and each call's output
 * IS the plan's own text for those weeks — so the per-call term is dominated by
 * token generation, not by the number of calls.
 *
 * Measured against the deployed function: a one-week call regularly completes in
 * roughly 20-35s on a normal request, with occasional runs past that when the
 * provider is busy. The estimate below is deliberately on the high side of that
 * measured range, because the failure mode of an underestimate is an athlete who
 * believes their plan is stuck; the failure mode of an overestimate is a bar that
 * finishes early and waits, which is invisible. Past 1.5× its own estimate the
 * screen stops claiming a time at all and says the plan is taking longer than
 * usual — which is always the honest answer when the work outlasted the model.
 *
 * So: a fixed cost for the work that happens before any call (auth, charge,
 * dossier, skeleton, validation), a per-call generation cost that is the same for
 * every chunk because each chunk is one week for most plans, and a small per-week
 * term for the merge and the larger payloads on longer plans.
 */
export function expectedPlanSeconds(weeks: number, chunkWeeks = planChunkWeeks(weeks)): number {
  const total = safeWeeks(weeks);
  const perCall = safeChunk(chunkWeeks, total);
  // Fixed work before the first model call starts: auth, credit charge, dossier
  // fetch, skeleton build, caps, prompt assembly, and the final merge + validate.
  // 11s is on the high side of what those steps take; the merge is fast, the rest
  // is a few network round-trips.
  const fixed = 11;
  // Generation cost of ONE model call. One week per call is the fastest shape and
  // the one the server uses for the vast majority of plans, so this term is the
  // same for a 4-week plan and a 12-week plan. 24s sits at the high end of the
  // measured one-week range on the deployed function; longer calls (two-week
  // chunks) are bounded by the 90s cap below rather than by this term, and the
  // screen admits it is taking longer than usual if they overrun.
  const perCallSeconds = 24;
  // Small extra per written week for the merge and the larger payloads on longer
  // plans. This is what makes the estimate grow slowly with the plan length rather
  // than staying flat — but it stays small, because the calls are parallel.
  const perWeekSeconds = 1.2;
  const estimate = fixed + perCallSeconds + total * perWeekSeconds;
  return Math.max(MIN_EXPECTED_SECONDS, Math.min(90, Math.round(estimate)));
}

/**
 * How many chunk blocks the wait screen shows. Not a claim that each one
 * finishes in order — they run at the same time — just how many pieces of work
 * the plan is being written in.
 */
export function planChunkCount(weeks: number, chunkWeeks = planChunkWeeks(weeks)): number {
  const total = safeWeeks(weeks);
  return Math.max(1, Math.ceil(total / safeChunk(chunkWeeks, total)));
}
