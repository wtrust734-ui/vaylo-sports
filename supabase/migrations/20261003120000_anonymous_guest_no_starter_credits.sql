-- ===========================================================================
-- Anonymous web guests must not receive the starter credit grant
-- ----------------------------------------------------------------------------
-- Why
--
-- The marketing site mounts the live app at /play/. A visitor there used to hit
-- a sign-in wall whose OAuth buttons could not work (the site is on
-- .netlify.app, so there is no owned domain to receive the OAuth redirect).
-- They now go straight into the app as a guest, which means the client calls
-- supabase.auth.signInAnonymously().
--
-- That call fires exactly the same on_auth_user_created trigger as a real
-- sign-up, and handle_new_user() grants public.starting_credits() — currently
-- 50. Anonymous sign-in is unauthenticated and unrate-limited, so without this
-- change any visitor could mint unlimited accounts and 50 credits each by
-- looping the call. There were 11 profiles before this change.
--
-- So: anonymous users get a profile with zero credits, no subscription grant and
-- no credit_transaction row. Nothing else about the account changes — a guest is
-- a real account with a real uuid and real RLS, so every screen behind
-- AppLayout's session gate works normally. It simply cannot be used to extract
-- value.
--
-- Deliberately NOT done here
--
--   - No rate limiting on signInAnonymously. That belongs at the edge (a
--     per-IP limit on the auth endpoint), not in a trigger, and is not
--     something this migration can do.
--   - No guest expiry or cleanup. Profiles with zero credits and no activity are
--     harmless, and a deletion job that removes rows other tables reference is a
--     much bigger change than this one.
--   - The trigger still inserts a subscription row. It is the 'free' plan, which
--     is what every account has, and several screens read it; an account
--     without one would look like a broken account rather than a guest.
--
-- Existing accounts are untouched: this only changes the grant for rows created
-- from now on, and only when auth.users.is_anonymous is true.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start integer := 0;
BEGIN
  -- An anonymous guest is not a signed-up athlete, so the starter grant does
  -- not apply. starting_credits() is still called for everyone else, which
  -- keeps this function reading the configured economy value rather than a
  -- literal.
  IF NEW.is_anonymous IS DISTINCT FROM true THEN
    v_start := public.starting_credits();
  END IF;

  INSERT INTO public.profiles (user_id, credits) VALUES (NEW.id, v_start);
  INSERT INTO public.subscriptions (user_id, plan_type, status) VALUES (NEW.id, 'free', 'free');

  -- No transaction row for a zero grant. A credit_transactions row recording
  -- "+0 starter credits" is noise that would read as a real ledger entry.
  IF v_start <> 0 THEN
    INSERT INTO public.credit_transactions (user_id, amount, reason, source, balance_after, idempotency_key)
    VALUES (NEW.id, v_start, 'Starter credits', 'starter', v_start, 'starter:' || NEW.id::text);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates the profile/subscription for a new auth user. Anonymous (web guest) '
  'accounts get zero starter credits and no ledger row, so unauthenticated '
  'sign-in cannot be used to mint credit.';


-- The client needs to tell a guest from a real account, for two reasons: to show
-- a name (an anonymous user has no email and no metadata, so every
-- name-derivation path yields null), and to know that "sign out" cannot be
-- offered — there is no credential to return to, so the web build sends a
-- guest straight back in rather than stranding them on a sign-in wall.
--
-- Recorded on the profile rather than inferred in the client: auth.users is not
-- readable under RLS, so is_anonymous is only reliably available inside the
-- database. This column is the client-visible copy, and it is written by the
-- trigger in the same transaction as the account, so it cannot drift.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_guest IS
  'True for accounts created through supabase.auth.signInAnonymously() (web '
  'guests on /play/). Such accounts get zero starter credits and cannot sign '
  'in again once signed out.';

-- Backfill: any pre-existing account that was created anonymously before this
-- migration. There should be none (anonymous sign-in was disabled), so this is
-- a no-op that makes the column correct rather than merely plausible if the
-- setting is ever toggled on and then off.
UPDATE public.profiles p
SET is_guest = true
FROM auth.users u
WHERE u.id = p.user_id
  AND u.is_anonymous IS TRUE
  AND p.is_guest IS DISTINCT FROM true;
