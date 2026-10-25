-- ===========================================================================
-- SEED: friend code 220147
-- ---------------------------------------------------------------------------
-- Inserts the gift code 220147 into friend_codes so that redemption is
-- possible. The code is owned by a demo/admin account; whoever redeems the
-- code receives infinite credits (see redeem_friend_code RPC).
--
-- To change ownership: replace the demo user id below with a real account id
-- once the project has seeded users. The code itself is the shared resource;
-- only the account that stored it can give it.
-- ===========================================================================

-- Pick a demo account for the code owner. This is a placeholder UUID that
-- matches the shape of a real user id; swap it for a real user once the
-- project has any authenticated users to point the code at.
-- Test account used for the closed-test bundle (docs/CLOSED-TEST.md).
DO $$
declare
  v_demo_user uuid := '00000000-0000-0000-0000-000000000001';
  v_exists boolean;
begin
  -- No-op: the friend_codes table uses a unique constraint on `code`,
  -- so an INSERT ... ON CONFLICT DO NOTHING is always idempotent.
  insert into public.friend_codes (user_id, code)
  values (v_demo_user, '220147')
  on conflict (code) do nothing;

  -- Confirm the row landed (idempotent re-runs are safe).
  select exists (select 1 from public.friend_codes where code = '220147') into v_exists;
  if v_exists then
    raise noticE 'Seeded friend code 220147 for user %', v_demo_user;
  end if;
end $$;
