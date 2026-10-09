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
const localEnv = (() => {
  try { return readFileSync(".env.local", "utf8"); } catch { return ""; }
})();
const localEnvVar = (k) => ((localEnv.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "").trim().replace(/^["']|["']$/g, "");

const URL_BASE = envVar("VITE_SUPABASE_URL");
const ANON = localEnvVar("VITE_SUPABASE_PUBLISHABLE_KEY") || envVar("VITE_SUPABASE_PUBLISHABLE_KEY");
if (ANON && !ANON.startsWith("sb_publishable_")) {
  console.error("security-check: refusing a legacy JWT-shaped key; set VITE_SUPABASE_PUBLISHABLE_KEY to the rotatable sb_publishable_ key");
  process.exit(1);
}
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
    // The title contains a space, so it must be URL-encoded. Without this the
    // filter parsed as `title = 'security-check'` and matched nothing, so every
    // run of this script quietly left its probe row behind — ten had
    // accumulated on the review account before it was noticed.
    await fetch(`${URL_BASE}/rest/v1/achievements?title=eq.${encodeURIComponent("security-check probe")}`, { method: "DELETE", headers: authHeaders });
  }
  check("An achievement cannot claim its own date or share count", ok, detail);
}

{
  // A caller who invents a Play receipt must not buy credits with it. This is the
  // path that was open while PAYMENT_MODE=test: the function returned
  // `verified: true` without looking at anything, so one HTTP call with a
  // made-up token granted 650 credits. The forged token below is well-formed
  // and names a real product, so only a real verification can reject it.
  const before = (await (await fetch(`${URL_BASE}/rest/v1/profiles?select=credits&user_id=eq.${me}`, { headers: authHeaders })).json())[0]?.credits;
  const r = await fetch(`${URL_BASE}/functions/v1/process-purchase`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      items: [{ product_id: "pack_500", product_type: "credits" }],
      platform: "android",
      verification: {
        reference: `security-check-${Date.now()}`,
        receipt: JSON.stringify({ packageName: "app.vaylo.sports", productId: "pack_500", token: "forged" }),
      },
    }),
  });
  const t = (await r.text()).trim();
  const after = (await (await fetch(`${URL_BASE}/rest/v1/profiles?select=credits&user_id=eq.${me}`, { headers: authHeaders })).json())[0]?.credits;
  check("A forged Play receipt does not buy a credit pack", r.status === 503 && before === after,
    `HTTP ${r.status} · balance ${before} -> ${after} · ${t.slice(0, 80)}`);
}

// ---------------------------------------------------------------------------
// Official challenges (creator_id NULL) are content the whole app points at, so
// no athlete may rewrite them. An update matching zero RLS rows resolves without
// an error, so the count of returned rows is the evidence, not the absence of one.
{
  const id = "11111111-1111-4111-8111-111111111101";
  const r = await fetch(`${URL_BASE}/rest/v1/challenges?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...authHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ title: "security-check probe" }),
  });
  const body = await r.text();
  let changed = 0;
  try { changed = JSON.parse(body || "[]").length; } catch { /* non-JSON counts as 0 */ }
  check("An official challenge cannot be rewritten by an athlete", changed === 0,
    `HTTP ${r.status} · ${changed} rows changed`);
}

// ---------------------------------------------------------------------------
// Challenge progress is server-owned. A clamp inside an RPC is decoration if the
// column is writable beside it, and it was: an "update self" policy let an
// athlete PATCH their own row to any progress. That policy had no client caller
// — join is INSERT, leave is DELETE, progress is the RPC — so it is gone rather
// than narrowed.
{
  const CH = "11111111-1111-4111-8111-111111111102";
  await fetch(`${URL_BASE}/rest/v1/challenge_participants`, {
    method: "POST", headers: authHeaders,
    body: JSON.stringify({ challenge_id: CH, user_id: me }),
  }).then(async (r) => { if (!r.ok) return; }); // join; ignored either way
  const r = await fetch(
    `${URL_BASE}/rest/v1/challenge_participants?challenge_id=eq.${CH}&user_id=eq.${me}`,
    {
      method: "PATCH",
      headers: { ...authHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ progress: 99999, status: "completed" }),
    }
  );
  const body = r.ok ? await r.json() : [];
  const row = await (
    await fetch(`${URL_BASE}/rest/v1/challenge_participants?challenge_id=eq.${CH}&user_id=eq.${me}&select=progress`, { headers: authHeaders })
  ).json();
  check("Challenge progress cannot be written beside the RPC", (body?.length ?? 0) === 0 && Number(row?.[0]?.progress ?? 0) <= 5,
    `PATCH returned ${body?.length ?? 0} rows · progress ${row?.[0]?.progress ?? "none"} (target 5)`);
  await fetch(`${URL_BASE}/rest/v1/challenge_participants?challenge_id=eq.${CH}&user_id=eq.${me}`, { method: "DELETE", headers: authHeaders });
}

// ---------------------------------------------------------------------------
// A challenge creator cannot price their own reward, and cannot mint one that
// looks official or sponsored. Completion writes points_events from the
// challenge's own reward_points, so a client-chosen value is a client-chosen
// payout — and a fake "Vaylo official" challenge is phishing inside our own UI.
{
  const r = await fetch(`${URL_BASE}/rest/v1/challenges`, {
    method: "POST",
    headers: { ...authHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      creator_id: me,
      title: "security-check official-impersonation probe",
      type: "count",
      target_value: 1,
      target_unit: "workouts",
      is_official: true,
      sponsor_name: "security-check Brand",
      reward_credits: 9999,
      reward_points: 99999,
      scope: "weekly",
    }),
  });
  const rows = r.ok ? await r.json() : [];
  const row = rows?.[0];
  const spoofed = !!row && (row.is_official === true || !!row.sponsor_name || row.reward_points > 250 || row.reward_credits > 20);
  check("A challenge creator cannot mint an official, sponsored or over-priced one", !spoofed,
    row ? `created · is_official=${row.is_official} sponsor=${JSON.stringify(row.sponsor_name)} reward=${row.reward_credits}c/${row.reward_points}pt`
        : `refused · HTTP ${r.status}`);
  if (row) {
    await fetch(`${URL_BASE}/rest/v1/challenges?id=eq.${row.id}`, { method: "DELETE", headers: authHeaders });
  }
}

// ---------------------------------------------------------------------------
// An empty or id-less basket must be a 400, not a success. Granting nothing is
// safe; answering `{"success": true}` is not, because the client shows a success
// toast and the athlete learns to ignore the signal that a purchase failed.
{
  const bal0 = (await (await fetch(`${URL_BASE}/rest/v1/profiles?select=credits&user_id=eq.${me}`, { headers: authHeaders })).json())[0]?.credits;
  const seen = [];
  for (const body of [{}, { items: [] }, { items: [{ product_type: "credits" }] }]) {
    const r = await fetch(`${URL_BASE}/functions/v1/process-purchase`, {
      method: "POST", headers: authHeaders, body: JSON.stringify(body),
    });
    if (r.status === 200) seen.push(`HTTP 200 for ${JSON.stringify(body)}`);
  }
  const bal1 = (await (await fetch(`${URL_BASE}/rest/v1/profiles?select=credits&user_id=eq.${me}`, { headers: authHeaders })).json())[0]?.credits;
  check("An empty basket is a 400, not a success", seen.length === 0 && bal0 === bal1,
    seen.length ? seen.join(" | ") : `3 malformed baskets all refused · balance ${bal0} -> ${bal1}`);
}

// ---------------------------------------------------------------------------
// Database invariants added by 20260930070000_security_hardening_ownership_and_grants.
// Each probe must be REFUSED. Nothing inserted here can survive: every write
// below violates a CHECK, a UNIQUE index, an FK, or a revoked grant, and the
// duplicate-achievement probe cleans up after itself.
{
  // Zero-amount ledger rows are noise; CHECK amount <> 0 (and the INSERT grant
  // is revoked, so either way the write must fail).
  const r = await fetch(`${URL_BASE}/rest/v1/coin_transactions`, {
    method: "POST", headers: { ...authHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ amount: 0, reason: "security-check probe" }),
  });
  check("A client cannot insert a zero-amount ledger row", r.status >= 400, `HTTP ${r.status}`);

  // Negative recorded balance in the credit ledger.
  const r2 = await fetch(`${URL_BASE}/rest/v1/credit_transactions`, {
    method: "POST", headers: { ...authHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ amount: 1, reason: "security-check probe", balance_after: -5 }),
  });
  check("A client cannot record a negative balance_after", r2.status >= 400, `HTTP ${r2.status}`);

  // You cannot be your own friend.
  const r3 = await fetch(`${URL_BASE}/rest/v1/friendships`, {
    method: "POST", headers: { ...authHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: me, friend_id: me }),
  });
  check("A client cannot befriend themselves", r3.status >= 400, `HTTP ${r3.status}`);

  // One identical achievement per athlete: the second identical insert must hit
  // the UNIQUE index even though INSERT is otherwise allowed by RLS.
  const dupTitle = "security-check-dup-probe-x9";
  const dupHeaders = { ...authHeaders, Prefer: "return=minimal" };
  const first = await fetch(`${URL_BASE}/rest/v1/achievements`, {
    method: "POST", headers: dupHeaders,
    body: JSON.stringify({ user_id: me, type: "milestone", title: dupTitle, description: "probe" }),
  });
  const second = await fetch(`${URL_BASE}/rest/v1/achievements`, {
    method: "POST", headers: dupHeaders,
    body: JSON.stringify({ user_id: me, type: "milestone", title: dupTitle, description: "probe" }),
  });
  await fetch(`${URL_BASE}/rest/v1/achievements?title=eq.${dupTitle}&user_id=eq.${me}`, { method: "DELETE", headers: authHeaders });
  check("A duplicate achievement claim is rejected (one per athlete/type/title)",
    first.status < 400 && second.status >= 400,
    `first HTTP ${first.status} · duplicate HTTP ${second.status}`);

  // guard_achievement_claims is a trigger function, not an API: anon must not
  // be able to invoke it over REST.
  const r4 = await fetch(`${URL_BASE}/rest/v1/rpc/guard_achievement_claims`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: "{}",
  });
  check("Anon cannot call the guard_achievement_claims trigger function", r4.status >= 400, `HTTP ${r4.status}`);

  // has_unlimited_credits(otherUser) was an entitlement oracle about somebody
  // else; now revoked from clients.
  const r5 = await sb.rpc("has_unlimited_credits", { _user: me });
  check("has_unlimited_credits is no longer client-executable", !!r5.error, r5.error ? `refused · ${r5.error.message.slice(0, 80)}` : "returned a value");
}

// ---------------------------------------------------------------------------
// Friend messaging (20261008120000_friends_messaging_and_unfriend.sql).
// A message is friends-only, direction-proof about blocks, and readable by its
// two participants alone. None of that is enforced by a screen, so all of it is
// probed from the wire: the app is not the authority here, Postgres is.
{
  // A uuid nobody can be friends with, so every probe below is the negative
  // case the triggers exist for.
  const stranger = "00000000-0000-4000-8000-000000000000";

  // Anon holds no privilege on the table at all — a permission error, not an
  // empty list.
  const anonRead = await restAnon("direct_messages?select=id");
  check("Anon cannot read direct messages", anonRead.status >= 400, `HTTP ${anonRead.status}`);

  // ...and a signed-in athlete can read their own, so this is RLS rather than a
  // blanket refusal.
  const mine = await fetch(`${URL_BASE}/rest/v1/direct_messages?select=id&limit=1`, { headers: authHeaders });
  check("An athlete can read their own messages", mine.status === 200, `HTTP ${mine.status}`);

  // A message to somebody who is not a friend is refused by the trigger.
  const notFriend = await post("direct_messages", {
    sender_id: me, recipient_id: stranger, body: "security-check probe",
  });
  const nfText = (await notFriend.text()).trim();
  check("A message to somebody who is not a friend is refused",
    !notFriend.ok && /friends/i.test(nfText),
    `HTTP ${notFriend.status} · ${nfText.slice(0, 110)}`);

  // ...and so is one written as somebody else.
  const spoof = await post("direct_messages", {
    sender_id: stranger, recipient_id: me, body: "security-check probe",
  });
  const spText = (await spoof.text()).trim();
  check("A message cannot be sent as another athlete",
    !spoof.ok, `HTTP ${spoof.status} · ${spText.slice(0, 110)}`);

  // No UPDATE grant: a recipient cannot rewrite the words they were sent.
  const rewrite = await fetch(`${URL_BASE}/rest/v1/direct_messages?id=eq.${stranger}`, {
    method: "PATCH", headers: authHeaders,
    body: JSON.stringify({ body: "rewritten" }),
  });
  const rwText = (await rewrite.text()).trim();
  check("A message cannot be rewritten after it is sent",
    !rewrite.ok, `HTTP ${rewrite.status} · ${rwText.slice(0, 110)}`);

  // The two RPCs are callable by an athlete, and answer for a stranger without
  // changing anything.
  const u = await sb.rpc("unfriend", { p_friend_id: stranger });
  check("unfriend() is callable and refuses a non-friend",
    !u.error && u.data === false,
    u.error ? `refused · ${u.error.message.slice(0, 80)}` : `returned ${JSON.stringify(u.data)}`);

  const marked = await sb.rpc("mark_messages_read", { p_friend_id: stranger });
  check("mark_messages_read() is callable and changes nothing for a stranger",
    !marked.error && marked.data === 0,
    marked.error ? `refused · ${marked.error.message.slice(0, 80)}` : `returned ${JSON.stringify(marked.data)}`);
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.passed);
console.log(`security-check: ${failed.length ? `FAIL (${failed.length})` : `PASS (${results.length} checks)`}`);
for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
process.exit(failed.length ? 1 : 0);
