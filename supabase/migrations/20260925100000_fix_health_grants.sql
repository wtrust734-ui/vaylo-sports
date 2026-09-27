-- The original health migration enabled RLS on the three health tables and
-- created self-service policies, but only granted SELECT to `authenticated`.
-- The native Health Connect sync writes workouts/samples/sync-state directly
-- from the device into Supabase via the anon+JWT REST path (no edge function
-- in the middle), so INSERT/UPDATE are required for the sync to land.
-- Without them every upsert surfaces as "upload_failed" on the health page.
-- The RLS policies themselves remain the authorization fence (user_id = auth.uid()).
-- Re-apply on top of the existing select grants; this is intentionally the
-- narrowest fix — authenticated users gain exactly the writes the design
-- already intended.

grant insert, update, delete on public.health_workouts   to authenticated;
grant insert, update, delete on public.health_samples     to authenticated;
grant insert, update, delete on public.health_sync_state  to authenticated;

notify pgrst, 'reload schema';
