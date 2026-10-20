-- ============================================================================
-- GOAL ROADMAP & GUARDIAN ACCESS  (Adaptive Athlete Intelligence — Phase 4)
-- ----------------------------------------------------------------------------
-- Two things, and one of them is a privacy decision rather than a feature.
--
-- 1. THE ROADMAP EXTENDS `outcome_goals`. There is no second goals table here.
--    The app already stores a target (`target_value`), where the athlete is now
--    (`current_value`), where they started (`start_value`) and when they want it
--    by (`deadline`). What a roadmap adds is the middle: which phase they are
--    in, which areas of their development matter, and the milestones between
--    here and there. Those are columns on the existing table.
--
--    Note what is deliberately NOT added: a `target_date`. `deadline` already
--    is the target date, and two columns meaning one thing is how a database
--    starts disagreeing with itself.
--
-- 2. GUARDIAN ACCESS IS A SANITIZED READ, NOT A TABLE GRANT. This is the
--    important one. Postgres RLS filters ROWS, never COLUMNS, so any policy
--    that lets a guardian read `recovery_logs` also lets them read `hrv`,
--    `sleep_quality`, `rest_hours` and `notes` — which the specification
--    forbids in as many words. So guardians are granted ZERO access to the
--    athlete's tables. Instead there is one SECURITY DEFINER function,
--    `guardian_athlete_overview(athlete)`, which:
--
--      • verifies the caller is an ACTIVE guardian of that athlete,
--      • reads the permission map stored on the link,
--      • builds a payload containing only permitted sections, each already
--        reduced to what that section is allowed to contain (a recovery
--        *band*, never a recovery log; an average, never a daily row).
--
--    One function means one authorization check to audit rather than six
--    view policies that could drift apart. Column-level privacy is enforced by
--    construction: the raw columns are not selected at all, so there is no
--    permission a guardian could hold that would reveal them.
--
-- 3. THE FRIENDSHIP GRANT ON GOALS IS REVOKED. `outcome_goals` carried a
--    "Partners view outcome goals" policy letting any accepted friend read goal
--    rows. For an adult that is a feature; for a 12-year-old it is a stranger
--    reading "make the county squad" off a friend request that was accepted on
--    a bus. Goals are now readable by their owner and by an approved guardian,
--    and by nobody else.
--
-- What is NOT changed: `process_goals`, `daily_actions`, `daily_action_logs`,
-- `training_plans`, `plan_events`, `workouts`, `recovery_logs` and
-- `performance_logs` keep their existing policies exactly as they are. No
-- guardian is granted anything on them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The roadmap columns, on the goals table that already exists
-- ---------------------------------------------------------------------------

alter table public.outcome_goals
  -- Where the athlete is now, in their own words: "4:32 1500m PB", "school
  -- second team". Free text because a current level is genuinely not one
  -- number — a team level and a PB are both answers.
  add column if not exists current_level text,
  -- Base / build / specific / competition / transition. The closed set the
  -- specification names, so a phase the UI has no word for cannot be stored.
  add column if not exists phase text,
  -- Key development areas, e.g. ["aerobic capacity", "change of direction"].
  -- JSON array rather than a join table: they are 3–5 short labels derived
  -- from the goal, never queried individually, and a table here would be a
  -- second thing to keep in step with the goal it belongs to.
  add column if not exists development_areas jsonb not null default '[]'::jsonb,
  -- Milestones: [{ id, title, targetDate, status, note? }], status one of
  -- achieved / upcoming / missed.
  add column if not exists milestones jsonb not null default '[]'::jsonb,
  -- on_track / ahead / behind / unknown. `unknown` is a real answer and is the
  -- default: a goal with no deadline is not "on track", it is unmeasurable.
  add column if not exists progress_status text,
  -- When the roadmap last changed, so a stale one can say so rather than
  -- presenting month-old advice as current.
  add column if not exists roadmap_updated_at timestamptz;

comment on column public.outcome_goals.current_level is
  'The athlete''s current level toward this goal, free text (a PB, a team level, a description).';
comment on column public.outcome_goals.phase is
  'Current development phase. Closed set: base, build, specific, competition, transition.';
comment on column public.outcome_goals.development_areas is
  'JSON string array of 3-5 key development areas, derived from the goal category, sports and age.';
comment on column public.outcome_goals.milestones is
  'JSON array of { id, title, targetDate, status, note? } where status is achieved|upcoming|missed.';
comment on column public.outcome_goals.progress_status is
  'Derived progress label: on_track|ahead|behind|unknown. Nullable; unknown is a real answer.';

alter table public.outcome_goals
  drop constraint if exists outcome_goals_phase_allowed;
alter table public.outcome_goals
  add constraint outcome_goals_phase_allowed
  check (phase is null or phase in ('base', 'build', 'specific', 'competition', 'transition'));

alter table public.outcome_goals
  drop constraint if exists outcome_goals_progress_status_allowed;
alter table public.outcome_goals
  add constraint outcome_goals_progress_status_allowed
  check (progress_status is null or progress_status in ('on_track', 'ahead', 'behind', 'unknown'));

alter table public.outcome_goals
  drop constraint if exists outcome_goals_development_areas_array;
alter table public.outcome_goals
  add constraint outcome_goals_development_areas_array
  check (jsonb_typeof(development_areas) = 'array');

alter table public.outcome_goals
  drop constraint if exists outcome_goals_milestones_array;
alter table public.outcome_goals
  add constraint outcome_goals_milestones_array
  check (jsonb_typeof(milestones) = 'array');

-- A roadmap is a summary, not a document. Bounded so a bad import cannot turn
-- a goal row into a payload every render has to carry.
alter table public.outcome_goals
  drop constraint if exists outcome_goals_roadmap_size;
alter table public.outcome_goals
  add constraint outcome_goals_roadmap_size
  check (
    jsonb_array_length(development_areas) <= 8
    and jsonb_array_length(milestones) <= 20
  );

alter table public.outcome_goals
  drop constraint if exists outcome_goals_current_level_length;
alter table public.outcome_goals
  add constraint outcome_goals_current_level_length
  check (current_level is null or char_length(current_level) <= 200);

-- ---------------------------------------------------------------------------
-- 2. Guardian links — the permission record itself
-- ---------------------------------------------------------------------------

create table if not exists public.guardian_links (
  id uuid primary key default gen_random_uuid(),

  -- The adult. Named `guardian_user_id` rather than `parent_user_id` because a
  -- carer, an older sibling with custody or a legal guardian all fit, and the
  -- product should not rename someone's family for them.
  guardian_user_id uuid not null references auth.users(id) on delete cascade,
  -- The athlete. `athlete_user_id` rather than the schema-wide `user_id`,
  -- because this row belongs to two people and one of them has to be named.
  athlete_user_id uuid not null references auth.users(id) on delete cascade,

  -- The guardian's own word for the relationship. Free-ish and closed: the UI
  -- offers these and adding one is a migration, on purpose.
  relationship text not null default 'guardian',

  -- pending  — the link exists but the athlete has not approved it
  -- active   — approved and readable, subject to `permissions`
  -- revoked  — switched off by either side; kept so the athlete can see it
  --            happened rather than finding a link silently gone
  status text not null default 'pending',

  -- Field-level visibility. Keys are the guardian fields in
  -- `src/lib/guardianAccess.ts`; a key that is absent is a key that is FALSE,
  -- so a permission added later is off until it is deliberately granted.
  -- These are visibility flags for SANITIZED summaries only — no value of this
  -- object grants access to a raw recovery log, because none is ever selected.
  permissions jsonb not null default '{}'::jsonb,

  -- Which age band the defaults were computed for, so a guardian whose child
  -- has a birthday does not silently keep a younger child's wider access.
  defaults_band text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  revoked_at timestamptz,

  constraint guardian_links_status_allowed
    check (status in ('pending', 'active', 'revoked')),
  constraint guardian_links_relationship_allowed
    check (relationship in ('parent', 'guardian', 'carer', 'sibling', 'other')),
  -- Nobody is their own guardian.
  constraint guardian_links_not_self
    check (guardian_user_id <> athlete_user_id),
  constraint guardian_links_permissions_object
    check (jsonb_typeof(permissions) = 'object'),
  -- One link per pair. A revoked link is re-activated rather than duplicated,
  -- which is what makes `status` meaningful.
  constraint guardian_links_pair_unique
    unique (guardian_user_id, athlete_user_id)
);

comment on table public.guardian_links is
  'A guardian''s approved access to a youth athlete. Grants no access to any athlete table; read access goes through guardian_athlete_overview().';
comment on column public.guardian_links.permissions is
  'Field-level visibility flags for sanitized summaries. Absent key = not granted. Never grants access to raw recovery or wellbeing data.';

create index if not exists idx_guardian_links_athlete
  on public.guardian_links (athlete_user_id, status);
create index if not exists idx_guardian_links_guardian
  on public.guardian_links (guardian_user_id, status);

alter table public.guardian_links enable row level security;

-- A guardian sees the links where they are the guardian; an athlete sees the
-- links where they are the athlete. Neither sees the other's other links, and
-- no third party sees anything.
drop policy if exists "guardian_links parties read" on public.guardian_links;
create policy "guardian_links parties read" on public.guardian_links
  for select using (auth.uid() = guardian_user_id or auth.uid() = athlete_user_id);

-- Only the athlete may CREATE a link (through an invite) and only the athlete
-- may grant wider permissions. Both sides can revoke — leaving an athlete
-- unable to detach from an adult who has their code would be the wrong way
-- round for a safeguarding control.
drop policy if exists "guardian_links athlete updates" on public.guardian_links;
create policy "guardian_links athlete updates" on public.guardian_links
  for update using (auth.uid() = athlete_user_id) with check (auth.uid() = athlete_user_id);

drop policy if exists "guardian_links athlete deletes" on public.guardian_links;
create policy "guardian_links athlete deletes" on public.guardian_links
  for delete using (auth.uid() = athlete_user_id);

-- Guardians revoke their own access by setting status, which the update policy
-- above cannot express (they are not the athlete). This narrow policy lets them
-- do exactly one thing: turn their own link off.
drop policy if exists "guardian_links guardian revokes" on public.guardian_links;
create policy "guardian_links guardian revokes" on public.guardian_links
  for update
  using (auth.uid() = guardian_user_id)
  with check (auth.uid() = guardian_user_id and status = 'revoked');

drop trigger if exists trg_guardian_links_updated on public.guardian_links;
create trigger trg_guardian_links_updated
  before update on public.guardian_links
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3. Invites — how a link is proposed in the first place
-- ---------------------------------------------------------------------------

create table if not exists public.guardian_invites (
  id uuid primary key default gen_random_uuid(),
  athlete_user_id uuid not null references auth.users(id) on delete cascade,

  -- Short, unambiguous, single-use. Never the athlete's email or id: a code
  -- the athlete can read out loud and revoke is the whole point of this over
  -- a "claim this account" flow.
  code text not null,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  -- Who redeemed it, for the athlete's own record.
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,

  constraint guardian_invites_code_length check (char_length(code) = 8),
  constraint guardian_invites_code_upper check (code = upper(code))
);

create unique index if not exists guardian_invites_code_unique
  on public.guardian_invites (code);
create index if not exists idx_guardian_invites_athlete
  on public.guardian_invites (athlete_user_id, created_at desc);

comment on table public.guardian_invites is
  'Single-use, expiring codes an athlete gives to a guardian. Readable only by the athlete; the code itself never leaves the database except to its owner.';

alter table public.guardian_invites enable row level security;

-- The athlete owns their invites. A guardian never SELECTs this table — they
-- redeem a code through the function below, so codes cannot be enumerated by
-- anyone holding an account.
drop policy if exists "guardian_invites athlete owns" on public.guardian_invites;
create policy "guardian_invites athlete owns" on public.guardian_invites
  for all using (auth.uid() = athlete_user_id) with check (auth.uid() = athlete_user_id);

-- ---------------------------------------------------------------------------
-- 4. The functions
-- ---------------------------------------------------------------------------

/**
 * Create a fresh invite for the calling athlete.
 *
 * The code is generated server-side rather than by the client so it cannot be
 * chosen, and so two devices cannot race to insert the same one. Eight
 * characters over a 32-symbol alphabet with I/L/O/0/1 removed: ~1.1e12
 * possibilities, read out loud without ambiguity, and single-use with a
 * short expiry so an unused code ages out rather than lingering.
 */
create or replace function public.create_guardian_invite()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_id uuid;
  v_expires timestamptz := now() + interval '7 days';
  i int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Retry on the (vanishingly unlikely) collision rather than failing a
  -- request the athlete cannot understand.
  for attempt in 1..5 loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.guardian_invites g where g.code = v_code);
  end loop;

  insert into public.guardian_invites (athlete_user_id, code, expires_at)
  values (auth.uid(), v_code, v_expires)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'code', v_code,
    'expiresAt', v_expires
  );
end;
$$;

/**
 * Redeem an invite as a guardian.
 *
 * Runs as the definer because the redeeming guardian has no SELECT on
 * `guardian_invites` — that is deliberate, so codes cannot be probed. All the
 * validation this function does is therefore load-bearing, and it does all of
 * it: the code must exist, be unused, be unexpired, and not belong to the
 * caller.
 *
 * The new link's status depends on the athlete's age:
 *   • under 13 — activated immediately. A guardian of a ten-year-old is the
 *     person legally responsible for the account, and asking a ten-year-old to
 *     approve their own parent would be theatre.
 *   • 13–17    — `pending`, awaiting the athlete's approval. A teenager gets a
 *     say in who reads their training, and gets it before anything is visible.
 *   • 18+      — `pending` as well. An adult's data is not a guardian's by
 *     default regardless of who holds the code.
 */
create or replace function public.redeem_guardian_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_invite public.guardian_invites;
  -- The link row gets its own variable. Reusing `v_invite` for it would lose
  -- the invite id the update at the bottom of this function needs, and the
  -- code would stay redeemable forever.
  v_link public.guardian_links;
  v_dob date;
  v_age int;
  v_band text;
  v_status text;
  v_permissions jsonb;
  v_athlete_name text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if char_length(v_code) <> 8 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  select * into v_invite
  from public.guardian_invites g
  where g.code = v_code and g.redeemed_at is null and g.expires_at > now()
  limit 1;

  if v_invite.id is null then
    -- One message for unknown / used / expired. Distinguishing them would let
    -- a caller probe which codes exist.
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  if v_invite.athlete_user_id = auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'self_link');
  end if;

  select p.date_of_birth, p.full_name
    into v_dob, v_athlete_name
  from public.profiles p
  where p.user_id = v_invite.athlete_user_id;

  v_age := case
    when v_dob is null then null
    else date_part('year', age(v_dob))::int
  end;

  v_band := case
    when v_age is null then 'unknown'
    when v_age < 13 then 'under_13'
    when v_age < 16 then 'age_13_15'
    when v_age < 18 then 'age_16_17'
    else 'adult'
  end;

  v_status := case when v_band = 'under_13' then 'active' else 'pending' end;
  v_permissions := public.guardian_default_permissions(v_band);

  insert into public.guardian_links (
    guardian_user_id, athlete_user_id, relationship, status, permissions, defaults_band, approved_at
  )
  values (
    auth.uid(), v_invite.athlete_user_id, 'guardian', v_status, v_permissions, v_band,
    case when v_status = 'active' then now() else null end
  )
  on conflict (guardian_user_id, athlete_user_id) do update
    set status = excluded.status,
        permissions = excluded.permissions,
        defaults_band = excluded.defaults_band,
        approved_at = excluded.approved_at,
        revoked_at = null
  returning * into v_link;

  -- Guarded on `redeemed_at is null` so two devices racing the same code cannot
  -- both claim it: the second one's update matches no row.
  update public.guardian_invites
     set redeemed_by = auth.uid(), redeemed_at = now()
   where id = v_invite.id
     and redeemed_at is null;

  return jsonb_build_object(
    'ok', true,
    'linkId', v_link.id,
    'status', v_status,
    'ageBand', v_band,
    'athleteName', coalesce(v_athlete_name, 'Your athlete')
  );
end;
$$;

/**
 * The default permission map for an age band.
 *
 * Kept in the database as well as in `src/lib/guardianAccess.ts` on purpose.
 * The client needs it to render the settings screen without a round trip, and
 * the link needs it at the moment it is created, when no client is involved.
 * They are asserted equal by `guardianAccess.test.ts` so the two cannot drift.
 *
 * The rule of the map: younger athletes start with wider guardian visibility,
 * older teenagers start with narrower, and an adult's guardian starts with
 * almost nothing. Every default is a starting point an athlete can change,
 * except the floors enforced in `guardian_sanitize_permissions`.
 */
create or replace function public.guardian_default_permissions(p_band text)
returns jsonb
language sql
immutable
as $$
  select case p_band
    when 'under_13' then jsonb_build_object(
      'goals', true, 'roadmap', true, 'consistency', true, 'upcoming', true,
      'completed', true, 'recovery', true, 'workload', true,
      'competitions', true, 'alerts', true, 'coach', true
    )
    when 'age_13_15' then jsonb_build_object(
      'goals', true, 'roadmap', true, 'consistency', true, 'upcoming', true,
      'completed', true, 'recovery', true, 'workload', true,
      'competitions', true, 'alerts', true, 'coach', true
    )
    when 'age_16_17' then jsonb_build_object(
      'goals', true, 'roadmap', true, 'consistency', true, 'upcoming', false,
      'completed', false, 'recovery', false, 'workload', true,
      'competitions', true, 'alerts', true, 'coach', true
    )
    else jsonb_build_object(
      'goals', true, 'roadmap', true, 'consistency', false, 'upcoming', false,
      'completed', false, 'recovery', false, 'workload', false,
      'competitions', false, 'alerts', false, 'coach', false
    )
  end;
$$;

/**
 * Clamp a requested permission map to what the athlete's age band permits.
 *
 * A safety floor, not a convenience. Two rules, and neither is negotiable by
 * the client:
 *   • `alerts` cannot be switched off for a minor. A guardian of a 14-year-old
 *     is entitled to know the load is high, and an app that let that be hidden
 *     would be removing the one signal this whole feature exists to give them.
 *   • A guardian of an under-13 cannot turn off consistency, upcoming or
 *     completed. That guardian is answerable for whether the child is training
 *     sensibly, and "I turned it off" is not a thing a ten-year-old should be
 *     able to do.
 *
 * Unknown keys are dropped, so a permission added in a later phase is off until
 * it is deliberately granted. `recovery` and `workload` CO-EXIST with the
 * floors rather than overriding them: a 12-year-old can hide their recovery
 * band if the guardian agrees, but cannot hide whether they trained.
 */
create or replace function public.guardian_sanitize_permissions(p_requested jsonb, p_band text)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_allowed constant text[] := array[
    'goals', 'roadmap', 'consistency', 'upcoming', 'completed',
    'recovery', 'workload', 'competitions', 'alerts', 'coach'
  ];
  v_result jsonb := '{}'::jsonb;
  v_key text;
  v_value boolean;
begin
  -- Start from the band's defaults, so an omitted key keeps its default rather
  -- than silently becoming false.
  v_result := public.guardian_default_permissions(p_band);

  if p_requested is not null and jsonb_typeof(p_requested) = 'object' then
    for v_key in select jsonb_object_keys(p_requested) loop
      if v_key = any(v_allowed) and jsonb_typeof(p_requested -> v_key) = 'boolean' then
        v_value := (p_requested ->> v_key)::boolean;
        v_result := jsonb_set(v_result, array[v_key], to_jsonb(v_value));
      end if;
    end loop;
  end if;

  if p_band in ('under_13', 'age_13_15', 'age_16_17', 'unknown') then
    v_result := jsonb_set(v_result, array['alerts'], 'true'::jsonb);
  end if;

  if p_band = 'under_13' then
    v_result := jsonb_set(v_result, array['consistency'], 'true'::jsonb);
    v_result := jsonb_set(v_result, array['upcoming'], 'true'::jsonb);
    v_result := jsonb_set(v_result, array['completed'], 'true'::jsonb);
  end if;

  return v_result;
end;
$$;

/**
 * The athlete sets what their guardian can see.
 *
 * Only the athlete may call this for themselves (the p_athlete argument exists
 * so a guardian cannot pass someone else's id — it is checked against
 * auth.uid()). A guardian cannot widen their own access: that is what makes
 * the permission map a control rather than a suggestion.
 */
create or replace function public.set_guardian_permissions(p_athlete uuid, p_permissions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_band text;
  v_safe jsonb;
  v_updated int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_athlete <> auth.uid() then
    raise exception 'not your account' using errcode = '42501';
  end if;

  -- The band is recomputed from the date of birth rather than read off the
  -- existing link, so an athlete who has had a birthday since the link was
  -- created is governed by their current band. Reading the stored value would
  -- let a 13-year-old keep a 12-year-old's wider defaults forever.
  select case
      when p.date_of_birth is null then 'unknown'
      when date_part('year', age(p.date_of_birth))::int < 13 then 'under_13'
      when date_part('year', age(p.date_of_birth))::int < 16 then 'age_13_15'
      when date_part('year', age(p.date_of_birth))::int < 18 then 'age_16_17'
      else 'adult'
    end
    into v_band
  from public.profiles p
  where p.user_id = p_athlete;

  v_safe := public.guardian_sanitize_permissions(p_permissions, coalesce(v_band, 'unknown'));

  update public.guardian_links
     set permissions = v_safe,
         defaults_band = coalesce(v_band, defaults_band)
   where athlete_user_id = p_athlete;

  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', true, 'permissions', v_safe, 'links', v_updated);
end;
$$;

/**
 * Answer a pending link: the athlete approves or revokes it.
 *
 * Approving is athlete-only. Revoking is either party — an athlete must always
 * be able to detach, and a guardian must always be able to step back.
 */
create or replace function public.set_guardian_link_status(p_link uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.guardian_links;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- `coalesce` because `null not in (...)` is NULL rather than true: without
  -- it, a null status falls through to the update and trips the CHECK
  -- constraint as a 500 instead of being reported as the bad input it is.
  if coalesce(p_status, '') not in ('active', 'revoked') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;

  select * into v_link from public.guardian_links l where l.id = p_link;
  if v_link.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if auth.uid() <> v_link.athlete_user_id and auth.uid() <> v_link.guardian_user_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- Only the athlete may activate. A guardian cannot promote their own
  -- pending link to active; that is the single most important line here.
  if p_status = 'active' and auth.uid() <> v_link.athlete_user_id then
    raise exception 'only the athlete may approve this link' using errcode = '42501';
  end if;

  update public.guardian_links
     set status = p_status,
         approved_at = case when p_status = 'active' then now() else approved_at end,
         revoked_at = case when p_status = 'revoked' then now() else null end
   where id = p_link;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The sanitized read
-- ---------------------------------------------------------------------------

/**
 * What a guardian is allowed to see about their athlete, and nothing else.
 *
 * The specification's list, section by section, with the privacy rules applied
 * inside the query rather than trusted to the client:
 *
 *   • Recovery is a BAND derived from the 7-day mean readiness, never a log
 *     row. `hrv`, `sleep_quality`, `rest_hours` and `notes` are not selected,
 *     so there is no permission that could reveal them.
 *   • Workload is a BAND derived from summed `session_load`, never per-session
 *     figures.
 *   • Only `illness` and `injury` life events are surfaced, by type and month,
 *     because those are the ones the specification asks for an alert about and
 *     the ones a guardian needs. `wellbeing`, `private` and every other type
 *     are filtered out in SQL — a personal break is the athlete's, and a
 *     guardian does not get to see it because they hold a code.
 *   • Life-event NOTES are never read at all.
 *   • No leaderboard, ranking, streak-comparison or peer data of any kind.
 *
 * Every section is present only when its permission is granted, and the whole
 * payload says which permissions produced it, so the client can render honestly
 * without re-deriving the rules.
 */
create or replace function public.guardian_athlete_overview(p_athlete uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.guardian_links;
  v_perms jsonb;
  v_today date := current_date;
  v_name text;
  v_sport text;
  v_dob date;
  v_age int;
  v_result jsonb;
  v_section jsonb;
  v_readiness numeric;
  v_recovery_band text;
  v_load_7 numeric;
  v_load_28 numeric;
  v_planned int;
  v_completed int;
  v_consistency numeric;
  v_upcoming jsonb;
  v_completed_summary jsonb;
  v_goals jsonb;
  v_roadmap jsonb;
  v_competitions jsonb;
  v_alerts jsonb;
  v_break_type text;
  v_break_end date;
  v_coach jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_link
  from public.guardian_links l
  where l.guardian_user_id = auth.uid()
    and l.athlete_user_id = p_athlete
    and l.status = 'active'
  limit 1;

  -- No active link: an empty object, not an error. Returning an error here
  -- would let a caller distinguish "no such athlete" from "not your athlete",
  -- which is a probe.
  if v_link.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_access');
  end if;

  v_perms := v_link.permissions;

  select p.full_name, p.sport, p.date_of_birth
    into v_name, v_sport, v_dob
  from public.profiles p
  where p.user_id = p_athlete;

  v_age := case when v_dob is null then null else date_part('year', age(v_dob))::int end;

  v_result := jsonb_build_object(
    'ok', true,
    'athlete', jsonb_build_object(
      'name', coalesce(v_name, 'Your athlete'),
      'sports', coalesce(v_sport, ''),
      -- The band, not the birthday. A guardian does not need the child's date
      -- of birth to be told how their training is going.
      'ageBand', v_link.defaults_band,
      'isMinor', (v_age is not null and v_age < 18)
    ),
    'permissions', v_perms
  );

  -- ---- Consistency, upcoming, completed ---------------------------------
  -- Counted when ANY of the three sections needs them, including `alerts`
  -- alone: the consistency alert is derived from these same numbers, and
  -- skipping the read because the athlete hid the consistency section would
  -- silently drop an alert they did ask for.
  if coalesce((v_perms ->> 'consistency')::boolean, false)
     or coalesce((v_perms ->> 'completed')::boolean, false)
     or coalesce((v_perms ->> 'alerts')::boolean, false) then
    select count(*) filter (where e.status in ('completed', 'modified', 'replaced')),
           count(*)
      into v_completed, v_planned
    from public.plan_events e
    where e.user_id = p_athlete
      and e.scheduled_date >= v_today - 27
      and e.scheduled_date <= v_today;

    v_consistency := case when coalesce(v_planned, 0) > 0
      then round((coalesce(v_completed, 0)::numeric / v_planned) * 100)
      else null end;
  end if;

  if coalesce((v_perms ->> 'consistency')::boolean, false) then
    v_result := v_result || jsonb_build_object(
      'consistency', jsonb_build_object(
        'completed', coalesce(v_completed, 0),
        'planned', coalesce(v_planned, 0),
        'percent', v_consistency,
        'windowDays', 28
      )
    );
  end if;

  if coalesce((v_perms ->> 'upcoming')::boolean, false) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'date', e.scheduled_date,
             'title', e.title,
             'status', e.status
           ) order by e.scheduled_date), '[]'::jsonb)
      into v_upcoming
    from public.plan_events e
    where e.user_id = p_athlete
      and e.scheduled_date > v_today
      and e.scheduled_date <= v_today + 13
      and e.status not in ('cancelled_due_to_availability', 'replaced');

    v_result := v_result || jsonb_build_object('upcoming', coalesce(v_upcoming, '[]'::jsonb));
  end if;

  if coalesce((v_perms ->> 'completed')::boolean, false) then
    -- A summary: how much, in which sessions, and how many were logged off
    -- plan. Not a session-by-session log, and no RPE, heart rate or note.
    select coalesce(jsonb_agg(jsonb_build_object(
             'date', e.scheduled_date,
             'title', e.title,
             'status', e.status
           ) order by e.scheduled_date desc), '[]'::jsonb)
      into v_completed_summary
    from (
      select e.scheduled_date, e.title, e.status
      from public.plan_events e
      where e.user_id = p_athlete
        and e.scheduled_date > v_today - 15
        and e.scheduled_date <= v_today
        and e.status in ('completed', 'modified', 'replaced')
      order by e.scheduled_date desc
      limit 12
    ) e;

    v_result := v_result || jsonb_build_object(
      'completedRecent', coalesce(v_completed_summary, '[]'::jsonb)
    );
  end if;

  -- ---- Recovery band -----------------------------------------------------
  if coalesce((v_perms ->> 'recovery')::boolean, false) then
    select avg(r.readiness_score)
      into v_readiness
    from public.recovery_logs r
    where r.user_id = p_athlete
      and r.log_date > v_today - 7
      and r.readiness_score is not null;

    -- The band is computed here so no raw value crosses the boundary at all.
    v_recovery_band := case
      when v_readiness is null then 'unknown'
      when v_readiness >= 70 then 'good'
      when v_readiness >= 50 then 'moderate'
      else 'low'
    end;

    v_result := v_result || jsonb_build_object(
      -- The band only. The threshold and the mean are NOT included: a band is
      -- the general status the specification asks for, and a number invites
      -- the guardian to track it day by day, which is not what it is for.
      'recovery', jsonb_build_object('band', v_recovery_band, 'hasRecentLogs', v_readiness is not null)
    );
  end if;

  -- ---- Workload band -----------------------------------------------------
  if coalesce((v_perms ->> 'workload')::boolean, false) then
    select coalesce(sum(l.session_load) filter (where l.log_date > v_today - 7), 0),
           coalesce(sum(l.session_load) filter (where l.log_date > v_today - 28), 0)
      into v_load_7, v_load_28
    from public.performance_logs l
    where l.user_id = p_athlete
      and l.log_date > v_today - 28
      and l.session_load is not null;

    -- Compared against the athlete's own four-week average rather than an
    -- absolute number, because "high" only means anything relative to what
    -- this athlete normally does.
    v_result := v_result || jsonb_build_object(
      'workload', jsonb_build_object(
        'band', case
          when v_load_28 is null or v_load_28 <= 0 then 'unknown'
          when v_load_7 >= (v_load_28 / 4) * 1.3 then 'high'
          when v_load_7 <= (v_load_28 / 4) * 0.7 then 'low'
          else 'moderate'
        end
      )
    );
  end if;

  -- ---- Goals -------------------------------------------------------------
  if coalesce((v_perms ->> 'goals')::boolean, false) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'title', g.title,
             'category', g.category,
             'targetDate', g.deadline,
             'phase', g.phase,
             'progressStatus', g.progress_status,
             'status', g.status
           ) order by g.created_at), '[]'::jsonb)
      into v_goals
    from (
      select g.title, g.category, g.deadline, g.phase, g.progress_status, g.status, g.created_at
      from public.outcome_goals g
      where g.user_id = p_athlete
        and g.status <> 'abandoned'
      order by g.created_at
      limit 8
    ) g;

    -- `description` is deliberately not selected: an athlete's own words about
    -- why a goal matters are theirs. A target and a date are the shared facts.
    v_result := v_result || jsonb_build_object('goals', coalesce(v_goals, '[]'::jsonb));
  end if;

  -- ---- Roadmap summary ---------------------------------------------------
  if coalesce((v_perms ->> 'roadmap')::boolean, false) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'title', g.title,
             'phase', g.phase,
             'progressStatus', g.progress_status,
             'milestonesTotal', jsonb_array_length(g.milestones),
             'milestonesAchieved', (
               select count(*)
               from jsonb_array_elements(g.milestones) m
               where m ->> 'status' = 'achieved'
             ),
             'nextMilestone', (
               select m ->> 'title'
               from jsonb_array_elements(g.milestones) m
               where m ->> 'status' <> 'achieved'
               order by coalesce(m ->> 'targetDate', '9999-12-31')
               limit 1
             )
           ) order by g.created_at), '[]'::jsonb)
      into v_roadmap
    from (
      select g.title, g.phase, g.progress_status, g.milestones, g.created_at
      from public.outcome_goals g
      where g.user_id = p_athlete
        and g.status <> 'abandoned'
      order by g.created_at
      limit 8
    ) g;

    v_result := v_result || jsonb_build_object('roadmap', coalesce(v_roadmap, '[]'::jsonb));
  end if;

  -- ---- Competitions ------------------------------------------------------
  if coalesce((v_perms ->> 'competitions')::boolean, false) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'title', c.title,
             'date', c.event_date,
             'sport', c.sport
           ) order by c.event_date), '[]'::jsonb)
      into v_competitions
    from (
      select c.title, c.event_date, c.sport
      from public.events c
      where c.user_id = p_athlete
        and c.event_date >= v_today - 7
      order by c.event_date
      limit 10
    ) c;

    v_result := v_result || jsonb_build_object('competitions', coalesce(v_competitions, '[]'::jsonb));
  end if;

  -- ---- Alerts ------------------------------------------------------------
  if coalesce((v_perms ->> 'alerts')::boolean, false) then
    v_alerts := '[]'::jsonb;

    -- Illness and injury only. These are the two the specification names, and
    -- the two a guardian is entitled to know about. Every other life-event type
    -- — including `wellbeing` and `private` — is excluded in this WHERE clause,
    -- so a personal break is never named, hinted at, or counted here.
    select e.event_type, e.end_date
      into v_break_type, v_break_end
    from public.life_events e
    where e.user_id = p_athlete
      and e.event_type in ('illness', 'injury')
      and e.end_date >= v_today - 28
    order by e.end_date desc
    limit 1;

    if v_break_type is not null then
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
        'kind', 'medical_break',
        'eventType', v_break_type,
        'endedOn', v_break_end,
        -- Development-oriented, and about the plan rather than the person.
        -- Never "your child should be training harder", which the
        -- specification bans in as many words.
        'text', case
          when v_break_end >= v_today then
            'A break was recorded for illness or injury and is still in place. Training is being reduced or paused accordingly.'
          else
            'A break was recorded for illness or injury and has finished. Training is being rebuilt gradually rather than resumed at full volume.'
        end
      ));
    end if;

    if coalesce(v_planned, 0) > 0 and coalesce(v_consistency, 100) < 50 then
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
        'kind', 'consistency',
        'text', 'Fewer sessions than planned have been logged recently. That is not unusual, and rest is part of development rather than something to make up for.'
      ));
    end if;

    v_result := v_result || jsonb_build_object('alerts', v_alerts);
  end if;

  -- ---- Coach -------------------------------------------------------------
  -- There is no coach-linking table in this schema, so there is nothing to
  -- read and this section reports honestly that no coach is linked rather than
  -- inventing one. The field exists so the client renders the same shape
  -- whether or not a later phase adds linking.
  if coalesce((v_perms ->> 'coach')::boolean, false) then
    v_coach := jsonb_build_object('linked', false, 'name', null);
    v_result := v_result || jsonb_build_object('coach', v_coach);
  end if;

  return v_result;
end;
$$;

revoke all on function public.guardian_athlete_overview(uuid) from public;
revoke all on function public.create_guardian_invite() from public;
revoke all on function public.redeem_guardian_invite(text) from public;
revoke all on function public.set_guardian_permissions(uuid, jsonb) from public;
revoke all on function public.set_guardian_link_status(uuid, text) from public;

grant execute on function public.guardian_athlete_overview(uuid) to authenticated;
grant execute on function public.create_guardian_invite() to authenticated;
grant execute on function public.redeem_guardian_invite(text) to authenticated;
grant execute on function public.set_guardian_permissions(uuid, jsonb) to authenticated;
grant execute on function public.set_guardian_link_status(uuid, text) to authenticated;
grant execute on function public.guardian_default_permissions(text) to authenticated;
grant execute on function public.guardian_sanitize_permissions(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Grants and the revoked friendship view
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.guardian_links to authenticated;
grant select, insert, update, delete on public.guardian_invites to authenticated;

-- Goals are the athlete's and their guardian's. A friendship is not consent to
-- read a child's ambition, and the Feed already hides activity from non-shared
-- friends, so this closes a gap rather than removing a working feature.
drop policy if exists "Partners view outcome goals" on public.outcome_goals;

-- The roadmap columns are written by the roadmap builder, which runs as the
-- athlete. No new policy is needed for them: the existing
-- "Users manage own outcome goals" policy already covers every column, and a
-- guardian still has no UPDATE on this table.
