-- ============================================================================
-- COACH MARKETPLACE — explicit grants
-- ----------------------------------------------------------------------------
-- Supabase's template database carries `alter default privileges in schema
-- public grant all on tables to anon, authenticated, service_role`, so every
-- table a migration creates starts out readable AND writable by both client
-- roles. RLS is then the only thing standing between an anonymous caller and a
-- table like coach_applications, which holds an applicant's name, email and
-- Stripe identifiers.
--
-- That is one barrier where there should be two, and it is the same finding the
-- 20260930064813_security_hardening_ownership_and_grants migration recorded. So
-- this migration withdraws the blanket grant and issues exactly what the
-- product needs:
--
--   marketplace_config      read: the fee schedule is printed on the site
--   coach_roster            read (signed in): the roster is in-app
--   coach_credit_packs      read: a price list, shown before a top-up
--   coach_applications      read own rows only (RLS), no writes at all
--   coach_orders            read own rows only (RLS), no writes at all
--   coach_earnings          read own rows only (RLS), no writes at all
--   coach_deliveries        read own rows, coach writes their own delivery
--   coach_credit_wallet     read own row only, no writes
--   coach_credit_entries    read own rows only, no writes
--
-- Everything a client cannot write stays unwritable by grant as well as by
-- policy, so an attempt is a permission error rather than a silent zero-row
-- UPDATE that a developer would read as a bug in their own code.
-- ============================================================================

-- --------------------------------------------------------------------- tables --
revoke all on public.marketplace_config from anon, authenticated;
revoke all on public.coach_applications from anon, authenticated;
revoke all on public.coach_orders from anon, authenticated;
revoke all on public.coach_earnings from anon, authenticated;
revoke all on public.coach_deliveries from anon, authenticated;
revoke all on public.coach_credit_packs from anon, authenticated;
revoke all on public.coach_credit_wallet from anon, authenticated;
revoke all on public.coach_credit_entries from anon, authenticated;
revoke all on public.coach_roster from anon, authenticated;

-- Re-grant the reads. Each of these is a subset of what was revoked, which is
-- what makes this migration the record of the decision rather than an echo of
-- the defaults.
grant select on public.marketplace_config to anon, authenticated;
grant select on public.coach_credit_packs to anon, authenticated;

grant select on public.coach_roster to authenticated;
grant select on public.coach_applications to authenticated;
grant select on public.coach_orders to authenticated;
grant select on public.coach_earnings to authenticated;
grant select on public.coach_credit_wallet to authenticated;
grant select on public.coach_credit_entries to authenticated;

-- A coach writes the product they were paid for. Insert and update only: a
-- delivery is a thing the buyer keeps, so a coach cannot delete it out of the
-- buyer's account.
grant select, insert, update on public.coach_deliveries to authenticated;

-- service_role keeps everything, which is what the edge functions use.
grant all on public.marketplace_config to service_role;
grant all on public.coach_applications to service_role;
grant all on public.coach_orders to service_role;
grant all on public.coach_earnings to service_role;
grant all on public.coach_deliveries to service_role;
grant all on public.coach_credit_packs to service_role;
grant all on public.coach_credit_wallet to service_role;
grant all on public.coach_credit_entries to service_role;
grant all on public.coach_roster to service_role;

-- ---------------------------------------------------------------- functions --
-- `apply_coach_signup_payment`, `buy_coach_plan` and `grant_coach_credits` are
-- revoked from every client role in the parent migration. Restated here so this
-- file is a complete statement of the marketplace's privilege surface rather
-- than a diff a reader has to join with another file.
revoke all on function public.apply_coach_signup_payment(text, text, text) from public, anon, authenticated;
revoke all on function public.buy_coach_plan(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.grant_coach_credits(uuid, text, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ proofs --
-- The migration fails rather than applies if the posture above is not what the
-- database ended up with. A revoked privilege that silently stayed granted is
-- exactly the finding this migration exists to prevent, and it is invisible in
-- a review of the SQL.
do $$
declare
  v_problems text[] := '{}';
begin
  if has_table_privilege('anon', 'public.coach_applications', 'SELECT') then
    v_problems := v_problems || 'anon can read coach_applications';
  end if;
  if has_table_privilege('authenticated', 'public.coach_orders', 'INSERT') then
    v_problems := v_problems || 'authenticated can insert coach_orders';
  end if;
  if has_table_privilege('authenticated', 'public.coach_earnings', 'UPDATE') then
    v_problems := v_problems || 'authenticated can update coach_earnings';
  end if;
  if has_table_privilege('authenticated', 'public.coach_credit_wallet', 'UPDATE') then
    v_problems := v_problems || 'authenticated can update coach_credit_wallet';
  end if;
  if has_table_privilege('authenticated', 'public.coach_deliveries', 'DELETE') then
    v_problems := v_problems || 'authenticated can delete coach_deliveries';
  end if;
  if has_function_privilege('authenticated', 'public.buy_coach_plan(uuid,uuid,text)', 'EXECUTE') then
    v_problems := v_problems || 'authenticated can call buy_coach_plan';
  end if;
  if has_function_privilege('anon', 'public.apply_coach_signup_payment(text,text,text)', 'EXECUTE') then
    v_problems := v_problems || 'anon can call apply_coach_signup_payment';
  end if;
  if not has_table_privilege('authenticated', 'public.coach_roster', 'SELECT') then
    v_problems := v_problems || 'authenticated cannot read the coach roster';
  end if;
  if not has_table_privilege('authenticated', 'public.coach_deliveries', 'INSERT') then
    v_problems := v_problems || 'a coach cannot insert a delivery';
  end if;
  if not has_table_privilege('anon', 'public.marketplace_config', 'SELECT') then
    v_problems := v_problems || 'the fee schedule is unreadable';
  end if;

  if array_length(v_problems, 1) is not null then
    raise exception 'coach marketplace privilege check failed: %', array_to_string(v_problems, '; ');
  end if;
end;
$$;
