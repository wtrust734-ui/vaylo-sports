-- ============================================================================
-- REFERRAL COMMISSIONS — cash programme on verified revenue only
-- ----------------------------------------------------------------------------
-- Business rule implemented here: no cash commission is earned by clicking a
-- link, registering, installing or starting a free trial. A commission becomes
-- a record ONLY when a genuine referred customer's ELIGIBLE PAID purchase is
-- settled through public.settle_referral(...), which process-purchase calls
-- with a provider-verified transaction reference after the store receipt has
-- been checked.
--
-- Commission formula (all knobs are rows in referral_commission_config, not
-- code, and every change is audited in referral_admin_audit):
--
--   net_eligible_minor = round(gross_minor * (100 - provider_fee_pct - tax_pct) / 100)
--   commission_minor   = round(net_eligible_minor * commission_pct / 100)
--
--   provider_fee_pct/tax_pct: amounts Vaylo does NOT retain. Discounts are
--   already inside gross_minor, because user_purchases.price_cents records the
--   price the customer actually paid, not the list price.
--
-- Lifecycle:
--   pending   → commission recorded at settlement, inside the hold period.
--   eligible  → hold period passed and no reversal recorded; payable on admin
--               approval. Pending commission is NOT withdrawable money.
--   paid      → payout actually executed and reference recorded (admin).
--   cancelled → refunded / charged back / fraud review / admin decision,
--               always with a recorded reason.
--
-- Payouts: NO automated provider is wired in yet (no real payment-out
-- integration exists in this codebase). The honest state is a payout REQUEST,
-- which requires admin approval and an admin-entered provider reference of the
-- real transfer. Nothing here pretends money moved when it did not.
--
-- Eligibility: cash commissions are restricted to adult referrers. An
-- under-18 referrer's commissions accrue as records but payout requests are
-- refused client-clearly; they are never "paid into a parent's account" by
-- this system.
-- ============================================================================

-- ── configuration: one row, admin-editable, audited ─────────────────────────
create table if not exists public.referral_commission_config (
  id                     integer primary key default 1 check (id = 1),
  enabled                boolean not null default true,
  commission_pct         numeric not null default 15 check (commission_pct >= 0 and commission_pct <= 100),
  provider_fee_pct       numeric not null default 0 check (provider_fee_pct >= 0),
  tax_pct                numeric not null default 0 check (tax_pct >= 0),
  hold_days              integer not null default 30 check (hold_days >= 0),
  min_payout_minor       bigint not null default 2500 check (min_payout_minor >= 0),
  payout_currency        text not null default 'GBP',
  attribution_window_days integer not null default 30 check (attribution_window_days > 0),
  updated_at             timestamptz not null default now()
);
insert into public.referral_commission_config (id) values (1) on conflict (id) do nothing;

alter table public.referral_commission_config enable row level security;

drop policy if exists "referral config public read" on public.referral_commission_config;
create policy "referral config public read" on public.referral_commission_config
  for select to authenticated using (true);
-- No client write policies: configuration changes go through the admin RPC
-- below, which checks has_role(auth.uid(), 'admin') and writes the audit row.

-- ── recorded referral clicks (no personal data, permitted and honest) ───────
create table if not exists public.referral_clicks (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  clicked_at timestamptz not null default now()
);
create index if not exists referral_clicks_code_time_idx
  on public.referral_clicks (code, clicked_at desc);

alter table public.referral_clicks enable row level security;
revoke all on public.referral_clicks from public, anon, authenticated;
-- Writes only through the definer RPC below; no policies — aggregates of other
-- users' click records are never exposed.

-- ── commissions ─────────────────────────────────────────────────────────────
create table if not exists public.referral_commissions (
  id                  uuid primary key default gen_random_uuid(),
  referral_id         uuid not null unique references public.referrals (id) on delete cascade,
  referrer_id         uuid not null,
  referee_id          uuid not null,
  purchase_id         uuid not null unique references public.user_purchases (id) on delete cascade,
  product_kind        text not null,
  currency            text not null,
  gross_minor         bigint not null check (gross_minor >= 0),
  provider_fee_minor  bigint not null default 0 check (provider_fee_minor >= 0),
  tax_minor           bigint not null default 0 check (tax_minor >= 0),
  net_eligible_minor  bigint not null check (net_eligible_minor >= 0),
  commission_pct      numeric not null check (commission_pct >= 0 and commission_pct <= 100),
  commission_minor    bigint not null check (commission_minor >= 0),
  status              text not null default 'pending'
                      check (status in ('pending','eligible','paid','cancelled')),
  holds_until         timestamptz not null,
  eligible_at         timestamptz,
  paid_at             timestamptz,
  cancellation_reason text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists referral_commissions_referrer_idx
  on public.referral_commissions (referrer_id, status);

alter table public.referral_commissions enable row level security;

drop policy if exists "referral commissions own read" on public.referral_commissions;
create policy "referral commissions own read" on public.referral_commissions
  for select to authenticated using (referrer_id = auth.uid());
-- Insert/update/delete have no policies: rows are written only by the definer
-- settlement path and the admin RPCs. A user cannot mint, alter or approve
-- their own balance.

-- ── commission audit trail ──────────────────────────────────────────────────
create table if not exists public.referral_commission_events (
  id             uuid primary key default gen_random_uuid(),
  commission_id  uuid not null references public.referral_commissions (id) on delete cascade,
  event          text not null,
  occurred_at    timestamptz not null default now(),
  meta           jsonb not null default '{}'::jsonb
);
alter table public.referral_commission_events enable row level security;
revoke all on public.referral_commission_events from public, anon, authenticated;
-- No policies: event rows are read through admin functions and surfaced to
-- the user's aggregate summary only.

-- ── payout requests (honest pending state; real transfer is admin-recorded) ─
create table if not exists public.referral_payouts (
  id                 uuid primary key default gen_random_uuid(),
  referrer_id        uuid not null,
  amount_minor       bigint not null check (amount_minor > 0),
  currency           text not null,
  status             text not null default 'pending_review'
                     check (status in ('pending_review','approved','paid','rejected','cancelled')),
  provider           text,
  provider_reference text,
  requested_at       timestamptz not null default now(),
  decided_by         uuid,
  decided_at         timestamptz,
  admin_note         text
);
create index if not exists referral_payouts_referrer_idx
  on public.referral_payouts (referrer_id, status);

alter table public.referral_payouts enable row level security;

drop policy if exists "referral payouts own read" on public.referral_payouts;
create policy "referral payouts own read" on public.referral_payouts
  for select to authenticated using (referrer_id = auth.uid());

-- ── admin audit (who did what, when, previous→next values) ──────────────────
create table if not exists public.referral_admin_audit (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  action        text not null,
  subject       text not null,
  previous      jsonb not null default '{}'::jsonb,
  next          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
alter table public.referral_admin_audit enable row level security;
revoke all on public.referral_admin_audit from public, anon, authenticated;
-- No read policy for the public: audit rows are written by admin RPCs and
-- surfaced through the admin export function (also admin-gated).

-- ── settlement: extend settle_referral to record the commission ─────────────
-- Kept exactly as before (qualification gate, tier credit bonuses); the only
-- new behaviour is the commission insert, which is silently skipped when the
-- programme is disabled.
create or replace function public.settle_referral(
  p_referee uuid,
  p_purchase_id uuid,
  p_product_kind text,
  p_transaction_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral public.referrals%rowtype;
  v_purchase_user uuid;
  v_purchase_price integer;
  v_purchase_reference text;
  v_purchase_currency text;
  v_referrer_reward integer;
  v_qualifying_count integer;
  v_tier text;
  v_tier_reward integer;
  v_cfg public.referral_commission_config%rowtype;
  v_net bigint;
  v_commission bigint;
begin
  if p_referee is null or p_purchase_id is null then
    raise exception 'settle_referral: referee and purchase required';
  end if;

  select * into v_referral
  from public.referrals
  where referee_id = p_referee
  for update;
  if not found then return jsonb_build_object('ok', false, 'why', 'no_referral'); end if;
  if v_referral.status <> 'pending' then
    return jsonb_build_object('ok', false, 'why', 'already_' || v_referral.status);
  end if;

  select user_id, price_cents, provider_reference, currency
    into v_purchase_user, v_purchase_price, v_purchase_reference, v_purchase_currency
  from public.user_purchases where id = p_purchase_id;
  if v_purchase_user is distinct from p_referee or coalesce(v_purchase_price, 0) <= 0 then
    raise exception 'Referral qualification requires the referee’s positive-price purchase';
  end if;
  if nullif(btrim(p_transaction_reference), '') is null
     or v_purchase_reference is distinct from p_transaction_reference then
    raise exception 'Referral qualification requires the purchase’s verified transaction reference';
  end if;

  insert into public.referral_qualifications(
    referral_id, purchase_id, product_kind, transaction_reference_hash, paid
  ) values (
    v_referral.id, p_purchase_id, p_product_kind,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_transaction_reference, 'UTF8')), 'hex'), true
  );

  update public.referrals set status = 'granted', reward_granted_at = now()
  where id = v_referral.id;

  v_referrer_reward := coalesce(
    (public.economy_value('promo_bonuses') ->> 'referral_referrer')::integer, 0);
  if v_referrer_reward > 0 then
    perform public.credits_grant(
      v_referral.referrer_id, v_referrer_reward,
      'A friend made their first purchase with your code', 'referral',
      'referral:referrer:' || v_referral.referee_id::text, '{}'::jsonb);
  end if;

  select count(*) into v_qualifying_count
  from public.referral_qualifications q
  join public.referrals r on r.id = q.referral_id
  where q.paid and r.referrer_id = v_referral.referrer_id;

  v_tier := case
    when v_qualifying_count = 10 then 'tier_10'
    when v_qualifying_count = 5 then 'tier_5'
    when v_qualifying_count = 3 then 'tier_3'
  end;
  if v_tier is not null then
    v_tier_reward := coalesce(
      (public.economy_value('promo_bonuses') ->> ('referral_' || v_tier))::integer, 0);
    if v_tier_reward > 0 then
      perform public.credits_grant(
        v_referral.referrer_id, v_tier_reward,
        'Referral milestone — ' || split_part(v_tier, '_', 2) || ' qualifying friends',
        'referral_' || v_tier,
        'referral:' || v_tier || ':' || v_referral.referrer_id::text, '{}'::jsonb);
    end if;
  end if;

  -- ── cash commission: recorded ONCE per referred customer, from money Vaylo
  --    actually keeps, held for the configured hold period before payout. ──
  select * into v_cfg from public.referral_commission_config where id = 1;
  if coalesce(v_cfg.enabled, false) then
    v_net := round(v_purchase_price::numeric
                   * (100 - coalesce(v_cfg.provider_fee_pct, 0) - coalesce(v_cfg.tax_pct, 0)) / 100);
    v_commission := round(v_net::numeric * coalesce(v_cfg.commission_pct, 0) / 100);

    insert into public.referral_commissions (
      referral_id, referrer_id, referee_id, purchase_id, product_kind, currency,
      gross_minor, provider_fee_minor, tax_minor, net_eligible_minor,
      commission_pct, commission_minor, status, holds_until
    ) values (
      v_referral.id, v_referral.referrer_id, p_referee, p_purchase_id, p_product_kind,
      coalesce(v_purchase_currency, 'USD'),
      v_purchase_price,
      round(v_purchase_price * coalesce(v_cfg.provider_fee_pct, 0) / 100),
      round(v_purchase_price * coalesce(v_cfg.tax_pct, 0) / 100),
      v_net,
      coalesce(v_cfg.commission_pct, 0),
      v_commission,
      'pending',
      now() + make_interval(days => coalesce(v_cfg.hold_days, 30))
    )
    on conflict (referral_id) do nothing;   -- one commission per referred customer

    if found then
      insert into public.referral_commission_events (commission_id, event, meta)
      select c.id, 'settled',
             jsonb_build_object('gross', c.gross_minor, 'net', c.net_eligible_minor,
                                'pct', c.commission_pct, 'commission', c.commission_minor,
                                'hold_days', coalesce(v_cfg.hold_days, 30))
      from public.referral_commissions c
      where c.referral_id = v_referral.id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'status', 'granted',
    'referrer_credits', v_referrer_reward, 'tier_bonus', v_tier);
end $$;
revoke all on function public.settle_referral(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.settle_referral(uuid, uuid, text, text) to service_role;

-- ── hold-period completion: pending → eligible when the hold has passed ────
create or replace function public.referral_commissions_process_holds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moved integer;
begin
  update public.referral_commissions
  set status = 'eligible', eligible_at = now(), updated_at = now()
  where status = 'pending'
    and holds_until <= now();
  get diagnostics v_moved = row_count;

  if v_moved > 0 then
    insert into public.referral_commission_events (commission_id, event, meta)
    select id, 'hold_passed,eligible', jsonb_build_object('at', now())
    from public.referral_commissions
    where status = 'eligible' and eligible_at > now() - interval '10 seconds';
  end if;

  return jsonb_build_object('ok', true, 'eligible_count', v_moved);
end $$;
revoke all on function public.referral_commissions_process_holds() from public, anon, authenticated;
grant execute on function public.referral_commissions_process_holds() to service_role;

-- Hourly hold-period sweep: pending → eligible once holds_until passes. Named
-- so a redeploy of this migration does not stack a second identical job;
-- cron.schedule upserts by job name. This is the only thing that moves a
-- commission from "pending" (not withdrawable) to "approved".
select cron.schedule(
  'referral-commissions-hold-sweep',
  '17 * * * *',
  $$select public.referral_commissions_process_holds()$$
);

-- ── referrer summary: honest statuses only ──────────────────────────────────
create or replace function public.referral_dashboard_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (select * from public.referral_commission_config where id = 1),
  sums as (
    select
      coalesce(sum(case when status in ('pending') then commission_minor else 0 end), 0) as pending_minor,
      coalesce(sum(case when status = 'eligible' then commission_minor else 0 end), 0) as approved_minor,
      coalesce(sum(case when status = 'paid' then commission_minor else 0 end), 0) as paid_minor,
      coalesce(sum(case when status = 'cancelled' then commission_minor else 0 end), 0) as cancelled_minor
    from public.referral_commissions
    where referrer_id = auth.uid()
  ),
  paying as (
    select count(*)::int as paying_customers
    from public.referral_qualifications q
    join public.referrals r on r.id = q.referral_id
    where r.referrer_id = auth.uid() and q.paid
  )
  select jsonb_build_object(
    'enabled', (select enabled from cfg),
    'commission_pct', (select commission_pct from cfg),
    'hold_days', (select hold_days from cfg),
    'min_payout_minor', (select min_payout_minor from cfg),
    'payout_currency', (select payout_currency from cfg),
    'attribution_window_days', (select attribution_window_days from cfg),
    'pending_minor', s.pending_minor,
    'approved_minor', s.approved_minor,
    'paid_minor', s.paid_minor,
    'cancelled_minor', s.cancelled_minor,
    'paying_customers', p.paying_customers,
    'referrals_count', (select count(*)::int from public.referrals where referrer_id = auth.uid()),
    'withdrawable_minor',
      s.approved_minor - coalesce((
        select sum(amount_minor) from public.referral_payouts
        where referrer_id = auth.uid() and status in ('pending_review','approved','paid')
      ), 0),
    'is_adult', coalesce(public.viewer_is_adult(), false)
  )
  from sums s, paying p
$$;
revoke all on function public.referral_dashboard_summary() from public, anon;
grant execute on function public.referral_dashboard_summary() to authenticated;

-- ── payout request: user may ASK; admin approves and records the real move ──
create or replace function public.referral_payout_request()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cfg public.referral_commission_config%rowtype;
  v_withdrawable bigint;
  v_is_adult boolean;
  v_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_cfg from public.referral_commission_config where id = 1;
  if not coalesce(v_cfg.enabled, false) then
    return jsonb_build_object('ok', false, 'error', 'programme_disabled');
  end if;

  if not coalesce(public.viewer_is_adult(), false) then
    -- Safeguarding: minors cannot hold withdrawal rights here, full stop.
    return jsonb_build_object('ok', false, 'error', 'under_18_not_eligible');
  end if;

  v_withdrawable := coalesce((
    select sum(commission_minor) from public.referral_commissions
    where referrer_id = v_user and status = 'eligible'
  ), 0) - coalesce((
    select sum(amount_minor) from public.referral_payouts
    where referrer_id = v_user and status in ('pending_review','approved','paid')
  ), 0);

  if v_withdrawable < coalesce(v_cfg.min_payout_minor, 2500) then
    return jsonb_build_object('ok', false, 'error', 'below_threshold',
                              'withdrawable_minor', v_withdrawable,
                              'min_payout_minor', coalesce(v_cfg.min_payout_minor, 2500));
  end if;

  insert into public.referral_payouts (referrer_id, amount_minor, currency, status)
  values (v_user, v_withdrawable, coalesce(v_cfg.payout_currency, 'GBP'), 'pending_review')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'payout_id', v_id, 'status', 'pending_review',
                            'amount_minor', v_withdrawable);
end $$;
revoke all on function public.referral_payout_request() from public, anon;
grant execute on function public.referral_payout_request() to authenticated;

-- ── click recording (anonymous; no account and no personal data is attached) ─
create or replace function public.referral_click_record(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(p_code), '') is null then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.referral_clicks (code) values (upper(btrim(p_code)));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.referral_click_record(text) from public, anon;
grant execute on function public.referral_click_record(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ADMIN RPCs — every one checks has_role(auth.uid(), 'admin') on the backend,
-- every mutation writes referral_admin_audit with before/after values.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._referral_admin_assert()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Referral admin action denied';  -- fails closed: not admin, no data path
  end if;
end $$;

create or replace function public.referral_admin_configure(
  p_enabled boolean default null,
  p_commission_pct numeric default null,
  p_provider_fee_pct numeric default null,
  p_tax_pct numeric default null,
  p_hold_days integer default null,
  p_min_payout_minor bigint default null,
  p_attribution_window_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform public._referral_admin_assert();

  select to_jsonb(c) into v_before from public.referral_commission_config c where id = 1;

  update public.referral_commission_config set
    enabled                 = coalesce(p_enabled, enabled),
    commission_pct          = coalesce(p_commission_pct, commission_pct),
    provider_fee_pct        = coalesce(p_provider_fee_pct, provider_fee_pct),
    tax_pct                 = coalesce(p_tax_pct, tax_pct),
    hold_days               = coalesce(p_hold_days, hold_days),
    min_payout_minor        = coalesce(p_min_payout_minor, min_payout_minor),
    attribution_window_days = coalesce(p_attribution_window_days, attribution_window_days),
    updated_at              = now()
  where id = 1;

  select to_jsonb(c) into v_after from public.referral_commission_config c where id = 1;

  insert into public.referral_admin_audit (admin_user_id, action, subject, previous, next)
  values (auth.uid(), 'configure', 'referral_commission_config', v_before, v_after);

  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.referral_admin_configure(boolean, numeric, numeric, numeric, integer, bigint, integer) from public, anon, authenticated;
grant execute on function public.referral_admin_configure(boolean, numeric, numeric, numeric, integer, bigint, integer) to authenticated;

create or replace function public.referral_admin_cancel_commission(
  p_commission_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform public._referral_admin_assert();
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A cancellation must state a reason';
  end if;

  select to_jsonb(c) into v_before from public.referral_commissions c where id = p_commission_id;
  if v_before is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  update public.referral_commissions
  set status = 'cancelled', cancellation_reason = p_reason, updated_at = now()
  where id = p_commission_id;

  select to_jsonb(c) into v_after from public.referral_commissions c where id = p_commission_id;

  insert into public.referral_admin_audit (admin_user_id, action, subject, previous, next)
  values (auth.uid(), 'cancel_commission', p_commission_id::text, v_before, v_after);

  insert into public.referral_commission_events (commission_id, event, meta)
  values (p_commission_id, 'cancelled', jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.referral_admin_cancel_commission(uuid, text) from public, anon, authenticated;
grant execute on function public.referral_admin_cancel_commission(uuid, text) to authenticated;

-- Payout decision: approval does NOT move money. 'approved' means the payout
-- is cleared for execution; 'mark_paid' records an admin-entered provider
-- reference for a transfer that was actually executed outside the system.
create or replace function public.referral_admin_payout_decide(
  p_payout_id uuid,
  p_action text,                -- 'approve' | 'mark_paid' | 'reject'
  p_provider text default null,
  p_provider_reference text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform public._referral_admin_assert();

  select to_jsonb(p_) into v_before from public.referral_payouts p_ where p_.id = p_payout_id;
  if v_before is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  if p_action = 'approve' then
    update public.referral_payouts
    set status = 'approved', decided_by = auth.uid(), decided_at = now()
    where id = p_payout_id and status = 'pending_review';
  elsif p_action = 'mark_paid' then
    if nullif(btrim(coalesce(p_provider, '')), '') is null
       or nullif(btrim(coalesce(p_provider_reference, '')), '') is null then
      raise exception 'Recording a payout requires the provider and the real transfer reference';
    end if;
    update public.referral_payouts
    set status = 'paid', provider = p_provider,
        provider_reference = p_provider_reference,
        decided_by = auth.uid(), decided_at = now()
    where id = p_payout_id and status = 'approved';
  elsif p_action = 'reject' then
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      raise exception 'A rejection must state a reason';
    end if;
    update public.referral_payouts
    set status = 'rejected', admin_note = p_reason,
        decided_by = auth.uid(), decided_at = now()
    where id = p_payout_id and status = 'pending_review';
  else
    raise exception 'Unknown action';
  end if;

  select to_jsonb(p_) into v_after from public.referral_payouts p_ where p_.id = p_payout_id;

  insert into public.referral_admin_audit (admin_user_id, action, subject, previous, next)
  values (auth.uid(), 'payout_' || p_action, p_payout_id::text, v_before, v_after);

  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.referral_admin_payout_decide(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.referral_admin_payout_decide(uuid, text, text, text, text) to authenticated;

-- Inspection + reconciliation export (admin-gated read of ALL rows).
create or replace function public.referral_admin_list_commissions()
returns setof public.referral_commissions
language sql
stable
security definer
set search_path = public
as $$
  select * from public.referral_commissions order by created_at desc limit 200;
$$;

create or replace function public.referral_admin_list_payouts()
returns setof public.referral_payouts
language sql
stable
security definer
set search_path = public
as $$
  select * from public.referral_payouts order by requested_at desc limit 200;
$$;

create or replace function public.referral_admin_export_reconciliation()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'exported_by', auth.uid(),
    'commissions', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
      from public.referral_commissions c),
    'payouts', (
      select coalesce(jsonb_agg(to_jsonb(p_) order by p_.requested_at), '[]'::jsonb)
      from public.referral_payouts p_),
    'audit', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb)
      from public.referral_admin_audit a)
  );
$$;

-- Admin LIST/EXPORT read gate: definer functions above cannot rely on RLS for
-- their reads, so they must check the role explicitly.
create or replace function public._referral_admin_assert_active()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._referral_admin_assert();
end $$;

-- Wrap list/export calls so the check executes before data leaves the server.
create or replace function public.referral_admin_commissions_export()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._referral_admin_assert();
  return public.referral_admin_export_reconciliation();
end $$;
revoke all on function public.referral_admin_commissions_export() from public, anon, authenticated;
grant execute on function public.referral_admin_commissions_export() to authenticated;

revoke all on function public.referral_admin_list_commissions() from public, anon, authenticated;
revoke all on function public.referral_admin_list_payouts() from public, anon, authenticated;
revoke all on function public.referral_admin_export_reconciliation() from public, anon, authenticated;

create or replace function public.referral_admin_commissions_list()
returns setof public.referral_commissions
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._referral_admin_assert();
  return query select * from public.referral_commissions order by created_at desc limit 200;
end $$;

create or replace function public.referral_admin_payouts_list()
returns setof public.referral_payouts
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._referral_admin_assert();
  return query select * from public.referral_payouts order by requested_at desc limit 200;
end $$;

revoke all on function public.referral_admin_commissions_list() from public, anon, authenticated;
revoke all on function public.referral_admin_payouts_list() from public, anon, authenticated;
grant execute on function public.referral_admin_commissions_list() to authenticated;
grant execute on function public.referral_admin_payouts_list() to authenticated;
