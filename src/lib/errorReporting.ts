// ============================================================================
// FIRST-PARTY FAILURE REPORTING
// ----------------------------------------------------------------------------
// A closed test produces failures nobody is watching for: a plugin that throws
// inside an event handler, a fetch that outlives its component, a render that
// the boundary catches. The app's own backend records them (report-error →
// app_error_reports), because a third-party crash SDK would contradict the
// published privacy documents.
//
// Three rules shape everything here:
//
//   1. Nothing private leaves the device. Messages and stacks are redacted
//      before they are sent, and the redaction runs first, not on the way out.
//   2. A reporter must never throw. It runs while something else is already
//      broken, so every path is wrapped and the queue is a plain localStorage
//      array that survives a corrupted read.
//   3. One failure is one report. The same failure is sent at most once per
//      session and the session is capped, so a failing render loop cannot
//      become a request loop.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { isNative, loadPlugin } from "@/lib/platform";

export type ReportSource = "error" | "rejection" | "react";

export interface ErrorReport {
  source: ReportSource;
  name?: string | null;
  message: string;
  stack?: string | null;
}

interface ReportBody {
  source: ReportSource;
  name: string;
  message: string;
  stack: string;
  screen: string;
  platform: "native" | "web";
  app_version: string;
  user_agent: string;
}

/** Where an undelivered report waits. Versioned so a shape change is a new key. */
const QUEUE_KEY = "vaylo.errorReports.pending.v1";

/** A phone is not a log server: keep only the last few failures. */
const MAX_QUEUED = 5;

/** Per session. A failing render loop must not become a request loop. */
const MAX_PER_SESSION = 15;

const MAX_NAME = 200;
const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;

/** Failures already sent this session, keyed by source + name + message. */
const sentThisSession = new Set<string>();
let sessionCount = 0;
let installed = false;

/** Test seam: the module keeps process-lifetime state, which leaks between cases. */
export function __resetErrorReportingForTests(): void {
  sentThisSession.clear();
  sessionCount = 0;
  installed = false;
}

/**
 * Removes anything that must not leave the device, collapses the result to one
 * line, and caps it.
 *
 * Ordered deliberately: credentials first (so a bearer token is named as one
 * before the generic blob rule can swallow it), then identifiers, then URLs —
 * whose query string is exactly where a reset or OAuth token lives.
 */
export function redact(value: unknown, max = MAX_MESSAGE): string {
  if (typeof value !== "string") return "";
  let out = value;
  // Authorization headers, in the form they appear in a thrown fetch error.
  out = out.replace(/Bearer\s+[^\s;,]+/gi, "Bearer <token>");
  // JWTs are the shape a Supabase access token takes.
  out = out.replace(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<jwt>");
  // Publishable / secret API keys.
  out = out.replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "<key>");
  // Somebody's address.
  out = out.replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "<email>");
  // Keep the path, drop the query: that is where the codes are.
  out = out.replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, "$1?<redacted>");
  // Long unbroken runs: image payloads, hashes, base64 blobs.
  out = out.replace(/[A-Za-z0-9+/=_-]{48,}/g, "<blob>");
  out = out.replace(/\s+/g, " ").trim();
  return out.slice(0, max);
}

/**
 * A route, not a URL: `/coach/8f3a…` is the coach screen, and every athlete's
 * copy of it is the same screen.
 */
export function normalizeScreen(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  let out = value.split("?")[0].split("#")[0];
  out = out.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "<id>",
  );
  out = out.replace(/\/\d+(?=\/|$)/g, "/<id>");
  return out.slice(0, 200);
}

/** Where the build came from: the installed manifest, or the word "web". */
async function describeInstall(): Promise<{ platform: "native" | "web"; app_version: string }> {
  if (!isNative()) return { platform: "web", app_version: "web" };
  try {
    // Through lib/platform's loader, never a bare `@capacitor/app` import: it is
    // the project's one way into a plugin and it settles the thenable trap.
    const App = await loadPlugin<{ getInfo: () => Promise<{ version?: string }> }>("app");
    if (!App || typeof App.getInfo !== "function") {
      return { platform: "native", app_version: "native" };
    }
    const info = await App.getInfo();
    return { platform: "native", app_version: info?.version || "native" };
  } catch {
    return { platform: "native", app_version: "native" };
  }
}

function readQueue(): ReportBody[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReportBody[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: ReportBody[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUED)));
  } catch {
    // Storage full or blocked: the report is lost, the app is not.
  }
}

function enqueue(body: ReportBody): void {
  const items = readQueue();
  items.push(body);
  writeQueue(items);
}

async function deliver(body: ReportBody): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke("report-error", { body });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Retries whatever could not be sent earlier. Called on install and safe to
 * call again; a corrupted queue is discarded rather than allowed to throw.
 */
export async function flushPendingReports(): Promise<void> {
  const items = readQueue();
  if (items.length === 0) {
    try {
      localStorage.setItem(QUEUE_KEY, "[]");
    } catch {
      // nothing to do
    }
    return;
  }

  const remaining: ReportBody[] = [];
  for (const item of items) {
    const ok = await deliver(item);
    if (!ok) remaining.push(item);
  }
  writeQueue(remaining);
}

/**
 * Records one failure. Fire-and-forget by contract: it returns nothing, awaits
 * nothing, and never throws — it runs while something else is already broken.
 */
export function reportError(report: ErrorReport): void {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!url || /vaylo-demo\.invalid/.test(url)) return;

    const message = redact(report.message, MAX_MESSAGE);
    if (!message) return;

    const name = redact(report.name, MAX_NAME) || "Error";
    const stack = redact(report.stack ?? "", MAX_STACK);
    const key = `${report.source}|${name}|${message}`;
    if (sentThisSession.has(key)) return;
    if (sessionCount >= MAX_PER_SESSION) return;
    sentThisSession.add(key);
    sessionCount += 1;

    void (async () => {
      const install = await describeInstall();
      const body: ReportBody = {
        source: report.source,
        name,
        message,
        stack,
        screen: normalizeScreen(typeof window !== "undefined" ? window.location.pathname : ""),
        platform: install.platform,
        app_version: install.app_version,
        user_agent:
          typeof navigator !== "undefined" ? String(navigator.userAgent).slice(0, 300) : "",
      };
      const ok = await deliver(body);
      if (!ok) enqueue(body);
    })();
  } catch {
    // a reporter must never throw; the app it watches is already in trouble.
  }
}

/**
 * Installs the one handler the app had nothing for: an error thrown from an
 * event handler or a plugin callback, which in a WebView vanishes silently.
 *
 * A failed resource load (an <img> or a lazy chunk) also fires `error`, but with
 * no Error object and no message — those are ignored, or every broken image
 * would bury the real failures.
 */
export function installGlobalErrorReporting(): boolean {
  if (typeof window === "undefined") return false;
  if (installed) return false;
  installed = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    const error = event?.error as Error | undefined;
    const message = event?.message;
    if (!error && !message) return;
    reportError({
      source: "error",
      name: error?.name ?? "Error",
      message: error?.message || String(message),
      stack: error?.stack ?? null,
    });
  });

  void flushPendingReports();
  return true;
}
