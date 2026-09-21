
-- 1. Subscriptions: remove client-writable INSERT/UPDATE policies
DROP POLICY IF EXISTS "Users can insert own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update own subscription" ON public.subscriptions;

-- 2. Achievements: restrict INSERT to authenticated only
DROP POLICY IF EXISTS "Users can insert their own achievements" ON public.achievements;
CREATE POLICY "Users can insert their own achievements"
ON public.achievements FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own achievements" ON public.achievements;
CREATE POLICY "Users can view their own achievements"
ON public.achievements FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 3. Profiles: prevent direct credit manipulation via trigger
-- All credit changes must go through SECURITY DEFINER functions which set a session-local flag.
CREATE OR REPLACE FUNCTION public.guard_profile_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.credits IS DISTINCT FROM OLD.credits THEN
    IF current_setting('app.allow_credit_change', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Direct updates to credits are not allowed. Use add_credits or spend_credits.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_credits_trg ON public.profiles;
CREATE TRIGGER guard_profile_credits_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_credits();

-- 4. Server-side credit management functions
CREATE OR REPLACE FUNCTION public.spend_credits(p_amount integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_current integer;
  v_new integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;

  SELECT credits INTO v_current FROM public.profiles WHERE user_id = v_user FOR UPDATE;
  IF v_current IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;
  IF v_current < p_amount THEN RAISE EXCEPTION 'Insufficient credits'; END IF;

  v_new := v_current - p_amount;
  PERFORM set_config('app.allow_credit_change', 'on', true);
  UPDATE public.profiles SET credits = v_new WHERE user_id = v_user;
  PERFORM set_config('app.allow_credit_change', 'off', true);

  INSERT INTO public.credit_transactions (user_id, amount, reason)
  VALUES (v_user, -p_amount, p_reason);

  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_credits(p_amount integer, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_current integer;
  v_new integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  -- Cap arcade-style awards to prevent abuse
  IF p_amount > 50 THEN RAISE EXCEPTION 'Amount exceeds allowed limit'; END IF;

  SELECT credits INTO v_current FROM public.profiles WHERE user_id = v_user FOR UPDATE;
  IF v_current IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  v_new := v_current + p_amount;
  PERFORM set_config('app.allow_credit_change', 'on', true);
  UPDATE public.profiles SET credits = v_new WHERE user_id = v_user;
  PERFORM set_config('app.allow_credit_change', 'off', true);

  INSERT INTO public.credit_transactions (user_id, amount, reason)
  VALUES (v_user, p_amount, p_reason);

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_credits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_credits(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits(integer, text) TO authenticated;
