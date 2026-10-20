insert into public.ad_engine_spawns (calendar_day, state) values ('2026-10-18','pending') on conflict (calendar_day) do update set state = 'pending', spawned_at = null, attempts = 0;
