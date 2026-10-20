-- ============================================================================
-- TWO FIXES FOUND WHILE BUILDING THE COACH MARKETPLACE
-- ----------------------------------------------------------------------------
-- 1. A creator could not publish a listing at all, and never could have.
--
--    `guard_listing_insert()` refuses a row whose `rating is not null`, with the
--    message "New listings start with zero sales and no rating". The column's
--    DEFAULT is 0, so every INSERT that does not name `rating` arrives with
--    rating = 0 — which is not null — and is rejected. Nothing has ever been
--    inserted into marketplace_listings (it is empty), so this surfaced only when
--    a probe tried to insert a listing, which means the failure mode in
--    production is a "Become a creator" form that always answers "New listings
--    start with zero sales and no rating".
--
--    Both halves are wrong in a way that matters to a buyer:
--      * the default is changed to NULL, so a new listing genuinely has no
--        rating and CreatorMarketplace's `rating?.toFixed(1) ?? "—"` shows an
--        em dash, which is what a plan with no reviews should say;
--      * the guard accepts 0 as well as NULL, so a listing written by anything
--        that relies on the old default still inserts rather than failing on a
--        technicality nobody could see.
--
-- 2. `coach_orders.listing_id` was `on delete restrict`, which reads like caution
--    and is in fact a trap. coach_orders is a user table: delete-account removes
--    every row belonging to the athlete, and it removes the coach's
--    marketplace_listings too. RESTRICT means one sold plan is enough to make a
--    coach's own account undeletable — and the failure appears at the very end of
--    an account deletion, after the rest of the rows are gone, as a foreign key
--    error. That is a data-protection right being blocked by a bookkeeping row.
--
--    SET NULL is the honest option, and better than CASCADE for a second reason:
--    a buyer keeps their order when the coach retires the listing, and
--    coach_deliveries — where the plan actually lives — is keyed on the ORDER,
--    not the listing. The thing they paid for survives the listing going away,
--    which is what a buyer would expect and what CASCADE would have deleted.
--
-- Both tables are empty (the marketplace has never been switched on), so there is
-- no row to migrate.
-- ============================================================================

-- ------------------------------------------------------------------ fix 1 --
alter table public.marketplace_listings
  alter column rating set default null;

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

  -- 0 and NULL both mean "not rated". 0 is accepted because the column's default
  -- was 0 for as long as this trigger has existed, and refusing it is what made
  -- every insert fail.
  if coalesce(new.sales_count, 0) <> 0 or (new.rating is not null and new.rating <> 0) then
    raise exception 'New listings start with zero sales and no rating';
  end if;

  if coalesce(new.is_coach_plan, false) then
    if new.price_cents < 100 then
      raise exception 'A coaching plan must be priced at 100 minor units or more';
    end if;
    if new.weeks is null then
      raise exception 'A coaching plan must say how many weeks it covers';
    end if;
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------------ fix 2 --
alter table public.coach_orders
  drop constraint if exists coach_orders_listing_id_fkey;

alter table public.coach_orders
  alter column listing_id drop not null;

alter table public.coach_orders
  add constraint coach_orders_listing_id_fkey
  foreign key (listing_id) references public.marketplace_listings(id) on delete set null;

comment on column public.coach_orders.listing_id is
  'The listing as it was when bought. Null once the coach deletes that listing; the order and the delivery it produced are kept.';

-- ----------------------------------------------------------------- proofs --
-- A probe that actually creates a coach, a listing and an order, then deletes the
-- listing, then deletes both accounts. It leaves nothing behind: everything it
-- writes is removed before the block ends, including the two auth rows.
do $$
declare
  v_coach uuid := gen_random_uuid();
  v_buyer uuid := gen_random_uuid();
  v_listing uuid;
  v_order uuid;
  v_left int;
  v_rating numeric;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (v_coach, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'coach-retention-probe@example.com', now(), now()),
    (v_buyer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'buyer-retention-probe@example.com', now(), now());

  -- No rating named: this is the insert that used to fail.
  insert into public.marketplace_listings (creator_id, title, category, price_cents, active, is_coach_plan, weeks)
  values (v_coach, 'Retention probe plan', 'plan', 500, true, true, 1)
  returning id, rating into v_listing, v_rating;

  if v_rating is not null then
    raise exception 'a new listing came out with a rating of %', v_rating;
  end if;

  insert into public.coach_orders (listing_id, coach_id, buyer_id, net_cents, fee_cents, gross_cents, rail, status)
  values (v_listing, v_coach, v_buyer, 500, 100, 600, 'play', 'paid')
  returning id into v_order;

  delete from public.marketplace_listings where id = v_listing;

  select count(*) into v_left from public.coach_orders where id = v_order and listing_id is null;
  if v_left <> 1 then
    raise exception 'deleting a listing with an order did not leave the order behind';
  end if;

  delete from public.coach_orders where id = v_order;
  delete from auth.users where id in (v_coach, v_buyer);

  if exists (select 1 from auth.users where email like '%retention-probe@example.com') then
    raise exception 'the probe left an account behind';
  end if;
end;
$$;
