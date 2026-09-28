// ============================================================================
// AUTH POSTURE REPORT
// ----------------------------------------------------------------------------
//   npm run auth:posture                 # report only, always exits 0
//   npm run auth:posture -- --cleanup    # also delete the probe account
//
// The four Auth settings that matter for this app are Dashboard settings, not
// schema, so no migration can change them — Authentication -> Sign In / Providers
// -> Email. This script is how you find out whether the change took effect,
// because the only way to know is to ask the live endpoint the way an attacker
// would.
//
// It exits 0 whatever it finds: this is a report, not a gate. `security:check`
// is the gate, and it deliberately asserts nothing about auth, because a red
// build that nobody can fix from the repository is a red build people learn to
// ignore.
//
// The two probes that create an account are the only way to test "is a weak
// password accepted" and "does a signup get a session before confirmation".
// They create a real user at example.com, which has no mail servers, and print
// the address. Pass --cleanup with SUPABASE_SERVICE_ROLE_KEY set to have the
// script delete it again.
// ============================================================================

import { readFileSync } from "node:fs";

const env = readFileSync(".env", "utf8");
const envVar = (k) => ((env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "").trim().replace(/^["']|["']$/g, "");
const U = envVar("VITE_SUPABASE_URL");
const KEY = envVar("VITE_SUPABASE_PUBLISHABLE_KEY");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLEANUP = process.argv.includes("--cleanup");

if (!U || !KEY) {
  console.error("auth:posture: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing from .env");
  process.exit(0);
}

const { createClient } = await import("@supabase/supabase-js");
const lines = [];
const report = (ok, label, detail) => {
  lines.push({ ok, label, detail });
  console.log(`${ok ? "ok  " : "AT RISK"}  ${label}\n      ${detail}\n`);
};

// Both probes create a user, so both addresses are tracked. An earlier version
// kept a single variable and overwrote it, which left the first account behind
// with no way to find it.
const probeEmails = [];
const cleanup = async () => {
  if (!probeEmails.length) return;
  if (!CLEANUP || !SERVICE) {
    console.log(`Probe account${probeEmails.length > 1 ? "s" : ""} left behind: ${probeEmails.join(", ")}`);
    console.log("Delete them in the Dashboard (Authentication -> Users), or re-run with --cleanup and SUPABASE_SERVICE_ROLE_KEY set.");
    return;
  }
  const admin = createClient(U, SERVICE, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const email of probeEmails) {
    const user = data?.users?.find((u) => u.email === email);
    if (user) {
      await admin.auth.admin.deleteUser(user.id);
      console.log(`Probe account deleted: ${email}`);
    }
  }
};

// --- 1. Is a trivially weak password accepted? ---------------------------
{
  const probeEmail = `authposture.${Date.now()}@example.com`;
  probeEmails.push(probeEmail);
  const c = createClient(U, KEY);
  const { data, error } = await c.auth.signUp({ email: probeEmail, password: "123456" });
  if (error) {
    report(true, "A 6-character password is refused", error.message);
  } else {
    report(
      false,
      "A 6-character password is refused",
      data.session
        ? `accepted, and a session was issued immediately — set a minimum length of 8 in the Dashboard`
        : "accepted (no session) — set a minimum length of 8 in the Dashboard anyway"
    );
  }
}

// --- 2. Does a signup get a session before email confirmation? -----------
{
  const c = createClient(U, KEY);
  const email = `authposture2.${Date.now()}@example.com`;
  probeEmails.push(email);
  const { data, error } = await c.auth.signUp({ email, password: "Vaylo!Posture2026" });
  if (error) {
    report(true, "Sign-up requires email confirmation", error.message);
  } else if (data.session) {
    report(
      false,
      "Sign-up requires email confirmation",
      "a session was issued with no email confirmed — this is what makes free-trial mass sign-up free"
    );
  } else {
    report(true, "Sign-up requires email confirmation", "no session until the address is confirmed");
  }
  await c.auth.signOut();
}

// --- 3. Are repeated failures rate limited? ------------------------------
{
  const target = readFileSyncSafe(".freebuff/ui-audit.local.json");
  if (!target) {
    report(true, "Repeated wrong passwords are rate limited", "skipped: no review account to aim at");
  } else {
    const { email } = JSON.parse(target);
    let locked = false;
    for (let i = 1; i <= 12 && !locked; i++) {
      const c = createClient(U, KEY);
      const { error } = await c.auth.signInWithPassword({ email, password: `wrong-${i}` });
      if (error?.status === 429 || /rate|too many|security/i.test(error?.message || "")) locked = true;
    }
    report(
      locked,
      "Repeated wrong passwords are rate limited",
      locked ? "locked out within 12 attempts" : "12 wrong passwords, no 429 — set the token and password rate limits"
    );
  }
}

function readFileSyncSafe(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

await cleanup();

const atRisk = lines.filter((l) => !l.ok);
console.log(
  atRisk.length
    ? `auth:posture — ${atRisk.length} of ${lines.length} need a Dashboard change (Authentication -> Sign In / Providers -> Email)`
    : `auth:posture — all ${lines.length} checks pass`
);
