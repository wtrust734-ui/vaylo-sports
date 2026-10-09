-- ===========================================================================
-- EXPLICIT DENY POLICIES FOR SERVICE-ROLE-ONLY TABLES
-- ---------------------------------------------------------------------------
-- The security advisor flags four tables as "RLS enabled, no policy":
--   ai_call_events, brands, brand_placements, brand_metrics.
-- They are already closed to every client role — table grants were revoked
-- from anon/authenticated/public in 20260928193000 and 20260921090700, and
-- only the service role retains ALL. The flag exists because the schema did
-- not SAY so with a policy.
--
-- This migration says it. A FOR ALL policy with USING (false) / WITH CHECK
-- (false) grants nothing (policies only filter rows for roles that already
-- hold table privileges, and those were revoked) — it makes the intended
-- "no row is ever readable or writable through the PostgREST API" explicit,
-- resolves the lint honestly, and keeps the service-role writers working
-- because service_role bypasses RLS.
-- ===========================================================================

do $$
declare
  t text;
  tables text[] := array['ai_call_events','brands','brand_placements','brand_metrics'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists "closed_service_role_only" on public.%I', t);
    execute format(
      'create policy "closed_service_role_only" on public.%I
         for all using (false) with check (false)', t);
  end loop;
end $$;

comment on policy "closed_service_role_only" on public.ai_call_events is
  'Written and read only by edge functions via the service role, which bypasses RLS. Client roles hold no table grants; this policy makes the closure explicit.';
comment on policy "closed_service_role_only" on public.brands is
  'Sponsor management is service-role only (20260921090700). Client roles hold no table grants; this policy makes the closure explicit.';
comment on policy "closed_service_role_only" on public.brand_placements is
  'Sponsor management is service-role only (20260921090700). Client roles hold no table grants; this policy makes the closure explicit.';
comment on policy "closed_service_role_only" on public.brand_metrics is
  'Aggregate-only brand telemetry, written by record_brand_event() as definer. Client roles hold no table grants; this policy makes the closure explicit.';

notify pgrst, 'reload schema';
