-- Only the service role can mark a completed attempt safe to execute again.
-- Existing claims retain the conservative default, including interrupted work.
ALTER TABLE public.ai_request_results
  ADD COLUMN retryable boolean NOT NULL DEFAULT false;

-- Recover earlier cached insufficient-credit refusals only with proof of no debit.
UPDATE public.ai_request_results r SET retryable = true
WHERE response_status = 402
  AND response_body->>'error' = 'insufficient_credits'
  AND NOT EXISTS (
    SELECT 1 FROM public.credit_transactions t
    WHERE t.user_id = r.user_id AND t.idempotency_key = r.debit_key AND t.amount < 0
  );
