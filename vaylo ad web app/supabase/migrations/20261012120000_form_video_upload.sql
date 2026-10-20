-- ============================================================================
-- FORM VIDEO UPLOAD — a private bucket for the clip the athlete analyses
-- ----------------------------------------------------------------------------
-- Video form analysis used to send the clip as base64 inside the edge
-- function's request body. That is what capped it at six megabytes, and six
-- megabytes of phone video is five to fifteen seconds — no approach, no
-- complete rep, no follow-through, so the report was written about a fragment
-- and read like one.
--
-- The clip now goes straight to Storage instead, under the athlete's own id,
-- and the function is told the path. It downloads the bytes with the service
-- role, sends them to the provider through the Files API, and deletes the
-- object again — the app tells the athlete their video is not kept, and that
-- has to be true on the refund path as well as the happy one.
--
-- Why the bucket is PRIVATE. The `renders` bucket is public because its output
-- is an advert meant to be shared. This one holds an athlete in shorts,
-- filmed in their garden, with their face in frame. It is never linked to, it
-- is only ever read by the service role, and `public = false` makes an
-- accidental URL a 400 rather than a leak.
--
-- Why the policies are owner-only. The client uploads directly, so it needs
-- INSERT on its own folder and nothing else. It does not need SELECT: the page
-- renders the clip from the local File object while it waits, and after that
-- the object is gone. DELETE is granted so the client can clean up after itself
-- if the function call never arrives (a failed upload, a closed tab), and
-- SELECT is granted so a retry can confirm what it uploaded.
--
-- The `form-videos/` prefix is the athlete's auth id, which is what these
-- policies and the function's own owner check both key on. Nothing else may
-- write here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The bucket — private, and created without disturbing an existing one.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('form-videos', 'form-videos', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------------
-- 2. Policies — one folder per athlete, and only that folder.
-- ---------------------------------------------------------------------------
drop policy if exists "form_videos_select_own" on storage.objects;
create policy "form_videos_select_own" on storage.objects
  for select using (
    bucket_id = 'form-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "form_videos_insert_own" on storage.objects;
create policy "form_videos_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'form-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "form_videos_update_own" on storage.objects;
create policy "form_videos_update_own" on storage.objects
  for update using (
    bucket_id = 'form-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "form_videos_delete_own" on storage.objects;
create policy "form_videos_delete_own" on storage.objects
  for delete using (
    bucket_id = 'form-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ---------------------------------------------------------------------------
-- 3. Assertions — the migration fails rather than shipping a public bucket or
--    a bucket with no owner scoping, which are the two ways this goes wrong.
-- ---------------------------------------------------------------------------
do $$
declare
  v_public boolean;
  v_policies int;
begin
  select public into v_public from storage.buckets where id = 'form-videos';
  if v_public is null then
    raise exception 'form-videos bucket was not created';
  end if;
  if v_public then
    raise exception 'form-videos is public — an athlete''s clip must not be reachable by URL';
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname like 'form_videos_%';
  if v_policies < 4 then
    raise exception 'form-videos has % owner policies, expected 4', v_policies;
  end if;
end $$;
