-- ============================================================================
-- WAITLIST ADMIN ACCESS — let the operator read the list they collect
-- ----------------------------------------------------------------------------
-- The waiting list collects addresses and, until now, the only way to read them
-- was the Supabase dashboard. The list is meant to be looked at — that is the
-- entire point of collecting it — so the operator needs a way to see it that is
-- not "log into the database console".
--
-- How this stays closed, in two independent layers:
--
--   1. GRANT. The table had NO grant to authenticated at all, which is why even
--      an admin could not read it (Postgres requires BOTH a grant and a policy,
--      and the original migration deliberately granted neither). SELECT and
--      UPDATE are granted here to `authenticated` — reachability, not access.
--
--   2. RLS. The four explicit-deny policies from 20261004130000 stay exactly as
--      they are. Postgres ORs permissive policies, so the only rows any
--      signed-in user can reach are the ones the two new policies admit, and
--      both of them test has_role(auth.uid(), 'admin'). Every non-admin still
--      matches only `using (false)` and sees nothing.
--
-- So the deny policies are not replaced here; they remain the thing that
-- answers for everybody who is not an admin. Deleting them later would still
-- leave admins working and would remove the second lock for everyone else.
--
-- Why UPDATE and not just SELECT: the published Waiting List Terms promise that
-- someone can ask to be removed, and the design (20261004130000) records a
-- removal as `unsubscribed_at` rather than a DELETE so it is auditable. Without
-- an update path an operator would have to open a SQL console to honour a
-- promise made in a legal document. The UPDATE policy is a column-blind grant
-- of the row, which is broader than strictly needed — acceptable here because
-- the only writer is an admin, and the columns hold nothing an admin cannot
-- already read. There is still no DELETE policy: rows are never destroyed by a
-- client, only marked.
-- ============================================================================

-- Reachability for signed-in users. Access is decided by the policies below.
grant select, update on public.waitlist_signups to authenticated;

-- ---------------------------------------------------------------------------
-- Read: admins only.
-- ---------------------------------------------------------------------------
drop policy if exists "waitlist_signups_admin_read" on public.waitlist_signups;
create policy "waitlist_signups_admin_read"
  on public.waitlist_signups
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Removal: admins only. Setting unsubscribed_at is the documented way an
-- address is taken off the list, and the WITH CHECK keeps the row an admin
-- writes still answerable to the same test.
-- ---------------------------------------------------------------------------
drop policy if exists "waitlist_signups_admin_update" on public.waitlist_signups;
create policy "waitlist_signups_admin_update"
  on public.waitlist_signups
  for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Still no DELETE policy for anyone. A removal is a recorded fact, not a row
-- vanishing, and an address quietly disappearing is not auditable.

-- Postgres does not concatenate adjacent string literals the way C does, so
-- this comment is one line on purpose.
comment on policy "waitlist_signups_admin_read" on public.waitlist_signups is
  'Admins may read the waiting list. Everyone else is answered by the explicit deny policies from 20261004130000.';