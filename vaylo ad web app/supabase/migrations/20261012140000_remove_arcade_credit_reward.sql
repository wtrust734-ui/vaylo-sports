-- ============================================================================
-- THE ARCADE Payout, REMOVED AT THE SOURCE
-- ----------------------------------------------------------------------------
-- The client stopped paying 10 credits for a beaten mini-game record on
-- 2026-10-12 (src/pages/Arcade.tsx, PROMO_BONUSES in src/config/credits.ts).
-- That was only half the fix, and the live project proved it: `promo_bonuses`
-- still carried `arcade_record: 10`, and `public.credits_claim_reward()` grants
-- whatever key it is handed straight out of that row:
--
--   v_amount := COALESCE((public.economy_value('promo_bonuses') ->> p_kind)::integer, 0);
--
-- So the payout was still reachable by any signed-in client with one RPC call,
-- twenty times a day up to the function's own 150-credit rolling ceiling — an
-- unlimited credit tap paying out faster than the games it was written for, and
-- one no screen in the app needed to exist to farm. Shipping the client change
-- alone would have left that door open and made the "removed" claim untrue.
--
-- Removed rather than zeroed, the same call this repo made for
-- `form_analysis_unlock` and the other retired flat rates: the function refuses
-- an unknown key ("Unknown or disabled reward"), and a 0 would sit in the row as
-- a decoy for the next person to wire back up.
--
-- The three real rewards stay exactly as they are. referral_referrer (50),
-- referral_referee (25) and winback (20) are what the app's PROMO_BONUSES
-- declares, and they are earned by actions a client cannot forge — a referral
-- that was accepted, a lapsed athlete who came back.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop the key. One jsonb subtraction, so it cannot be half-applied.
-- ---------------------------------------------------------------------------
UPDATE public.economy_config
SET value = (value::jsonb - 'arcade_record')
WHERE key = 'promo_bonuses' AND region = 'GLOBAL';

-- ---------------------------------------------------------------------------
-- 2. Assertions — fail rather than leave the tap open or break a real reward.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb := public.economy_value('promo_bonuses');
BEGIN
  IF (v ? 'arcade_record') THEN
    RAISE EXCEPTION 'arcade_record is still claimable — the mini-game credit tap is open';
  END IF;

  -- The rewards that survive are the ones with a server-verifiable trigger. If
  -- one of them is missing, the migration has taken a payout out with the tap.
  IF (v ->> 'referral_referrer')::integer IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'referral_referrer moved (got %)', v ->> 'referral_referrer';
  END IF;
  IF (v ->> 'referral_referee')::integer IS DISTINCT FROM 25 THEN
    RAISE EXCEPTION 'referral_referee moved (got %)', v ->> 'referral_referee';
  END IF;
  IF (v ->> 'winback')::integer IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'winback moved (got %)', v ->> 'winback';
  END IF;
END $$;
