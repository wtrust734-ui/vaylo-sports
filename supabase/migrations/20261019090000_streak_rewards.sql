-- ============================================================================
-- STREAK REWARDS — qualifying activity days and milestone awards
-- ----------------------------------------------------------------------------
-- A streak is a run of consecutive calendar days in which the athlete recorded
-- one qualifying activity (or the plan scheduled a rest day). The trusted
-- backend computes it from streak_activity_days; the client only ASKS to claim
-- a day and can never supply a date it has not proven through the same
-- verified sources the XP service already validates.
--
-- Design:
--   streak_activity_days  one row per qualifying local calendar day (unique per
--                         user/day). Duplicate events, concurrent clicks, and
--                         offline/delayed sync all collapse to one day.
--   streak_milestone_wins one row per milestone per account — every milestone
--                         is awarded exactly once, ever, even after a break.
--   streaks               cached current/longest streak for fast reads; always
--                         recomputed from streak_activity_days at claim time.
--   xp_reward_rules       gains 8 rows streak_milestone_<days>, so milestone XP
--                         flows through the SAME xp_award() service, proof
--                         validation and ledger idempotency as every other
--                         award — no second balance, no client minting, no new
--                         level system.
--
-- Rest days: a scheduled rest or active-recovery day in the athlete's active
-- plan qualifies WITHOUT exercise. The reason is stored in the day's detail so
-- streak history stays explainable. Nothing here pressures an injured or sore
-- athlete to train, and there are no paid freezes or paid protections.
-- ============================================================================

-- ── 8 milestone rules: exact spec amounts, one award per account ────────────
insert into public.xp_reward_rules (kind, label, xp_reward, active, repeatable, pass_mark, daily_cap) values
  ('streak_milestone_3',   'The Starter — reach a 3-day streak',       25,   true, false, null, null),
  ('streak_milestone_7',   'The Consistency Badge — 7-day streak',     75,   true, false, null, null),
  ('streak_milestone_14',  'The Momentum Badge — 14-day streak',       125,  true, false, null, null),
  ('streak_milestone_30',  'The Discipline Badge — 30-day streak',     250,  true, false, null, null),
  ('streak_milestone_60',  'The Dedication Badge — 60-day streak',     400,  true, false, null, null),
  ('streak_milestone_90',  'The Elite Habit Badge — 90-day streak',    600,  true, false, null, null),
  ('streak_milestone_180', 'The Unbreakable Badge — 180-day streak',   1000, true, false, null, null),
  ('streak_milestone_365', 'The Year of Progress Badge — 365 days',    2000, true, false, null, null)
on conflict (kind) do update set
  xp_reward   = excluded.xp_reward,
  label       = excluded.label,
  active      = true,
  repeatable  = false,
  updated_at  = now();

-- ── activity days ───────────────────────────────────────────────────────────
create table if not exists public.streak_activity_days (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  source     text not null check (source in
             ('training_session','recovery_session','learning_lesson','weekly_goal','rest_day')),
  source_ref text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint streak_activity_days_user_day_unique unique (user_id, day)
);
create index if not exists streak_activity_days_user_day_idx
  on public.streak_activity_days (user_id, day desc);

alter table public.streak_activity_days enable row level security;

drop policy if exists "streak days own read" on public.streak_activity_days;
create policy "streak days own read" on public.streak_activity_days
  for select to authenticated using (user_id = auth.uid());
-- No insert/update/delete policies on purpose: days are inserted only by the
-- SECURITY DEFINER claim function after source validation. Clients cannot
-- forge a day, backfill history, or rewrite a source.

-- ── milestone wins (achievement badges; once per account, ever) ─────────────
create table if not exists public.streak_milestone_wins (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  milestone_days integer not null check (milestone_days in (3,7,14,30,60,90,180,365)),
  xp_amount      integer not null check (xp_amount > 0),
  created_at     timestamptz not null default now(),
  constraint streak_milestone_wins_user_milestone_unique unique (user_id, milestone_days)
);
create index if not exists streak_milestone_wins_user_idx
  on public.streak_milestone_wins (user_id);

alter table public.streak_milestone_wins enable row level security;

drop policy if exists "streak wins own read" on public.streak_milestone_wins;
create policy "streak wins own read" on public.streak_milestone_wins
  for select to authenticated using (user_id = auth.uid());
-- No write policies: awards are inserted only by the definer below.

-- ── cached streak row ───────────────────────────────────────────────────────
create table if not exists public.streaks (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  current_streak    integer not null default 0 check (current_streak >= 0),
  longest_streak    integer not null default 0 check (longest_streak >= 0),
  last_activity_day date,
  updated_at        timestamptz not null default now()
);

alter table public.streaks enable row level security;

drop policy if exists "streaks own read" on public.streaks;
create policy "streaks own read" on public.streaks
  for select to authenticated using (user_id = auth.uid());

-- ── streak run computation ──────────────────────────────────────────────────
-- The run is the consecutive chain of qualifying days ending at the most
-- recent qualifying day. A streak is "live" while the most recent qualifying
-- day is today or yesterday; otherwise the run is dead and the displayed
-- current streak resets to 0 (the longest is never reduced).
create or replace function public._streak_compute(p_user uuid)
returns table (run integer, latest_day date, alive boolean, longest integer)
language plpgsql stable
set search_path = public
as $$
declare
  v_utc_today date := (now() at time zone 'utc')::date;
  v_latest    date;
  v_cursor    date;
  v_run       integer := 0;
  v_longest   integer := 0;
begin
  select max(day) into v_latest from public.streak_activity_days where user_id = p_user;

  if v_latest is not null then
    v_cursor := v_latest;
    while v_cursor >= v_utc_today - 400 loop
      if exists (select 1 from public.streak_activity_days
                 where user_id = p_user and day = v_cursor) then
        v_run := v_run + 1;
      else
        exit;
      end if;
      v_cursor := v_cursor - 1;
    end loop;
  end if;

  if v_latest is not null and v_latest >= v_utc_today - 1 and v_latest <= v_utc_today + 1 then
    return query select v_run, v_latest, true,
      greatest(v_run, coalesce((select longest_streak from public.streaks where user_id = p_user), 0));
  end if;

  select coalesce(max(longest_streak), 0) into v_longest from public.streaks where user_id = p_user;
  return query select 0::integer, coalesce(v_latest, null), false, v_longest;
end;
$$;

-- ── rest-day validation: a scheduled rest or active-recovery day qualifies
--    WITHOUT exercise, computed from the server's own plan store ─────────────
create or replace function public._streak_validate_rest_day(
  p_user uuid, p_day date
) returns boolean
language plpgsql stable
set search_path = public
as $$
declare
  v_plan record;
  v_days_since_plan integer;
  v_plan_week integer;
  v_dow integer;
  v_sessions jsonb;
  v_session jsonb;
  s jsonb;
begin
  select * into v_plan
  from public.training_plans
  where user_id = p_user
    and active = true
    and plan_data is not null
    and (plan_data->'sessions') is not null
    and created_at::date <= p_day
  order by created_at desc
  limit 1;
  if not found then return false; end if;

  -- Week of the plan for p_day, anchored to the plan's server creation date,
  -- so a client cannot shift the schedule it is claiming against.
  v_days_since_plan := (p_day - v_plan.created_at::date);
  if v_days_since_plan < 0 or v_days_since_plan > v_plan.duration_weeks * 7 then
    return false;
  end if;
  v_plan_week := (v_days_since_plan / 7) + 1;
  if v_plan_week < 1 or v_plan_week > v_plan.duration_weeks then return false; end if;

  -- Plan sessions use day 1..7 with Monday first (Postgres makes Sunday 0).
  v_dow := extract(dow from p_day)::int;
  if v_dow = 0 then v_dow := 7; end if;

  v_sessions := v_plan.plan_data->'sessions';
  if jsonb_typeof(v_sessions) = 'object' then
    v_session := v_sessions -> v_dow::text;
    return coalesce(
      (v_session->>'isRest')::boolean
      or (v_session->>'isRecovery')::boolean
      or lower(coalesce(v_session->>'type','')) = 'rest',
      false);
  end if;

  if jsonb_typeof(v_sessions) = 'array' then
    for s in select * from jsonb_array_elements(v_sessions) loop
      if (s->>'day')::int = v_dow
         and (
           (s->>'isRest')::boolean is true
           or (s->>'isRecovery')::boolean is true
           or lower(coalesce(s->>'type','')) = 'rest'
         ) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

-- ── milestone XP passes the same proof gate as every other kind ─────────────
-- The original validators become _xp_validate_source_core; a new wrapper adds
-- the streak_milestone_* branch: the ref ('<user>:<days>') must match a
-- streak_milestone_wins row for the caller, and the rule amount must equal the
-- amount stamped into that win row. xp_award() for these kinds is callable
-- only from the claim transaction that also inserts the win row.
alter function public._xp_validate_source(uuid, text, text)
  rename to _xp_validate_source_core;

create or replace function public._xp_validate_source(
  p_user uuid, p_kind text, p_source_ref text
) returns boolean
language plpgsql stable
set search_path = public
as $$
declare
  v_days integer;
begin
  if p_kind like 'streak\_milestone\__%' escape '\' then
    begin
      v_days := (split_part(p_kind, '_', 3))::integer;
    exception when others then return false;
    end;
    if v_days is null or v_days not in (3,7,14,30,60,90,180,365) then return false; end if;
    return exists (
      select 1 from public.streak_milestone_wins w
      where w.user_id = p_user
        and w.milestone_days = v_days
        and w.xp_amount = (select xp_reward from public.xp_reward_rules
                           where kind = p_kind and active = true)
    );
  end if;
  return public._xp_validate_source_core(p_user, p_kind, p_source_ref);
end;
$$;

-- ── the claim function: proof → day → milestone awards, one transaction ─────
create or replace function public.streak_claim_day(
  p_day        date,
  p_source     text,
  p_source_ref text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_utc_today date := (now() at time zone 'utc')::date;
  v_proven boolean := false;
  v_detail jsonb := '{}'::jsonb;
  v_inserted boolean := false;
  v_run integer := 0;
  v_latest date;
  v_alive boolean := false;
  v_longest integer := 0;
  v_prev_longest integer := 0;
  v_current integer := 0;
  v_rule public.xp_reward_rules%rowtype;
  v_days integer;
  v_amount integer;
  v_win_id uuid;
  v_award jsonb;
  v_new jsonb := '[]'::jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_day is null or nullif(btrim(p_source_ref), '') is null then
    return jsonb_build_object('ok', false, 'error', 'missing_arguments');
  end if;

  -- Delayed offline sync: a claimed day may be up to 14 days in the past
  -- (device offline, delayed upload), at most 1 day ahead of the UTC server
  -- day (user-local calendar east of UTC, DST transitions). Anything else is
  -- rejected — a client cannot create false streaks by changing its device
  -- date, and cannot backfill arbitrary history.
  if p_day < v_utc_today - 14 or p_day > v_utc_today + 1 then
    return jsonb_build_object('ok', false, 'error', 'day_out_of_range');
  end if;

  if p_source = 'rest_day' then
    v_proven := public._streak_validate_rest_day(v_user, p_day);
    if v_proven then
      v_detail := jsonb_build_object('reason', 'scheduled rest day in the active training plan');
    end if;
  else
    -- Every other source reuses the XP service's proof validators — the very
    -- rows that would earn XP themselves; no new trust path is created and no
    -- client-supplied amount or date is trusted.
    v_proven := public._xp_validate_source_core(v_user, p_source, p_source_ref);
  end if;

  if not v_proven then
    return jsonb_build_object('ok', false, 'error', 'unverified_activity');
  end if;

  -- Unique (user, day) makes duplicate events and retries collapse to one day.
  insert into public.streak_activity_days (user_id, day, source, source_ref, detail)
  values (v_user, p_day, p_source, btrim(p_source_ref), v_detail)
  on conflict (user_id, day) do nothing
  returning true into v_inserted;
  v_inserted := coalesce(v_inserted, false);

  -- Recompute the run from the record of qualifying days (the stale cache row
  -- never drives an award decision).
  select s.run, s.latest_day, s.alive, s.longest
    into v_run, v_latest, v_alive, v_prev_longest
  from public._streak_compute(v_user) s;
  v_longest := greatest(v_prev_longest, v_run);

  -- Milestone awards: every kind is a configured xp_reward_rules row, so XP is
  -- granted ONLY through public.xp_award() (same ledger, same proof gate, same
  -- idempotency). The win row is inserted first because the milestone validator
  -- uses it as proof; if xp_award fails, the win row is removed again so a
  -- later claim can retry the award. Unique (user, milestone) makes concurrent
  -- claims safe.
  for v_rule in
    select * from public.xp_reward_rules
    where kind like 'streak\_milestone\_%' escape '\'
      and active = true
      and (split_part(kind, '_', 3))::int <= v_run
    order by (split_part(kind, '_', 3))::int
  loop
    v_days := (split_part(v_rule.kind, '_', 3))::int;
    if not exists (
      select 1 from public.streak_milestone_wins
      where user_id = v_user and milestone_days = v_days
    ) then
      insert into public.streak_milestone_wins (user_id, milestone_days, xp_amount)
      values (v_user, v_days, v_rule.xp_reward)
      on conflict (user_id, milestone_days) do nothing
      returning id, xp_amount into v_win_id, v_amount;
      if v_win_id is not null then
        v_award := public.xp_award(
          v_rule.kind,
          v_user::text || ':' || v_days::text,
          null,
          v_rule.label
        );
        if coalesce((v_award->>'ok')::boolean, false) then
          v_amount := coalesce((v_award->>'awarded')::integer, 0);
          v_new := v_new || jsonb_build_object(
            'kind', v_rule.kind, 'days', v_days, 'name', v_rule.label, 'xp', v_amount);
        else
          -- Server error during reward processing: unwind the win so the next
          -- valid claim can retry. No phantom badge without a ledger entry.
          delete from public.streak_milestone_wins where id = v_win_id;
        end if;
      end if;
    end if;
  end loop;

  insert into public.streaks (user_id, current_streak, longest_streak, last_activity_day)
  values (v_user,
          case when v_alive then v_run else 0 end,
          v_longest,
          v_latest)
  on conflict (user_id) do update set
    current_streak    = excluded.current_streak,
    longest_streak    = greatest(public.streaks.longest_streak, excluded.longest_streak),
    last_activity_day = excluded.last_activity_day,
    updated_at        = now();

  select r.current_streak, r.longest_streak into v_current, v_longest
  from public.streaks r where r.user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'duplicate_day', not v_inserted,
    'current_streak', v_current,
    'longest_streak', v_longest,
    'new_milestones', v_new);
end;
$$;
revoke all on function public.streak_claim_day(date, text, text) from public, anon;
grant execute on function public.streak_claim_day(date, text, text) to authenticated;

-- ── panel state for the UI: everything the streak screen shows, one call ────
create or replace function public.streak_panel()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with comp as (
    select run, latest_day, alive, longest from public._streak_compute(auth.uid())
  ),
  milestones as (
    select
      r.kind,
      (split_part(r.kind, '_', 3))::int as days,
      r.label as name,
      r.xp_reward as xp,
      exists (select 1 from public.streak_milestone_wins w
              where w.user_id = auth.uid()
                and w.milestone_days = (split_part(r.kind, '_', 3))::int) as earned
    from public.xp_reward_rules r
    where r.kind like 'streak\_milestone\_%' escape '\'
      and r.active = true
  )
  select jsonb_build_object(
    'current_streak', case when c.alive then c.run else 0 end,
    'live_run', c.run,
    'longest_streak', c.longest,
    'last_activity_day', c.latest_day,
    'next_milestone', (
      select jsonb_build_object('days', m.days, 'name', m.name, 'xp', m.xp,
                                'remaining', greatest(m.days - case when c.alive then c.run else 0 end, 0))
      from milestones m
      where not m.earned and c.run < m.days
      order by m.days
      limit 1),
    'milestones', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', m.kind, 'days', m.days, 'name', m.name,
               'xp', m.xp, 'earned', m.earned) order by m.days), '[]'::jsonb)
      from milestones m),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', d.day, 'source', d.source, 'detail', d.detail) order by d.day desc), '[]'::jsonb)
      from public.streak_activity_days d
      where d.user_id = auth.uid()
        and d.day >= (now() at time zone 'utc')::date - 60)
  )
  from comp c;
$$;
revoke all on function public.streak_panel() from public, anon;
grant execute on function public.streak_panel() to authenticated;
