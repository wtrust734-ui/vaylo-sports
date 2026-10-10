// ============================================================================
// errorReporting — make a failure on a tester's phone reach a human
// ----------------------------------------------------------------------------
// Why this exists.
//
// The app runs inside a WebView. When something throws there, the athlete sees
// an ErrorBoundary card or a toast, and the only record of what happened is a
// line in logcat on a phone nobody is holding. During a closed test that is the
// worst possible place for it: a tester says "it broke when I logged a set" and
// there is nothing to look at. This module sends the failure to the
// `report-error` edge function, which groups it by fingerprint.
//
// Three rules, in this order, and everything below is shaped by them.
//
//   1. IT NEVER THROWS. This code runs while something else is already broken.
//      A reporter that throws turns one failure into two; a reporter that
//      throws inside a rejection handler is a loop. Every path is wrapped, and
//      the public functions return void.
//
//   2. IT NEVER SENDS ANYTHING PRIVATE. No tokens, no session material, no
//      email addresses, no health values, no message bodies, no photo data. An
//      error report is not a data export, and a crash reporter is the classic
//      way personal data leaks out of an app that was careful everywhere else.
//      redact() strips the shapes that carry it; the server caps and
//      re-validates; and the screen is a route, never a URL with a query.
//
//   3. IT NEVER OVERSTATES VOLUME. Identical failures are sent once per
//      session, there is a hard cap per session, and the server counts repeats
//      against one row. A thousand reports of one bug is one bug, and a queue
//      nobody can read is not monitoring.
//
// What this deliberately is not: a third-party crash service. Sentry and
// Crashlytics would each need an account, a native SDK and a new data
// processor, and the published advertising and cookie documents promise this
// app has no analytics or error-reporting SDK. The reports go to the project's
// own backend, which is already a declared processor. See the migration
// 20261010120000_app_error_reports.sql for the long version.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { isNative, loadPlugin } from "./platform";

/** Where the closed set of sources is defined on the server too. */
export type ReportSource = "error" | "rejection" | "react";
export type ReportPlatform = "native" | "web";

export interface ReportInput {
  name: string;
  message: string;
  stack?: string | null;
  screen?: string | null;
  source: ReportSource;
}

interface ReportBody extends ReportInput {
  platform: ReportPlatform;
  app_version: string;
}

/** Identical failures are not sent twice in one session. */
const SESSION_CAP = 15;

/** Reports held for the next launch when the network is gone. Few on purpose. */
const QUEUE_CAP = 5;
const QUEUE_KEY = "vaylo.errorReports.pending.v1";

/** A failure that repeats every frame must not become a request every frame. */
const MAX_STACK = 4000;
const MAX_MESSAGE = 1000;

// ---------------------------------------------------------------------------
// Is there anywhere to send it?
// ---------------------------------------------------------------------------

/**
 * The downloadable web-app clone is built with a `.invalid` Supabase host so
 * that no backend call can leave the machine. There it would only ever fill
 * localStorage with reports that can never be delivered, so it does not even
 * try. Also false during SSR/tests, where there is no window.
 */
function enabled(): boolean {
  if (typeof window === "undefined") return false;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return false;
  return !url.includes(".invalid");
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Replace the shapes that carry secrets or identity with placeholders.
 *
 * The order matters: URLs are handled before the long-token rule (a token in a
 * query string is part of a URL), and JWTs before the generic base64 sweep.
 *
 * Where this errs, it errs towards removing too much. A stack line that says
 * `<blob>` is a little harder to read; a stack line carrying a session token is
 * a security incident, and there is no way to notice one after it is stored.
 */
function applyRedactions(text: string): string {
  return (
    text
      // "Authorization: Bearer eyJ…" — an error message can quote a whole request.
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <token>")
      // JWTs anywhere, including inside a nested error string.
      .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g, "<jwt>")
      // Supabase keys have a recognisable prefix and must never leave a device.
      .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{4,}/g, "<key>")
      // Email addresses: the address is not diagnostic information.
      .replace(/\b[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+\b/g, "<email>")
      // A URL keeps its origin and path and loses its query: the password-reset
      // and OAuth callbacks both carry their token in the query string.
      .replace(/https?:\/\/[^\s?#"']*(\?[^\s"']*)?/g, (match) => {
        const query = match.indexOf("?");
        return query === -1 ? match : `${match.slice(0, query)}?<redacted>`;
      })
      // Long unbroken alphanumeric runs: base64 photo data, hex digests,
      // several kinds of token. Not a hash of a stack frame, which is short.
      .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, "<blob>")
  );
}

/** Redact, collapse to one line, and cap. Exported for its own test. */
export function redact(text: unknown, max = MAX_MESSAGE): string {
  if (typeof text !== "string") return "";
  const redacted = applyRedactions(text).replace(/\s+/g, " ").trim();
  return redacted.slice(0, max);
}

/**
 * The route where it happened, with ids folded out, so /coach/8f3a-… and
 * /coach/91d0-… are the same screen. No query string and no hash: both can
 * carry a token (Supabase puts one in the reset and OAuth callbacks).
 */
export function normalizeScreen(path: string): string {
  return (
    path
      // Strip query and hash first — everything after them is suspect.
      .replace(/[?#].*$/, "")
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
      .replace(/\/\d+(?=\/|$)/g, "/<id>")
      .slice(0, 200)
  );
}

// ---------------------------------------------------------------------------
// Which build did this come from?
// ---------------------------------------------------------------------------

let contextPromise: Promise<{ platform: ReportPlatform; app_version: string }> | null = null;

/**
 * The two fields that decide whether a report is actionable: which shell, and
 * which build. `App.getInfo()` reads the installed version from the Android
 * manifest — the same number that ends up in the Play Console listing, not a
 * number this repository maintains in parallel.
 *
 * The read is memoized and bounded. If the plugin is slow or absent the report
 * still goes, labelled "unknown" — a report with a poor version field is worth
 * far more than no report.
 */
export function deviceContext(): Promise<{ platform: ReportPlatform; app_version: string }> {
  if (!contextPromise) {
    contextPromise = (async () => {
      // Not native: no version to read, and saying "web" is honest. The web build
      // is always the latest deploy, so a version field there would be noise.
      if (!isNative()) return { platform: "web" as ReportPlatform, app_version: "web" };
      try {
        // Through lib/platform, which is this project's one way into a Capacitor
        // plugin: it keeps the plugin out of the web bundle and it settles the
        // thenable trap that would otherwise make this await never return.
        const App = await loadPlugin<{ getInfo: () => Promise<{ version?: string }> }>("app");
        if (!App?.getInfo) return { platform: "native" as ReportPlatform, app_version: "unknown" };
        const info = await Promise.race([
          App.getInfo(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
        return {
          platform: "native" as ReportPlatform,
          app_version: (info?.version || "unknown").slice(0, 40),
        };
      } catch {
        return { platform: "native" as ReportPlatform, app_version: "unknown" };
      }
    })();
  }
  return contextPromise;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

let sent = 0;
const seen = new Set<string>();

/**
 * What counts as "the same failure" locally.
 *
 * Deliberately NOT the server's fingerprint, and not required to match it. The
 * server's is authoritative: it decides grouping, and it normalizes ids out so
 * one bug stays one row. This one only has to answer "have I already sent
 * something that looked exactly like this in this session", and the cheap
 * answer is the name plus the start of the message.
 */
function localKey(body: ReportBody): string {
  return `${body.source}|${body.name}|${body.message.slice(0, 120)}`;
}

function readQueue(): ReportBody[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed.slice(0, QUEUE_CAP) as ReportBody[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(next: ReportBody[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(next.slice(0, QUEUE_CAP)));
  } catch {
    /* storage full or unavailable — the report is lost, never an error */
  }
}

/** Best effort. Returns true when the server accepted it. */
async function deliver(body: ReportBody): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke("report-error", { body });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Send one report, or keep it for the next launch.
 *
 * A device that is offline is exactly the device whose failures are most
 * interesting, so a failed send is parked rather than dropped — but only a few,
 * and only until the next flush. There is no retry loop and no backoff: this
 * must not become a background task on a phone that is already struggling.
 */
async function send(body: ReportBody): Promise<void> {
  if (sent >= SESSION_CAP) return;
  const key = localKey(body);
  if (seen.has(key)) return;
  seen.add(key);
  sent++;
  if (await deliver(body)) return;
  writeQueue([...readQueue().filter((q) => localKey(q) !== key), body]);
}

/**
 * Send whatever the last session could not. Called when the reporter is
 * installed and when the device comes back online.
 */
export async function flushPendingReports(): Promise<void> {
  if (!enabled()) return;
  const queued = readQueue();
  if (queued.length === 0) return;
  const remaining: ReportBody[] = [];
  for (const body of queued) {
    // Flushing does not consume the session cap: these are reports already
    // counted in a previous one.
    if (!(await deliver(body))) remaining.push(body);
  }
  writeQueue(remaining);
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Report a failure. Fire and forget: the caller does not await, cannot get a
 * rejection, and does not get to find out whether it worked — nothing in the
 * app should change its behaviour because reporting is unavailable.
 */
export function reportError(input: ReportInput): void {
  try {
    if (!enabled()) return;
    const name = redact(input.name, 120) || "Error";
    const message = redact(input.message, MAX_MESSAGE);
    if (!message) return;
    const pending: ReportBody = {
      source: input.source,
      name,
      message,
      stack: input.stack ? redact(input.stack, MAX_STACK) : null,
      screen: input.screen ? normalizeScreen(input.screen) : normalizeScreen(window.location.pathname),
      platform: "web",
      app_version: "web",
    };
    void (async () => {
      try {
        const context = await deviceContext();
        await send({ ...pending, ...context });
      } catch {
        /* a reporter must never throw */
      }
    })();
  } catch {
    /* a reporter must never throw */
  }
}

/**
 * Listen for the two failure modes nothing else in the app catches.
 *
 * React render errors already have an ErrorBoundary, and rejections already
 * have a handler in main.tsx. What had no handler at all was `window.onerror`:
 * an uncaught error from inside an event handler — a click, a scroll, a
 * Capacitor plugin callback — which is where most of a user's session actually
 * runs. In the WebView that failure disappears without a toast.
 */
export function installGlobalErrorReporting(): void {
  if (!enabled()) return;
  try {
    window.addEventListener("error", (event) => {
      // A missing image or a failed lazy chunk also fires here, with a target
      // and no Error. Those are not stack-bearing failures and the app already
      // handles them; reporting them would drown the real ones.
      const error = (event as ErrorEvent).error;
      const message = (event as ErrorEvent).message;
      if (!error && !message) return;
      reportError({
        source: "error",
        name: error?.name || "Error",
        message: error?.message || message,
        stack: error?.stack ?? null,
      });
    });

    window.addEventListener("online", () => {
      void flushPendingReports();
    });

    void flushPendingReports();
  } catch {
    /* no window: nothing to report from */
  }
}

/** Test-only: forget this session's dedupe and counters. */
export function __resetErrorReportingForTests(): void {
  sent = 0;
  seen.clear();
  contextPromise = null;
}
