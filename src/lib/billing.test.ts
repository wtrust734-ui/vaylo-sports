// ============================================================================
// THE ERROR BODY OF A FAILED PURCHASE
// ----------------------------------------------------------------------------
// This is a regression test for a bug that threw nothing and showed nothing.
// supabase-js rejects a non-2xx function call with a FunctionsHttpError whose
// `context` is the Response. The code used to read `context.body` as if it were
// a string, so JSON.parse threw, the catch assigned the stream itself, and every
// failed purchase in the app told the athlete "[object ReadableStream]".
//
// The 402 from process-purchase was the expensive half: its body carries the
// shortfall the top-up sheet needs, so losing it turned "buy this feature" into
// a dead end with no way to recover.
// ============================================================================

import { describe, it, expect } from "vitest";

import { readPurchaseError } from "@/lib/billing";

const httpError = (body: string, status = 402) =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(body, { status }),
  }) as unknown as Error;

describe("readPurchaseError", () => {
  it("reads the server's message out of a JSON body", async () => {
    const res = await readPurchaseError(
      httpError(JSON.stringify({ error: "Not enough credits for form_analysis (need 54)." })),
      "Purchase failed"
    );
    expect(res.message).toBe("Not enough credits for form_analysis (need 54).");
  });

  it("keeps the machine-readable shortfall a top-up sheet needs", async () => {
    const res = await readPurchaseError(
      httpError(
        JSON.stringify({
          error: "Not enough credits for form_analysis (need 54).",
          code: "insufficient_credits",
          required: 54,
          balance: 50,
          shortfall: 4,
        })
      ),
      "Purchase failed"
    );
    expect(res.detail.code).toBe("insufficient_credits");
    expect(res.detail.required).toBe(54);
    expect(res.detail.shortfall).toBe(4);
  });

  it("never returns a stream in the message", async () => {
    // The old code did exactly this: JSON.parse of a ReadableStream throws, and
    // the catch put the stream into the string the athlete sees.
    const res = await readPurchaseError(httpError("plain text failure"), "Purchase failed");
    expect(res.message).not.toContain("ReadableStream");
    expect(res.message).toBe("plain text failure");
  });

  it("falls back when the error carries no response", async () => {
    const res = await readPurchaseError(new Error("network down"), "Purchase failed");
    expect(res.message).toBe("network down");
    expect(res.detail).toEqual({});
  });

  it("falls back for a null error rather than throwing", async () => {
    const res = await readPurchaseError(null, "Purchase failed");
    expect(res.message).toBe("Purchase failed");
  });

  it("does not consume the caller's copy of the body", async () => {
    const err = httpError(JSON.stringify({ error: "nope" }));
    await readPurchaseError(err, "Purchase failed");
    // The caller's Response is still readable, which is what clone() buys.
    const again = (err as unknown as { context: Response }).context;
    expect(await again.json()).toEqual({ error: "nope" });
  });
});
