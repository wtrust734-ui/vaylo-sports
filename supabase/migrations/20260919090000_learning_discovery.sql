-- Learning discovery state: keeps bookmarks and recent activity alongside
-- existing completion/mastery without creating a parallel content store.
ALTER TABLE public.learning_progress
  ADD COLUMN IF NOT EXISTS saved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
