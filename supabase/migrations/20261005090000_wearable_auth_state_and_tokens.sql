-- ===========================================================================
-- Wearable OAuth persistence — state and tokens survive the edge instance
-- ---------------------------------------------------------------------------
-- Problem this fixes:
--
--   wearable-oauth kept its OAuth `state` in an in-memory Map inside the edge
--   function. Supabase edge invocations are not guaranteed to hit the same
--   instance: the vendor's callback GET can land on a different (or cold)
--   instance where the Map is empty, so `stateStore.get(state)` returned
--   nothing, userId was null, and the connection row was silently never
--   written. "Connected" only worked when a single warm instance happened to
--   serve both halves of the flow.
--
-- Two tables, both service-role only:
--
--   wearable_auth_states     — single-use, 10-minute OAuth state. Lets the
--                              callback prove which athlete started which
--                              provider flow, on any instance.
--
--   health_connection_tokens — the vendor tokens the callback exchanges the
--                              code for. They must be server-held for refresh
--                              and for the sync import (a client that could
--                              read them could read the vendor's API as the
--                              athlete). Deliberately NOT `metadata` on
--                              health_connections: that table has a
--                              self-scoped RLS policy, so the athlete's own
--                              client reads metadata back — a token stored
--                              there would be handed to the browser.
--
-- Both tables: RLS enabled with ZERO policies, plus an explicit revoke from
-- anon/authenticated. No policy + no grant means only the service role — what
-- the edge function authenticates as — can touch them. Belt and braces, because
-- Supabase default privileges grant ALL on new public tables to anon and
-- authenticated.
--
-- Tokens are never logged, never returned to the client, and are deleted on
-- disconnect and on account deletion (auth.users cascade).
-- ===========================================================================

create table if not exists public.wearable_auth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint wearable_auth_states_expiry check (expires_at > created_at),
  constraint wearable_auth_states_provider_check check (provider in (
    'health_connect','healthkit',
    'garmin','fitbit','polar','coros','whoop','oura',
    'samsung_health','google_fit','suunto','withings','strava','huawei'
  ))
);

-- Opportunistic cleanup reads this; states are deleted on consume either way.
create index if not exists wearable_auth_states_expires_idx
  on public.wearable_auth_states (expires_at);

alter table public.wearable_auth_states enable row level security;
revoke all on public.wearable_auth_states from anon, authenticated;

-- ---------------------------------------------------------------------------

create table if not exists public.health_connection_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  access_token text not null,
  refresh_token text,
  -- When the access token expires; null when the vendor issued no expiry.
  expires_at timestamptz,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint health_connection_tokens_pk primary key (user_id, provider),
  constraint health_connection_tokens_provider_check check (provider in (
    'health_connect','healthkit',
    'garmin','fitbit','polar','coros','whoop','oura',
    'samsung_health','google_fit','suunto','withings','strava','huawei'
  ))
);

alter table public.health_connection_tokens enable row level security;
revoke all on public.health_connection_tokens from anon, authenticated;
