// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { edgeHarness } from "../test/edgeHarness";

// Edge modules execute through edgeHarness; keep Deno imports out of the app compiler.
type AiAttempt = { start: () => void; uncharged: () => void; uncertain: () => Response; fail: (message: string, status: number, amount: number) => Promise<Response> };
type Row = { user_id: string; operation: string; request_id: string; payload_hash: string; debit_key: string; response_status: number | null; response_body?: Record<string, unknown>; retryable?: boolean };
const rows: Row[] = [];
let userId = "athlete-a";
const rpc = vi.fn();
let failSave = false;
const client = {
  auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  rpc,
  from: () => ({
    insert: async (row: Row) => {
      if (rows.some(r => r.user_id === row.user_id && r.operation === row.operation && r.request_id === row.request_id)) return { error: { code: "23505" } };
      rows.push({ ...row, response_status: null }); return { error: null };
    },
    select: () => {
      const filters: [keyof Row, string][] = [];
      const query = {
        eq: (key: keyof Row, value: string) => { filters.push([key, value]); return query; },
        single: async () => ({ data: structuredClone(rows.find(r => filters.every(([key, value]) => r[key] === value))), error: null }),
      };
      return query;
    },
    update: (patch: Partial<Row>) => {
      const filters: [keyof Row, unknown][] = [];
      const execute = async () => {
        if (failSave) return { data: null, error: { message: "synthetic save failure" } };
        const row = rows.find(r => filters.every(([key, value]) => r[key] === value));
        if (row) Object.assign(row, patch);
        return { data: row ? structuredClone(row) : null, error: null };
      };
      const query = {
        eq: (key: keyof Row, value: unknown) => { filters.push([key, value]); return query; },
        select: () => query, maybeSingle: execute,
        then: (resolve: (value: unknown) => unknown) => execute().then(resolve),
      };
      return query;
    },
  }),
};
const deps = { "https://esm.sh/@supabase/supabase-js@2.100.0": { createClient: () => client } };
const { idempotentAiHandler } = edgeHarness(deps).load<{ idempotentAiHandler: (operation: string, handler: (req: Request, debitKey: string, attempt: AiAttempt) => Promise<Response>) => (req: Request) => Promise<Response> }>("supabase/functions/_shared/idempotentAiHandler.ts");
const { refundCredits } = edgeHarness(deps).load<{ refundCredits: (args: { supabaseUrl: string; serviceRoleKey: string; userId: string; amount: number; debitKey: string; reason: string }) => Promise<boolean> }>("supabase/functions/_shared/refund.ts");
const request = (body = { request_id: "intent-1", instruction: "Make this easier", weeks: [1] }) => new Request("https://synthetic.local", {
  method: "POST", headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => { rows.length = 0; userId = "athlete-a"; rpc.mockReset(); failSave = false; });

it.each([200, 502])("replays a saved %s response without another provider call or refund", async (status) => {
  const provider = vi.fn(async (_req: Request, _key: string, attempt: AiAttempt) => { attempt.start(); return new Response(JSON.stringify({ result: "saved result" }), { status }); });
  const handler = idempotentAiHandler("edit-plan", provider);
  expect((await handler(request())).status).toBe(status);
  expect((await handler(request())).status).toBe(status);
  expect(provider).toHaveBeenCalledTimes(1);
});
it("allows only the claim owner to execute simultaneous requests", async () => {
  let release!: () => void;
  const provider = vi.fn(() => new Promise<Response>(resolve => { release = () => resolve(Response.json({ done: true })); }));
  const handler = idempotentAiHandler("nutrition", provider);
  const first = handler(request());
  await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
  expect((await handler(request())).status).toBe(409);
  release();
  expect((await first).status).toBe(200);
  expect(provider).toHaveBeenCalledTimes(1);
});
it("binds the whole payload to the request ID and isolates users", async () => {
  const provider = vi.fn(async () => Response.json({ done: true }));
  const handler = idempotentAiHandler("edit-plan", provider);
  await handler(request());
  expect((await handler(request({ request_id: "intent-1", instruction: "Make this easier", weeks: [99] }))).status).toBe(409);
  userId = "athlete-b";
  expect((await handler(request())).status).toBe(200);
  expect(provider).toHaveBeenCalledTimes(2);
  expect(rows[0].debit_key).not.toBe(rows[1].debit_key);
});
it("refunds reference the original debit and handle failed RPC responses", async () => {
  const args = { supabaseUrl: "synthetic", serviceRoleKey: "synthetic", userId: "athlete-a", amount: 10, debitKey: "original-debit", reason: "Provider failed" };
  rpc.mockResolvedValue({ data: { success: true }, error: null });
  expect(await refundCredits(args)).toBe(true);
  expect(await refundCredits(args)).toBe(true);
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  expect(rpc.mock.calls[0]).toEqual(["credits_refund", { p_user: "athlete-a", p_debit_key: "original-debit", p_reason: "Provider failed", p_source: "refund" }]);
  rpc.mockResolvedValue({ data: { success: false }, error: null });
  expect(await refundCredits(args)).toBe(false);
});
it("refuses legacy activation aliases and fake purchase validation", async () => {
  let handler!: (req: Request) => Promise<Response>;
  const databaseWrite = vi.fn(() => { throw new Error("Unexpected database write"); });
  edgeHarness({ "https://esm.sh/@supabase/supabase-js@2": { createClient: () => ({ ...client, from: databaseWrite }) } }, {
    Deno: { env: { get: () => "synthetic" }, serve: (fn: typeof handler) => { handler = fn; } },
  }).load("supabase/functions/manage-subscription/index.ts");
  for (const action of ["activate", "activate_legacy_disabled", "validate_purchase"]) {
    const response = await handler(new Request("https://synthetic.local", { method: "POST", headers: { Authorization: "Bearer synthetic" }, body: JSON.stringify({ action, plan_type: "elite", purchase_token: "unverified", product_id: "unlimited" }) }));
    expect(response.status).toBe(410);
  }
  expect(databaseWrite).not.toHaveBeenCalled();
});


it("rechecks an uncharged refusal after top-up, with only one concurrent retry owner", async () => {
  let funded = false;
  let finish!: () => void;
  const provider = vi.fn(async (_req: Request, _key: string, attempt: AiAttempt) => {
    attempt.start();
    if (!funded) { attempt.uncharged(); return Response.json({ error: "insufficient_credits" }, { status: 402 }); }
    return new Promise<Response>(resolve => { finish = () => resolve(Response.json({ done: true })); });
  });
  const handler = idempotentAiHandler("edit-plan", provider);
  expect((await handler(request())).status).toBe(402);
  const firstKey = rows[0].debit_key;
  funded = true;
  const first = handler(request());
  await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
  expect((await handler(request())).status).toBe(409);
  finish();
  expect((await first).status).toBe(200);
  expect(rows[0].debit_key).not.toBe(firstKey);
  expect((await handler(request())).status).toBe(200);
  expect(provider).toHaveBeenCalledTimes(2);
});

it("retains uncertain debit failures and interrupted requests instead of reexecuting", async () => {
  const failedSpend = vi.fn(async (_req: Request, _key: string, attempt: AiAttempt) => {
    attempt.start(); return attempt.uncertain();
  });
  const handler = idempotentAiHandler("edit-plan", failedSpend);
  const unresolved = await (await handler(request())).json();
  expect(unresolved.attempt_complete).toBe(false);
  expect(unresolved.retryable).toBe(false);
  await handler(request());
  expect(failedSpend).toHaveBeenCalledTimes(1);
  const crashed = vi.fn(async () => { throw new Error("interrupted"); });
  const crashHandler = idempotentAiHandler("nutrition", crashed);
  expect((await crashHandler(request())).status).toBe(503);
  expect((await crashHandler(request())).status).toBe(409);
  expect(crashed).toHaveBeenCalledTimes(1);
});

it("records a pending refund and retries only the ledger refund on replay", async () => {
  rpc.mockResolvedValueOnce({ error: { message: "offline" }, data: null })
    .mockResolvedValue({ error: null, data: { success: true } });
  const provider = vi.fn(async (_req: Request, _key: string, attempt: AiAttempt) => {
    attempt.start(); return attempt.fail("The edit failed.", 502, 10);
  });
  const handler = idempotentAiHandler("edit-plan", provider);
  const failed = await (await handler(request())).json();
  expect(failed.refund_pending).toBe(true);
  expect(failed.error).not.toContain("were refunded");
  const settled = await (await handler(request())).json();
  expect(settled.refund_pending).toBe(false);
  expect(settled.error).toContain("were refunded");
  expect(settled.attempt_complete).toBe(true);
  await handler(request());
  expect(provider).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
});

it("does not refund or release the claim when the recovery record cannot be persisted", async () => {
  const provider = vi.fn(async (_req: Request, _key: string, attempt: AiAttempt) => {
    attempt.start(); failSave = true; return attempt.fail("Failed", 502, 10);
  });
  const handler = idempotentAiHandler("edit-plan", provider);
  expect((await handler(request())).status).toBe(503);
  failSave = false;
  expect((await handler(request())).status).toBe(409);
  expect(rpc).not.toHaveBeenCalled();
  expect(provider).toHaveBeenCalledTimes(1);
});

it("refuses AI work on a limiter RPC error or exception, including free calls", async () => {
  const { aiCallAllowed } = edgeHarness(deps).load<{ aiCallAllowed: (req: Request, user: string, feature: string) => Promise<boolean> }>("supabase/functions/_shared/guard.ts");
  rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } }).mockRejectedValueOnce(new Error("timeout"));
  expect(await aiCallAllowed(request(), userId, "edit-plan")).toBe(false);
  expect(await aiCallAllowed(request(), userId, "edit-plan")).toBe(false);
  rpc.mockResolvedValue({ data: true, error: null });
  expect(await aiCallAllowed(request(), userId, "edit-plan")).toBe(true);
});

const week = (n: number) => ({ week: n, sessions: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((dayName, i) => ({ day: i + 1, dayName, title: "Easy session", type: "recovery", duration_minutes: 20 })) });
it.each(["wrong week", "duplicate week", "duplicate day", "wrong day name", "valid reorder"])("validates actual edit handler output: %s", async scenario => {
  let handler!: (req: Request) => Promise<Response>;
  const sent = [week(1), week(2)];
  const returned = structuredClone(sent);
  if (scenario === "wrong week") returned[0].week = 99;
  if (scenario === "duplicate week") returned[1].week = 1;
  if (scenario === "duplicate day") returned[0].sessions[1].day = 1;
  if (scenario === "wrong day name") returned[0].sessions[0].dayName = "Sunday";
  if (scenario === "valid reorder") { returned.reverse(); returned[0].sessions.reverse(); }
  rpc.mockResolvedValue({ data: { success: true }, error: null });
  const spend = vi.fn(async () => ({ success: true, cost: 10, balance: 90, unlimited: false }));
  const provider = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ weeks: returned }) } }] }));
  edgeHarness({ ...deps,
    "../_shared/guard.ts": {
      authenticate: async () => userId, readJsonBody: (req: Request) => req.json(),
      json: (body: unknown, status = 200) => Response.json(body, { status }),
      throttled: () => false, aiCallAllowed: async () => true, spendForUser: spend,
    },
    "../_shared/openai.ts": { languageDirective: () => "" },
    "../_shared/coachVoice.ts": { coachVoiceDirective: () => "" },
  }, { Deno: { env: { get: () => "synthetic" }, serve: (fn: typeof handler) => { handler = fn; } }, fetch: provider }).load("supabase/functions/edit-plan/index.ts");
  const input = () => new Request("https://synthetic.local", { method: "POST", headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json" }, body: JSON.stringify({ request_id: "edit-test", instruction: "Make this easier", scope: "plan", weeks: sent }) });
  const response = await handler(input());
  expect(response.status).toBe(scenario === "valid reorder" ? 200 : 502);
  expect(spend).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledTimes(scenario === "valid reorder" ? 0 : 1);
  const calls = provider.mock.calls.length;
  await handler(input());
  expect(provider).toHaveBeenCalledTimes(calls);
});
