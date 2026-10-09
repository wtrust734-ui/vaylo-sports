# Friends, messages and the safety controls around them

The friend graph, direct messaging, per-activity sharing, reporting, blocking and
unfriending. One database migration, three client modules and two screens.

- Migration: `supabase/migrations/20261008120000_friends_messaging_and_unfriend.sql`
- Client: `src/lib/friends.ts`, `src/lib/messages.ts`, `src/lib/activitySharing.ts`
- Screens: `src/pages/Friends.tsx` (`/friends`), `src/pages/FriendChat.tsx` (`/friends/:friendId`)
- Entry point: the **Friends** row in the sidebar, under Compete

The surface was deleted on 2026-10-08 as an empty shell (`/friends` redirected
home) and restored the same day with something to do behind it. The graph itself
was never missing: `friend_codes`, `friend_requests`, `friendships`, `user_blocks`
and the `accept_friend_request` RPC all predate this work, and the two redirects
that made them unreachable (`/friends`, and the Goals card that linked to it)
were what changed.

## What each control actually enforces

Nothing below is a UI rule. Every one is a database rule, so a client that skips
the screen cannot route around it.

| The rule | Where it lives |
|---|---|
| A message is friends-only, in both directions | `guard_direct_message()` BEFORE INSERT on `direct_messages` |
| A message cannot be sent across a block, whoever blocked whom | same trigger (backstop), plus `guard_block_coherence()` once a block exists |
| A message is readable only by its two participants | SELECT policy on `direct_messages` |
| ...and by neither of them once a block exists between them | the same policy, via `public.blocked_with()` |
| A message cannot be sent as somebody else | `with check ((select auth.uid()) = sender_id)` |
| An attachment must be the sender's own published share | `guard_direct_message()` |
| A recipient cannot rewrite a message they were sent | no `UPDATE` grant, no UPDATE policy; read receipts go through `mark_messages_read()` |
| Only the sender can unsend | DELETE policy `auth.uid() = sender_id` |
| Blocking ends the friendship and clears every request both ways | `guard_block_coherence()` AFTER INSERT on `user_blocks` |
| Unfriending removes both friendship rows **and** the accepted request | `unfriend()` RPC |
| A request to somebody you are already friends with is refused | `guard_friend_request_existing_friend()` |
| The `friend_activity` switch turns the bell entry off | `notify_direct_message()` reads `notification_prefs` |

### Two traps this file has already fallen into

Both were caught by live probes rather than by reading the code, and both are
recorded in comments next to the SQL so nobody re-introduces them:

1. **A policy subquery on `user_blocks` runs as the querying athlete.** `user_blocks`
   is readable only by the BLOCKER ("Blocks are private to the blocker"), so an
   inline `EXISTS` cannot see a block where somebody *else* blocked the viewer —
   the blocked athlete keeps reading their messages. The same bug was found and
   fixed in the activity feed on 2026-10-06
   (`20261006140100_feed_block_filter_both_directions.sql`); this policy reuses
   that fix, `public.blocked_with(p_other uuid)`.
2. **Supabase's default privileges grant ALL on a new table to `authenticated`.**
   `grant select, insert, delete` alone leaves `UPDATE`, `TRUNCATE`, `REFERENCES`
   and `TRIGGER` in place, so "no UPDATE" would have been true of the migration
   file and false of the live database. The migration now revokes them explicitly.

### Unfriend, and why it is an RPC

`unfriend(p_friend_id)` deletes both directional `friendships` rows *and* every
`friend_requests` row between the two, in one transaction. The request rows matter:
`guard_friendship_pair()` certifies a new friendship row against an `accepted`
request, so leaving one behind would let either athlete re-insert the friendship by
hand after being unfriended. The conversation is deliberately kept — it is both
athletes' own history, and the select policy still lets them read it.

## The screens

**`/friends`** — three tabs (Friends, Requests, Messages), your own friend code
with a copy button, an add-by-code field, incoming requests with Accept/Decline,
outgoing requests with Withdraw, the conversation list with unread counts, and a
"Share your training" card that publishes your last five sessions through the
existing `ShareActivityButton` (which had no importer at all before this — activity
sharing existed as a library with no screen that could start one).

Every friend row carries the same flag control as any public profile
(`ReportMenu`: report + block) and a two-step inline **Unfriend**. Blocking also
ends the friendship in the database, so the list reloads on a successful block
rather than offering to message somebody who has just been blocked.

**`/friends/:friendId`** — the thread, a composer, and an attachment picker listing
your own published shares. Report, block and unfriend sit in the header, on
purpose: they are what somebody reaches for when a conversation has gone wrong.
Incoming messages arrive live over Realtime (the table is added to the
`supabase_realtime` publication by the same migration, which also finally puts
`notifications` in it — the bell's subscription had never fired either).

## Friend codes

`friend_codes` has existed since the first migration and nothing ever created a
row, so "add a friend by code" could never have worked. `ensureMyFriendCode()`
creates one on first visit (8 characters from an alphabet without 0/O/1/I/L),
looks codes up through `find_user_by_friend_code` (exact match only — the table is
own-row readable so codes cannot be enumerated), and treats a `23505` as "another
device just created it" rather than as an error.

## How this was verified

Static: `npm run typecheck` clean · `npm run lint` 0 errors, no warnings in the new
files · `npx vitest run` **85 files / 1565 tests**, of which
`src/lib/friends.test.ts` (38) pins the migration source, the client's use of the
RPCs, and the reachability of the surface.

Live, in the real database:

- `npm run security:check` — **PASS, 31 checks** (7 new): anon is refused on
  `direct_messages`, an athlete reads their own, a non-friend's message is refused
  with the trigger's own sentence, a message written as somebody else is refused, an
  `UPDATE` is refused at the privilege level, and `unfriend()` /
  `mark_messages_read()` are callable and inert for a stranger.
- A throwaway probe (`live-e2e-friends.sql`, run through `supabase db query --linked`,
  deleted afterwards) signed in as two real accounts with real JWT claims and
  exercised the whole flow inside one transaction: accepting a request writes both
  friendship rows; friends can message; a stranger and a third-party reader are
  refused; the recipient can read and mark read; blocking ends the friendship,
  clears the requests, refuses the next message and hides the conversation from
  **both** athletes; `unfriend()` then refuses a non-friend; and the
  `friend_activity` switch suppresses the bell entry. **21/21 assertions passed**,
  and the probe deleted everything it created before committing.
- `node scripts/ui-audit.mjs friends` — `/friends` renders (1,600 characters of
  content, no redirect flag, **0 console/network errors**).

The migration was applied with `supabase db query --linked --file <migration>`
rather than `supabase db push --linked`: the remote migration history has drifted
from `supabase/migrations/` (the remote table lists timestamps this tree does not
have, and marks most of the local files as unapplied although their objects exist
live), so a push would have tried to re-run dozens of already-applied files. The
SQL was validated against the live schema first by running it in a batch ending in
a deliberate error — which proves nothing was applied, because the query endpoint
wraps a batch in one transaction (itself verified with a probe table).

## Open, and worth deciding

- **Moderation.** Reports are recorded and private to the reporter, and nobody
  reads them. `content_reports` has a `status` column waiting for an operator, and
  that is still the largest operational gap in the product (docs/RELEASE-AUDIT.md,
  section 4).
- **The two friend challenges** ("Social Butterfly", "Friend Network") stay
  retired: they are seeded rows, so bringing them back is a seed migration and a
  copy review, not a code change. The four friend achievements are back and
  earnable.
- **Push for a message.** The bell entry is in-app; server-sent push is still not
  configured (`npm run push:ready`: NOT READY).
- **Goal sharing.** The Goals "Accountability Partners" card stays out. Messaging
  a friend is not the same as letting them see your goal progress, and that is
  what the card promised.
- **A signed-in click-through.** The flow was verified at the data layer with real
  sessions and by rendering the screen, but not tapped end to end in a browser
  with two accounts — that needs two signed-in strangers, which the review account
  does not provide.
