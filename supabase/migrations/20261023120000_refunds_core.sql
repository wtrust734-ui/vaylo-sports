-- ============================================================================
-- REFUND SYSTEM — cases, audit trail, service-delivery ledger, notification outbox
-- ============================================================================
-- Why this exists
-- ---------------
-- Credits are already an auditable ledger: every debit and credit goes through
-- credits_spend()/credits_grant() and carries a deterministic idempotency key.
-- What did not exist was a *refund* record: a durable case a user can open, an
-- administrator can decide, and a future payment provider can settle. This
-- migration adds exactly that, plus the missing half of the AI-charge linkage —
-- a service_job row that says whether a charged AI call was delivered or failed.
--
-- Deliberate boundaries
-- ---------------------
--   * Only the service role writes refund state. Users can READ their own cases
--     and events (RLS), and cannot insert, update or delete any of it. A user
--     therefore cannot grant themselves credits, invent a decision, or edit a
--     status the way they could with the original client-insertable
--     credit_transactions policy.
--   * Monetary refunds are NOT executed here. No provider is connected, and
--     there is no code path in this migration that claims money moved. A money
--     case can only reach 'awaiting_provider' until a provider adapter confirms
--     an operation; 'completed' for money is reachable only through
--     refund_case_record_provider_decision() with a provider-issued reference.
--   * Credit restoration is a real ledger grant (credits_grant), keyed
--     deterministically from the charge, so retries and duplicate decisions
--     collapse instead of paying twice. A second case for the same charge is
--     refused even under concurrency (row lock + advisory lock + completed-case
--     check + the ledger's unique key).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Service jobs — one row per charged AI call
-- ---------------------------------------------------------------------------
-- The charge key is the SAME idempotency key credits_spend() wrote on the debit,
-- so a case can point at both rows without a second lookup table. `started`
-- means charged but no recorded outcome; `failed` means the automatic refund
-- path established a genuine failure; `delivered` means the function got all the
-- way to its success return. Only `failed` is safe to auto-restore — a merely
-- started job is "unverified", never "failed".
CREATE TABLE IF NOT EXISTS public.service_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL,
  charge_key text,
  credits integer NOT NULL DEFAULT 0 CHECK (credits >= 0),
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'delivered', 'failed')),
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS service_jobs_charge_key_uniq
  ON public.service_jobs (user_id, charge_key)
  WHERE charge_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS service_jobs_user_started_idx
  ON public.service_jobs (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS service_jobs_status_idx
  ON public.service_jobs (status, started_at DESC);

ALTER TABLE public.service_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.service_jobs TO authenticated;
GRANT ALL ON public.service_jobs TO service_role;

DROP POLICY IF EXISTS "Users can view their own service jobs" ON public.service_jobs;
CREATE POLICY "Users can view their own service jobs" ON public.service_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all service jobs" ON public.service_jobs;
CREATE POLICY "Admins can view all service jobs" ON public.service_jobs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 2. Refund cases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.refund_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-quotable reference used on the download page, in email subjects and
  -- in the administrator's secure link. Opaque but not a secret: authorization
  -- is the reader's session + has_role, never knowledge of this string.
  public_ref text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('credits', 'money', 'subscription')),
  source_type text NOT NULL CHECK (source_type IN (
    'ai_service', 'credit_purchase', 'subscription',
    'duplicate_charge', 'unauthorized', 'other'
  )),
  reason_code text NOT NULL,
  details text,
  -- The exact debit this case is about, when it is a credit case.
  charge_transaction_id uuid REFERENCES public.credit_transactions(id) ON DELETE SET NULL,
  charge_key text,
  -- Store-side transaction reference (Play purchase token / order id), when it
  -- is a money case and one exists.
  transaction_ref text,
  purchase_id uuid REFERENCES public.user_purchases(id) ON DELETE SET NULL,
  service_job_id uuid REFERENCES public.service_jobs(id) ON DELETE SET NULL,
  feature text,
  credits_requested integer CHECK (credits_requested IS NULL OR credits_requested > 0),
  amount_cents integer CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'under_review', 'approved_processing',
    'completed', 'declined', 'processing_failed', 'awaiting_provider'
  )),
  resolution text,
  -- The deterministic rule ids that sent this case to a human. Empty on a case
  -- the engine could settle on its own.
  escalation_rules text[] NOT NULL DEFAULT '{}',
  -- Snapshot of what the engine saw and decided, for auditability. Never used
  -- as an authorization input.
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text,
  provider_refund_id text,
  provider_state text,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_note text,
  -- Client-supplied retry key for the SUBMIT call (a double-tapped button or a
  -- retried HTTP request). Scoped to the user; the same key returns the same
  -- case instead of opening a second one.
  submission_key text NOT NULL,
  decided_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Submission idempotency: a double-tapped button or a retried request returns
-- the SAME case instead of opening a second one.
CREATE UNIQUE INDEX IF NOT EXISTS refund_cases_submission_key_uniq
  ON public.refund_cases (user_id, submission_key);

-- One ACTIVE case per charge. Two concurrent requests for the same failed call
-- cannot both be open; a completed or declined case is not "active", so a user
-- may raise a new issue after a rejection (which an administrator decides).
CREATE UNIQUE INDEX IF NOT EXISTS refund_cases_one_active_per_charge
  ON public.refund_cases (user_id, charge_key)
  WHERE charge_key IS NOT NULL
    AND status IN ('submitted', 'under_review', 'approved_processing', 'awaiting_provider');

CREATE INDEX IF NOT EXISTS refund_cases_user_created_idx
  ON public.refund_cases (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refund_cases_status_created_idx
  ON public.refund_cases (status, created_at DESC);
CREATE INDEX IF NOT EXISTS refund_cases_charge_key_idx
  ON public.refund_cases (charge_key)
  WHERE charge_key IS NOT NULL;

ALTER TABLE public.refund_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refund_cases FROM PUBLIC, anon, authenticated;
-- Column grants, not `GRANT SELECT ON`: an athlete may read their case, but not
-- the administrator's private note, the internal eligibility snapshot, the
-- submission key or which administrator touched it. The app reads through
-- refund-request anyway; this closes the direct-table path too.
GRANT SELECT (
  id, public_ref, user_id, kind, source_type, reason_code, details,
  charge_transaction_id, charge_key, purchase_id, service_job_id, feature,
  credits_requested, amount_cents, currency, status, resolution,
  escalation_rules, provider, provider_refund_id, provider_state,
  decided_at, completed_at, created_at, updated_at
) ON public.refund_cases TO authenticated;
GRANT ALL ON public.refund_cases TO service_role;

-- A user sees their own cases and nothing else. There is deliberately no INSERT
-- or UPDATE policy: every write is an authenticated edge function holding the
-- service-role credential and re-deriving the facts itself.
DROP POLICY IF EXISTS "Users can read their own refund cases" ON public.refund_cases;
CREATE POLICY "Users can read their own refund cases" ON public.refund_cases
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read all refund cases" ON public.refund_cases;
CREATE POLICY "Admins can read all refund cases" ON public.refund_cases
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS update_refund_cases_updated_at ON public.refund_cases;
CREATE TRIGGER update_refund_cases_updated_at BEFORE UPDATE ON public.refund_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3. Case timeline — append-only audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.refund_case_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES public.refund_cases(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'system', 'admin', 'provider')),
  actor_id uuid,
  event text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refund_case_events_case_idx
  ON public.refund_case_events (case_id, created_at);

ALTER TABLE public.refund_case_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refund_case_events FROM PUBLIC, anon, authenticated;
-- actor_id is an administrator's user id; it is not part of the customer's
-- timeline (the function returns the event label and time only).
GRANT SELECT (id, case_id, actor_type, event, detail, created_at)
  ON public.refund_case_events TO authenticated;
GRANT ALL ON public.refund_case_events TO service_role;

-- Reading an event requires being able to read its case. Kept as an EXISTS
-- against refund_cases rather than duplicating the ownership column, so a case
-- reassignment (never expected) cannot leak a timeline.
DROP POLICY IF EXISTS "Users can read their own refund events" ON public.refund_case_events;
CREATE POLICY "Users can read their own refund events" ON public.refund_case_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.refund_cases c
    WHERE c.id = refund_case_events.case_id AND c.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Admins can read all refund events" ON public.refund_case_events;
CREATE POLICY "Admins can read all refund events" ON public.refund_case_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 4. Notification outbox — email survives a failed send, and never repeats
-- ---------------------------------------------------------------------------
-- The case row is written BEFORE this table is touched, so a mail failure can
-- never lose the case. One row per (case, dedupe_key): the first delivery of a
-- given notification is the only one that can exist, which is what makes a
-- retried HTTP request safe.
CREATE TABLE IF NOT EXISTS public.refund_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.refund_cases(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('admin_review', 'customer_update')),
  dedupe_key text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  -- 'sending' is a short-lived claim so two retry workers cannot both mail the
  -- same notification; a stale claim is reclaimed after ten minutes.
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS refund_notifications_dedupe_uniq
  ON public.refund_notifications (case_id, kind, dedupe_key);
CREATE INDEX IF NOT EXISTS refund_notifications_pending_idx
  ON public.refund_notifications (status, next_attempt_at)
  WHERE status IN ('pending', 'sending');

ALTER TABLE public.refund_notifications ENABLE ROW LEVEL SECURITY;
-- No policy at all: the outbox holds message bodies addressed to one person and
-- is readable only by the service role.
REVOKE ALL ON public.refund_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.refund_notifications TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Atomic credit restoration
-- ---------------------------------------------------------------------------
-- The one place credits go back for a refund case. Every guard that matters is
-- inside this function, under one row lock:
--   * only the service role (an edge function that already verified the caller)
--   * only a credit case
--   * only from a state that can still be decided
--   * never if the same charge was already restored by another case
--   * a ledger grant whose key derives from the CHARGE, so even a duplicate
--     call that got past the checks collapses into the existing ledger row.
-- Returns {success, duplicate, balance, grant_key} or a machine-readable error.
CREATE OR REPLACE FUNCTION public.refund_execute_credit_restore(
  p_case_id uuid,
  p_admin_id uuid DEFAULT NULL,
  p_source text DEFAULT 'refund'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_case public.refund_cases;
  v_other uuid;
  v_grant jsonb;
  v_key text;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'Missing refund case';
  END IF;
  IF p_admin_id IS NOT NULL AND NOT public.has_role(p_admin_id, 'admin') THEN
    RAISE EXCEPTION 'Not an administrator';
  END IF;

  SELECT * INTO v_case FROM public.refund_cases WHERE id = p_case_id FOR UPDATE;
  IF v_case.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unknown_case');
  END IF;

  IF v_case.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'status', v_case.status);
  END IF;
  IF v_case.kind <> 'credits' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_a_credit_case');
  END IF;
  IF v_case.status NOT IN ('submitted', 'under_review', 'approved_processing') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_state', 'status', v_case.status);
  END IF;
  IF v_case.credits_requested IS NULL OR v_case.credits_requested <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_amount');
  END IF;

  -- Serialize on the charge. The row lock above serializes THIS case; the
  -- advisory lock serializes two DIFFERENT cases for the same charge.
  IF v_case.charge_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_case.user_id::text || ':' || v_case.charge_key, 0)
    );

    SELECT c.id INTO v_other
      FROM public.refund_cases c
     WHERE c.user_id = v_case.user_id
       AND c.charge_key = v_case.charge_key
       AND c.id <> v_case.id
       AND c.status = 'completed'
       AND c.resolution IN ('auto_credit_restored', 'admin_credit_restored')
     LIMIT 1;

    IF v_other IS NOT NULL THEN
      UPDATE public.refund_cases
         SET status = 'declined',
             resolution = 'already_restored',
             admin_note = COALESCE(admin_note, '') ||
               ' [system: credits were already restored for this transaction]',
             decided_at = COALESCE(decided_at, now())
       WHERE id = v_case.id;
      INSERT INTO public.refund_case_events (case_id, actor_type, event, detail)
      VALUES (v_case.id, 'system', 'rejected_already_restored',
              jsonb_build_object('other_case', v_other));
      RETURN jsonb_build_object('success', false, 'error', 'already_restored', 'other_case', v_other);
    END IF;
  END IF;

  -- The key is derived from the charge, not the case, so the ledger itself is
  -- the final duplicate guard even if every check above were bypassed.
  v_key := 'refundcase:' || COALESCE(v_case.charge_key, v_case.public_ref);

  v_grant := public.credits_grant(
    v_case.user_id,
    v_case.credits_requested,
    COALESCE(v_case.reason_code, 'refund'),
    p_source,
    v_key,
    jsonb_build_object(
      'kind', 'refund',
      'case_ref', v_case.public_ref,
      'charge_key', v_case.charge_key
    )
  );

  IF COALESCE((v_grant ->> 'success')::boolean, false) = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'grant_failed', 'detail', v_grant);
  END IF;

  UPDATE public.refund_cases
     SET status = 'completed',
         resolution = CASE WHEN p_admin_id IS NULL THEN 'auto_credit_restored' ELSE 'admin_credit_restored' END,
         admin_id = COALESCE(p_admin_id, admin_id),
         decided_at = COALESCE(decided_at, now()),
         completed_at = now(),
         eligibility = eligibility || jsonb_build_object('grant_key', v_key, 'restored_at', now())
   WHERE id = v_case.id;

  INSERT INTO public.refund_case_events (case_id, actor_type, actor_id, event, detail)
  VALUES (
    v_case.id,
    CASE WHEN p_admin_id IS NULL THEN 'system' ELSE 'admin' END,
    p_admin_id,
    'credits_restored',
    jsonb_build_object('credits', v_case.credits_requested, 'grant_key', v_key)
  );

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', COALESCE((v_grant ->> 'duplicate')::boolean, false),
    'balance', (v_grant ->> 'balance')::integer,
    'grant_key', v_key
  );
END $$;

REVOKE ALL ON FUNCTION public.refund_execute_credit_restore(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_execute_credit_restore(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Administrator rejection (reason mandatory, audit preserved)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_case_reject(
  p_case_id uuid,
  p_admin_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_case public.refund_cases;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin') THEN
    RAISE EXCEPTION 'Not an administrator';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT * INTO v_case FROM public.refund_cases WHERE id = p_case_id FOR UPDATE;
  IF v_case.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unknown_case');
  END IF;
  IF v_case.status = 'declined' THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true, 'status', v_case.status);
  END IF;
  IF v_case.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_completed');
  END IF;
  IF v_case.status NOT IN ('submitted', 'under_review', 'approved_processing', 'awaiting_provider') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_state', 'status', v_case.status);
  END IF;

  UPDATE public.refund_cases
     SET status = 'declined',
         resolution = 'rejected',
         admin_id = p_admin_id,
         admin_note = btrim(p_reason),
         decided_at = now(),
         completed_at = now()
   WHERE id = p_case_id;

  INSERT INTO public.refund_case_events (case_id, actor_type, actor_id, event, detail)
  VALUES (p_case_id, 'admin', p_admin_id, 'rejected', jsonb_build_object('reason', btrim(p_reason)));

  RETURN jsonb_build_object('success', true, 'duplicate', false, 'status', 'declined');
END $$;

REVOKE ALL ON FUNCTION public.refund_case_reject(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_case_reject(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Provider-stage transitions (money / subscription)
-- ---------------------------------------------------------------------------
-- No branch here can mark a monetary refund 'completed': only a provider-issued
-- refund reference can, and p_provider_refund_id is mandatory for that state.
-- Before a provider exists the edge function calls this with 'awaiting_provider',
-- which is the honest description of an approved-but-unpayable refund.
CREATE OR REPLACE FUNCTION public.refund_case_record_provider_decision(
  p_case_id uuid,
  p_admin_id uuid,
  p_state text,
  p_provider text DEFAULT NULL,
  p_provider_refund_id text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_case public.refund_cases;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin') THEN
    RAISE EXCEPTION 'Not an administrator';
  END IF;
  IF p_state NOT IN ('awaiting_provider', 'approved_processing', 'processing_failed', 'completed') THEN
    RAISE EXCEPTION 'Invalid provider state';
  END IF;
  IF p_state = 'completed' AND NULLIF(btrim(COALESCE(p_provider_refund_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A provider refund reference is required to complete a monetary refund';
  END IF;

  SELECT * INTO v_case FROM public.refund_cases WHERE id = p_case_id FOR UPDATE;
  IF v_case.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unknown_case');
  END IF;
  IF v_case.status IN ('completed', 'declined') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_decided', 'status', v_case.status);
  END IF;

  UPDATE public.refund_cases
     SET status = p_state,
         resolution = CASE
           WHEN p_state = 'completed' THEN 'monetary_refunded'
           WHEN p_state = 'awaiting_provider' THEN 'awaiting_provider'
           WHEN p_state = 'processing_failed' THEN 'provider_failed'
           ELSE resolution
         END,
         provider = COALESCE(p_provider, provider),
         provider_refund_id = COALESCE(p_provider_refund_id, provider_refund_id),
         provider_state = p_state,
         admin_id = p_admin_id,
         admin_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), admin_note),
         decided_at = COALESCE(decided_at, now()),
         completed_at = CASE WHEN p_state = 'completed' THEN now() ELSE completed_at END
   WHERE id = p_case_id;

  INSERT INTO public.refund_case_events (case_id, actor_type, actor_id, event, detail)
  VALUES (p_case_id, 'admin', p_admin_id, 'provider_state_' || p_state,
          jsonb_build_object('provider', p_provider, 'provider_refund_id', p_provider_refund_id));

  RETURN jsonb_build_object('success', true, 'status', p_state);
END $$;

REVOKE ALL ON FUNCTION public.refund_case_record_provider_decision(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_case_record_provider_decision(uuid, uuid, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Scheduled retry for the notification outbox
-- ---------------------------------------------------------------------------
-- The inline attempt in refund-request/refund-admin covers the normal case.
-- This is the safety net for a transient SMTP outage: every 15 minutes it asks
-- refund-notify to deliver rows that are still pending, with the bounded
-- backoff refundNotify.ts already applied. It sends mail only; no path here can
-- move money or decide a case.
--
-- The secret is read from Vault at fire time and sent as x-cron-secret, so it
-- is never written into cron.job or this file. Same pattern as
-- waitlist_trigger_campaigns(); the URL is the project's own endpoint, written
-- out because the project ref cannot be read from inside the database.
CREATE OR REPLACE FUNCTION public.refund_trigger_notification_retry()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT ds.decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets ds
   WHERE ds.name = 'refund_cron_secret'
   LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE WARNING 'refund_trigger_notification_retry: vault secret "refund_cron_secret" is not set; nothing was retried';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://vvwhausdjzdmsyxekrcl.supabase.co/functions/v1/refund-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  ) INTO v_request_id;

  RETURN v_request_id;
END $$;

REVOKE ALL ON FUNCTION public.refund_trigger_notification_retry() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_trigger_notification_retry() TO service_role;

-- Named so redeploying this migration does not stack a second job; cron.schedule
-- updates by job name.
SELECT cron.schedule(
  'refund-notify-retry',
  '*/15 * * * *',
  $$select public.refund_trigger_notification_retry()$$
);
