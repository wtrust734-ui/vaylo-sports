-- ============================================================================
-- XP AND ATHLETE PROGRESSION SYSTEM — foundation
-- ----------------------------------------------------------------------------
-- XP is a progression metric ONLY. It is not money, credits, coins or any
-- purchasable balance. It lives in its own tables and its own RPCs, completely
-- separated from credit_transactions, coins and every payment flow.
--
-- Design shape:
--   xp_reward_rules    configurable award amounts (server is the only reader of
--                      the amounts; the client asks by kind and never supplies a
--                      number).
--   xp_levels          cumulative thresholds for levels 1..10; post-10 comes from
--                      xp_level_config so the ladder can grow without a rewrite.
--   xp_level_config    flexible config table for post-level-10 progression.
--   xp_transactions    the ledger. One row per award/reversal, unique
--                      idempotency key, reversal references. Append-only.
--
-- Writes are impossible for clients. RLS allows a user to SELECT their own
-- ledger rows; INSERT/UPDATE/DELETE have no policies at all, and all mutations
-- run through SECURITY DEFINER functions that take the caller from auth.uid(),
-- never from an argument.
--
-- Rules kept for the future streak work (documented, not implemented):
--   * a rest day is a session_source too (xp_activity_days), so a streak built
--     on "logged activity days" does not need exercise to be valid;
--   * every table below is generic (kind + ref), so new award kinds are new
--     rows in xp_reward_rules, not new code paths;
--   * xp_profile() is the only level calculator; page 10+ growth is data.
-- ============================================================================

-- ── reward rules ─────────────────────────────────────────────────────────────
create table if not exists public.xp_reward_rules (
  kind          text primary key,
  label         text not null,
  xp_reward     integer not null check (xp_reward > 0),
  active        boolean not null default true,
  repeatable    boolean not null default false,
  pass_mark     integer check (pass_mark is null or (pass_mark >= 0 and pass_mark <= 100)),
  daily_cap     integer check (daily_cap is null or daily_cap > 0),
  updated_at    timestamptz not null default now()
);

insert into public.xp_reward_rules (kind, label, xp_reward, active, repeatable, pass_mark, daily_cap) values
  ('training_session', 'Complete a training session',            20, true, false, null, 3),
  ('recovery_session', 'Complete a recovery check-in',           15, true, false, null, 1),
  ('learning_lesson',  'Complete a learning lesson',             10, true, false, null, null),
  ('weekly_goal',      'Complete a weekly training-plan goal',   50, true, false, null, null),
  ('assessment',       'Pass an approved educational assessment',15, true, false,   80, null)
on conflict (kind) do nothing;

-- ── level ladder ─────────────────────────────────────────────────────────────
create table if not exists public.xp_levels (
  level        integer primary key check (level >= 1),
  total_xp     bigint  not null unique check (total_xp >= 0)
);

insert into public.xp_levels (level, total_xp) values
  (1, 0), (2, 100), (3, 250), (4, 450), (5, 700),
  (6, 1000), (7, 1400), (8, 1900), (9, 2500), (10, 3200)
on conflict (level) do nothing;

-- Growth after the fixed ladder. threshold(n) for n > 10:
--   threshold(10) + sum over k = 11..n of (first_delta + (k - 11) * growth)
-- With the seed values: L10=3200, L11=4000, L12=4860, L13=5780 …
-- every step is strictly larger than the previous one.
create table if not exists public.xp_level_config (
  id                 integer primary key default 1 check (id = 1),
  post10_first_delta bigint not null default 800 check (post10_first_delta > 0),
  post10_growth      bigint not null default 60  check (post10_growth >= 0),
  updated_at         timestamptz not null default now()
);

insert into public.xp_level_config (id) values (1) on conflict (id) do nothing;

-- ── the ledger ───────────────────────────────────────────────────────────────
create table if not exists public.xp_transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  kind           text not null,
  xp_amount      integer not null check (xp_amount <> 0),
  reason         text,
  source_ref     text,
  idempotency_key text not null unique,
  reversal_of    uuid references public.xp_transactions (id) on delete set null,
  created_at     timestamptz not null default now(),
  -- audit trail: the ref is *verified* by the award function, never trusted.
  constraint xp_amount_kind_reversal_shape
    check ((xp_amount > 0 and reversal_of is null) or (xp_amount < 0 and reversal_of is not null))
);

create index if not exists xp_transactions_user_created_idx
  on public.xp_transactions (user_id, created_at desc);
create unique index if not exists xp_transactions_user_kind_ref_idx
  on public.xp_transactions (user_id, kind, source_ref)
  where source_ref is not null;

-- ── RLS: read your own ledger, never write ───────────────────────────────────
alter table public.xp_transactions enable row level security;

drop policy if exists "xp own ledger read" on public.xp_transactions;
create policy "xp own ledger read" on public.xp_transactions
  for select to authenticated
  using (user_id = auth.uid());

-- No insert/update/delete policies on purpose: every mutation goes through the
-- SECURITY DEFINER functions below.

-- ── level helpers (trusted shared logic; the UI mirrors this in src/lib/xp.ts) ─
create or replace function public.xp_threshold(p_level bigint)
returns bigint
language plpgsql immutable
set search_path = public
as $$
declare
  v_total bigint := 0;
  v_growth bigint;
  v_first bigint;
  k bigint;
begin
  if p_level <= 0 then return 0; end if;

  -- Fixed ladder levels read their row directly. A plain (non-aggregate)
  -- SELECT INTO is used because an aggregate always yields exactly one row,
  -- which would make `found` true even when nothing matched.
  if p_level <= 10 then
    select total_xp into v_total from public.xp_levels where level = p_level;
    return coalesce(v_total, 0);
  end if;

  select post10_first_delta, post10_growth into v_first, v_growth
    from public.xp_level_config where id = 1;
n  v_total := (select total_xp from public.xp_levels where level = 10);
  for k in 11..p_level loop
    -- Strictly increasing: the delta itself grows with k, so it can never wrap
    -- back below the level before it.
    v_total := v_total + v_first + (k - 11) * v_growth;
  end loop;
  return v_total;
end;
$$;

create or replace function public.xp_level_for(p_total_xp bigint)
returns bigint
language plpgsql immutable
set search_path = public
as $$
declare
  v_level bigint := 1;
begin
  if p_total_xp is null or p_total_xp < 0 then return 1; end if;

  select coalesce(max(level), 1) into v_level from public.xp_levels where total_xp <= p_total_xp;
  if v_level < 10 then return v_level; end if;

  -- Above the fixed ladder: walk the config formula. Bounded by ~a lifetime of
  -- XP; each step adds at least v_first, so the loop terminates.
  loop
    v_level := v_level + 1;
    if public.xp_threshold(v_level) > p_total_xp then
      return v_level - 1;
    end if;
  end loop;
end;
$$;

-- ── proof validation ─────────────────────────────────────────────────────────-
-- Each kind has one validator. It returns true only when the referenced row:
--   * belongs to the caller, and
--   * really represents the completed, qualifying activity.
create or replace function public._xp_validate_source(
  p_user uuid, p_kind text, p_source_ref text
) returns boolean
language plpgsql stable
set search_path = public
as $$
declare
  v_log_date date;
  v_target int;
begin
  if p_source_ref is null or length(p_source_ref) = 0 then return false; end if;

  case p_kind
    -- A planned training session: a performance log the athlete actually
    -- recorded (RPE or full session load present), typed as training.
    when 'training_session' then
      return exists (
        select 1 from public.performance_logs pl
        where pl.id::text = p_source_ref
          and pl.user_id = p_user
          and pl.log_type = 'training'
          and (pl.perceived_exertion is not null or pl.session_load is not null)
      );

    -- A recovery day (rest counts — a rest day never requires exercise).
    when 'recovery_session' then
      begin
        v_log_date := p_source_ref::date;
      exception when others then return false;
      end;
      return exists (
        select 1 from public.recovery_logs rl
        where rl.user_id = p_user
          and rl.log_date = v_log_date
          and rl.readiness_score is not null
      );

    -- Learning: the lesson genuinely marked complete for this user.
    when 'learning_lesson' then
      return exists (
        select 1 from public.learning_progress lp
        where lp.user_id = p_user
          and lp.lesson_id = p_source_ref
          and lp.completed = true
      );

    -- Assessment: the same row, but the stored quiz score must meet the rule's
    -- pass mark. Scoring below the mark earns the lesson, not the assessment.
    when 'assessment' then
      return exists (
        select 1 from public.learning_progress lp
        where lp.user_id = p_user
          and lp.lesson_id = p_source_ref
          and lp.completed = true
          and lp.quiz_score is not null
          and lp.quiz_score >= (select pass_mark from public.xp_reward_rules where kind = 'assessment')
      );

    -- Weekly process goal: the goal exists for the caller and the distinct
    -- logged days for its actions within the target week reach weekly_target.
    when 'weekly_goal' then
      begin
        v_target := (select pg.weekly_target
                     from public.process_goals pg
                     where pg.id::text = split_part(p_source_ref, ':', 1)
                       and pg.user_id = p_user);
      exception when others then return false;
      end;
      if v_target is null or v_target <= 0 then return false; end if;

      return v_target <= (
        select count(distinct dal.log_date)
        from public.daily_action_logs dal
        join public.daily_actions da on da.id = dal.action_id
        where da.user_id = p_user
          and da.process_goal_id::text = split_part(p_source_ref, ':', 1)
          and dal.completed = true
          and dal.log_date >= split_part(p_source_ref, ':', 2)::date
          and dal.log_date <  split_part(p_source_ref, ':', 2)::date + 7
      );

    else
      return false;
  end case;
end;
$$;

-- ── the one way XP is awarded ───────────────────────────────────────────────---
create or replace function public.xp_award(
  p_kind           text,
  p_source_ref     text,
  p_idempotency_key text default null,
  p_reason         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_rule  public.xp_reward_rules%rowtype;
  v_key   text := p_idempotency_key;
  v_amount int;
  v_total bigint;
  v_level bigint;
  v_prev_level bigint;
  v_awarded int := 0;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_kind is null or p_source_ref is null then
    return jsonb_build_object('ok', false, 'error', 'missing_arguments');
  end if;

  select * into v_rule from public.xp_reward_rules
    where kind = p_kind and active = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_kind');
  end if;

  -- Proof first: no row, no XP.
  if not public._xp_validate_source(v_user, p_kind, p_source_ref) then
    return jsonb_build_object('ok', false, 'error', 'unverified_activity');
  end if;

  -- Reusable awards (none today) are the only kind that may repeat; everything
  -- else is one award per source, forever, via the ledger's unique indexes.
  if v_rule.repeatable then
    if v_key is null then
      v_key := v_user::text || ':' || p_kind || ':' || p_source_ref || ':' ||
               to_char(now(), 'YYYY-MM-DD');
    end if;
  elsif v_key is null then
    v_key := v_user::text || ':' || p_kind || ':' || p_source_ref;
  end if;

  -- Daily cap: flat rewards per session, capped per day, so volume is never
  -- farmed and overtraining earns nothing extra. Counts today's positive
  -- awards of this kind (reversals are negative and do not use up the cap).
  if v_rule.daily_cap is not null then
    if (select count(*) from public.xp_transactions
        where user_id = v_user and kind = p_kind
          and xp_amount > 0
          and created_at >= date_trunc('day', now())) >= v_rule.daily_cap then
      return jsonb_build_object('ok', false, 'error', 'daily_cap_reached');
    end if;
  end if;

  -- Idempotent write: the key is unique; a replay lands here with no insert.
  insert into public.xp_transactions
    (user_id, kind, xp_amount, reason, source_ref, idempotency_key)
  values
    (v_user, p_kind, v_rule.xp_reward,
     coalesce(p_reason, v_rule.label), p_source_ref, v_key)
  on conflict (idempotency_key) do nothing
  returning xp_amount into v_amount;

  if v_amount is null then
    -- Duplicate submission: already awarded; report the standing profile.
    return public.xp_profile() || jsonb_build_object('ok', true, 'awarded', 0, 'duplicate', true);
  end if;

  select sum(xp_amount) into v_total from public.xp_transactions where user_id = v_user;
  v_level := public.xp_level_for(v_total);
  -- Level before this award: level of the total minus this one award.
  v_prev_level := public.xp_level_for(v_total - v_amount);

  return jsonb_build_object(
    'ok', true,
    'awarded', v_amount,
    'duplicate', false,
    'total_xp', v_total,
    'level', v_level,
    'previous_level', v_prev_level,
    'leveled_up', v_level > v_prev_level,
    'xp_into_level', v_total - public.xp_threshold(v_level),
    'xp_for_next_level', greatest(public.xp_threshold(v_level + 1) - public.xp_threshold(v_level), 0),
    'xp_to_next_level', greatest(public.xp_threshold(v_level + 1) - v_total, 0)
  );
end;
$$;

-- ── auditable correction ─────────────────────────────────────────────────────
create or replace function public.xp_reverse(
  p_transaction_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_orig public.xp_transactions%rowtype;
  v_key text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_orig from public.xp_transactions
    where id = p_transaction_id and user_id = v_user;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'transaction_not_found');
  end if;
  if v_orig.xp_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'already_a_reversal');
  end if;
  if exists (select 1 from public.xp_transactions where reversal_of = v_orig.id) then
    return jsonb_build_object('ok', false, 'error', 'already_reversed');
  end if;

  v_key := 'reverse:' || v_orig.id::text;
  insert into public.xp_transactions
    (user_id, kind, xp_amount, reason, source_ref, idempotency_key, reversal_of)
  values
    (v_user, v_orig.kind, -v_orig.xp_amount,
     coalesce(p_reason, 'reversal: ' || v_orig.id::text), v_orig.source_ref, v_key, v_orig.id);

  return public.xp_profile() || jsonb_build_object('ok', true);
end;
$$;

-- ── progression read model ───────────────────────────────────────────────────
create or replace function public.xp_profile(p_for uuid default null)
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(p_for, auth.uid());
  v_total bigint;
  v_level bigint;
  v_next bigint;
  v_this bigint;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  -- Only auth.uid() reads a profile: private progression stays private.
  -- `<>` would evaluate to NULL (false) when the session user is unknown,
  -- letting a foreign id through; IS DISTINCT FROM handles that correctly.
  if v_user is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(sum(xp_amount), 0) into v_total
    from public.xp_transactions where user_id = v_user;

  v_level   := public.xp_level_for(v_total);
  v_next    := public.xp_threshold(v_level + 1);
  v_this    := public.xp_threshold(v_level);

  return jsonb_build_object(
    'ok', true,
    'total_xp', v_total,
    'level', v_level,
    'xp_into_level', v_total - v_this,
    'xp_for_next_level', greatest(v_next - v_this, 0),
    'xp_to_next_level', greatest(v_next - v_total, 0)
  );
end;
$$;

-- ── least privilege: callable only by signed-in athletes ─────────────────────
revoke all on function public.xp_award(text, text, text, text) from public, anon;
revoke all on function public.xp_reverse(uuid, text) from public, anon;
revoke all on function public.xp_profile(uuid) from public, anon;
grant execute on function public.xp_award(text, text, text, text) to authenticated;
grant execute on function public.xp_reverse(uuid, text) to authenticated;
grant execute on function public.xp_profile(uuid) to authenticated;

revoke all on table public.xp_reward_rules  from anon, authenticated;
revoke all on table public.xp_levels        from anon, authenticated;
revoke all on table public.xp_level_config  from anon, authenticated;
revoke all on table public.xp_transactions  from anon, authenticated;
grant select on table public.xp_transactions to authenticated; -- RLS limits to own rows
