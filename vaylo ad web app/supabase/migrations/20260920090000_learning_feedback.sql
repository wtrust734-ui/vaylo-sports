-- Learning feedback: lightweight reader feedback on individual lessons.
-- One row per user per lesson; readers can change their rating any time.

create table if not exists public.learning_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text not null,
  rating text not null check (rating in ('helpful', 'not_helpful')),
  created_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

alter table public.learning_feedback enable row level security;

create policy "Users can read own learning feedback"
  on public.learning_feedback for select
  using (auth.uid() = user_id);

create policy "Users can insert own learning feedback"
  on public.learning_feedback for insert
  with check (auth.uid() = user_id);

create policy "Users can update own learning feedback"
  on public.learning_feedback for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own learning feedback"
  on public.learning_feedback for delete
  using (auth.uid() = user_id);

create index if not exists learning_feedback_lesson_id_idx
  on public.learning_feedback (lesson_id);
