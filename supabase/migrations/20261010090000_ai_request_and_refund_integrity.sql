-- Durable provider claims, including free/Unlimited calls. No client writes.
CREATE TABLE public.ai_request_results (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation text NOT NULL,
  request_id text NOT NULL,
  payload_hash text NOT NULL,
  debit_key text NOT NULL UNIQUE,
  response_status integer CHECK (response_status BETWEEN 200 AND 599),
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation, request_id)
);
ALTER TABLE public.ai_request_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_request_results FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_request_results TO service_role;

-- Derive the refund from a real debit; serialize with all balance changes.
CREATE OR REPLACE FUNCTION public.credits_refund(
  p_user uuid,
  p_debit_key text,
  p_reason text,
  p_source text DEFAULT 'refund'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_debit public.credit_transactions;
BEGIN
  IF p_user IS NULL OR p_debit_key IS NULL OR p_debit_key = '' THEN
    RAISE EXCEPTION 'Missing refund identity';
  END IF;
  PERFORM 1 FROM public.profiles WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found'; END IF;
  SELECT * INTO v_debit FROM public.credit_transactions
    WHERE user_id = p_user AND idempotency_key = p_debit_key AND amount < 0;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'debit_not_found');
  END IF;
  RETURN public.credits_grant(p_user, -v_debit.amount, p_reason, p_source,
    'refund:' || p_debit_key, jsonb_build_object('debit_id', v_debit.id));
END $$;
REVOKE ALL ON FUNCTION public.credits_refund(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credits_refund(uuid, text, text, text) TO service_role;

-- Explicitly remove inherited PUBLIC execution on the grant helper as well.
REVOKE ALL ON FUNCTION public.credits_grant(uuid, integer, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credits_grant(uuid, integer, text, text, text, jsonb) TO service_role;
