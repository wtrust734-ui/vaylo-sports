-- ============================================================================
-- COACH MARKETPLACE
-- ----------------------------------------------------------------------------
-- The database half of the coach marketplace: what a coach is, what they sell,
-- what a buyer pays, what the coach is owed, and where the platform's cut goes.
--
-- It ships DARK. Nothing here can be reached by a client role except a read of
-- the public roster, the fee schedule and the buyer's own records; every write
-- goes through an edge function with the service role. The app surfaces are
-- behind the `coachMarketplace` feature flag (src/config/featureFlags.ts), which
-- is off, and the website page is noindex and absent from the sitemap. See
-- docs/COACH-MARKETPLACE.md for how this is switched on.
--
-- THE MONEY, IN ONE PLACE
--
-- A coach sets the price they want to receive. The buyer is charged that price
-- plus the platform's commission. So a coach who asks for £5.00 has a listing at
-- price_cents = 500, the buyer is charged 600, and 100 is Vaylo's.
--
--   marketplace_config.coach_commission_bps   2000   (20%, bounded 1000–2000)
--   marketplace_quote(net_cents)              the only implementation of the
--                                             split, used by every purchase path
--   coach_orders                              net + fee = gross, enforced by a
--                                             check constraint as well as by the
--                                             function, so no row can record an
--                                             inconsistent split even if a future
--                                             code path computes it by hand
--
-- The rate lives in a table rather than in the migration body so it is tunable
-- the way `economy_config.coins_per_credit` is, and so the band can be a real
-- CHECK constraint instead of a convention.
--
-- WHY THERE IS A WALLET
--
-- Google Play cannot charge a price the server chooses at runtime: a one-time
-- product must exist in the Play Console with its price before anybody buys it,
-- and a coach's price is different for every coach. So the in-app path is a
-- wallet: the buyer tops up coaching credits in fixed amounts through Play
-- Billing (a normal consumable purchase) and then spends that balance on a
-- listing at the listing's own price. One credit is one penny. The credit
-- economy the app already has is untouched — a coaching credit cannot buy an AI
-- feature, which is what the Coaching screen already tells athletes.
--
-- Payouts are a LEDGER, not a transfer. `coach_earnings` records what each coach
-- is owed and in what state; no money leaves anywhere until a payout rail is
-- connected deliberately. That is the same posture `creator_profiles.payout_email`
-- has had since the economy migration: the address is stored, and nothing moves.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. CONFIG — the commission rate and the signup fee, both bounded
-- ---------------------------------------------------------------------------
create table if not exists public.marketplace_config (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value numeric not null,
  region text not null default 'GLOBAL',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists marketplace_config_key_region_key
  on public.marketplace_config (key, region);

-- The band is a constraint, not a comment. `marketplace_quote()` reads this row,
-- so a rate outside 10–20% would be charged; refusing the row is better than
-- refusing the charge, and it means a hand-edited 200 (="200bps"? "200%"?) fails
-- loudly at write time rather than on a buyer's card.
alter table public.marketplace_config
  drop constraint if exists marketplace_check_commission;
alter table public.marketplace_config
  add constraint marketplace_check_commission
  check (key <> 'coach_commission_bps' or (value >= 1000 and value <= 2000));

alter table public.marketplace_config
  drop constraint if exists marketplace_check_signup_fee;
alter table public.marketplace_config
  add constraint marketplace_check_signup_fee
  check (key <> 'coach_signup_fee_cents' or (value >= 0 and value <= 1000000));

-- 2000 bps = 20%: a £5 plan charges £6 and keeps £1, the specified example.
-- The signup fee is $20 because coaches onboard on the website, where Stripe is.
insert into public.marketplace_config (key, value) values
  ('coach_commission_bps', 2000),
  ('coach_signup_fee_cents', 2000)
on conflict (key, region) do nothing;

alter table public.marketplace_config enable row level security;

-- The fee schedule is public: a coach is entitled to see the rate they are
-- charged without asking, and it is the same number the site prints.
drop policy if exists "Public read marketplace config" on public.marketplace_config;
create policy "Public read marketplace config"
  on public.marketplace_config for select
  to anon, authenticated
  using (active);

grant select on public.marketplace_config to anon, authenticated;
grant all on public.marketplace_config to service_role;

create or replace function public.marketplace_config_int(p_key text, p_fallback int)
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select value::int from public.marketplace_config
      where key = p_key and active
      order by (region <> 'GLOBAL') desc
      limit 1),
    p_fallback
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. THE SPLIT — one function, and the only place commission is computed
-- ---------------------------------------------------------------------------
/**
 * What the buyer pays for a coach's asking price, and what the platform keeps.
 *
 * Both numbers come back so a caller can never compute one from the other
 * wrongly: the edge function stores exactly these three, and a CHECK constraint
 * on coach_orders insists they add up.
 *
 * Raises rather than returning when the rate is outside the band. The band is
 * enforced by a constraint on the row, so this is the second net — it catches a
 * rate that somehow got into the table before this migration was applied, and it
 * fails closed: no quote, no charge.
 */
create or replace function public.marketplace_quote(p_net_cents int)
returns table (net_cents int, fee_cents int, gross_cents int, commission_bps int)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_bps int;
  v_fee int;
begin
  if p_net_cents is null or p_net_cents <= 0 then
    raise exception 'coach plan price must be a positive number of minor units';
  end if;

  v_bps := public.marketplace_config_int('coach_commission_bps', 2000);
  if v_bps < 1000 or v_bps > 2000 then
    raise exception 'coach commission bps outside the 1000-2000 band: %', v_bps;
  end if;

  -- numeric + round, never float and never integer division: 20% of 500 is 100,
  -- of 999 is 200 (the coach is never asked to absorb the rounding).
  v_fee := round((p_net_cents::numeric * v_bps) / 10000)::int;

  return query select p_net_cents, v_fee, p_net_cents + v_fee, v_bps;
end;
$$;

grant execute on function public.marketplace_quote(int) to anon, authenticated;
grant execute on function public.marketplace_config_int(text, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. COACHES — coach status is granted by payment, never claimed by a client
-- ---------------------------------------------------------------------------
-- `creator_profiles` already exists (20260605003837) and its SELECT is
-- column-scoped since the 2026-10-06 audit migration, which withdrew
-- payout_email from clients. These two columns are what makes somebody a coach
-- rather than a creator, and they are the ones the roster reads.
alter table public.creator_profiles
  add column if not exists is_coach boolean not null default false;
alter table public.creator_profiles
  add column if not exists coach_since timestamptz;

-- Column-level grants were re-issued by column in 20261006140000, so a new
-- column gets no privilege at all until it is granted. Without this the roster
-- query fails with `permission denied for column is_coach` — which is exactly
-- how HumanCoaches.tsx behaves today for `payout_email`, and the reason it
-- selects its columns explicitly.
grant select (is_coach, coach_since) on public.creator_profiles to anon, authenticated;

/**
 * is_coach cannot be set by the person it describes.
 *
 * The insert/update policies on creator_profiles check `auth.uid() = user_id`
 * and `verified = false`, which stops a client granting itself a verification
 * badge — but says nothing about these two columns. Without this trigger anybody
 * could PATCH their own profile, appear in the coach roster, publish listings,
 * and skip the $20 fee entirely.
 *
 * `auth.uid() is null` is the service role, the only caller allowed to set them:
 * the Stripe webhook, once the fee has actually been paid.
 */
create or replace function public.guard_creator_profile_coach_flags()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_coach, false) or new.coach_since is not null then
      raise exception 'Coach status is granted by the marketplace, not claimed';
    end if;
  elsif new.is_coach is distinct from old.is_coach
     or new.coach_since is distinct from old.coach_since then
    raise exception 'Coach status is granted by the marketplace, not claimed';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_creator_profile_coach_flags on public.creator_profiles;
create trigger trg_creator_profile_coach_flags
  before insert or update on public.creator_profiles
  for each row execute function public.guard_creator_profile_coach_flags();

-- ---------------------------------------------------------------------------
-- 4. COACH APPLICATIONS — the $20 fee, paid on the website through Stripe
-- ---------------------------------------------------------------------------
create table if not exists public.coach_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Displayed to the buyer in the roster, so it is part of the record rather
  -- than being read back off the profile at webhook time.
  display_name text,
  email text,
  status text not null default 'pending_payment',
  fee_cents int not null default 2000,
  currency text not null default 'USD',
  -- Stripe identifiers. A Checkout Session is created before any money moves, so
  -- the row exists first and the webhook completes it; the unique index is what
  -- makes a replayed webhook idempotent rather than a second membership.
  stripe_session_id text,
  stripe_payment_intent text,
  paid_at timestamptz,
  refunded_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_applications_status
    check (status in ('pending_payment', 'paid', 'refunded', 'rejected')),
  constraint coach_applications_fee check (fee_cents >= 0),
  constraint coach_applications_currency check (currency ~ '^[A-Z]{3}$')
);

create unique index if not exists coach_applications_session_key
  on public.coach_applications (stripe_session_id)
  where stripe_session_id is not null;
create unique index if not exists coach_applications_payment_intent_key
  on public.coach_applications (stripe_payment_intent)
  where stripe_payment_intent is not null;
create index if not exists coach_applications_user_idx
  on public.coach_applications (user_id, created_at desc);

alter table public.coach_applications enable row level security;

-- A coach can see their own application, so the app can say "your payment is
-- still being confirmed" instead of showing an empty state forever. Nobody can
-- see anybody else's, and no client role can write: the row is created and
-- completed by the service role only.
drop policy if exists "Applicants read own application" on public.coach_applications;
create policy "Applicants read own application"
  on public.coach_applications for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.coach_applications to authenticated;
grant all on public.coach_applications to service_role;

/**
 * Called by the Stripe webhook once the fee has been paid.
 *
 * It is the ONLY thing that turns a person into a coach. Idempotent by
 * construction: a session already marked paid returns its coach immediately, so
 * Stripe's retries cannot produce a second grant or a duplicate email.
 */
create or replace function public.apply_coach_signup_payment(
  p_session_id text,
  p_payment_intent text,
  p_email text default null
)
returns table (user_id uuid, display_name text, email text, already_applied boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_app record;
  v_name text;
begin
  select * into v_app
    from public.coach_applications
   where stripe_session_id = p_session_id
   for update;

  if v_app.id is null then
    raise exception 'no coach application for that checkout session';
  end if;

  if v_app.status = 'paid' then
    return query select v_app.user_id, v_app.display_name, v_app.email, true;
    return;
  end if;

  update public.coach_applications
     set status = 'paid',
         paid_at = now(),
         updated_at = now(),
         stripe_payment_intent = coalesce(p_payment_intent, stripe_payment_intent),
         email = coalesce(email, p_email)
   where id = v_app.id
   returning * into v_app;

  -- The coach profile may already exist (a creator who later became a coach),
  -- so this upserts rather than inserting.
  insert into public.creator_profiles (user_id, display_name, is_coach, coach_since)
  values (v_app.user_id, coalesce(nullif(btrim(v_app.display_name), ''), 'Coach'), true, now())
  on conflict (user_id) do update
    set is_coach = true,
        coach_since = coalesce(public.creator_profiles.coach_since, now()),
        display_name = coalesce(
          nullif(btrim(public.creator_profiles.display_name), ''),
          excluded.display_name
        )
  returning display_name into v_name;

  return query select v_app.user_id, v_name, v_app.email, false;
end;
$$;

-- Service role only. A client that could call this could make itself a coach for
-- free, which is the single most valuable thing in this file to get wrong.
revoke all on function public.apply_coach_signup_payment(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. LISTINGS — a coach's plan, with weeks and a floor on the price
-- ---------------------------------------------------------------------------
-- marketplace_listings already carries creator_id, title, description, category,
-- price_cents, cover_url, duration_minutes, rating, sales_count and active, with
-- creator-scoped RLS from the economy migration. Two additions make it a plan:
-- how long it covers, and whether it is a coaching plan at all (the same table
-- holds programs and guides).
alter table public.marketplace_listings
  add column if not exists is_coach_plan boolean not null default false;
alter table public.marketplace_listings
  add column if not exists weeks int;
alter table public.marketplace_listings
  add column if not exists currency text not null default 'GBP';

alter table public.marketplace_listings
  drop constraint if exists marketplace_listings_weeks;
alter table public.marketplace_listings
  add constraint marketplace_listings_weeks
  check (weeks is null or (weeks >= 1 and weeks <= 104));
alter table public.marketplace_listings
  drop constraint if exists marketplace_listings_currency;
alter table public.marketplace_listings
  add constraint marketplace_listings_currency
  check (currency ~ '^[A-Z]{3}$');

/**
 * A coaching plan must be priced at or above the floor.
 *
 * Below £1 the commission rounds to nothing and the platform pays to process the
 * payment. The old 0..100000000 band still applies — this narrows it for plans
 * only, so a free program listing is still publishable.
 */
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

-- `guard_listing_metrics` (the UPDATE half) is deliberately untouched: it already
-- refuses a client bumping its own sales_count or rating, which is what
-- buy_coach_plan() legitimately increments below.

-- ---------------------------------------------------------------------------
-- 6. ORDERS — net + fee = gross, and the coach is named on the row
-- ---------------------------------------------------------------------------
create table if not exists public.coach_orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings(id) on delete restrict,
  coach_id uuid not null references auth.users(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  net_cents int not null,
  fee_cents int not null,
  gross_cents int not null,
  currency text not null default 'GBP',
  rail text not null,
  provider_reference text,
  status text not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  -- The split is arithmetic the database can check, so it does. A row whose
  -- numbers disagree is unrepresentable rather than merely unexpected.
  constraint coach_orders_split check (net_cents + fee_cents = gross_cents),
  constraint coach_orders_amounts check (net_cents > 0 and fee_cents >= 0 and gross_cents > net_cents),
  constraint coach_orders_rail check (rail in ('play', 'stripe')),
  constraint coach_orders_status check (status in ('pending', 'paid', 'refunded', 'failed')),
  constraint coach_orders_currency check (currency ~ '^[A-Z]{3}$'),
  constraint coach_orders_not_self check (coach_id <> buyer_id)
);

-- One store transaction buys one plan. A retried webhook or a replayed Play
-- purchase token collides here instead of granting twice, the same protection
-- `user_purchases.provider_reference` gives the credit economy.
create unique index if not exists coach_orders_provider_reference_key
  on public.coach_orders (rail, provider_reference)
  where provider_reference is not null;
create index if not exists coach_orders_buyer_idx on public.coach_orders (buyer_id, created_at desc);
create index if not exists coach_orders_coach_idx on public.coach_orders (coach_id, created_at desc);

alter table public.coach_orders enable row level security;

-- Both parties can read an order; neither can write one. There is no INSERT or
-- UPDATE policy at all, so a client attempting either gets a permission error
-- from the grant rather than an RLS refusal it could mistake for a bug.
drop policy if exists "Order participants read" on public.coach_orders;
create policy "Order participants read"
  on public.coach_orders for select
  to authenticated
  using ((select auth.uid()) = buyer_id or (select auth.uid()) = coach_id);

grant select on public.coach_orders to authenticated;
grant all on public.coach_orders to service_role;

-- ---------------------------------------------------------------------------
-- 7. EARNINGS — what a coach is owed, and whether it has been paid
-- ---------------------------------------------------------------------------
create table if not exists public.coach_earnings (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.coach_orders(id) on delete cascade,
  amount_cents int not null,
  currency text not null default 'GBP',
  status text not null default 'accrued',
  payout_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint coach_earnings_status
    check (status in ('accrued', 'payable', 'paid', 'reversed')),
  constraint coach_earnings_amount check (amount_cents >= 0),
  constraint coach_earnings_currency check (currency ~ '^[A-Z]{3}$')
);

-- One earning per order. A second settlement for the same order would double
-- what a coach is owed, which is worse than missing a payout because it is
-- invisible until reconciliation.
create unique index if not exists coach_earnings_order_key on public.coach_earnings (order_id);
create index if not exists coach_earnings_coach_idx
  on public.coach_earnings (coach_id, status, created_at desc);

alter table public.coach_earnings enable row level security;

drop policy if exists "Coaches read own earnings" on public.coach_earnings;
create policy "Coaches read own earnings"
  on public.coach_earnings for select
  to authenticated
  using ((select auth.uid()) = coach_id);

grant select on public.coach_earnings to authenticated;
grant all on public.coach_earnings to service_role;

-- ---------------------------------------------------------------------------
-- 8. DELIVERY — where the product actually reaches the buyer
-- ---------------------------------------------------------------------------
-- A plan bought and then never delivered is a complaint, so the delivery is a
-- row rather than an email: the buyer opens it in the app, and the coach can
-- write it once and see whether it has been opened.
create table if not exists public.coach_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.coach_orders(id) on delete cascade,
  coach_id uuid not null references auth.users(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  opened_at timestamptz,
  constraint coach_deliveries_title_len check (char_length(btrim(title)) between 1 and 120),
  constraint coach_deliveries_body_len check (char_length(btrim(body)) between 1 and 20000)
);

create unique index if not exists coach_deliveries_order_key on public.coach_deliveries (order_id);

alter table public.coach_deliveries enable row level security;

drop policy if exists "Delivery participants read" on public.coach_deliveries;
create policy "Delivery participants read"
  on public.coach_deliveries for select
  to authenticated
  using ((select auth.uid()) = buyer_id or (select auth.uid()) = coach_id);

-- The coach writes it, and only for an order they were actually paid for. The
-- existence check is on the ORDER, not on the listing: a listing can be edited
-- or retired, an order cannot.
drop policy if exists "Coach delivers a paid order" on public.coach_deliveries;
create policy "Coach delivers a paid order"
  on public.coach_deliveries for insert
  to authenticated
  with check (
    (select auth.uid()) = coach_id
    and exists (
      select 1 from public.coach_orders o
       where o.id = order_id
         and o.coach_id = (select auth.uid())
         and o.status = 'paid'
    )
  );

drop policy if exists "Coach edits own delivery" on public.coach_deliveries;
create policy "Coach edits own delivery"
  on public.coach_deliveries for update
  to authenticated
  using ((select auth.uid()) = coach_id)
  with check ((select auth.uid()) = coach_id);

grant select, insert, update on public.coach_deliveries to authenticated;
grant all on public.coach_deliveries to service_role;

-- ---------------------------------------------------------------------------
-- 9. COACHING CREDITS — the Play Billing wallet
-- ---------------------------------------------------------------------------
-- The fixed-value products sold through Google Play. These ids must exist in the
-- Play Console with matching prices before the marketplace is switched on
-- (docs/COACH-MARKETPLACE.md §4); the table exists so the server can refuse a
-- product id it does not recognise rather than trusting the client's idea of
-- what a purchase is worth.
create table if not exists public.coach_credit_packs (
  id text primary key,
  price_cents int not null,
  credit_cents int not null,
  currency text not null default 'GBP',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint coach_credit_packs_amounts check (price_cents > 0 and credit_cents = price_cents),
  constraint coach_credit_packs_currency check (currency ~ '^[A-Z]{3}$')
);

insert into public.coach_credit_packs (id, price_cents, credit_cents) values
  ('coach_credits_5', 500, 500),
  ('coach_credits_10', 1000, 1000),
  ('coach_credits_25', 2500, 2500)
on conflict (id) do nothing;

alter table public.coach_credit_packs enable row level security;
drop policy if exists "Public read coach credit packs" on public.coach_credit_packs;
create policy "Public read coach credit packs"
  on public.coach_credit_packs for select
  to anon, authenticated
  using (active);

grant select on public.coach_credit_packs to anon, authenticated;
grant all on public.coach_credit_packs to service_role;

create table if not exists public.coach_credit_wallet (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_cents int not null default 0,
  updated_at timestamptz not null default now(),
  -- A negative balance must be impossible at rest, not merely unreachable in
  -- the code paths we know about.
  constraint coach_credit_wallet_nonneg check (balance_cents >= 0)
);

alter table public.coach_credit_wallet enable row level security;
drop policy if exists "Own coach credit wallet" on public.coach_credit_wallet;
create policy "Own coach credit wallet"
  on public.coach_credit_wallet for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.coach_credit_wallet to authenticated;
grant all on public.coach_credit_wallet to service_role;

create table if not exists public.coach_credit_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta_cents int not null,
  reason text not null,
  order_id uuid references public.coach_orders(id) on delete set null,
  provider_reference text,
  created_at timestamptz not null default now(),
  constraint coach_credit_entries_reason
    check (reason in ('play_topup', 'plan_purchase', 'refund', 'grant', 'correction'))
);

-- The top-up idempotency key. Play replays purchases, and a replayed top-up that
-- granted twice would be free money.
create unique index if not exists coach_credit_entries_reference_key
  on public.coach_credit_entries (provider_reference)
  where provider_reference is not null;
create index if not exists coach_credit_entries_user_idx
  on public.coach_credit_entries (user_id, created_at desc);

alter table public.coach_credit_entries enable row level security;
drop policy if exists "Own coach credit entries" on public.coach_credit_entries;
create policy "Own coach credit entries"
  on public.coach_credit_entries for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.coach_credit_entries to authenticated;
grant all on public.coach_credit_entries to service_role;

-- ---------------------------------------------------------------------------
-- 10. BUYING — one function, atomic, replay-safe
-- ---------------------------------------------------------------------------
/**
 * Spend coaching credits on a plan.
 *
 * Everything that must not be interleaved happens here, in one transaction:
 *
 *   * the buyer's wallet is locked, so two purchases cannot both see the balance
 *     before either has spent it;
 *   * the price is re-read from the listing and re-quoted by marketplace_quote(),
 *     never taken from the caller;
 *   * the same provider reference returns the ORIGINAL order instead of buying
 *     again, because a Play purchase token can be replayed by a retrying client;
 *   * the order, the coach's earning and the sales count are written together,
 *     so an order can never exist without the coach being owed for it.
 *
 * Raises with a short, machine-readable message ('insufficient_credits',
 * 'listing_not_for_sale', 'own_listing', 'listing_not_found') which the edge
 * function turns into an honest sentence. Nothing here sends email or calls out
 * to a network: a failure after a charge must be recoverable by retrying the
 * function, not by re-charging the buyer.
 */
create or replace function public.buy_coach_plan(
  p_buyer uuid,
  p_listing_id uuid,
  p_reference text
)
returns table (
  order_id uuid,
  net_cents int,
  fee_cents int,
  gross_cents int,
  balance_cents int,
  reused boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_listing record;
  v_quote record;
  v_balance int;
  v_existing record;
  v_order uuid;
begin
  if p_buyer is null then
    raise exception 'buyer required';
  end if;
  if p_reference is null or btrim(p_reference) = '' then
    raise exception 'provider reference required';
  end if;

  -- Serialise on the buyer. hashtextextended() keeps the lock key stable for a
  -- given uuid and out of the range pg_advisory_xact_lock reserves for other uses.
  perform pg_advisory_xact_lock(hashtextextended(p_buyer::text, 42));

  -- Replay of a store transaction this buyer already completed.
  select o.id, o.net_cents as n, o.fee_cents as f, o.gross_cents as g
    into v_existing
    from public.coach_orders o
   where o.rail = 'play'
     and o.provider_reference = p_reference
   limit 1;

  if v_existing.id is not null then
    return query
      select v_existing.id, v_existing.n, v_existing.f, v_existing.g,
             coalesce((select w.balance_cents from public.coach_credit_wallet w
                        where w.user_id = p_buyer), 0),
             true;
    return;
  end if;

  select id, creator_id, price_cents, currency, active, is_coach_plan, title
    into v_listing
    from public.marketplace_listings
   where id = p_listing_id;

  if v_listing.id is null then
    raise exception 'listing_not_found';
  end if;
  if not v_listing.active then
    raise exception 'listing_not_for_sale';
  end if;
  if v_listing.creator_id = p_buyer then
    raise exception 'own_listing';
  end if;

  select * into v_quote from public.marketplace_quote(v_listing.price_cents);

  select balance_cents into v_balance
    from public.coach_credit_wallet
   where user_id = p_buyer
   for update;
  v_balance := coalesce(v_balance, 0);

  if v_balance < v_quote.gross_cents then
    raise exception 'insufficient_credits';
  end if;

  insert into public.coach_orders (
    listing_id, coach_id, buyer_id, net_cents, fee_cents, gross_cents,
    currency, rail, provider_reference, status, paid_at
  ) values (
    p_listing_id, v_listing.creator_id, p_buyer, v_quote.net_cents, v_quote.fee_cents,
    v_quote.gross_cents, coalesce(v_listing.currency, 'GBP'), 'play', p_reference,
    'paid', now()
  )
  returning id into v_order;

  update public.coach_credit_wallet
     set balance_cents = balance_cents - v_quote.gross_cents,
         updated_at = now()
   where user_id = p_buyer
   returning balance_cents into v_balance;

  insert into public.coach_credit_entries (user_id, delta_cents, reason, order_id)
  values (p_buyer, -v_quote.gross_cents, 'plan_purchase', v_order);

  -- What the coach is owed. Accrued, not payable: nothing is transferred until a
  -- payout rail is connected, and the ledger says so in the row's own status.
  insert into public.coach_earnings (coach_id, order_id, amount_cents, currency, status)
  values (v_listing.creator_id, v_order, v_quote.net_cents, coalesce(v_listing.currency, 'GBP'), 'accrued')
  on conflict (order_id) do nothing;

  -- Incrementing is explicitly allowed by guard_listing_metrics; a client doing
  -- it is not, which is the point of keeping the counter server-owned.
  update public.marketplace_listings
     set sales_count = sales_count + 1
   where id = p_listing_id;

  return query select v_order, v_quote.net_cents, v_quote.fee_cents, v_quote.gross_cents, v_balance, false;
end;
$$;

/**
 * Credit a wallet from a verified Play purchase. Idempotent on the reference.
 *
 * Returns the resulting balance so the caller can tell the buyer what they have
 * without a second round trip.
 */
create or replace function public.grant_coach_credits(
  p_user uuid,
  p_pack_id text,
  p_reference text
)
returns table (balance_cents int, credited_cents int, reused boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pack record;
  v_balance int;
begin
  if p_user is null then
    raise exception 'user required';
  end if;
  if p_reference is null or btrim(p_reference) = '' then
    raise exception 'provider reference required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 43));

  select id, credit_cents into v_pack
    from public.coach_credit_packs
   where id = p_pack_id and active;
  if v_pack.id is null then
    raise exception 'unknown_credit_pack';
  end if;

  if exists (
    select 1 from public.coach_credit_entries e
     where e.provider_reference = p_reference
  ) then
    select balance_cents into v_balance from public.coach_credit_wallet where user_id = p_user;
    return query select coalesce(v_balance, 0), 0, true;
    return;
  end if;

  insert into public.coach_credit_wallet (user_id, balance_cents)
  values (p_user, v_pack.credit_cents)
  on conflict (user_id) do update
    set balance_cents = public.coach_credit_wallet.balance_cents + excluded.balance_cents,
        updated_at = now()
  returning balance_cents into v_balance;

  insert into public.coach_credit_entries (user_id, delta_cents, reason, provider_reference)
  values (p_user, v_pack.credit_cents, 'play_topup', p_reference);

  return query select v_balance, v_pack.credit_cents, false;
end;
$$;

-- Both of these can create or destroy value, so neither is reachable by a client
-- role. The webhook and the coach-checkout function are the only callers.
revoke all on function public.buy_coach_plan(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.grant_coach_credits(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. ROSTER — every coach who has signed up
-- ---------------------------------------------------------------------------
/**
 * The roster the app's Coaches tab reads, as a view rather than a client query.
 *
 * It is a view because the tab needs two things a column-scoped SELECT on
 * creator_profiles cannot give a client: the row count of what each coach sells,
 * and the lowest price. Both come from marketplace_listings, which the client CAN
 * read — but joining the two in the client would mean N+1 queries for a list of
 * coaches, and the "how many plans" number is the one piece of the card that
 * matters most when deciding whether to open a coach at all.
 *
 * SECURITY: this view deliberately does NOT use `security_invoker`. It runs with
 * the owner's rights so the aggregate is computed across every active listing,
 * and the reason that is acceptable is that it selects three fixed COUNT/MIN
 * values and a short list of already-public profile columns. `payout_email` is
 * not among them and cannot be added without editing this definition. It is
 * granted to signed-in athletes only, and it exposes nothing about a person who
 * is not a coach.
 */
create or replace view public.coach_roster as
  select
    p.user_id,
    p.display_name,
    p.bio,
    p.specialties,
    p.verified,
    p.coach_since,
    coalesce(l.listing_count, 0) as listing_count,
    l.lowest_net_cents
  from public.creator_profiles p
  left join (
    select creator_id,
           count(*)::int as listing_count,
           min(price_cents) as lowest_net_cents
      from public.marketplace_listings
     where active
     group by creator_id
  ) l on l.creator_id = p.user_id
  where p.is_coach;

grant select on public.coach_roster to authenticated;
grant all on public.coach_roster to service_role;

comment on view public.coach_roster is
  'Every coach who has paid to sign up. Public profile columns plus a count and floor price of their active listings. Deliberately excludes payout_email and reads with the view owner''s rights.';

-- ---------------------------------------------------------------------------
-- 12. SELF-CHECK — fail the migration rather than ship a broken split
-- ---------------------------------------------------------------------------
do $$
declare
  v_quote record;
begin
  select * into v_quote from public.marketplace_quote(500);
  if v_quote.fee_cents <> 100 or v_quote.gross_cents <> 600 then
    raise exception 'marketplace_quote(500) returned %/% — expected a 100 fee on a 600 charge',
      v_quote.fee_cents, v_quote.gross_cents;
  end if;

  if (select count(*) from public.marketplace_config where key = 'coach_commission_bps') <> 1 then
    raise exception 'marketplace_config is missing the commission rate';
  end if;
end;
$$;
