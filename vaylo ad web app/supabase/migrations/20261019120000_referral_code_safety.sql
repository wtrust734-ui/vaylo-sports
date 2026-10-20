-- ============================================================================
-- REFERRAL CODE SAFETY + ADMIN DISPUTE RECORDING
-- ----------------------------------------------------------------------------
-- Referral codes are issued SERVER-side: cryptographic randomness, retry on
-- the rare unique collision, and one code per account. The previous client
-- generation (Math.random 6 chars) was guessable and turned a collision into
-- a dead "Couldn't create your referral code" toast with no retry — a real
-- mis-attribution risk on shared public links.
--
-- Also adds the admin RPC to record disputes and authorised adjustments as
-- audit-declared events. It does NOT move money: a monetary change for a
-- specific commission still has exactly one path — the release status machine
-- (pending/eligible/paid/cancelled) that admin RPCs drive with reasons.
-- ============================================================================

-- ── server-issued code ──────────────────────────────────────────────────────
create or replace function public.referral_code_issue()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing text;
  v_code text;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  -- Idempotent: reading your existing code is not an error, so opening the
  -- referrals page twice can never mint two rows.
  select c.code into v_existing from public.referral_codes c where c.user_id = v_user limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  loop
    -- 9 random bytes → 12 base64 chars minus padding → an 11-char uppercase
    -- code from crypto-secure randomness (≈ 36^11 space). Collision with the
    -- existing 'code' unique index throws; draw again.
    v_code := upper(replace(replace(replace(
      encode(pg_catalog.gen_random_bytes(9), 'base64'), '+', ''), '/', ''), '=', ''));
    begin
      insert into public.referral_codes (user_id, code)
      values (v_user, v_code)
      returning code into v_code;
      return v_code;
    exception
      when unique_violation then
        continue;
    end;
  end loop;
end $$;
revoke all on function public.referral_code_issue() from public, anon;
grant execute on function public.referral_code_issue() to authenticated;

-- ── dispute / authorised adjustment recording (audit, not money movement) ──
create or replace function public.referral_admin_record_dispute(
  p_commission_id uuid,
  p_kind text,          -- 'dispute' | 'adjustment'
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  perform public._referral_admin_assert();
  if p_kind not in ('dispute', 'adjustment') then
    raise exception 'Unknown dispute kind';
  end if;
  if nullif(btrim(p_note), '') is null then
    raise exception 'A dispute or adjustment must be described';
  end if;

  select to_jsonb(c) into v_before from public.referral_commissions c where id = p_commission_id;
  if v_before is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- The event row is the record the operator asked for; the commission's
  -- monetary fields are untouched here. Authorised monetary changes remain
  -- owned by the status machine (approve / mark_paid / cancel-with-reason),
  -- which is what keeps a balance from being silently altered.
  insert into public.referral_commission_events (commission_id, event, meta)
  values (p_commission_id, p_kind, jsonb_build_object('note', btrim(p_note)));

  insert into public.referral_admin_audit (admin_user_id, action, subject, previous, next)
  values (auth.uid(), p_kind, p_commission_id::text, v_before,
          jsonb_build_object('note', btrim(p_note)));

  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.referral_admin_record_dispute(uuid, text, text) from public, anon, authenticated;
grant execute on function public.referral_admin_record_dispute(uuid, text, text) to authenticated;

-- ── event history readable through the admin export ─────────────────────────
create or replace function public.referral_admin_events_list()
returns setof public.referral_commission_events
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._referral_admin_assert();
  return query
    select e.* from public.referral_commission_events e
    order by e.occurred_at desc limit 300;
end $$;
revoke all on function public.referral_admin_events_list() from public, anon, authenticated;
grant execute on function public.referral_admin_events_list() to authenticated;
