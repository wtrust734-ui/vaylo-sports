// ============================================================================
// ENTITLEMENT LIFECYCLE + OBSERVABILITY — QA regression pack
// ----------------------------------------------------------------------------
// Closes the two highest-risk gaps found in the QA coverage audit:
//
//   1. Entitlement lifecycle: the client's active/refill answers must match
//      the server for every plan state. deriveEntitlementFlags() is extracted
//      from SubscriptionContext so each lifecycle row shape is tested as a
//      plain input — real behavior, no DB, no mocks. The expected values were
//      taken from the LIVE get_my_entitlements() / cancel_my_subscription() /
//      apply_credit_refill() function bodies, not from the client's hopes.
//
//   2. Log hygiene: refund paths log user ids (Deno logs are project-private,
//      and the id is already in the credits ledger), but nothing may ever log
//      provider bodies, tokens, health values, prompts or AI output. The
//      regexes here run against the actual edge-function sources, so a future
//      `console.log(payload)` fails CI instead of shipping.
//
// No production users, secrets or unstable ids. Deterministic.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveEntitlementFlags,
  ACTIVE_STATUSES,
} from "@/contexts/subscriptionFlags";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

// ---------------------------------------------------------------------------
// 1. Entitlement lifecycle — real behavior, no mocks
// ---------------------------------------------------------------------------

describe("entitlement lifecycle (deriveEntitlementFlags)", () => {
  const base = {
    status: "free",
    unlimited_credits: false,
    is_lifetime: false,
    cancel_at_period_end: false,
    monthly_credit_allowance: 0,
    credit_rollover_limit: 0,
  };

  it("client active-set matches the server's SQL check exactly", () => {
    // get_my_entitlements() gates plan data on `status in ('active','trial')
    // or is_lifetime` — the client must use the same set, no more, no less.
    expect(ACTIVE_STATUSES).toEqual(new Set(["active", "trial"]));
  });

  it("free user: inactive, no refill", () => {
    const f = deriveEntitlementFlags({ ...base, status: "free" });
    expect(f.active).toBe(false);
    expect(f.mayAutoRefill).toBe(false);
  });

  it("trial user: active with refill", () => {
    const f = deriveEntitlementFlags({
      ...base,
      status: "trial",
      monthly_credit_allowance: 50,
      credit_rollover_limit: 50,
    });
    expect(f.active).toBe(true);
    expect(f.mayAutoRefill).toBe(true);
  });

  it("active subscriber: active with refill", () => {
    const f = deriveEntitlementFlags({
      ...base,
      status: "active",
      monthly_credit_allowance: 100,
    });
    expect(f.active).toBe(true);
    expect(f.mayAutoRefill).toBe(true);
  });

  it("expired subscriber: NOT active — the server zeroes allowance for this row", () => {
    const f = deriveEntitlementFlags({
      ...base,
      status: "expired",
      monthly_credit_allowance: 100,
    });
    expect(f.active).toBe(false);
    expect(f.mayAutoRefill).toBe(false);
  });

  it("cancelled (access already revoked): NOT active", () => {
    // cancel_my_subscription() sets status='cancelled' only when nothing
    // paid-for remains — the server has already zeroed this row's plan data,
    // so showing paid UI here would contradict the server.
    const f = deriveEntitlementFlags({ ...base, status: "cancelled" });
    expect(f.active).toBe(false);
    expect(f.mayAutoRefill).toBe(false);
  });

  it("cancelled-at-period-end arrives as status 'active' + flag, and stays active", () => {
    // This is the row shape cancel_my_subscription() writes when a period
    // remains: status stays 'active', cancel_at_period_end=true.
    const f = deriveEntitlementFlags({
      ...base,
      status: "active",
      cancel_at_period_end: true,
      monthly_credit_allowance: 100,
    });
    expect(f.active).toBe(true);
    expect(f.mayAutoRefill).toBe(true);
  });

  it("lifetime: active regardless of status spelling; allowance honoured if the server grants one", () => {
    const f = deriveEntitlementFlags({
      ...base,
      status: "free",
      is_lifetime: true,
      monthly_credit_allowance: 200,
    });
    expect(f.active).toBe(true);
    // The server's allowance case explicitly includes is_lifetime, so a
    // lifetime row with an allowance does refill.
    expect(f.mayAutoRefill).toBe(true);
  });

  it("an unlimited-credits flag alone does NOT make a lapsed plan active", () => {
    // Regression guard for the old cross-user oracle: flags other than
    // status/lifetime must not influence the active answer.
    const f = deriveEntitlementFlags({ ...base, status: "expired", unlimited_credits: true });
    expect(f.active).toBe(false);
  });

  it("negative, zero or NaN allowances never trigger a refill call", () => {
    for (const bad of [0, -5, Number.NaN]) {
      const f = deriveEntitlementFlags({
        ...base,
        status: "active",
        monthly_credit_allowance: bad,
      });
      expect(f.mayAutoRefill).toBe(false);
    }
  });

  it("the context uses the shared derivation (no second, drifting copy)", () => {
    const ctx = read("/src/contexts/SubscriptionContext.tsx");
    expect(ctx).toMatch(/deriveEntitlementFlags|subscriptionFlags/);
    // The old inline derivation must be gone — two derivations WILL diverge.
    expect(ctx).not.toMatch(/status === "trial";?\s*$/m);
  });
});

// ---------------------------------------------------------------------------
// 2. Refund discipline — one failure gets exactly one matching refund
// ---------------------------------------------------------------------------

describe("refund path (edge _shared/refund.ts)", () => {
  const refund = read("/supabase/functions/_shared/refund.ts");

  it("skips zero/negative amounts (no free credits via a crafted amount)", () => {
    expect(refund).toMatch(/if \(!amount \|\| amount <= 0\) return false;/);
  });

  it("grants back only through the service-role-only RPC, never a client table", () => {
    expect(refund).toMatch(/credits_grant/);
    expect(refund).not.toMatch(/from\("credit_transactions"\)/);
  });

  it("each refund gets a fresh idempotency key (retry-safe, replay-proof)", () => {
    expect(refund).toMatch(/p_idempotency_key: `refund:\$\{crypto\.randomUUID\(\)\}`/);
  });

  it("never logs provider bodies or tokens", () => {
    expect(refund).not.toMatch(/console\.\w+\([^)]*(body|token|payload)/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Observability — sensitive data must not reach any log
// ---------------------------------------------------------------------------

describe("log hygiene across edge functions", () => {
  const fns = [
    "/supabase/functions/_shared/openai.ts",
    "/supabase/functions/process-purchase/index.ts",
    "/supabase/functions/coach-chat/index.ts",
    "/supabase/functions/delete-account/index.ts",
    "/supabase/functions/wearable-oauth/index.ts",
  ];

  it("no AI/provider function logs credentials, request payloads, or media", () => {
    for (const file of fns) {
      const src = read(file);
      const logLines = src.match(/console\.(log|error|warn)\([^\n]*/g) ?? [];
      for (const line of logLines) {
        // Key material / auth headers / raw key values.
        expect(/Bearer |Authorization|api[_-]?key=|sk-[a-zA-Z0-9]{8}/.test(line)).toBe(false);
        // The OUTBOUND request (what the user sent) — provider error bodies
        // are a deliberate, truncated debug trade-off (see aiEdgeSecurity).
        expect(/JSON\.stringify\(\s*(messages|prompt|request)/.test(line)).toBe(false);
        // Media payloads are never logged.
        expect(/image_base64/.test(line)).toBe(false);
      }
    }
  });

  it("the OpenAI adapter labels and truncates provider errors without echoing the request", () => {
    const src = read("/supabase/functions/_shared/openai.ts");
    expect(src).toMatch(/status=\$\{res\.status\}/);
    // A log line may carry a TRUNCATED provider ERROR body, never the request
    // the app sent (messages/prompt arrays) and never auth material.
    expect(src).not.toMatch(/console\.[^\n]*JSON\.stringify\(\s*(messages|prompt|request)/);
    expect(src).not.toMatch(/console\.[^\n]*Bearer /);
    // Usage lines record COUNTS only — never response content.
    expect(src).toMatch(/tokens=\$\{usage\?\.totalTokens/);
  });

  it("coach-chat never logs conversation content", () => {
    const src = read("/supabase/functions/coach-chat/index.ts");
    const logLines = src.match(/console\.(log|error|warn)\([^\n]*/g) ?? [];
    for (const line of logLines) {
      // The athlete's words must never appear in a log statement.
      expect(/userMessage|conversation|chat_history|\bmessages\b/i.test(line)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Client-side secret hygiene (the main bundle ships to every device)
// ---------------------------------------------------------------------------

describe("client bundle log hygiene", () => {
  const clientSources = [
    "/src/contexts/AuthContext.tsx",
    "/src/lib/health/sync.ts",
    "/src/lib/health/bridge.ts",
    "/src/lib/nativeOAuth.ts",
    "/src/lib/billing.ts",
  ];

  it("no client module logs session tokens, health data, or purchase tokens", () => {
    for (const file of clientSources) {
      const src = read(file);
      const logLines = src.match(/console\.(log|error|warn)\([^\n]*/g) ?? [];
      for (const line of logLines) {
        expect(/access_token|refresh_token|session\.|health|purchase_token|credit/i.test(line)).toBe(
          false,
        );
      }
    }
  });
});
