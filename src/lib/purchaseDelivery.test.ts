// @vitest-environment node
import { expect, it, vi } from "vitest";
import { edgeHarness } from "../test/edgeHarness";

function purchaseHandler(mode: string) {
  let handler!: (req: Request) => Promise<Response>;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "credit_cost") return { data: 10, error: null };
    if (name === "deliver_purchase") return { data: { success: true, items: args.p_items }, error: null };
    return { data: null, error: null };
  });
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "synthetic-user" } }, error: null }) }, rpc,
    from: (table: string) => {
      const query = {
        select: () => query, eq: () => query, delete: () => query,
        maybeSingle: async () => ({ data: { credits: 100, infinite_credits: false }, error: null }),
        then: (fn: (v: unknown) => unknown) => Promise.resolve({ data: table === "special_offers" ? [] : null, error: null }).then(fn),
      };
      return query;
    },
  };
  edgeHarness({
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => client },
    "../_shared/playBilling.ts": { verifyPlayPurchase: vi.fn(() => { throw new Error("Store must not run in free testing"); }) },
  }, {
    Deno: { serve: (fn: typeof handler) => { handler = fn; }, env: { get: (key: string) => key === "PAYMENT_MODE" ? mode : undefined } },
  }).load("supabase/functions/process-purchase/index.ts");
  return { handler, rpc };
}
const request = (id: string, closedTesting = true) => new Request("https://synthetic.local", {
  method: "POST", headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json" },
  body: JSON.stringify({ items: [{ product_id: id }], closed_testing: closedTesting, verification: { reference: "unverified" } }),
});

it.each(["pack_25", "coins_120", "infinite_monthly", "infinite_yearly", "infinite_lifetime"])("delivers %s for free only through the atomic RPC", async (product) => {
  const { handler, rpc } = purchaseHandler("free");
  const response = await handler(request(product));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, free: true });
  const delivery = rpc.mock.calls.find(([name]) => name === "deliver_purchase")![1];
  expect(delivery.p_reference).toBeNull();
  expect(delivery.p_items).toMatchObject([{ product_id: product, price_cents: 0 }]);
  expect(rpc.mock.calls.every(([name]) => ["deliver_purchase", "recompute_user_segment"].includes(name))).toBe(true);
});
it("requires the server free gate and matching client flag", async () => {
  for (const [mode, flag] of [["disabled", true], ["free", false]] as const) {
    const { handler, rpc } = purchaseHandler(mode);
    expect((await handler(request("pack_25", flag))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  }
});
it("never reports successful delivery after an RPC failure", async () => {
  const { handler, rpc } = purchaseHandler("free");
  rpc.mockResolvedValueOnce({ data: null, error: { message: "database unavailable" } } as never);
  const response = await handler(request("pack_25"));
  expect(response.status).toBe(409);
  expect((await response.json()).success).toBeUndefined();
});
