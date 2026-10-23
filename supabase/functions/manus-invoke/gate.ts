// ===========================================================================
// manus-invoke — gate
// ===========================================================================
// The shared-secret gate and the allowed-action catalogue live here, as pure
// module-level values and functions. They do not import the Supabase client and
// do not touch Deno.serve, so this file can be unit-tested beside the rest of
// `_shared` without a running edge runtime or any network access.
//
// The handler at index.ts imports from this module and shells out to the DB.

// NOTE: the shared secret must be set with `supabase secrets set`
// MANUS_SHARED_SECRET=…  (never a sk- style key; a shared secret is
// enough to identify the agent, and the vault keeps it out of the build).
/** The shared secret the operator set. When the env var is unset the gate is
 *  effectively closed, which is the deny-by-default behaviour the brief asks
 *  for; the tests below assert both the locked and unlocked shapes so the
 *  decision logic is covered either way. */
export function getSharedSecret(): string {
  if (typeof Deno !== "undefined" && Deno.env?.get) return Deno.env.get("MANUS_SHARED_SECRET") ?? "";
  return "";
}

/** The complete public surface the agent can trigger. Everything else is
 *  denied by default. */
export const ALLOWED_ACTIONS = new Set([
  // Read-only observations the agent runs to understand an athlete's form
  // and content before it decides to edit or post something.
  "form-analysis-summary", // returns the latest (or a named) form-analysis report in a summary shape
  "leaderboard-summary",   // given a sport, returns the top point totals the agent can reference when writing a hook
  "leadeboard-summary",    // historical misspelling kept as an alias of leaderboard-summary
  "coach-catalog",         // lists the published coaching plans; the agent surfaces them as "edits/plans" for the athlete to buy

  // Write-through actions. The server computes money, prices and ids; the agent
  // never does arithmetic and never receives a secret.
  "form-analysis-run",     // honestly refuses: the analysis runner is athlete-session-only (see index.ts)
  "plan-edit-request",      // records a real edit request: a notification row the plan's coach reads
  "plan-delivery-write",    // writes a real coach_deliveries row for a PAID order; coach/buyer ids are checked against the order
  "buy-coaching-plan",      // real purchase through the buy_coach_plan RPC: wallet debited server-side, idempotency enforced
  "leaderboard-bump",       // no-op placeholder: real leaderboard writes are server-side only

  // Video editing handoff — Manus 2.0 is the editor. Vaylo queues
  // ad_video_render_jobs with the full plan (signed https URLs for every clip,
  // narration and logo); the agent pulls pending jobs and reports the edit back:
  "render-jobs-fetch",      // read pending render jobs (plan + signed clip URLs) for the agent to edit
  "render-job-progress",   // claim a job for editing and push live progress (percent + stage) while working
  "render-job-result",     // report the edited file (storage path / public URL) or a failure for a pending job
]);

/** Shared-secret check. A bare path hit that does not send the secret is 401
 *  and is never answered with anything that could help an attacker. */
export function requireSharedSecret(req: Request): { ok: true } | { ok: false; status: number } {
  const sent = req.headers.get("x-shared-secret");
  if (!sent) return { ok: false, status: 401 };
  if (sent !== getSharedSecret()) return { ok: false, status: 401 };
  return { ok: true };
}
