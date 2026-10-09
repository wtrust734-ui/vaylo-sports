// ============================================================================
// PLAN E2E — does a real session get a real plan, and how long did it take?
// ----------------------------------------------------------------------------
// The unit tests in the app can prove the prompt, the periodisation and the
// refund bookkeeping are right, but none of them can prove the deployed
// function writes a plan an athlete can train from. This script signs in as the
// review account and asks the live endpoints for one, then prints the two
// numbers that actually matter to the athlete:
//
//   * wall-clock time, because "the plan took minutes" is the complaint this
//     flow exists to answer, and
//   * the credits before and after, because a plan that costs credits and does
//     not arrive is the worst failure this app has (see scripts/ai-health.mjs,
//     which watches the same thing for every AI feature).
//
// Usage:
//   node --env-file=.env scripts/plan-e2e.mjs            # 1 week, + a 10-credit edit
//   WEEKS=12 SKIP_EDIT=1 node --env-file=.env scripts/plan-e2e.mjs
//
// It spends real credits (20/week for the plan, 10 for a week edit), so run it
// against the review account, not an athlete's.
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const URL_BASE = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const WEEKS = Number(process.env.WEEKS ?? 1);
const SKIP_EDIT = process.env.SKIP_EDIT === "1";

if (!URL_BASE || !KEY) {
  console.error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (both are in .env) before running this.");
  process.exit(2);
}
if (!Number.isInteger(WEEKS) || WEEKS < 1 || WEEKS > 52) {
  console.error("WEEKS must be a whole number between 1 and 52.");
  process.exit(2);
}

const cfg = JSON.parse(readFileSync(".freebuff/ui-audit.local.json", "utf8"));
const supabase = createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: sess, error } = await supabase.auth.signInWithPassword({ email: cfg.email, password: cfg.password });
if (error) {
  console.error("Could not sign in as the review account:", error.message);
  process.exit(2);
}

const headers = { apikey: KEY, Authorization: `Bearer ${sess.session.access_token}`, "Content-Type": "application/json" };
const balance = async () => (await supabase.from("profiles").select("credits").single()).data?.credits ?? null;

const call = async (fn, body) => {
  const started = Date.now();
  const r = await fetch(`${URL_BASE}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body: reported below */ }
  return { status: r.status, ms: Date.now() - started, json, text };
};

const before = await balance();
console.log(`review account credits: ${before}`);
console.log(`asking for a ${WEEKS}-week plan...`);

const gen = await call("generate-plan", {
  sport: "running",
  goal: "run a faster 5k",
  level: "intermediate",
  duration_weeks: WEEKS,
  userLocale: "en",
  age: 24,
});

const weeks = gen.json?.plan_data ?? [];
// The whole plan, or none of it: a week with six days is a plan the athlete
// cannot follow, and the function is meant to reject that rather than return it.
const shortWeeks = weeks.filter((w) => !Array.isArray(w.sessions) || w.sessions.length !== 7);
const after = await balance();

console.log(
  `generate-plan: ${gen.status} in ${gen.ms}ms  weeks=${weeks.length}/${WEEKS}` +
  `  malformedWeeks=${shortWeeks.length}  cost=${gen.json?.cost ?? "-"}  credits=${after}`,
);
if (gen.status !== 200) console.log(`  body: ${gen.text.slice(0, 200)}`);
if (after !== null && before !== null && after > before) console.log("  + credits arrived during the call — a refund landed");
if (after !== null && before !== null && after < before && gen.status !== 200) {
  console.log("  CREDITS TAKEN WITHOUT A PLAN — the refund did not land");
}

if (!SKIP_EDIT && gen.status === 200 && weeks.length > 0) {
  const edit = await call("edit-plan", {
    scope: "week",
    week: 1,
    duration_weeks: WEEKS,
    instruction: "swap Thursday's run for a swim",
    sport: "running",
    level: "intermediate",
    userLocale: "en",
    weeks,
    request_id: `plan-e2e-${Date.now()}`,
  });
  const edited = edit.json?.weeks ?? [];
  console.log(
    `edit-plan:     ${edit.status} in ${edit.ms}ms  weeks=${edited.length} (asked for 1)` +
    `  weekNumbers=${edited.map((w) => w.week).join(",")}  cost=${edit.json?.cost ?? "-"}  credits=${await balance()}`,
  );
  if (edit.status !== 200) console.log(`  body: ${edit.text.slice(0, 200)}`);
}

const { data: tx } = await supabase
  .from("credit_transactions")
  .select("amount, reason, created_at")
  .order("created_at", { ascending: false })
  .limit(5);
console.log(`\nrecent ledger: ${(tx ?? []).map((t) => `${t.amount} ${String(t.reason).slice(0, 44)}`).join(" | ")}`);
