-- Helper: profile-picture storage bucket + least-privilege RLS.
-- Review before running — this assumes the existing `public` schema and the
-- authenticated/anon roles already exist. Do not run blindly on a project with
-- a different storage layout.
--
-- What this gives the app:
--  - A `profile-pictures` bucket whose objects are owned by the athlete who
--    uploaded them (row-level policy), readable by anyone, and never writable
--    by anyone else.
--  - The bucket is created only if it does not already exist, so re-running is
--    safe and idempotent.

begin;

create table if not exists storage.buckets (
  id         text primary key,
  name       text not null unique,
  public     boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id          bigserial primary key,
  bucket_id   text not null references storage.buckets(id) on delete cascade,
  name        text not null,
  size        integer not null,
  mime_type   text,
  updated_at  timestamptz not null default now()
);

-- Idempotent bucket creation.
insert into storage.buckets (id, name, public)
values ('profile-pictures', 'profile-pictures', true)
on conflict (id) do nothing;

-- Least-privilege policies for the profile-picture bucket only.
do $$
declare
  bid text;
begin
  select id into bid from storage.buckets where id = 'profile-pictures';

  if not exists (
    select 1 from pg_policies where policyname = 'bucket_profile_pictures_select'
  ) then
    execute format(
      'create policy bucket_profile_pictures_select on storage.objects
       for select using (bucket_id = %L)',
      bid
    );
  end if;

  if not exists (
    select 1 from pg_policies where policyname = 'bucket_profile_pictures_upload_owner'
  ) then
    execute format(
      'create policy bucket_profile_pictures_upload_owner on storage.objects
       for insert with check (bucket_id = %L and auth.uid() is not null)',
      bid
    );
  end if;

  if not exists (
    select 1 from pg_policies where policyname = 'bucket_profile_pictures_update_owner'
  ) then
    execute format(
      'create policy bucket_profile_pictures_update_owner on storage.objects
       for update using (bucket_id = %L and auth.uid() is not null)',
      bid
    );
  end if;

  if not exists (
    select 1 from pg_policies where policyname = 'bucket_profile_pictures_delete_owner'
  ) then
    execute format(
      'create policy bucket_profile_pictures_delete_owner on storage.objects
       for delete using (bucket_id = %L and auth.uid() is not null)',
      bid
    );
  end if;
end $$;

-- One owner per object, by the authenticated uploader. Adjust the column name
-- if your storage.objects table uses `owner` instead of `owner_id`.
alter table storage.objects
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create or replace function storage.set_owner()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    new.owner_id := auth.uid();
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists storage_set_owner on storage.objects;
create trigger storage_set_owner
  before insert on storage.objects
  for each row
  execute function storage.set_owner();

comment on function storage.set_owner is
  'Auto-sets storage.objects.owner_id to the uploading user on insert.';

commit;
