import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The reporter, exercised for real.
//
// This module is the only thing standing between a closed test and a silent
// failure, and its failure modes are all quiet: a report that leaks a token, a
// report that never leaves the device, a reporter that throws while something
// else is already broken, or a bug that arrives as two hundred rows because the
// same failure was sent every frame. Each of those is a test below.
const h = vi.hoisted(() => ({ native: false, invoke: vi.fn() }));

// The reporter reads the shell through lib/platform, which is the project's one
// way into a Capacitor plugin, so that is the seam these tests stand on.
vi.mock("@/lib/platform", () => ({
  isNative: () => h.native,
  loadPlugin: async (name: string) =>
    name === "app" ? { getInfo: async () => ({ version: "1.2.17" }) } : null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => h.invoke(...args) } },
}));

import {
  __resetErrorReportingForTests,
  flushPendingReports,
  installGlobalErrorReporting,
  normalizeScreen,
  redact,
  reportError,
} from "./errorReporting";

const QUEUE_KEY = "vaylo.errorReports.pending.v1";

const sentBodies = () => h.invoke.mock.calls.map((call) => (call[1] as { body: Record<string, unknown> }).body);

beforeEach(() => {
  h.native = false;
  h.invoke.mockReset();
  h.invoke.mockResolvedValue({ data: { ok: true }, error: null });
  localStorage.clear();
  __resetErrorReportingForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("redact — nothing private leaves the device", () => {
  it("removes bearer tokens, JWTs and Supabase keys", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMifQ.c2lnbmF0dXJl";
    const out = redact(
      `Authorization: Bearer ${jwt} failed; key sb_publishable_abc123DEF456 was rejected; also ${jwt}`
    );
    expect(out).not.toContain(jwt);
    expect(out).not.toContain("sb_publishable_abc123DEF456");
    expect(out).toContain("<jwt>");
    expect(out).toContain("<key>");
    expect(out).toContain("Bearer <token>");
  });

  it("removes email addresses", () => {
    const out = redact("Sign-in failed for tester@example.com after 3 attempts");
    expect(out).not.toContain("tester@example.com");
    expect(out).toContain("<email>");
  });

  it("keeps a URL's path and drops its query, which is where the tokens are", () => {
    // Both the password-reset and the OAuth callback carry their token here.
    const out = redact(
      "Failed to fetch https://app.example.com/auth/callback?code=abc123def456&flow_state_id=xyz"
    );
    expect(out).not.toContain("code=abc123def456");
    expect(out).toContain("https://app.example.com/auth/callback?<redacted>");
  });

  it("removes long unbroken runs of base64 or hex", () => {
    const blob = "A".repeat(60);
    const out = redact(`image payload ${blob} could not be decoded`);
    expect(out).not.toContain(blob);
    expect(out).toContain("<blob>");
  });

  it("collapses to one line and caps the length", () => {
    // Deliberately not one long run of characters: that is a <blob> and gets
    // folded by the rule above, which is the point of that rule.
    const long = Array.from({ length: 400 }, (_, i) => `frame ${i}`).join("\n");
    const out = redact(long, 100);
    expect(out).not.toContain("\n");
    expect(out.length).toBe(100);
  });

  it("returns an empty string for anything that is not text", () => {
    expect(redact(undefined)).toBe("");
    expect(redact({ message: "no" })).toBe("");
    expect(redact(null)).toBe("");
  });
});

describe("normalizeScreen — a route, not a URL", () => {
  it("drops the query and hash", () => {
    expect(normalizeScreen("/auth/callback?code=secret#frag")).toBe("/auth/callback");
  });

  it("folds account and content ids out so one screen is one screen", () => {
    expect(normalizeScreen("/coach/8f3a1b2c-1111-2222-3333-444455556666")).toBe("/coach/<id>");
    expect(normalizeScreen("/challenges/42")).toBe("/challenges/<id>");
    expect(normalizeScreen("/training")).toBe("/training");
  });
});

describe("reportError — what actually gets sent", () => {
  it("sends the failure with the install's real version from the manifest", async () => {
    h.native = true;
    reportError({ source: "react", name: "TypeError", message: "Cannot read properties of null" });

    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    const [fn, options] = h.invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fn).toBe("report-error");
    expect(options.body).toMatchObject({
      source: "react",
      name: "TypeError",
      message: "Cannot read properties of null",
      platform: "native",
      app_version: "1.2.17",
    });
    // The client never names its own grouping: the server derives the
    // fingerprint, so a crafted call cannot bury or scatter real failures.
    expect(options.body).not.toHaveProperty("fingerprint");
  });

  it("labels the browser build as web rather than guessing a version", async () => {
    reportError({ source: "error", name: "Error", message: "boom" });
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    expect(sentBodies()[0]).toMatchObject({ platform: "web", app_version: "web" });
  });

  it("redacts before sending, not after", async () => {
    reportError({
      source: "rejection",
      name: "Error",
      message: "401 for tester@example.com with Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.sig",
    });
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    const body = sentBodies()[0];
    expect(String(body.message)).not.toContain("tester@example.com");
    expect(String(body.message)).toContain("<email>");
  });

  it("drops a report with no usable message rather than sending an empty one", async () => {
    reportError({ source: "error", name: "Error", message: "   " });
    await Promise.resolve();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("sends the same failure once per session, and different failures separately", async () => {
    reportError({ source: "error", name: "Error", message: "boom" });
    reportError({ source: "error", name: "Error", message: "boom" });
    reportError({ source: "error", name: "Error", message: "bang" });
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2));
    expect(sentBodies().map((b) => b.message)).toEqual(["boom", "bang"]);
  });

  it("stops at the session cap, so one failing render loop cannot become a request loop", async () => {
    for (let i = 0; i < 40; i++) {
      reportError({ source: "error", name: "Error", message: `distinct failure ${i}` });
    }
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalled());
    expect(h.invoke.mock.calls.length).toBe(15);
  });

  it("is silent when there is nowhere to send — the demo clone must not queue forever", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://vaylo-demo.invalid");
    reportError({ source: "error", name: "Error", message: "boom" });
    await Promise.resolve();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("never throws, even when the transport does", async () => {
    h.invoke.mockRejectedValue(new Error("network down"));
    expect(() => reportError({ source: "error", name: "Error", message: "boom" })).not.toThrow();
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalled());
    await Promise.resolve();
  });
});

describe("the offline queue — a device with no signal still reports", () => {
  it("parks a report that could not be sent and delivers it on the next flush", async () => {
    h.invoke.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    reportError({ source: "error", name: "Error", message: "logged with no signal" });
    await vi.waitFor(() => expect(localStorage.getItem(QUEUE_KEY)).toBeTruthy());
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!)).toHaveLength(1);

    h.invoke.mockClear();
    h.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await flushPendingReports();

    expect(sentBodies().map((b) => b.message)).toEqual(["logged with no signal"]);
    expect(localStorage.getItem(QUEUE_KEY)).toBe("[]");
  });

  it("keeps at most a handful, because a phone is not a log server", async () => {
    h.invoke.mockResolvedValue({ data: null, error: { message: "offline" } });
    for (let i = 0; i < 12; i++) {
      reportError({ source: "error", name: "Error", message: `queued failure ${i}` });
    }
    await vi.waitFor(() => expect(localStorage.getItem(QUEUE_KEY)).toBeTruthy());
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!).length).toBeLessThanOrEqual(5);
  });

  it("survives a corrupted queue instead of taking the app down with it", async () => {
    localStorage.setItem(QUEUE_KEY, "{not json");
    await expect(flushPendingReports()).resolves.toBeUndefined();
  });
});

describe("installGlobalErrorReporting", () => {
  it("reports an uncaught error, which nothing else in the app catches", async () => {
    installGlobalErrorReporting();
    const error = new TypeError("setLog is not a function");
    window.dispatchEvent(new ErrorEvent("error", { error, message: error.message }));

    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    expect(sentBodies()[0]).toMatchObject({
      source: "error",
      name: "TypeError",
      message: "setLog is not a function",
    });
  });

  it("ignores a failed resource load, which has no stack and is already handled", async () => {
    installGlobalErrorReporting();
    // An <img> or a lazy chunk failing fires `error` on the element itself: no
    // Error object, no message. Reporting those would drown the real ones.
    const target = document.createElement("img");
    target.dispatchEvent(new Event("error"));
    await Promise.resolve();
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
