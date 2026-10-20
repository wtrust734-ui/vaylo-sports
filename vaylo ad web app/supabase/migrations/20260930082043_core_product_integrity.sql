-- ===========================================================================
-- CORE ATHLETE-PRODUCT INTEGRITY
-- ---------------------------------------------------------------------------
-- Range validation for the training/recovery/nutrition/mental/injury data the
-- app's calculations depend on. Every rule was checked against live data
-- (zero violations) on 2026-09-30 before being added.
--
-- Also: UNIQUE (user_id, log_date) on training_loads, so the RPE flow can
-- upsert a daily load row idempotently (retries cannot double-count load).
-- The table was empty on live data, so the constraint is safe.
-- ===========================================================================

-- training_plans: duration_weeks 1..52
alter table public.training_plans
  drop constraint if exists training_plans_duration_range;
alter table public.training_plans
  add constraint training_plans_duration_range
  check (duration_weeks between 1 and 52);

-- workouts: lifecycle + numeric bounds
alter table public.workouts
  drop constraint if exists workouts_completed_consistency;
alter table public.workouts
  add constraint workouts_completed_consistency
  check (completed = false or completed_at is not null);

alter table public.workouts
  drop constraint if exists workouts_numeric_bounds;
alter table public.workouts
  add constraint workouts_numeric_bounds
  check (
    (duration_minutes is null or duration_minutes between 0 and 1440) and
    (distance_km is null or distance_km between 0 and 500) and
    (heart_rate_avg is null or heart_rate_avg between 20 and 260) and
    (calories_burned is null or calories_burned between 0 and 20000)
  );

-- training_loads: non-negative loads, bounded session values, one row per day
alter table public.training_loads
  drop constraint if exists training_loads_numeric_bounds;
alter table public.training_loads
  add constraint training_loads_numeric_bounds
  check (
    sprint_load >= 0 and endurance_load >= 0 and
    strength_load >= 0 and skill_load >= 0 and
    total_rpe between 0 and 10000 and
    duration_minutes between 0 and 1440
  );

alter table public.training_loads
  drop constraint if exists training_loads_user_date_uniq;
alter table public.training_loads
  add constraint training_loads_user_date_uniq
  unique (user_id, log_date);

-- recovery_logs: physical ranges for the derived readiness inputs
alter table public.recovery_logs
  drop constraint if exists recovery_logs_physical_ranges;
alter table public.recovery_logs
  add constraint recovery_logs_physical_ranges
  check (
    (hrv is null or hrv between 10 and 300) and
    (rhr is null or rhr between 20 and 250) and
    (rest_hours is null or rest_hours between 0 and 24) and
    (stress is null or stress between 1 and 10) and
    (energy is null or energy between 1 and 10) and
    (readiness_score is null or readiness_score between 0 and 100)
  );

-- mental_checkins: slider scores are 1..10 by design
alter table public.mental_checkins
  drop constraint if exists mental_checkins_score_range;
alter table public.mental_checkins
  add constraint mental_checkins_score_range
  check (
    confidence between 1 and 10 and stress between 1 and 10 and
    focus between 1 and 10 and motivation between 1 and 10 and
    fatigue between 1 and 10 and readiness_score between 0 and 100
  );

-- injury_logs: severity 1..10, closed status set
alter table public.injury_logs
  drop constraint if exists injury_logs_severity_range;
alter table public.injury_logs
  add constraint injury_logs_severity_range
  check (severity between 1 and 10);

alter table public.injury_logs
  drop constraint if exists injury_logs_status_allowed;
alter table public.injury_logs
  add constraint injury_logs_status_allowed
  check (status in ('active', 'resolved'));

-- meal_logs: sensible per-meal bounds (client clamps too)
alter table public.meal_logs
  drop constraint if exists meal_logs_numeric_bounds;
alter table public.meal_logs
  add constraint meal_logs_numeric_bounds
  check (
    (calories is null or calories between 0 and 10000) and
    (protein_g is null or protein_g between 0 and 500) and
    (carbs_g is null or carbs_g between 0 and 1000) and
    (fat_g is null or fat_g between 0 and 500)
  );

-- plan_events: closed status set, bounded duration
alter table public.plan_events
  drop constraint if exists plan_events_status_allowed;
alter table public.plan_events
  add constraint plan_events_status_allowed
  check (status in ('planned', 'completed', 'skipped', 'rescheduled'));

alter table public.plan_events
  drop constraint if exists plan_events_duration_range;
alter table public.plan_events
  add constraint plan_events_duration_range
  check (duration_minutes is null or duration_minutes between 0 and 1440);

notify pgrst, 'reload schema';
