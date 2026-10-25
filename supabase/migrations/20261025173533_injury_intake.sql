-- ============================================================================
-- INJURY INTAKE — the facts the personalised plan is actually written from
-- ----------------------------------------------------------------------------
-- The log used to be body part + severity + a free-text note. A plan written
-- from that can only be generic, and the paid plan was therefore priced for a
-- briefing it could not really personalise. These are the answers the intake
-- asks for: how it happened, what makes it worse, what still works, whether
-- there is swelling, and how long it has been going on.
--
-- All nullable: every row logged before this migration is still valid, and a
-- plan can be generated from whatever the athlete actually gave.
--
-- These are user-owned rows (RLS: user_id = auth.uid()), written by the client
-- at log time, so the same bounds the briefings enforce live here too — a
-- compromised client must not be able to store a 2MB "note".
-- ============================================================================

alter table public.injury_logs
  add column if not exists mechanism text,
  add column if not exists hurts text,
  add column if not exists still_doing text,
  add column if not exists swelling text,
  add column if not exists onset_days integer;

alter table public.injury_logs
  drop constraint if exists injury_logs_intake_lengths;
alter table public.injury_logs
  add constraint injury_logs_intake_lengths check (
    (mechanism is null or (char_length(mechanism) <= 600 and char_length(btrim(mechanism)) > 0))
    and (hurts is null or (char_length(hurts) <= 600 and char_length(btrim(hurts)) > 0))
    and (still_doing is null or (char_length(still_doing) <= 600 and char_length(btrim(still_doing)) > 0))
  );

alter table public.injury_logs
  drop constraint if exists injury_logs_swelling_allowed;
alter table public.injury_logs
  add constraint injury_logs_swelling_allowed check (
    swelling is null or swelling in ('none', 'some', 'significant')
  );

alter table public.injury_logs
  drop constraint if exists injury_logs_onset_range;
alter table public.injury_logs
  add constraint injury_logs_onset_range check (
    onset_days is null or (onset_days >= 0 and onset_days <= 3650)
  );

notify pgrst, 'reload schema';
