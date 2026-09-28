-- ============================================================================
-- CLOSE THE CLIENT-WRITABLE PRIVILEGE PATHS
-- ----------------------------------------------------------------------------
-- Found by attacking the live API with nothing but the publishable key that
-- ships inside the app. Every finding below was reproduced against production,
-- not inferred from reading the schema.
--
-- 1. profiles.infinite_credits was self-writable. The guard trigger covered
--    `credits` and `coins` only, so a signed-in athlete could PATCH their own
--    profile to infinite_credits = true. process-purchase reads that column
--    with the service role and treats the balance as MAX_SAFE_INTEGER, so every
--    credit-priced purchase became free. Proven: a 54-credit unlock was granted
--    to an account holding 50.
--
-- 2. credit_transactions had an INSERT policy for the `public` role, so anyone
--    could write ledger rows with any amount and any `source`. Proven: a row of
--    +1,000,000 was accepted (HTTP 201). The ledger is the record the app shows
--    an athlete as their history, and the 24h self-serve reward cap is computed
--    by summing it.
--
-- 3. update_challenge_progress() added a client-supplied p_delta with no bound.
--    Proven: a challenge with a 100 target was completed in one request with
--    p_delta = 999999, paying 500 points and an achievement.
--
-- 4. has_role(_user_id, _role) is callable by any signed-in athlete for an
--    arbitrary user id, so anyone can enumerate who administers the app.
--
-- 5. top_referrers() is executable by `anon` and returns user ids with display
--    names. There is no referral data yet, so nothing leaks today; the moment
--    there is, it does.
--
-- What is deliberately NOT changed here: the `streaks` and `achievements` write
-- policies stay, because the app writes those client-side by design. They are
-- an integrity problem, not a breach — see SECURITY.md.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. infinite_credits joins credits and coins under the guard
-- ---------------------------------------------------------------------------
-- The promo path in process-purchase now goes through grant_infinite_credits()
-- below instead of writing the column directly, because a service-role client
-- still fires triggers — it bypasses RLS, not this.

create or replace function public.guard_profile_credits()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- infinite_credits is read by process-purchase as the balance for every
  -- credit-priced product, so it is money with a different name. It was left
  -- out of this guard and that was the whole vulnerability.
  if new.credits is distinct from old.credits
     or new.coins is distinct from old.coins
     or new.infinite_credits is distinct from old.infinite_credits
     or new.infinite_credits_until is distinct from old.infinite_credits_until then
    if current_setting('app.allow_credit_change', true) is distinct from 'on' then
      raise exception 'Direct updates to credits/coins/infinite_credits are not allowed. Use the coin/credit functions.';
    end if;
  end if;
  return new;
end;
$function$;

-- The one legitimate writer. Service-role only: an athlete calling it directly
-- would be the same hole with a nicer name.
create or replace function public.grant_infinite_credits(p_user uuid, p_until timestamptz)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_user is null then raise exception 'Missing user'; end if;
  perform set_config('app.allow_credit_change', 'on', true);
  update public.profiles
     set infinite_credits = true,
         infinite_credits_until = p_until
   where user_id = p_user;
  perform set_config('app.allow_credit_change', 'off', true);
end;
$function$;

revoke all on function public.grant_infinite_credits(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.grant_infinite_credits(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 2. The ledger is written by the server, not the client
-- ---------------------------------------------------------------------------
-- Every legitimate write already goes through credits_spend / credits_grant /
-- the edge functions, all of which run as the service role. The client INSERT
-- policy has no legitimate caller.

drop policy if exists "Users can insert their own transactions" on public.credit_transactions;

-- ---------------------------------------------------------------------------
-- 3. Bound the progress a single request can add
-- ---------------------------------------------------------------------------
-- A manual "log progress" feature has to take the athlete's number; it cannot
-- refuse to believe them without removing the feature. What it can do is stop
-- one request from completing a challenge outright, and stop progress outside
-- the challenge window.

create or replace function public.update_challenge_progress(p_challenge uuid, p_delta numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.challenge_participants%ROWTYPE;
  v_ch public.challenges%ROWTYPE;
  v_completed boolean := false;
  v_step integer;
  v_max_step integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  -- Reject the shapes that make the old function a one-tap win: negative,
  -- non-finite, larger than the challenge target, or larger than any plausible
  -- single session (a 100km "session" is a typo or an attack).
  if p_delta is null or p_delta <= 0 or p_delta <> trunc(p_delta) then
    raise exception 'Progress must be a positive whole number';
  end if;

  select * into v_ch from public.challenges where id = p_challenge;
  if not found then raise exception 'Challenge not found'; end if;

  v_max_step := least(greatest(coalesce(v_ch.target_value, 1), 1), 1000);
  v_step := least(p_delta::integer, v_max_step);
  if p_delta::numeric > v_max_step then
    -- Returned rather than raised so the screen can explain itself, and so the
    -- athlete keeps the (clamped) progress they legitimately logged.
    v_step := v_max_step;
  end if;

  if v_ch.start_date is not null and now() < v_ch.start_date then
    raise exception 'This challenge has not started yet';
  end if;
  if v_ch.end_date is not null and now() > v_ch.end_date then
    raise exception 'This challenge has ended';
  end if;

  select * into v_row from public.challenge_participants
   where challenge_id = p_challenge and user_id = v_user for update;
  if not found then raise exception 'Not joined'; end if;
  if v_row.status = 'completed' then
    return jsonb_build_object('progress', v_row.progress, 'completed', true, 'awarded', false);
  end if;

  update public.challenge_participants
     set progress = progress + v_step
   where id = v_row.id returning * into v_row;

  if v_row.progress >= v_ch.target_value then
    update public.challenge_participants set status = 'completed', completed_at = now() where id = v_row.id;
    v_completed := true;
    insert into public.points_events(user_id, points, source, sport)
    values (v_user, v_ch.reward_points, 'challenge:' || v_ch.id, v_ch.sport);
    insert into public.achievements(user_id, type, title, description, icon)
    values (v_user, 'challenge', 'Completed: ' || v_ch.title, v_ch.description, coalesce(v_ch.icon, 'trophy'));
  end if;

  return jsonb_build_object(
    'progress', v_row.progress, 'target', v_ch.target_value,
    'completed', v_completed, 'reward_points', v_ch.reward_points,
    'clamped', p_delta::numeric > v_max_step
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. has_role answers for you, or for an admin — nobody else
-- ---------------------------------------------------------------------------
-- The policies call it as has_role(auth.uid(), 'admin'), which still works: the
-- function now special-cases the caller's own id.

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when auth.uid() is not null and _user_id = auth.uid() then
      exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
    else
      -- Asking about somebody else is an admin capability, so it needs the role
      -- being asked about. Without this any signed-in athlete could enumerate
      -- who runs the app by iterating ids.
      public.has_role(auth.uid(), 'admin')
      and exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The referral leaderboard is for signed-in athletes
-- ---------------------------------------------------------------------------

revoke execute on function public.top_referrers(integer) from anon;
