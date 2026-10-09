-- ============================================================================
-- waitlist_signups — the waiting list can now actually send mail
-- ----------------------------------------------------------------------------
-- Until now the table was deliberately the whole mechanism: the operator read
-- it in a dashboard and the public page said, in those words, that no mailing
-- system was connected. That is no longer true, so the page and the waiting
-- list terms are updated in the same change as this migration. A table that
-- starts sending mail while the pages that describe it still promise it will
-- not is the failure mode this file exists to prevent.
--
-- Three columns, and the reasoning for each:
--
--   unsubscribe_token — a per-recipient unguessable id used to leave the list
--     from the link in an email. It exists because promotional mail needs a
--     working one-click route out (PECR/GDPR), and because the alternative the
--     page used to describe — "ask us and we will remove you" — is not a
--     self-service route at the volume email creates. It is a random UUID, not
--     a hash of the address: a token derived from the address would let anyone
--     who knows an address compute the token and unsubscribe that person.
--     It deliberately does NOT restore the enumeration problem the page warns
--     about: knowing a token tells you nothing about whether an address is on
--     the list, and there is no endpoint that answers that question.
--
--   confirmation_sent_at — set when the joining confirmation actually left.
--     A timestamp rather than a boolean so "when" is answerable, and nullable
--     so a send that failed is visibly unsent rather than silently assumed.
--
--   last_emailed_at — set on every launch/announcement send. Together with the
--     above it makes "did this person ever get anything" a query instead of a
--     guess, and it is what stops a retry from mailing somebody twice.
--
-- No column is added for a "marketing consent" flag. There is one list, one
-- purpose, and one route off it; a consent boolean nobody ever sets correctly
-- would be worse than the honest single-purpose list.
-- ============================================================================

alter table public.waitlist_signups
  add column if not exists unsubscribe_token   uuid        not null default gen_random_uuid(),
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists last_emailed_at      timestamptz;

-- Lookups are always "find the row with this token", so it is indexed and
-- unique. Unique matters: two rows sharing a token would make one click remove
-- the wrong person.
create unique index if not exists waitlist_signups_unsubscribe_token_idx
  on public.waitlist_signups (unsubscribe_token);

-- The broadcast reads exactly "everyone who has not left", newest last. A
-- partial index keeps that the only thing the planner has to look at.
create index if not exists waitlist_signups_active_idx
  on public.waitlist_signups (created_at)
  where unsubscribed_at is null;

-- RLS is unchanged and still the real authorisation: every policy on this table
-- is an explicit deny for anon and authenticated, the admin read/update from
-- 20261004140000 is the operator's route in, and the edge functions write with
-- the service role. The new columns are not granted to anybody new — the
-- grant is at table level, so they inherit the existing shape rather than
-- opening a second one.
