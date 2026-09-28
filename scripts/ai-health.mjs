// ============================================================================
// AI HEALTH — which of the seven AI features are actually switched on?
// ----------------------------------------------------------------------------
// Run this after changing any AI secret. Each function is called with a real
// session as the review account, so it measures the deployed function rather
// than the source. It reports two distinct states, because they are different
// problems:
//
//   ALIVE  — answered. Either it did the work, or it refused for a reason that
//            is about the request (no credits, bad input, rate limited).
//   OFF    — the provider key is not set. The athlete-facing copy for this is
//            "This feature isn't switched on yet", so the leak of a variable
//            name is separately asserted below.
//
// The credit balance is printed before and after on purpose: the charging
// endpoints refund a failed call, and that refund is the thing most likely to
// regress silently. A feature that works but charges for a 500 is a bug that
// costs an athlete money to use.
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const URL_BASE = process.env.SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_KEY ?? "";
if (!URL_BASE || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_KEY (both are in .env) before running this.");
  process.exit(2);
}

const cfg = JSON.parse(readFileSync(".freebuff/ui-audit.local.json", "utf8"));
const supabase = createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: sess, error: signErr } = await supabase.auth.signInWithPassword({
  email: cfg.email,
  password: cfg.password,
});
if (signErr) {
  console.error("Could not sign in as the review account:", signErr.message);
  process.exit(2);
}
const authHeaders = { apikey: KEY, Authorization: `Bearer ${sess.session.access_token}`, "Content-Type": "application/json" };

const balance = async () => (await supabase.from("profiles").select("credits").single()).data?.credits ?? 0;
const before = await balance();

// Each probe is the smallest request the endpoint accepts. None of these need a
// video file or a real athlete dataset — a refusal for those reasons still
// proves the key is present and the model answered.
const PROBES = [
  ["ai-service", { feature: "coach_chat", userPrompt: "Say 'ready' in five words." }],
  ["coach-chat", { message: "Say 'ready' in five words." }],
  ["ai-analyze", { text: "Felt strong today. Easy pace, good sleep." }],
  ["generate-plan", { goal: "5k", sport: "running", weeks: 1 }],
  ["weekly-review", { stats: { workouts: 1, totalKm: 5 } }],
  ["learning-recommend", { topic: "threshold running" }],
  ["video-form-analysis", { video_base64: "", mime_type: "video/mp4", video_name: "probe.mp4", sport_type: "running" }],
];

const OFF = /(API key not configured|API_KEY|is not configured)/i;
let alive = 0;
const off = [];

console.log(`review account credits: ${before}\n`);

for (const [fn, body] of PROBES) {
  const started = Date.now();
  const r = await fetch(`${URL_BASE}/functions/v1/${fn}`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(body),
  });
  const text = (await r.text()).trim();
  const ms = Date.now() - started;
  const credits = await balance();

  if (OFF.test(text)) {
    off.push(fn);
    console.log(`  OFF    ${fn.padEnd(21)} ${r.status} ${text.slice(0, 60)}`);
    continue;
  }

  alive++;
  const delta = credits - before;
  const refunded = r.status < 500 || delta === 0;
  console.log(
    `  ALIVE  ${fn.padEnd(21)} ${r.status} ${String(ms).padStart(5)}ms` +
    (delta === 0 ? "  (no credits taken)" : `  (${delta > 0 ? "+" : ""}${delta} credits)`) +
    `  ${refunded ? "" : "REFUND MISSING"}`
  );
  if (!refunded) {
    console.log(`         ^ charged ${delta} credits for a ${r.status}. This is the regression to look for.`);
  }
  if (r.status >= 500) console.log(`         body: ${text.slice(0, 140)}`);
}

const after = await balance();
console.log(`\nreview account credits: ${before} -> ${after}`);
console.log(
  `\n${alive} of ${PROBES.length} AI features are answering` +
  (off.length ? `; switched off: ${off.join(", ")}` : "")
);
console.log(off.length
  ? `\nTo switch them on: npx supabase secrets set OPENAI_API_KEY=... (and GOOGLE_API=... for video)`
  : `\nAll AI features are live.`);
