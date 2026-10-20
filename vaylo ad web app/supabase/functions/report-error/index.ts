import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { emailConfigured, sendMail } from "../_shared/email.ts";
import { json, readJsonBody, throttled } from "../_shared/guard.ts";

// ============================================================================
// report-error — the endpoint that makes a tester's crash reach a human
// ----------------------------------------------------------------------------
// The app runs in a WebView. When JavaScript throws there, the athlete sees an
// ErrorBoundary card and the only record is a line in logcat on a phone nobody
// is holding. This endpoint is where that line goes instead.
//
// What it does, in order:
//   1. rejects anything that is not a POST
//   2. parses a size-capped JSON body
//   3. validates each field against a closed set or a hard length cap
//   4. DERIVES the fingerprint here, from the error's own text
//   5. rate-limits per client address
//   6. upserts through record_app_error_report() with the service role — one row
//      per fingerprint per version, with a counter
//   7. emails the operator ONLY when a fingerprint is seen for the first time,
//      so a bug that 40 testers hit costs one email, not forty
//
// What it deliberately does NOT do:
//   * fail the request because mail failed. The row is already stored and
//     counted by then; a mail outage must cost a delayed notification, never a
//     lost report. The response says nothing about mail either way.
//   * accept a fingerprint from the client. A client that chose its own
//     grouping could bury real errors under a shared key or scatter one bug
//     across thousands of rows.
//   * store the client's address, or ask who the caller is. Unlike the website
//     forms there is no abuse investigation here that needs either, and a row in
//     this table is a shared counter for a failure across the whole tester
//     population — so an account identifier on it would make the row personal
//     data of whoever reported it first while giving deletion and export no
//     honest answer about it. A report identifies the FAILURE: build, screen,
//     platform, browser string.
//   * claim to catch everything. This covers JavaScript: uncaught errors,
//     unhandled rejections, React render errors. A native crash — the Kotlin
//     side, or the WebView process dying — never reaches JavaScript at all and
//     is reported by Play Console's own Android vitals instead.
//
// Why this is safe to expose without a JWT: the caller is a device that may be
// signed out (a failure at sign-in is exactly the kind that matters), so there
// is no session to present. The structural protections are the caps below, the
// closed sets, the fingerprint upsert — which means a replay flood cannot add
// rows, only a counter — and the per-address throttle. The most a successful
// call can do is add one row, or bump one counter.
// ============================================================================

/** Closed sets. A value outside these is a request that is not from this app. */
const SOURCES = ["error", "rejection", "react"] as const;
const PLATFORMS = ["native", "web"] as const;

type Source = (typeof SOURCES)[number];
type Platform = (typeof PLATFORMS)[number];

/** Field caps. Identical to the constraints on app_error_reports. */
const MAX_NAME = 120;
const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;
const MAX_SCREEN = 200;
const MAX_VERSION = 40;
const MAX_UA = 300;

/** Where a new failure is announced. The one inbox the operator reads. */
const OPERATOR_EMAIL = "vaylosportssupport@gmail.com";

/**
 * The shapes that make an error message different every time it happens.
 *
 * Without this, "Failed to fetch for user 8f3a1b2c-…" and "Failed to fetch for
 * user 91d0ee77-…" are two fingerprints, so one bug becomes a thousand rows and
 * the queue is useless. Ids, long hex runs, URLs and multi-digit numbers become
 * placeholders. Three or more digits, not one: a message that says "Expected 4
 * arguments" is telling us something, and folding it into "<n>" would hide it.
 */
function normalize(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<id>")
    .replace(/https?:\/\/[^\s"']+/gi, "<url>")
    .replace(/\b\d{3,}\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** What the row and the notification both key on. Derived, never accepted. */
export async function fingerprintFor(name: string, message: string, screen: string): Promise<string> {
  const hex = await sha256Hex(`${name}|${normalize(message)}|${screen}`);
  return hex.slice(0, 32);
}

/** Trimmed string within a cap, or null. */
function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Same, but a missing value is a rejection rather than a null. */
function required(value: unknown, max: number): string | null {
  return clean(value, max);
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

interface Report {
  fingerprint: string;
  source: Source;
  name: string;
  message: string;
  stack: string | null;
  screen: string | null;
  platform: Platform;
  appVersion: string;
  userAgent: string | null;
}

/**
 * Tell the operator about a failure nobody has seen before.
 *
 * Every line is capped before it is mailed: this text ends up in an inbox, and
 * an error message is attacker-influenced input even if it came from our own
 * app. Nothing here is HTML — plain text only — so there is no markup to inject.
 */
async function notifyOperator(report: Report): Promise<boolean> {
  if (!emailConfigured()) return false;

  const text = [
    "Vaylo Sports — a new app failure was reported",
    "",
    `${report.name}: ${report.message}`,
    "",
    `First seen:  ${new Date().toISOString()}`,
    `Source:      ${report.source}`,
    `Screen:      ${report.screen ?? "(unknown)"}`,
    `Build:       ${report.appVersion} · ${report.platform}`,
    `Fingerprint: ${report.fingerprint}`,
    "",
    report.stack ? "--- first frames ---" : "",
    report.stack ?? "",
    "",
    "---",
    "This is the first report of this failure. Repeats are counted in",
    "app_error_reports.occurrences without sending another email, so a bug",
    "40 testers hit costs one message. Triage at /admin/errors.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  try {
    await sendMail({
      to: OPERATOR_EMAIL,
      subject: `Vaylo Sports: app failure — ${report.name}: ${report.message.slice(0, 80)}`,
      text,
    });
    return true;
  } catch (error) {
    // The report is already stored and counted. A mail failure must never turn
    // into a failed request the client would retry forever.
    console.error("report-error: failed to email operator", error);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const payload = await readJsonBody(req);
  if (!payload) return json({ error: "bad_request" }, 400);

  const name = required(payload.name, MAX_NAME);
  const message = required(payload.message, MAX_MESSAGE);
  if (!name || !message) return json({ error: "missing_error" }, 400);

  const source = SOURCES.includes(payload.source as Source) ? (payload.source as Source) : null;
  if (!source) return json({ error: "invalid_source" }, 400);

  const platform = PLATFORMS.includes(payload.platform as Platform) ? (payload.platform as Platform) : null;
  if (!platform) return json({ error: "invalid_platform" }, 400);

  const appVersion = required(payload.app_version, MAX_VERSION);
  if (!appVersion) return json({ error: "missing_app_version" }, 400);

  const screen = clean(payload.screen, MAX_SCREEN);
  const report: Report = {
    fingerprint: await fingerprintFor(name, message, screen ?? ""),
    source,
    name,
    message,
    stack: clean(payload.stack, MAX_STACK),
    screen,
    platform,
    appVersion,
    userAgent: clean(req.headers.get("user-agent"), MAX_UA),
  };

  // The shared helper's window is 20 per minute per key. Per-isolate, so it
  // resets on a cold start and is not shared between instances: it exists to
  // turn away a flood without a database round trip, and the fingerprint upsert
  // is what actually bounds the table.
  if (throttled(`${clientIp(req)}|report-error`)) {
    return json({ error: "rate_limited" }, 429);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await admin.rpc("record_app_error_report", {
    p_fingerprint: report.fingerprint,
    p_app_version: report.appVersion,
    p_name: report.name,
    p_message: report.message,
    p_stack: report.stack,
    p_screen: report.screen,
    p_platform: report.platform,
    p_user_agent: report.userAgent,
    p_seen_at: new Date().toISOString(),
  });

  if (error) {
    // The client never retries on this — it stores the report locally instead
    // and tries again on the next launch, so a database blip costs a delay.
    console.error("report-error: record failed", error.message);
    return json({ error: "store_failed" }, 500);
  }

  // SECURITY INVOKER functions returning a table come back as a one-row set.
  const row = (Array.isArray(data) ? data[0] : data) as { was_new?: boolean; times_seen?: number } | null;

  if (row?.was_new) await notifyOperator(report);

  return json({ ok: true, first: row?.was_new === true, times_seen: row?.times_seen ?? 1 });
});
