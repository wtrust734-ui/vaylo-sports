-- ===========================================================================
-- ECONOMY & MARKETPLACE INTEGRITY
-- ---------------------------------------------------------------------------
-- Rewards, cosmetics, event packs, creators and sponsor CTA links: the server
-- RPCs are already the price authority (they read the catalog, ignore client
-- prices); this migration closes the remaining client-writable paths and
-- normalises the identity surface.
--
-- PostgreSQL CHECK constraints cannot contain subqueries, so cross-row rules
-- (ownership, probability sums, immutable counters) are BEFORE triggers.
--
-- Live-data check 2026-09-30: avatar_items, user_rewards, chest_claims,
-- event_pack_ownership, coach_bookings, marketplace_listings and
-- creator_profiles are all EMPTY except the admin-owned catalog (246 items,
-- 78 free), so every new constraint and trigger is safe to add.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. CATALOG VALUE SETS — admins write these tables; the constraints are the
--    tripwire that keeps one bad admin row from breaking the app.
-- ---------------------------------------------------------------------------
alter table public.avatar_catalog
  drop constraint if exists avatar_catalog_shape;
alter table public.avatar_catalog
  add constraint avatar_catalog_shape
  check (
    cost >= 0
    and rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')
    and char_length(item_id) between 1 and 80
  );

alter table public.reward_definitions
  drop constraint if exists reward_definitions_shape;
alter table public.reward_definitions
  add constraint reward_definitions_shape
  check (
    rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')
    and (coin_cost is null or coin_cost >= 0)
    and char_length(id) between 1 and 80
  );

-- Chest probability rows must sum to 100 (open-chest falls back to the known
-- set if the config is missing, but a malformed row must not ship), and every
-- duplicate-conversion value must be at least 1 credit.
create or replace function public.guard_reward_config()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_total numeric;
  v_bad int;
begin
  select coalesce(sum((value)::numeric), 0) into v_total
    from jsonb_each_text(coalesce(new.probabilities, '{}'::jsonb));
  if v_total <> 100 then
    raise exception 'Chest probabilities must sum to 100 (got %)', v_total;
  end if;

  select count(*) into v_bad
    from jsonb_each_text(coalesce(new.duplicate_conversion, '{}'::jsonb))
    where (value)::numeric < 1;
  if v_bad > 0 then
    raise exception 'Duplicate conversion values must be at least 1 credit';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reward_config on public.reward_config;
create trigger trg_reward_config
  before insert or update of probabilities, duplicate_conversion on public.reward_config
  for each row execute function public.guard_reward_config();

-- ---------------------------------------------------------------------------
-- 2. AVATARS — display name bounds; prestige cannot be self-granted
-- ---------------------------------------------------------------------------
alter table public.avatars
  drop constraint if exists avatars_display_name_shape;
alter table public.avatars
  add constraint avatars_display_name_shape
  check (display_name is null or char_length(btrim(display_name)) between 1 and 24);

-- ---------------------------------------------------------------------------
-- 3. OWNERSHIP ENFORCEMENT
-- ---------------------------------------------------------------------------
-- 3a. avatar_items: only FREE catalog items may be inserted directly (the
--     avatar screen's identity customisation). Paid items must arrive through
--     purchase_avatar_item_coins, chests or admin grants.
create or replace function public.guard_avatar_item_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- The purchase RPC sets this GUC locally (transaction-scoped) right before
  -- its own ownership insert, after the wallet charge succeeded. No client can
  -- set it: it only ever exists inside the security-definer call.
  if coalesce(current_setting('app.avatar_grant', true), '') = 'on' then
    return new;
  end if;
  if not exists (
    select 1 from public.avatar_catalog c
     where c.item_id = new.item_id
       and c.cost = 0
  ) then
    raise exception 'Only free catalog items can be added directly — purchase it instead';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_avatar_item on public.avatar_items;
create trigger trg_guard_avatar_item
  before insert on public.avatar_items
  for each row execute function public.guard_avatar_item_insert();

-- 3b. avatars: every equipped cosmetic slot must reference an item the athlete
--     OWNS or a FREE catalog item. Legacy rows pass because their payload
--     items were free before paid items existed. prestige_level is server-
--     derived: clients can never raise it (an update may only keep it).
create or replace function public.guard_avatar_equips()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item text;
  v_owned boolean;
  v_slots_unchanged boolean;
begin
  -- Prestige is server-derived: an update may keep it but never raise it, and
  -- a fresh avatar always starts at zero regardless of the payload.
  if tg_op = 'UPDATE' and new.prestige_level > old.prestige_level then
    raise exception 'Prestige cannot be increased directly';
  end if;
  if tg_op = 'INSERT' and new.prestige_level > 0 then
    new.prestige_level := 0;
  end if;

  -- Legacy forgiveness: a pre-existing avatar row keeps rendering even if a
  -- stored slot later becomes a paid/unowned item (catalog retirement, admin
  -- cost change). The pass-through covers only rows whose six ownership-
  -- relevant slots are ALL unchanged (skin_tone, display_name, extras and
  -- is_setup are always-free fields and never smuggle ownership), so no client
  -- can switch to a new unowned item through an update.
  v_slots_unchanged :=
    tg_op = 'UPDATE'
    and old.outfit is not distinct from new.outfit
    and old.headgear is not distinct from new.headgear
    and old.accessory is not distinct from new.accessory
    and old.badge is not distinct from new.badge
    and old.background is not distinct from new.background
    and old.pose is not distinct from new.pose;
  if v_slots_unchanged then
    return new;
  end if;

  foreach v_item in array array[new.outfit, new.headgear, new.accessory, new.badge, new.background, new.pose] loop
    continue when v_item is null;
    if not exists (
      select 1 from public.avatar_catalog c
       where c.item_id = v_item and c.cost = 0
    ) then
      select exists (
        select 1 from public.avatar_items ai
         where ai.user_id = new.user_id and ai.item_id = v_item
      ) into v_owned;
      if not v_owned then
        raise exception 'Cosmetic % is not owned', v_item;
      end if;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_guard_avatar_equips on public.avatars;
create trigger trg_guard_avatar_equips
  before insert or update on public.avatars
  for each row execute function public.guard_avatar_equips();

-- ---------------------------------------------------------------------------
-- 4. CREATORS — verification is admin-granted; payout email is private
-- ---------------------------------------------------------------------------
drop policy if exists "Own creator profile" on public.creator_profiles;
drop policy if exists "Public read creators" on public.creator_profiles;

create policy "Public read creator profiles"
  on public.creator_profiles for select
  to authenticated
  using (true);

create policy "Creators manage own profile"
  on public.creator_profiles for insert
  to authenticated
  with check ((select auth.uid()) = user_id and verified = false);

create policy "Creators update own profile"
  on public.creator_profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and verified = false);

alter table public.creator_profiles
  drop constraint if exists creator_profiles_payout_email_shape;
alter table public.creator_profiles
  add constraint creator_profiles_payout_email_shape
  check (payout_email is null or payout_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- ---------------------------------------------------------------------------
-- 5. MARKETPLACE LISTINGS — sales metrics are server-owned; prices bounded
-- ---------------------------------------------------------------------------
drop policy if exists "Public read listings" on public.marketplace_listings;
drop policy if exists "Creator manages own listings" on public.marketplace_listings;

create policy "Public read active listings"
  on public.marketplace_listings for select
  to authenticated
  using (active = true or creator_id = (select auth.uid()));

create policy "Creators create own listings"
  on public.marketplace_listings for insert
  to authenticated
  with check ((select auth.uid()) = creator_id);

create policy "Creators edit own listings"
  on public.marketplace_listings for update
  to authenticated
  using ((select auth.uid()) = creator_id)
  with check ((select auth.uid()) = creator_id);

create policy "Creators delete own listings"
  on public.marketplace_listings for delete
  to authenticated
  using ((select auth.uid()) = creator_id);

-- rating and sales_count are computed from real purchases; a creator edits the
-- listing, never the score. price_cents is bounded to a sane band.
create or replace function public.guard_listing_metrics()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.rating <> old.rating or new.sales_count < old.sales_count then
    raise exception 'Sales metrics are updated by the system only';
  end if;
  if new.price_cents < 0 or new.price_cents > 100000000 then
    raise exception 'Listing price out of range';
  end if;
  return new;
end;
$$;

-- The same band applies at INSERT time (a creator cannot seed a listing at an
-- absurd price), and metrics start at zero.
create or replace function public.guard_listing_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.price_cents is null or new.price_cents < 0 or new.price_cents > 100000000 then
    raise exception 'Listing price out of range';
  end if;
  if coalesce(new.sales_count, 0) <> 0 or new.rating is not null then
    raise exception 'New listings start with zero sales and no rating';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_listing_insert on public.marketplace_listings;
create trigger trg_listing_insert
  before insert on public.marketplace_listings
  for each row execute function public.guard_listing_insert();

drop trigger if exists trg_listing_metrics on public.marketplace_listings;
create trigger trg_listing_metrics
  before update on public.marketplace_listings
  for each row execute function public.guard_listing_metrics();

-- ---------------------------------------------------------------------------
-- 6. COACH BOOKINGS — client proposes, server prices; no forged video links
-- ---------------------------------------------------------------------------
drop policy if exists "Client books" on public.coach_bookings;
drop policy if exists "Participants update" on public.coach_bookings;

create policy "Clients book sessions"
  on public.coach_bookings for insert
  to authenticated
  with check (
    (select auth.uid()) = client_id
    and status = 'pending'
  );

-- Client-side booking INSERT normalization: the platform prices and provisions
-- sessions (the marketplace is pre-payment — see the report), so a booking the
-- client creates carries no price and no self-made video link.
create or replace function public.guard_booking_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.price_cents := 0;
  new.video_link := null;
  new.rating := null;
  return new;
end;
$$;

drop trigger if exists trg_booking_insert on public.coach_bookings;
create trigger trg_booking_insert
  before insert on public.coach_bookings
  for each row execute function public.guard_booking_insert();

create policy "Booking participants update"
  on public.coach_bookings for update
  to authenticated
  using ((select auth.uid()) in (coach_id, client_id))
  with check ((select auth.uid()) in (coach_id, client_id));

-- The client may set status/rating/review; price, video link and coach fields
-- are server/creator territory. A client (non-creator) update may not change
-- them; a creator update may not raise the price.
create or replace function public.guard_booking_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (select auth.uid()) = client_id and (select auth.uid()) <> coach_id then
    if new.price_cents <> old.price_cents
       or new.video_link is distinct from old.video_link
       or new.coach_id <> old.coach_id
       or new.client_id <> old.client_id then
      raise exception 'Booking price, coach and video link are managed by the platform';
    end if;
  end if;
  if new.rating is not null and (new.rating < 1 or new.rating > 5) then
    raise exception 'Rating must be 1-5';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_booking_transition on public.coach_bookings;
create trigger trg_booking_transition
  before update on public.coach_bookings
  for each row execute function public.guard_booking_transition();

-- ---------------------------------------------------------------------------
-- 7. EVENT PACKS — paid packs cannot be acquired through direct inserts.
--    (claim_event_pack is the acquisition path; free packs stay direct-insert
--    so the catalogue keeps working offline of the RPC.)
-- ---------------------------------------------------------------------------
create or replace function public.guard_pack_ownership_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_price int;
  v_credit int;
begin
  select coalesce(price_cents, 0), coalesce(credit_price, 0)
    into v_price, v_credit
    from public.event_packs where pack_id = new.pack_id;

  if v_price is null then
    -- Not in the admin catalog: built-in free packs only.
    if coalesce(new.source, 'free') <> 'free' or coalesce(new.price_cents, 0) <> 0 then
      raise exception 'Unknown pack — claim it through the app';
    end if;
    return new;
  end if;

  if v_price > 0 or v_credit > 0 then
    -- Service-role writers (Play/web payment webhooks) run with auth.uid()
    -- null and bypass this client-facing guard.
    if auth.uid() is null then
      return new;
    end if;
    -- A client-path row must carry PROOF of payment, not just a claim:
    --  · source 'credits'  → a negative credit_transactions ledger row written
    --    by claim_event_pack earlier in this same transaction,
    --  · source 'purchase' → a verified store purchase row (service-role
    --    written; clients cannot insert into user_purchases at all).
    if new.source = 'credits' then
      if not exists (
        select 1 from public.credit_transactions t
         where t.user_id = new.user_id
           and t.source = 'event_pack'
           and t.amount < 0
           and t.metadata ->> 'pack_id' = new.pack_id
      ) then
        raise exception 'Paid packs are granted only by the purchase flow';
      end if;
    elsif new.source = 'purchase' then
      if not exists (
        select 1 from public.user_purchases p
         where p.user_id = new.user_id
           and p.product_id = 'event_pack:' || new.pack_id
      ) then
        raise exception 'Paid packs are granted only by the purchase flow';
      end if;
    else
      raise exception 'Paid packs are granted only by the purchase flow';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_pack_ownership on public.event_pack_ownership;
create trigger trg_guard_pack_ownership
  before insert on public.event_pack_ownership
  for each row execute function public.guard_pack_ownership_insert();

-- ---------------------------------------------------------------------------
-- 8. SPONSOR CTA LINKS — http(s) only, never javascript:/data:
-- ---------------------------------------------------------------------------
alter table public.brand_placements
  drop constraint if exists brand_placements_cta_url_safe;
alter table public.brand_placements
  add constraint brand_placements_cta_url_safe
  check (
    cta_url is null
    or cta_url ~* '^https?://[a-z0-9.-]+(:[0-9]+)?(/|$)'
  );

-- ---------------------------------------------------------------------------
-- 9. RPC FIXES
-- ---------------------------------------------------------------------------
-- 9a. purchase_avatar_item_coins: free items are granted without touching the
--     wallet (the avatar screen's "Unlock (Free)" previously only mutated
--     local state — the ownership never persisted). Paid items keep the
--     catalog-priced spend_coins path. The p_category/p_rarity/p_cost
--     arguments stay on the wire for deployed clients but remain ignored —
--     the catalog row is authoritative.
create or replace function public.purchase_avatar_item_coins(p_item_id text, p_category text, p_rarity text, p_cost integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_existing uuid;
  v_new_coins integer;
  v_cat public.avatar_catalog%ROWTYPE;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select * into v_cat from public.avatar_catalog where item_id = p_item_id;
  if not found then
    raise exception 'Unknown cosmetic item: %', p_item_id;
  end if;

  select id into v_existing from public.avatar_items
    where user_id = v_user and item_id = p_item_id;
  if v_existing is not null then raise exception 'Item already owned'; end if;

  if v_cat.cost > 0 then
    v_new_coins := public.spend_coins(v_cat.cost, 'avatar:' || p_item_id);
  else
    -- Free item: grant ownership, no wallet activity, no coin edge cases.
    select coins into v_new_coins from public.profiles where user_id = v_user;
  end if;
  if v_new_coins is null then raise exception 'Profile not found'; end if;

  perform set_config('app.avatar_grant', 'on', true);
  insert into public.avatar_items (user_id, item_id, category, rarity)
    values (v_user, p_item_id, v_cat.category, v_cat.rarity);

  return jsonb_build_object('coins', v_new_coins, 'item_id', p_item_id, 'cost', v_cat.cost);
end;
$$;

-- 9b. claim_event_pack: a concurrent double-tap used to be able to pass the
--     ownership check twice and then fail the second insert (or, before the
--     unique constraint existed, double-charge). Serialise per user+pack.
create or replace function public.claim_event_pack(p_pack_id text, p_pack_name text default null, p_sport text default null, p_price_cents integer default 0, p_version text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_existing uuid;
  v_pack public.event_packs%rowtype;
  v_paid boolean := false;
  v_cost integer := 0;
  v_balance integer;
  v_source text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_pack_id is null or length(p_pack_id) = 0 then raise exception 'Missing pack'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('event_pack:' || v_user || ':' || p_pack_id, 0)
  );

  select id into v_existing from public.event_pack_ownership
    where user_id = v_user and pack_id = p_pack_id;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'pack_id', p_pack_id);
  end if;

  -- The catalog, not the caller, decides the pack's identity and prices.
  -- p_pack_name / p_sport / p_price_cents / p_version are accepted for wire
  -- compatibility with deployed clients and deliberately ignored.
  select * into v_pack from public.event_packs
    where pack_id = p_pack_id and not coalesce(retired, false);
  if v_pack.id is null then
    raise exception 'Unknown or retired event pack: %', p_pack_id;
  end if;

  if coalesce(v_pack.price_cents, 0) <= 0 then
    v_source := 'free';
  else
    select true into v_paid from public.user_purchases
      where user_id = v_user and product_id = 'event_pack:' || p_pack_id
      limit 1;

    if coalesce(v_paid, false) then
      v_source := 'purchase';
    elsif coalesce(v_pack.credit_price, 0) > 0 then
      v_cost := v_pack.credit_price;

      select credits into v_balance from public.profiles
        where user_id = v_user for update;
      if v_balance is null then raise exception 'Profile not found'; end if;

      if v_balance < v_cost then
        return jsonb_build_object(
          'ok', false,
          'pack_id', v_pack.pack_id,
          'error', 'insufficient_credits',
          'required', v_cost,
          'balance', v_balance,
          'shortfall', v_cost - v_balance
        );
      end if;

      v_balance := v_balance - v_cost;
      perform set_config('app.allow_credit_change', 'on', true);
      update public.profiles set credits = v_balance where user_id = v_user;
      perform set_config('app.allow_credit_change', 'off', true);

      insert into public.credit_transactions
        (user_id, amount, reason, feature, source, balance_after, metadata)
      values (
        v_user, -v_cost, 'Event Pack: ' || v_pack.name, 'event_pack',
        'event_pack', v_balance,
        jsonb_build_object('pack_id', v_pack.pack_id, 'price_cents', v_pack.price_cents)
      );

      v_source := 'credits';
    else
      raise exception 'Purchase required for this event pack';
    end if;
  end if;

  insert into public.event_pack_ownership
    (user_id, pack_id, pack_name, sport, price_cents, version_at_purchase, source, credits_paid)
  values (
    v_user, v_pack.pack_id, v_pack.name, v_pack.sport,
    coalesce(v_pack.price_cents, 0), v_pack.version, v_source, v_cost
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'pack_id', v_pack.pack_id,
    'price_cents', coalesce(v_pack.price_cents, 0),
    'credits_paid', v_cost,
    'balance', v_balance
  );
end;
$$;

notify pgrst, 'reload schema';
