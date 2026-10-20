-- Coach message ownership: a message must belong to its writer AND sit in one
-- of their own conversations.
--
-- The original policy ("Users manage own messages", 20260331061234) checked
-- only auth.uid() = user_id ON THE MESSAGE ROW. A caller could therefore
-- attach their own message to ANOTHER account's conversation: the row carried
-- their id, so WITH CHECK passed, while conversation_id pointed at a
-- conversation they cannot read. Historical mismatches become inaccessible
-- under the new policy; nothing here deletes them — inspect them before
-- rollout.
--
-- The coach-chat edge function writes with the service role, which bypasses
-- RLS, so this only constrains the client paths in src/pages/Coach.tsx
-- (history read, user/assistant inserts, conversation delete cascade).

drop policy if exists "Users manage own messages" on public.coach_messages;

-- Read your own messages, and only inside your own conversations.
create policy "coach_messages_select_own_in_own_conversation"
  on public.coach_messages for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.coach_conversations c
      where c.id = coach_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- Write a message only as yourself into one of your own conversations.
create policy "coach_messages_insert_own_in_own_conversation"
  on public.coach_messages for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.coach_conversations c
      where c.id = coach_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- Change or remove your own messages inside your own conversations.
create policy "coach_messages_update_own_in_own_conversation"
  on public.coach_messages for update to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.coach_conversations c
      where c.id = coach_messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.coach_conversations c
      where c.id = coach_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "coach_messages_delete_own_in_own_conversation"
  on public.coach_messages for delete to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.coach_conversations c
      where c.id = coach_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );
