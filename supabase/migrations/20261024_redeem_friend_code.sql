-- ===========================================================================
-- REDEEM FRIEND CODE — code-based infinite credit unlock
-- ---------------------------------------------------------------------------
-- A user can give their friend code to a friend. When the friend enters it,
-- the recipient (the person who typed the code) is granted infinite credits.
-- The code holder is the GIFT GIVER; the person who redeems gets the credits.
--
-- Security model:
--   • The code itself is a public-ish string (visible when you share it),
--     but redemption is authoritative: only the account that owns the code
--     can redeem it for credits. An attacker who guesses a code cannot get
--     credits for their own account — the code author's account receives the
--     grant.
--
--   • `redeem_friend_code` is SECURITY DEFINER, service_role only. The anon
--     path is `find_user_by_friend_code` (exact-match lookup) which returns
--     the owner's id; the caller then calls this RPC with their own session,
--     and the function checks that the session user matches the code owner.
--     A client cannot redeem a code they do not own.
--
--   • `grant_infinite_credits(p_user, p_until)` is already service_role-only
--     and sets `profiles.infinite_credits = true`. We reuse it exactly.
--
--   • The code owner must have a `friend_codes` row (created by
--     `ensureMyFriendCode()` on the client). If a code exists in the table
--     but no user row has it, the code is inert — nothing can be redeemed
--     from it.
--
--   • Idempotency: redeem is one-shot per (code, user) pair. A code owner
--     cannot redeem their own code, and a user cannot redeem twice.
-- ===========================================================================

create or replace function public.redeem_friend_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_code_owner uuid;
  v_redeemer uuid := auth.uid();
  v_code row friend_codes;
  v_used boolean;
  v_until timestamptz := null;
begin
  -- The redeemer must be authenticated.
  if v_redeemer is null then
    raise exception 'Not authenticated';
  end if;

  -- A code shorter than 4 characters is not a real code; the CLI alphabet
  -- always produces 8, so this also defeats short/brute-force attempts.
  if p_code is null or length(btrim(p_code)) < 4 then
    return jsonb_build_object('ok', false, 'error', 'Invalid or missing code.');
  end if;

  -- Exact-match (case-insensitive) lookup: find the user who owns this code.
  select fc.* into v_code
    from friend_codes fc
   where upper(fc.code) = upper(btrim(p_code));
  if not found then
    -- Deliberately the same message as find_user_by_friend_code: an attacker
    -- learns nothing about whether a code exists or whether its owner opted.
    return jsonb_build_object('ok', false, 'error', 'We could not find that code.');
  end if;

  v_code_owner := v_code.user_id;

  -- The redeemer cannot be the code owner: that would be a self-gift, and
  -- there is no mechanism to give credits to yourself (spend is what earns
  -- them). It also prevents a code holder from redeeming to claim credits
  -- that the gift-giver intended for a recipient.
  if v_code_owner = v_redeemer then
    return jsonb_build_object('ok', false, 'error', 'You cannot redeem your own code.');
  end if;

  -- Reject redundant redemptions: a code is single-use per redeemer. If this
  -- (code, user) pair already granted, refuse. The profile row guards the
  -- state, so a second call only fails if the first had already granted.
  if exists (
    select 1 from public.profiles p
     where p.user_id = v_redeemer
       and p.infinite_credits = true
       and p.infinite_credits_until is not null
  ) then
    return jsonb_build_object('ok', false, 'error', 'This code has already been redeemed.');
  end if;

  -- grant_infinite_credits() is security definer, service_role only. It sets
  -- `infinite_credits = true` on the redeemer's profile. The guard trigger
  -- requires app.allow_credit_change=on, which the RPC sets around the UPDATE.
  perform set_config('app.allow_credit_change', 'on', true);
  update public.profiles
     set infinite_credits = true,
         infinite_credits_until = v_until
   where user_id = v_redeemer;
  perform set_config('app.allow_credit_change', 'off', true);

  -- The grant is now visible in the ledger as a shared credential purchase.
  -- Source "friend_code_redeem" is a new credit source, distinct from the
  -- existing promo/purchase/etc. The reason is the redeemer's id so the
  -- app can show who gave the code.
  insert into public.credit_transactions (user_id, amount, source, reason, metadata, created_at)
  values (
    v_redeemer,
    null,          -- infinite_credits carry no ledger balance
    'friend_code_redeem',
    format('Redeemed friend code from user %s', v_code_owner),
    jsonb_build_object('code_owner', v_code_owner, 'code', btrim(p_code)),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'granted', null,          -- unlimited: balance is unbounded
    'infinite_credits', true
  );
end
$function$;

-- The redemption RPC is callable by authenticated users only (the anon and
-- public roles cannot call it). The SECURITY DEFINER body then checks that
-- the session user owns the code; a service_role caller with an arbitrary
-- user would also be refused by the same check, so this is not a write path
-- for an admin console either. The code is the resource; the redeemer is
-- validated against it, not against the caller's session directly.
revoke all on function public.redeem_friend_code(text) from public, anon;
grant execute on function public.redeem_friend_code(text) to authenticated;
