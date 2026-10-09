import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { authenticate, json, readJsonBody } from "./guard.ts";
import { refundCredits } from "./refund.ts";

export interface AiAttempt {
  /** Call before any debit attempt or free provider execution. */
  start: () => void;
  /** Only after an authoritative refusal proves no debit/provider work occurred. */
  uncharged: () => void;
  uncertain: () => Response;
  fail: (message: string, status: number, amount: number) => Promise<Response>;
}

/** Claims survive uncertain outcomes. Only proven uncharged attempts may run again. */
export function idempotentAiHandler(
  operation: string,
  handler: (req: Request, debitKey: string, attempt: AiAttempt) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const noop: AiAttempt = { start() {}, uncharged() {}, uncertain: () => json({ error: "Request unresolved" }, 503), fail: async (message, status) => json({ error: message }, status) };
    if (req.method !== "POST") return handler(req, "", noop);
    const userId = await authenticate(req);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const body = await readJsonBody(req.clone());
    if (!body) return json({ error: "Invalid JSON body" }, 400);
    if (body.request_id !== undefined && (typeof body.request_id !== "string" || !body.request_id.trim() || body.request_id.length > 80)) {
      return json({ error: "Invalid request ID" }, 400);
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body)));
    const payloadHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    const requestId = typeof body.request_id === "string" ? body.request_id : payloadHash;
    const debitKey = crypto.randomUUID();
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const busy = () => json({ error: "This request is still being resolved. Retry to check its status." }, 409);
    const save = async (key: string, status: number, result: Record<string, unknown>, retryable = false) => {
      const { error } = await admin.from("ai_request_results").update({
        response_status: status, response_body: result, retryable,
      }).eq("debit_key", key);
      if (error) throw new Error("Could not persist AI request outcome");
    };
    const settleRefund = async (key: string, status: number, result: Record<string, unknown>) => {
      const refunded = await refundCredits({
        supabaseUrl: Deno.env.get("SUPABASE_URL")!, serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        userId, debitKey: key, amount: Number(result.refund_amount), reason: `${operation} failed — refund`,
      });
      if (!refunded) return json(result, status);
      const settled = { ...result, error: `${result.failure_message} Your credits were refunded.`, refund_pending: false, attempt_complete: true };
      // Concurrent retries are safe: the ledger refund and this final value are idempotent.
      await save(key, status, settled);
      return json(settled, status);
    };
    try {
      const { error } = await admin.from("ai_request_results").insert({
        user_id: userId, operation, request_id: requestId, payload_hash: payloadHash, debit_key: debitKey,
      });
      if (error) {
        if (error.code !== "23505") return json({ error: "Could not reserve this request. Try again." }, 503);
        const { data: existing, error: readError } = await admin.from("ai_request_results")
          .select("payload_hash, debit_key, response_status, response_body, retryable")
          .eq("user_id", userId).eq("operation", operation).eq("request_id", requestId).single();
        if (readError || !existing) return json({ error: "Could not read the previous request." }, 503);
        if (existing.payload_hash !== payloadHash) return json({ error: "This request ID was used for different input." }, 409);
        if (existing.response_status === null) return busy();
        if (existing.response_body?.refund_pending) return await settleRefund(existing.debit_key, existing.response_status, existing.response_body);
        if (!existing.retryable) return json(existing.response_body, existing.response_status);
        // Compare-and-swap: exactly one retry owns the next uncharged attempt.
        const { data: claimed, error: claimError } = await admin.from("ai_request_results").update({
          debit_key: debitKey, response_status: null, response_body: null, retryable: false,
        }).eq("debit_key", existing.debit_key).eq("retryable", true).select("debit_key").maybeSingle();
        if (claimError) return json({ error: "Could not resume this request. Try again." }, 503);
        if (!claimed) return busy();
      }
      let started = false;
      const attempt: AiAttempt = {
        start: () => { started = true; },
        uncharged: () => { started = false; },
        uncertain: () => json({ error: "The credit debit could not be confirmed. This request is retained for reconciliation; please contact support.", attempt_pending: true }, 503),
        fail: async (message, status, amount) => {
          if (amount <= 0) return json({ error: message }, status);
          const pending = {
            error: `${message} Your credit refund is pending. Retry to check its status.`,
            failure_message: message, refund_amount: amount, refund_pending: true, attempt_complete: false,
          };
          // Record recovery work before trying the refund. A retry never calls the provider again.
          await save(debitKey, status, pending);
          return settleRefund(debitKey, status, pending);
        },
      };
      const response = await handler(req, debitKey, attempt);
      const responseBody = await response.clone().json();
      if (responseBody.refund_pending !== undefined) return response;
      const retryable = !started && response.status >= 400;
      const result = { ...responseBody, retryable, attempt_complete: !responseBody.attempt_pending && !responseBody.refund_pending && (!retryable || [400, 403].includes(response.status)) };
      await save(debitKey, response.status, result, retryable);
      return json(result, response.status);
    } catch (error) {
      console.error("AI request failed", error);
      // Never release a claim whose debit/provider outcome is uncertain.
      return json({ error: "Could not confirm this request. Retry to check its status." }, 503);
    }
  };
}
