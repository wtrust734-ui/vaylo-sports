-- Ads Studio core: brand settings, chat sessions, library items, private bucket.
-- Complements 20261010100000_ad_campaigns.sql (campaigns, concepts, assets, exports, jobs).
-- Every table is owner-scoped RLS; owner_id always comes from the server (JWT), never the wire.
-- Re-runnable: create ... if not exists, drop-then-create policies.

-- ---------------------------------------------------------------------------
-- 1. Brand settings — one row per owner, merged over server defaults at read time
-- ---------------------------------------------------------------------------
create table if not exists public.ad_brand_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.ad_brand_settings enable row level security;

drop policy if exists "ad_brand_settings_owner_rw" on public.ad_brand_settings;
create policy "ad_brand_settings_owner_rw" on public.ad_brand_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. Chat sessions + messages
-- ---------------------------------------------------------------------------
create table if not exists public.ad_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New request' check (char_length(title) <= 200),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ad_chat_sessions_owner_idx on public.ad_chat_sessions (owner_id, created_at desc);

create table if not exists public.ad_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ad_chat_sessions (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  intent text,
  plan jsonb not null default '{}'::jsonb,
  classification_source text check (classification_source in ('model', 'rules', 'rules_fallback')),
  created_at timestamptz not null default now()
);
create index if not exists ad_chat_messages_session_idx on public.ad_chat_messages (session_id, created_at);

alter table public.ad_chat_sessions enable row level security;
alter table public.ad_chat_messages enable row level security;

drop policy if exists "ad_chat_sessions_owner_rw" on public.ad_chat_sessions;
create policy "ad_chat_sessions_owner_rw" on public.ad_chat_sessions
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "ad_chat_messages_owner_rw" on public.ad_chat_messages;
create policy "ad_chat_messages_owner_rw" on public.ad_chat_messages
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 3. Asset library — standalone items, campaign association optional
-- ---------------------------------------------------------------------------
create table if not exists public.ad_library_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid references public.ad_campaigns (id) on delete set null,
  kind text not null check (kind in ('image', 'video', 'audio', 'script', 'storyboard', 'document')),
  name text not null check (char_length(name) between 1 and 200),
  storage_path text not null unique,
  mime text,
  size_bytes bigint check (size_bytes >= 0),
  duration_seconds numeric(6, 2),
  status text not null default 'ready' check (status in ('processing', 'ready', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ad_library_items_owner_idx on public.ad_library_items (owner_id, created_at desc);
create index if not exists ad_library_items_kind_idx on public.ad_library_items (kind);

alter table public.ad_library_items enable row level security;

drop policy if exists "ad_library_items_owner_rw" on public.ad_library_items;
create policy "ad_library_items_owner_rw" on public.ad_library_items
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 4. Private 'ads' bucket — user files live under ads/{userId}/…
--    Unlike the public 'renders' bucket (campaign renders), library uploads hold
--    source material and must not be world-readable.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('ads', 'ads', false)
on conflict (id) do nothing;

drop policy if exists "ads_select_own" on storage.objects;
create policy "ads_select_own" on storage.objects
  for select using (bucket_id = 'ads' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "ads_insert_own" on storage.objects;
create policy "ads_insert_own" on storage.objects
  for insert with check (bucket_id = 'ads' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "ads_update_own" on storage.objects;
create policy "ads_update_own" on storage.objects
  for update using (bucket_id = 'ads' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "ads_delete_own" on storage.objects;
create policy "ads_delete_own" on storage.objects
  for delete using (bucket_id = 'ads' and auth.uid()::text = (storage.foldername(name))[1]);

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
grant all on public.ad_brand_settings to authenticated, service_role;
grant all on public.ad_chat_sessions to authenticated, service_role;
grant all on public.ad_chat_messages to authenticated, service_role;
grant all on public.ad_library_items to authenticated, service_role;
