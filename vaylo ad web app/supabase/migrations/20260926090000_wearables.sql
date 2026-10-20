-- ===========================================================================
-- Wearables (multi-provider) — provider-aware health sync
-- ---------------------------------------------------------------------------
-- Extends the Health Connect foundation (20260924200000_health_connect_sync)
-- to track every wearable as a first-class provider. Health Connect remains
-- the native on-device hub; cloud wearables (Garmin, Fitbit, Polar, COROS,
-- WHOOP, Oura, Strava, Suunto, …) authenticate via the wearable-oauth edge
-- function and land as the same normalized rows (health_workouts /
-- health_samples) with `source = provider id`.
--
-- Tables:
--   health_connections — per-athlete, per-provider OAuth / connection state.
--   health_workouts / health_samples — no DDL change; `source` now carries
--     the provider id (e.g. 'garmin', 'fitbit', 'whoop') instead of the bare
--     literal 'health_connect' when imported via cloud OAuth. Both tables
--     already constrain on (user_id, source, source_record_id) so cross-
--     provider dedup is free. RLS already self-scoped.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- health_connections — one row per (athlete, provider)
-- ---------------------------------------------------------------------------
create table if not exists public.health_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  -- 'checking' | 'not_connected' | 'permission_required' | 'connected' | 'token_expired' | 'unavailable'
  status text not null default 'not_connected',
  connected boolean not null default false,
  last_sync_at timestamptz,
  last_cursor timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_connections_provider_check check (provider in (
    'health_connect','healthkit',
    'garmin','fitbit','polar','coros','whoop','oura',
    'samsung_health','google_fit','suunto','withings','strava','huawei'
  )),
  constraint health_connections_pk primary key (user_id, provider)
);

create index if not exists health_connections_user_idx
  on public.health_connections (user_id);

alter table public.health_connections enable row level security;

drop policy if exists "health_connections self" on public.health_connections;
create policy "health_connections self" on public.health_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.health_connections to authenticated;

-- Keep updated_at fresh on writes.
create or replace function public.tg_health_connections_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_health_connections_touch on public.health_connections;
create trigger trg_health_connections_touch
  before update on public.health_connections
  for each row execute function public.tg_health_connections_touch();
