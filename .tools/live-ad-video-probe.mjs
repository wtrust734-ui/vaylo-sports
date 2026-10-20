import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").trim().split(/\r?\n/)
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => l.split(/=(.*)/).slice(0, 2).map(v => v.replace(/^"|"$/g, "")))
);
const base = env.VITE_SUPABASE_URL.replace(/\/$/, "");
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const sessPath = ".preview-session.json";
const sess = JSON.parse(fs.readFileSync(sessPath, "utf8"));

const r = await fetch(base + "/auth/v1/token?grant_type=refresh_token", {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: key },
  body: JSON.stringify({ refresh_token: sess.refresh_token }),
});
const s = await r.json();
if (!s.access_token) {
  console.log("REFRESH_FAILED", r.status, JSON.stringify(s).slice(0, 300));
  process.exit(1);
}
fs.writeFileSync(sessPath, JSON.stringify({ ...sess, access_token: s.access_token, refresh_token: s.refresh_token }));

const call = (body, extraHeaders = {}) =>
  fetch(base + "/functions/v1/ad-video", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, ...extraHeaders },
    body: JSON.stringify(body),
  });

let res = await call({ action: "start", prompt: "test clip" });
console.log("noauth_start ->", res.status, (await res.text()).slice(0, 160));

res = await call(
  { action: "start", prompt: "A sprinter exploding out of the blocks at dawn", model: "veo-3.1-fast-generate-preview", durationSeconds: 8 },
  { Authorization: "Bearer " + s.access_token }
);
console.log("auth_start_no_confirm ->", res.status, JSON.stringify(await res.json()).slice(0, 500));

res = await call({ action: "bogus" }, { Authorization: "Bearer " + s.access_token });
console.log("bogus_action ->", res.status, (await res.text()).slice(0, 200));

res = await call({ action: "start", prompt: "x".repeat(2000), confirm: true }, { Authorization: "Bearer " + s.access_token });
console.log("long_prompt ->", res.status, (await res.text()).slice(0, 200));

res = await call({ action: "poll", operationId: "not-an-operation" }, { Authorization: "Bearer " + s.access_token });
console.log("bad_poll_id ->", res.status, (await res.text()).slice(0, 200));
