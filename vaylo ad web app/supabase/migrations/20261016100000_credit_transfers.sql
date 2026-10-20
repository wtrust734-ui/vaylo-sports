-- ============================================================================
-- CREDIT TRANSFERS — the ecosystem rail
-- ----------------------------------------------------------------------------
-- An athlete can send credits to another athlete. The first use is paying a
-- human coach for a plan; later uses (friends splitting a pack, a community
-- prize payout) are the same primitive.
--
-- Rules enforced here, in the database, so no client or edge function can
-- bypass them:
--   * The receiver must have granted the sender authorization (ReceiverAuth):
--     a transfer into an account nobody can push into is a griefing vector,
--     and an account that anyone can pull from is a theft vector. Both sides
--     opt in.
--   * One outstanding (pending) transfer pair at a time between two accounts —
--     a transfer must be completed or declined before another is sent.
--   * Amount limits, mirrored from add_credits' abuse cap (50), so the transfer
--     rail cannot be used to mint beyond what the arcade award path allows.
--   * Atomicity: this runs entirely inside a SECURITY DEFINER function with a
--     FOR UPDATE lock on the sender's balance, so a concurrent spend cannot
--     race the withdrawal. Funds are deducted once, credited once, and each
--     side's ledger row is written by the same primitives every other credit
--     path uses (the guard-trigger exemption flag), so the balance guard and
--     the transactions ledger stay authoritative.
--
-- Completion is by the RECEIVER claiming a pending transfer, not by the sender
-- revoking: a sent transfer leaving without the receiver's action is a pull
-- debit in disguise. A pending transfer expires after 7 days and the funds
-- return to the sender — expired-at refunds are handled by the same function
-- on claim attempts, never by a client-side update.
-- ============================================================================

create table if not exists public.credit_transfers (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  receiver_id uuid not null references auth.users (id) on delete cascade,
  amount integer not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  completed_at timestamptz,
  note text
    check (char_length(note) <= 200),
  constraint credit_transfers_self check (sender_id <> receiver_id)
);

create index if not exists credit_transfers_receiver_idx
  on public.credit_transfers (receiver_id, status)
  where status = 'pending';
create index if not exists credit_transfers_sender_idx
  on public.credit_transfers (sender_id, status)
  where status = 'pending';

-- Receiver authorization: an account must explicitly allow incoming transfers
-- from a sender. audience='coach' also marks the relationship for the
-- marketplace (the coach's athlete can pay them); 'friend' covers everything.
create table if not exists public.credit_transfer_auth (
  owner_id uuid not null references auth.users (id) on delete cascade,
  allowed_sender uuid not null references auth.users (id) on delete cascade,
  audience text not null default 'any'
    check (audience in ('any', 'coach')),
  created_at timestamptz not null default now(),
  primary key (owner_id, allowed_sender)
);

alter table public.credit_transfers enable row level security;
alter table public.credit_transfer_auth enable row level security;

-- Both parties read their own transfers; authorization rows visible to both the
-- owner and the Authorization-authorized sender (the sender must be able to
-- check eligibility before sending).
create policy "credit_transfers_read_own"
  on public.credit_transfers for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "credit_transfers_auth_read"
  on public.credit_transfer_auth for select
  to authenticated
  using (auth.uid() = owner_id or auth.uid() = allowed_sender);

-- No insert/update/delete policies: the tables are written only by the
-- SECURITY DEFINER function, which bypasses RLS.

-- ---------------------------------------------------------------------------
-- The transfer function. One transaction, both balances, both ledgers.
-- ---------------------------------------------------------------------------
create or replace function public.credit_transfer_send(
  p_receiver uuid,
  p_amount integer,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_locked integer;
  v_new_sender integer;
  v_id uuid;
begin
  if v_sender is null then
    raise exception 'Not authenticated';
  end if;
  if p_receiver is null or p_receiver = v_sender then
    raise exception 'Invalid receiver';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 50 then
    raise exception 'Invalid amount';
  end if;

  -- Receiver must have authorized this sender.
  if not exists (
    select 1 from public.credit_transfer_auth a
    where a.owner_id = p_receiver
      and a.allowed_sender = v_sender
  ) then
    raise exception 'Receiver has not authorized transfers from you';
  end if;

  -- One outstanding transfer between the pair at a time.
  if exists (
    select 1 from public.credit_transfers t
    where t.status = 'pending'
      and (
        (t.sender_id = v_sender and t.receiver_id = p_receiver)
        or (t.sender_id = p_receiver and t.receiver_id = v_sender)
      )
  ) then
    raise exception 'A transfer between these accounts is already pending';
  end if;

  -- Lock the sender's balance row ONLY (the receiver's row is updated later in
  -- this same transaction, after the pending insert). Locking both here risks
  -- deadlock when two accounts transfer to each other concurrently.
  select credits into v_locked
    from public.profiles
    where user_id = v_sender
    for update;
  if v_locked is null then
    raise exception 'Profile not found';
  end if;
  if v_locked < p_amount then
    raise exception 'Insufficient credits';
  end if;

  perform set_config('app.allow_credit_change', 'on', true);
  update public.profiles
    set credits = v_locked - p_amount
    where user_id = v_sender;
  perform set_config('app.allow_credit_change', 'off', true);

  -- Sender-side ledger row, same convention as spend_credits.
  insert into public.credit_transactions (user_id, amount, reason)
    values (v_sender, -p_amount, 'credit transfer sent');

  insert into public.credit_transfers (sender_id, receiver_id, amount, note)
    values (v_sender, p_receiver, p_amount, left(p_note, 200))
    returning id into v_id;

  return v_id;
end;
$$;

-- The receiver claims: moves the funds into their balance, marks completed,
-- writes their ledger row. Also expires-stales any pending transfer past its
-- window and refunds it to the sender before claiming, so expiry is enforced
-- lazily, by the function, and never by a client.
create or replace function public.credit_transfer_claim(
  p_transfer uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receiver uuid := auth.uid();
  v_sender uuid;
  v_amount integer;
  v_status text;
  v_expires timestamptz;
  v_current integer;
begin
  if v_receiver is null then
    raise exception 'Not authenticated';
  end if;

  select t.sender_id, t.amount, t.status, t.expires_at
    into v_sender, v_amount, v_status, v_expires
    from public.credit_transfers t
    where t.id = p_transfer
    for update;
  if v_sender is null then
    raise exception 'Transfer not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'Transfer is not pending';
  end if;

  -- Expired? Refund the sender first (their balance is unlocked here: the
  -- claim is the only writer to it at this moment) and expire the row.
  if v_expires < now() then
    select credits into v_current
      from public.profiles where user_id = v_sender for update;
    perform set_config('app.allow_credit_change', 'on', true);
    update public.profiles
      set credits = v_current + v_amount
      where user_id = v_sender;
    perform set_config('app.allow_credit_change', 'off', true);
    insert into public.credit_transactions (user_id, amount, reason)
      values (v_sender, v_amount, 'credit transfer expired — refunded');

    update public.credit_transfers
      set status = 'expired'
      where id = p_transfer;

    raise exception 'Transfer expired — the credits were returned to the sender';
  end if;

  if v_receiver <> (select receiver_id from public.credit_transfers where id = p_transfer) then
    raise exception 'Only the receiver can claim this transfer';
  end if;

  select credits into v_current
    from public.profiles where user_id = v_receiver for update;
  if v_current is null then
    raise exception 'Profile not found';
  end if;

  perform set_config('app.allow_credit_change', 'on', true);
  update public.profiles
    set credits = v_current + v_amount
    where user_id = v_receiver;
  perform set_config('app.allow_credit_change', 'off', true);

  insert into public.credit_transactions (user_id, amount, reason)
    values (v_receiver, v_amount, 'credit transfer received');

  update public.credit_transfers
    set status = 'completed', completed_at = now()
    where id = p_transfer;

  return v_current + v_amount;
end;
$$;

revoke all on function public.credit_transfer_send(uuid, integer, text) from public, anon;
revoke all on function public.credit_transfer_claim(uuid) from public, anon;
grant execute on function public.credit_transfer_send(uuid, integer, text) to authenticated;
grant execute on function public.credit_transfer_claim(uuid) to authenticated;

-- Declining: the receiver can remove a pending transfer row addressed to them
-- and the sender's funds return only via expiry. Give the receiver a direct
-- decline that refunds immediately instead of them having to wait 7 days —
-- the receiver performing the refund-side of the transaction themselves is
-- safe because the refund goes to the SENDER, not the actor.
create or replace function public.credit_transfer_decline(
  p_transfer uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receiver uuid := auth.uid();
  v_sender uuid;
  v_amount integer;
  v_status text;
  v_current integer;
begin
  if v_receiver is null then
    raise exception 'Not authenticated';
  end if;

  select t.sender_id, t.amount, t.status
    into v_sender, v_amount, v_status
    from public.credit_transfers t
    where t.id = p_transfer
    for update;
  if v_sender is null then
    raise exception 'Transfer not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'Transfer is not pending';
  end if;
  if v_receiver <> (select receiver_id from public.credit_transfers where id = p_transfer) then
    raise exception 'Only the receiver can decline this transfer';
  end if;

  -- Refund the sender.
  select credits into v_current
    from public.profiles where user_id = v_sender for update;
  perform set_config('app.allow_credit_change', 'on', true);
  update public.profiles
    set credits = v_current + v_amount
    where user_id = v_sender;
  perform set_config('app.allow_credit_change', 'off', true);
  insert into public.credit_transactions (user_id, amount, reason)
    values (v_sender, v_amount, 'credit transfer declined — refunded');

  update public.credit_transfers
    set status = 'expired'
    where id = p_transfer;
end;
$$;

revoke all on function public.credit_transfer_decline(uuid) from public, anon;
grant execute on function public.credit_transfer_decline(uuid) to authenticated;

-- Receiver grants/revokes authorization. WHAT THIS DELIBERATELY DOESN'T DO:
-- a discovery/search function. Authorization is granted by a user id the
-- receiver already knows (from a coach they've engaged with, a friend code,
-- a shared link). Making sender discovery trivial would make the rail a
-- spam channel.
create or replace function public.credit_transfer_set_auth(
  p_allowed_sender uuid,
  p_allow boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_allowed_sender is null or p_allowed_sender = auth.uid() then
    raise exception 'Invalid sender';
  end if;

  if p_allow then
    insert into public.credit_transfer_auth (owner_id, allowed_sender)
      values (auth.uid(), p_allowed_sender)
      on conflict (owner_id, allowed_sender) do nothing;
  else
    delete from public.credit_transfer_auth
      where owner_id = auth.uid()
        and allowed_sender = p_allowed_sender;
  end if;
end;
$$;

revoke all on function public.credit_transfer_set_auth(uuid, boolean) from public, anon;
grant execute on function public.credit_transfer_set_auth(uuid, boolean) to authenticated;
