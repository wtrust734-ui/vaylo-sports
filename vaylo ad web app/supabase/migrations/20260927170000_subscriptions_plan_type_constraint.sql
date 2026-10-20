-- Unbreak the subscription write path: plan_type's CHECK predates Phase 2.
--
-- `subscriptions_plan_type_check` still described the legacy plan model —
-- it allowed only 'free', 'minimum', 'pro' and 'elite'. Both writers of that
-- column now name a Phase 2 plan: activate_subscription() sets
-- `plan_type = subscription_plans.plan_key`, whose live values are 'credit' and
-- 'unlimited', and grant_unlimited_trial() wrote 'trial'. Every one of those
-- writes raised
--
--   23514 new row for relation "subscriptions" violates check constraint
--         "subscriptions_plan_type_check"
--
-- so no subscription purchase could ever complete and the one-tap 7-day trial
-- always failed with a database error. That is why every row in the table is
-- still 'free'/'free'. The constraint is the only obstacle:
-- subscriptions_user_id_key — the UNIQUE (user_id) that activate_subscription's
-- ON CONFLICT needs — does exist, and was verified against the live schema.
--
-- The allowed set now matches the client's PlanKey union
-- ('free' | 'credit' | 'unlimited'). The legacy values stay in the list so any
-- historical row keeps validating.
alter table public.subscriptions drop constraint if exists subscriptions_plan_type_check;
alter table public.subscriptions
  add constraint subscriptions_plan_type_check
  check (plan_type = any (array['free', 'credit', 'unlimited', 'minimum', 'pro', 'elite']));

-- The trial is an Unlimited plan; `status = 'trial'` is what marks it as one,
-- and plan_type now mirrors plan_key exactly as activate_subscription does.
create or replace function public.grant_unlimited_trial(p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_days integer := greatest(1, least(30, coalesce(p_days, 7)));
  v_trial_end timestamptz;
  v_sub public.subscriptions%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'auth_required');
  end if;

  select * into v_sub from public.subscriptions where user_id = v_user;

  -- One trial per account, decided by whether a trial was ever started rather
  -- than by the current status. The previous version tested `status = 'trial'`
  -- *after* rejecting every non-'free' status, so that branch never ran.
  if v_sub.trial_ends_at is not null then
    return jsonb_build_object('ok', false, 'error', 'trial_already_used');
  end if;

  if v_sub.status is not null and v_sub.status <> 'free' then
    return jsonb_build_object('ok', false, 'error', 'already_subscribed');
  end if;

  v_trial_end := now() + make_interval(days => v_days);

  -- `expires_at` is set alongside `trial_ends_at`: it is the field every other
  -- consumer already understands (has_unlimited_credits, get_my_entitlements,
  -- and the edge-function entitlement check), so the trial has one unambiguous
  -- end date instead of a field nobody reads.
  update public.subscriptions
    set status = 'trial',
        plan_key = 'unlimited',
        plan_type = 'unlimited',
        trial_ends_at = v_trial_end,
        expires_at = v_trial_end,
        unlimited_credits = true,
        provider = 'trial',
        updated_at = now()
    where user_id = v_user;

  if not found then
    insert into public.subscriptions
      (user_id, status, plan_key, plan_type, trial_ends_at, expires_at, unlimited_credits, provider)
    values (v_user, 'trial', 'unlimited', 'unlimited', v_trial_end, v_trial_end, true, 'trial');
  end if;

  return jsonb_build_object('ok', true, 'trial_ends_at', v_trial_end, 'days', v_days);
end;
$function$;
