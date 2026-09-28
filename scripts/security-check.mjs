// ============================================================================
// SECURITY REGRESSION CHECK
// ----------------------------------------------------------------------------
//   npm run security:check
//
// Five privilege paths in this backend were writable by any signed-in athlete
// and were closed in supabase/migrations/20260928183000_close_client_writable_privileges.sql.
// A migration is a one-time event; this is the standing assertion that they stay
// closed, because the failure mode is silent — nothing throws, the app just
// quietly gives things away.
//
// It signs in as a real account and then tries the things an attacker would
// try. Every probe is a NEGATIVE: each one must fail. Nothing here grants a
// credit, spends one, or writes a row that survives; the two probes that would
// have created data are the ones whose fix is the guard trigger and an RLS
// policy, both of which reject the write before it happens.
//
// Credentials come from UI_EMAIL/UI_PASSWORD or .freebuff/ui-audit.local.json,
// the same review account the UI audit uses. A test-only account is the right
// subject: a real athlete's data should never be the thing that proves a
// vulnerability is closed.
// ============================================================================

import { readFileSync } from "node:fs";

const env = readFileSync(".env", "utf8");
const envVar = (k) => ((env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "").trim().replace(/^["']|["']$/g, "");

const URL_BASE = envVar("VITE_SUPABASE_URL");
const ANON = envVar("VITE_SUPABASE_PUBLISHABLE_KEY");
if (!URL_BASE || !ANON) {
  console.error("security-check: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing from .env");
  process.exit(1);
}

let CREDS = { email: process.env.UI_EMAIL, password: process.env.UI_PASSWORD };
if ((!CREDS.email || !CREDS.password) && readFileSyncSafe(".freebuff/ui-audit.local.json")) {
  CREDS = { ...CREDS, ...JSON.parse(readFileSync(".freebuff/ui-audit.local.json", "utf8")) };
}
function readFileSyncSafe(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}
if (!CREDS.email || !CREDS.password) {
  console.error("security-check: no review-account credentials (UI_EMAIL/UI_PASSWORD or .freebuff/ui-audit.local.json)");
  process.exit(1);
}

const results = [];
const check = (name, passed, detail) => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "ok  " : "FAIL"}  ${name}\n      ${detail}\n`);
};

const restAnon = (path) =>
  fetch(`${URL_BASE}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });

// ---------------------------------------------------------------------------
// Unauthenticated: the publishable key alone must see nothing.
// ---------------------------------------------------------------------------
for (const [name, table] of [
  ["Anon cannot read profiles", "profiles?select=*"],
  ["Anon cannot read subscriptions", "subscriptions?select=*"],
  ["Anon cannot read the credit ledger", "credit_transactions?select=*"],
  ["Anon cannot read purchases", "user_purchases?select=*"],
]) {
  const r = await restAnon(table);
  const body = (await r.text()).trim();
  const rows = body.startsWith("[{") ? JSON.parse(body).length : 0;
  check(name, rows === 0, `HTTP ${r.status} · ${rows} rows`);
}

// ---------------------------------------------------------------------------
// Signed in: a normal athlete must not be able to grant themselves anything.
// ---------------------------------------------------------------------------
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(URL_BASE, ANON);
const { data: session, error } = await sb.auth.signInWithPassword(CREDS);
if (error) {
  console.error("security-check: sign-in failed —", error.message);
  process.exit(1);
}
const me = session.user.id;
const authHeaders = {
  apikey: ANON,
  Authorization: `Bearer ${session.session.access_token}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};
const patch = (body) =>
  fetch(`${URL_BASE}/rest/v1/profiles?user_id=eq.${me}`, { method: "PATCH", headers: authHeaders, body: JSON.stringify(body) });
const post = (table, body) =>
  fetch(`${URL_BASE}/rest/v1/${table}`, { method: "POST", headers: authHeaders, body: JSON.stringify(body) });

for (const [name, body] of [
  ["Cannot set own credits", { credits: 999999 }],
  ["Cannot set own coins", { coins: 999999 }],
  ["Cannot set own infinite_credits", { infinite_credits: true, infinite_credits_until: "2099-01-01T00:00:00Z" }],
]) {
  const r = await patch(body);
  const t = (await r.text()).trim();
  check(name, !r.ok, `HTTP ${r.status} · ${t.slice(0, 110)}`);
}

{
  const r = await post("credit_transactions", { user_id: me, amount: 1000000, reason: "forged", source: "reward:forged" });
  check("Cannot forge a credit transaction", !r.ok, `HTTP ${r.status} · ${(await r.text()).trim().slice(0, 110)}`);
}
{
  const r = await post("user_purchases", { user_id: me, product_id: "unlimited_monthly", product_type: "subscription" });
  check("Cannot write a purchase row", !r.ok, `HTTP ${r.status} · ${(await r.text()).trim().slice(0, 110)}`);
}
{
  // Must not grant anything: the 503 is the whole assertion, and the balance
  // afterwards proves it.
  const before = (await (await fetch(`${URL_BASE}/rest/v1/profiles?select=credits&user_id=eq.${me}`, { headers: authHeaders })).json())[0]?.credits;
  const r = await fetch(`${URL_BASE}/functions/v1/process-purchase`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ items: [{ product_id: "pack_500", product_type: "credits" }], platform: "web" }),
  });
  const t = (await r.text()).trim();
  const after = (await (await fetch(`${URL_BASE}/rest/v1/profiles?select=credits&user_id=eq.${me}`, { headers: authHeaders })).json())[0]?.credits;
  const refused = r.status === 503 && /payments_not_available/.test(t);
  check(
    "A money-priced product is refused without payment proof",
    refused && before === after,
    `HTTP ${r.status} · balance ${before} -> ${after} · ${t.slice(0, 90)}`
  );
}

{
  // A streak is counted by touch_streak(), which clamps the athlete's local day
  // and applies the grace-day and freeze rules. The client only ever needs to
  // read it. Asserted by effect, not by status: with no UPDATE policy a PATCH
  // that matches no permitted row returns 200 with an empty array rather than
  // an error, so a status-code assertion here would pass on a write that
  // silently did nothing — and would also have passed before the fix.
  const before = (await (await fetch(`${URL_BASE}/rest/v1/streaks?select=current_streak&user_id=eq.${me}`, { headers: authHeaders })).json())[0]?.current_streak ?? 0;
  await fetch(`${URL_BASE}/rest/v1/streaks?user_id=eq.${me}`, { method: "PATCH", headers: authHeaders, body: JSON.stringify({ current_streak: 5000 }) });
  const after = (await (await fetch(`${URL_BASE}/rest/v1/streaks?select=current_streak&user_id=eq.${me}`, { headers: authHeaders })).json())[0]?.current_streak ?? 0;
  check("Cannot set own streak", before === after, `current_streak ${before} -> ${after} after asking for 5000`);

  await fetch(`${URL_BASE}/rest/v1/streaks`, { method: "POST", headers: authHeaders, body: JSON.stringify({ user_id: me, current_streak: 9999, longest_streak: 9999 }) });
  const after2 = (await (await fetch(`${URL_BASE}/rest/v1/streaks?select=current_streak&user_id=eq.${me}`, { headers: authHeaders })).json())[0]?.current_streak ?? 0;
  check("Cannot insert a streak", after2 === after, `current_streak still ${after2} after inserting 9999`);
}

{
  // checkAndAwardMilestones inserts a medal client-side, so the INSERT stays.
  // What the client may not do is assert when it was earned or how many people
  // shared it. Inserted with both claims set to something absurd, then deleted:
  // the delete policy is the owner's, so this leaves nothing behind.
  const r = await post("achievements", {
    user_id: me,
    type: "points",
    title: "security-check probe",
    description: "deleted immediately",
    icon: "star",
    earned_at: "2000-01-01T00:00:00Z",
    share_count: 100000,
  });
  const t = (await r.text()).trim();
  let ok = false;
  let detail = `HTTP ${r.status} · ${t.slice(0, 100)}`;
  if (t.startsWith("[{")) {
    const row = JSON.parse(t)[0];
    const year = new Date(row.earned_at).getUTCFullYear();
    ok = year > 2020 && row.share_count === 0;
    detail = `HTTP ${r.status} · earned_at ${year} (asked for 2000) · share_count ${row.share_count} (asked for 100000)`;
    await fetch(`${URL_BASE}/rest/v1/achievements?title=eq.security-check probe`, { method: "DELETE", headers: authHeaders });
  }
  check("An achievement cannot claim its own date or share count", ok, detail);
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.passed);
console.log(`security-check: ${failed.length ? `FAIL (${failed.length})` : `PASS (${results.length} checks)`}`);
for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
process.exit(failed.length ? 1 : 0);
