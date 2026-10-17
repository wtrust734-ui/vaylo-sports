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
  "form-analysis-summary", // given a user_id, returns the latest form-analysis report in a summary shape
  "leadeboard-summary",    // given a sport + tier, returns the top PBs the agent can reference when writing a hook
  "coach-catalog",         // lists the published coaching plans; the agent surfaces them as "edits/plans" for the athlete to buy

  // Write-through actions. The server computes money, prices and ids; the agent
  // never does arithmetic and never receives a secret.
  "form-analysis-run",     // upload a clip, run video-form-analysis through the existing function, return the report id
  "plan-edit-request",      // tell the coach what to change on an existing plan; written to the edit-plan queue
  "plan-delivery-write",    // mark a delivered plan for a paid order; server checks the order and the coach id
  "buy-coaching-plan",      // spend from the agent's wallet (coach credits) on a listing; server quotes and charges
  "leaderboard-bump",       // no-op placeholder: real leaderboard writes are server-side only
]);

/** Shared-secret check. A bare path hit that does not send the secret is 401
 *  and is never answered with anything that could help an attacker. */
export function requireSharedSecret(req: Request): { ok: true } | { ok: false; status: number } {
  const sent = req.headers.get("x-shared-secret");
  if (!sent) return { ok: false, status: 401 };
  if (sent !== getSharedSecret()) return { ok: false, status: 401 };
  return { ok: true };
}
