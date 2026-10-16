-- ============================================================================
-- REWARD BOX CLAIMS — bounded, once-per-milestone cosmetic grants
-- ----------------------------------------------------------------------------
-- The client plans milestone boxes locally (src/lib/rewardBoxes.ts: streak
-- days, qualifying referrals). Opening one must grant a real avatar cosmetic,
-- but the client cannot be trusted to pick what it grants — purchase RPCs are
-- priced server-side for exactly this reason. So the SERVER picks the item
-- from the milestone's rarity tier (preferring what the athlete does not own),
-- grants ownership without touching the wallet, and records the claim.
--
-- BOUNDED BY DESIGN (the economics):
--   * One claim per (user, source, threshold) — enforced by the primary key.
--     The client-side streak ledger is unverifiable server-side, so a client
--     can lie about the streak, but the very most it can extract is ONE item
--     per milestone from that milestone's tier: 12 boxes, fixed pools, no
--     coins, no credits. That ceiling is the deliberate cost of the reward
--     programme; everything else about it is cosmetic-only.
--   * The grant bypasses the wallet through the same transaction-scoped GUC
--     (app.avatar_grant) that purchase_avatar_item_coins uses for free items —
--     no new trust surface, no client-settable flag.
-- ============================================================================

create table if not exists public.reward_box_claims (
  user_id    uuid not null references auth.users (id) on delete cascade,
  source     text not null check (source in ('streak', 'referral', 'challenge')),
  threshold  integer not null check (threshold > 0),
  item_id    text not null references public.avatar_catalog (item_id),
  granted_at timestamptz not null default now(),
  primary key (user_id, source, threshold)
);

-- Claims are read only through the claim function (which returns the caller's
-- own row); there is no list endpoint, so no client role needs the table.
alter table public.reward_box_claims enable row level security;
revoke all on table public.reward_box_claims from public, anon, authenticated;
grant all on table public.reward_box_claims to service_role;

create or replace function public.claim_reward_box(p_source text, p_threshold integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_rarity text;
  v_claim public.reward_box_claims%rowtype;
  v_item_id text;
  v_category text;
  v_item_rarity text;
  v_cost integer;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;

  -- Milestone tiers, mirrored from src/lib/rewardBoxes.ts (BOX_MILESTONES).
  -- A threshold outside the table is refused rather than silently granted.
  v_rarity := case
    when p_source = 'streak' and p_threshold in (3, 7) then 'rare'
    when p_source = 'streak' and p_threshold in (14, 30) then 'epic'
    when p_source = 'streak' and p_threshold in (60, 100) then 'legendary'
    when p_source = 'streak' and p_threshold in (200, 365) then 'mythic'
    when p_source = 'referral' and p_threshold = 1 then 'rare'
    when p_source = 'referral' and p_threshold in (3, 5) then 'epic'
    when p_source = 'referral' and p_threshold = 10 then 'legendary'
    else null
  end;
  if v_rarity is null then
    raise exception 'Unknown reward box';
  end if;

  -- Idempotent: a repeat call returns the original grant, never a second one.
  select * into v_claim
    from public.reward_box_claims
   where user_id = v_user and source = p_source and threshold = p_threshold;
  if found then
    select item_id, category, rarity, cost
      into v_item_id, v_category, v_item_rarity, v_cost
      from public.avatar_catalog where item_id = v_claim.item_id;
    return jsonb_build_object(
      'already_claimed', true,
      'item_id', v_claim.item_id,
      'category', v_category,
      'rarity', coalesce(v_item_rarity, 'rare'),
      'cost', coalesce(v_cost, 0)
    );
  end if;

  -- Deterministic per (user, box) — md5 of stable inputs, not a clock or a
  -- sequence — and preferring items the athlete does not own, so most boxes
  -- are a genuine addition.
  select c.item_id, c.category, c.rarity, c.cost
    into v_item_id, v_category, v_item_rarity, v_cost
    from public.avatar_catalog c
   where c.rarity = v_rarity
     and c.cost > 0
     and not exists (
       select 1 from public.avatar_items ai where ai.user_id = v_user and ai.item_id = c.item_id
     )
   order by md5(c.item_id || ':' || v_user::text || ':' || p_source || ':' || p_threshold::text)
   limit 1;

  if v_item_id is null then
    -- The whole tier is collected. Any item in the tier will do: the client
    -- shows "you already own everything in this box" and the ownership insert
    -- below no-ops, so nothing can be duplicated or double-charged.
    select c.item_id, c.category, c.rarity, c.cost
      into v_item_id, v_category, v_item_rarity, v_cost
      from public.avatar_catalog c
     where c.rarity = v_rarity and c.cost > 0
     order by md5(c.item_id || ':' || v_user::text || ':' || p_source || ':' || p_threshold::text)
     limit 1;
  end if;

  if v_item_id is null then
    raise exception 'This box has no rewards configured yet';
  end if;

  insert into public.reward_box_claims (user_id, source, threshold, item_id)
  values (v_user, p_source, p_threshold, v_item_id);

  -- Ownership grant without the wallet charge. The same transaction-scoped
  -- GUC purchase_avatar_item_coins relies on; no client can set it.
  perform set_config('app.avatar_grant', 'on', true);
  insert into public.avatar_items (user_id, item_id, category, rarity)
  select v_user, v_item_id, v_category, v_item_rarity
   where not exists (
     select 1 from public.avatar_items where user_id = v_user and item_id = v_item_id
   );

  return jsonb_build_object(
    'already_claimed', false,
    'item_id', v_item_id,
    'category', v_category,
    'rarity', coalesce(v_item_rarity, 'rare'),
    'cost', coalesce(v_cost, 0)
  );
end;
$$;

grant execute on function public.claim_reward_box(text, integer) to authenticated;
revoke execute on function public.claim_reward_box(text, integer) from public, anon;
