// ============================================================================
// FRIENDS — messaging, unfriending and block coherence
// ----------------------------------------------------------------------------
// Same shape as socialPrivacy.test.ts: the live probes in `npm run security:check`
// prove the database enforces the rules it can poke, and these assertions fail
// the suite if a future edit silently drops a policy, a trigger or a guard from
// the migration SOURCE — or ships a screen that routes around it.
//
// The behavioural cases that need two real auth users (a message between
// strangers, a message across a block, an unfriend that leaves the request
// behind) are not reproducible in CI. What is checkable here is that the rule
// exists, is written in the place that enforces it, and is reachable from the
// interface.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const MIGRATION = "/supabase/migrations/20261008120000_friends_messaging_and_unfriend.sql";
const FRIENDS_LIB = "/src/lib/friends.ts";
const MESSAGES_LIB = "/src/lib/messages.ts";
const HUB = "/src/pages/Friends.tsx";
const CHAT = "/src/pages/FriendChat.tsx";

describe("direct messages — who can read them", () => {
  const src = read(MIGRATION);

  it("exists with RLS enabled", () => {
    expect(src).toMatch(/create table if not exists public\.direct_messages/i);
    expect(src).toMatch(/alter table public\.direct_messages enable row level security/i);
  });

  it("is readable by the two participants and by nobody else", () => {
    expect(src).toMatch(/Athletes read only their own conversations/);
    expect(src).toMatch(/\(select auth\.uid\(\)\) = sender_id or \(select auth\.uid\(\)\) = recipient_id/);
  });

  it("excludes BOTH directions of a block, through the definer helper", () => {
    // Someone who blocked you is hidden from you too, so the conversation stops
    // in both directions.
    //
    // The helper matters: a policy subquery runs as the querying athlete and
    // `user_blocks` is readable only by the blocker, so an inline EXISTS cannot
    // see a block where somebody else blocked the viewer — the blocked athlete
    // would keep reading their messages. A live probe of a first draft did
    // exactly that, which is why this is pinned.
    expect(src).toMatch(/public\.blocked_with\(/);
    expect(src).toMatch(/when sender_id = \(select auth\.uid\(\)\) then recipient_id/);
    // ...and the raw subquery must not come back.
    expect(src).not.toMatch(/select 1 from public\.user_blocks b\n\s+where \(b\.blocker_id = \(select auth\.uid\(\)\)/);
    // blocked_with() is created by the feed-block fix; both files must exist or
    // this migration cannot apply in order.
    expect(read("/supabase/migrations/20261006140100_feed_block_filter_both_directions.sql")).toMatch(
      /create or replace function public\.blocked_with\(p_other uuid\)/,
    );
  });

  it("lets an athlete send only as themselves", () => {
    expect(src).toMatch(/Send only as yourself/);
    expect(src).toMatch(/with check \(\(select auth\.uid\(\)\) = sender_id\)/);
  });

  it("never reaches anon, and never hands out UPDATE", () => {
    expect(src).toMatch(/revoke all on table public\.direct_messages from anon/i);
    // Supabase's default privileges hand ALL to authenticated on a new table, so
    // "no UPDATE" needs the explicit revoke or the live grant is broader than
    // this file says.
    expect(src).toMatch(
      /revoke update, truncate, references, trigger on table public\.direct_messages from authenticated/i,
    );
    expect(src).toMatch(/grant select, insert, delete on table public\.direct_messages to authenticated/i);
    // Read receipts go through mark_messages_read(): an UPDATE grant would let a
    // recipient rewrite the words of the message they were sent.
    expect(src).not.toMatch(/grant[^\n]*update[^\n]*direct_messages/i);
    expect(src).not.toMatch(/on public\.direct_messages for update/i);
  });

  it("only the sender can unsend", () => {
    expect(src).toMatch(/Unsend your own messages/);
    expect(src).toMatch(/for delete[\s\S]{0,80}using \(\(select auth\.uid\(\)\) = sender_id\)/);
  });
});

describe("direct messages — what may be sent, and to whom", () => {
  const src = read(MIGRATION);
  const guard = src.slice(src.indexOf("create or replace function public.guard_direct_message()"));

  it("refuses a message to anyone who is not a friend, in both directions", () => {
    expect(guard).toMatch(/f\.user_id = new\.sender_id and f\.friend_id = new\.recipient_id/);
    expect(guard).toMatch(/f\.user_id = new\.recipient_id and f\.friend_id = new\.sender_id/);
    expect(guard).toMatch(/You can only message athletes you are friends with/);
  });

  it("refuses a message across a block, whoever did the blocking", () => {
    expect(guard).toMatch(/b\.blocker_id = new\.sender_id and b\.blocked_id = new\.recipient_id/);
    expect(guard).toMatch(/b\.blocker_id = new\.recipient_id and b\.blocked_id = new\.sender_id/);
    // It is the second guard to fire (a block ends the friendship, so the
    // friends-only check above it answers first) and it says so, so nobody
    // "simplifies" it away as unreachable.
    expect(guard).toMatch(/Defence in depth/);
  });

  it("refuses an attachment that is not the sender's own share", () => {
    // Otherwise sending a message would be a way to surface somebody else's.
    expect(guard).toMatch(/s\.id = new\.activity_id and s\.user_id = new\.sender_id/);
    expect(guard).toMatch(/You can only send an activity you have shared yourself/);
  });

  it("cannot be addressed to yourself, and cannot be empty", () => {
    expect(src).toMatch(/constraint direct_messages_not_self check \(sender_id <> recipient_id\)/);
    expect(src).toMatch(
      /char_length\(btrim\(body\)\) between 1 and 2000 or activity_id is not null/,
    );
  });

  it("notifies the recipient, once per conversation per ten minutes", () => {
    expect(src).toMatch(/insert into public\.notifications \(user_id, type, title, body, link\)/);
    expect(src).toMatch(/interval '10 minutes'/);
    // Notifications render `link` through safeNotificationLink, which allows
    // in-app routes only — so the link has to be one.
    expect(src).toMatch(/'\/friends\/' \|\| new\.sender_id::text/);
  });
});

describe("the notification respects the athlete's own switch", () => {
  it("writes nothing to the bell while friend_activity is off", () => {
    const src = read(MIGRATION);
    expect(src).toMatch(/np\.friend_activity/);
    expect(src).toMatch(/where np\.user_id = new\.recipient_id/);
    // No row means on, matching the column's own default in the table.
    expect(src).toMatch(/\), true\) then\n\s+return new;/);
  });

  it("is offered as a switch, and is not a decoration", () => {
    const prefs = read("/src/pages/NotificationPrefs.tsx");
    expect(prefs).toMatch(/key: "friend_activity"/);
    // The switch writes the column the trigger reads; a switch that controlled
    // nothing is what this pair of assertions exists to prevent.
    expect(prefs).not.toMatch(/\/\/ .*"Friend activity".*was retired/);
  });
});

describe("the copy retired with the old surface comes back with it", () => {
  it("restores the four friend achievements", () => {
    const achievements = read("/src/pages/Achievements.tsx");
    for (const id of ["first_friend", "5_friends", "10_friends", "25_friends"]) {
      expect(achievements, `${id} is missing`).toContain(`id: "${id}"`);
    }
  });

  it("says messages arrive in the bell", () => {
    expect(read("/src/pages/Notifications.tsx")).toMatch(/messages from friends/i);
  });
});

describe("read receipts", () => {
  const src = read(MIGRATION);

  it("are written by an RPC scoped to the recipient's own inbox", () => {
    const fn = src.slice(src.indexOf("create or replace function public.mark_messages_read("));
    expect(fn).toMatch(/set read_at = now\(\)/);
    expect(fn).toMatch(/where recipient_id = v_user/);
    expect(fn).toMatch(/and sender_id = p_friend_id/);
    expect(fn).toMatch(/and read_at is null/);
  });

  it("are callable by athletes and not by anon", () => {
    expect(src).toMatch(/revoke all on function public\.mark_messages_read\(uuid\) from public, anon/i);
    expect(src).toMatch(/grant execute on function public\.mark_messages_read\(uuid\) to authenticated/i);
  });
});

describe("unfriending", () => {
  const src = read(MIGRATION);
  const fn = src.slice(src.indexOf("create or replace function public.unfriend(p_friend_id uuid)"));

  it("removes BOTH directional rows in one transaction", () => {
    expect(fn).toMatch(/delete from public\.friendships/);
    expect(fn).toMatch(/user_id = v_user and friend_id = p_friend_id/);
    expect(fn).toMatch(/user_id = p_friend_id and friend_id = v_user/);
  });

  it("removes the accepted request that authorised the friendship", () => {
    // guard_friendship_pair() certifies a friendship row against an 'accepted'
    // request, so leaving one behind would let either athlete re-insert the
    // friendship by hand after being unfriended.
    expect(fn).toMatch(/delete from public\.friend_requests/);
    expect(fn).toMatch(/from_user_id = v_user and to_user_id = p_friend_id/);
    expect(fn).toMatch(/from_user_id = p_friend_id and to_user_id = v_user/);
  });

  it("keeps the conversation, and says so", () => {
    expect(fn).not.toMatch(/delete from public\.direct_messages/);
    expect(src).toMatch(/The conversation itself is kept/);
  });
});

describe("blocking is also unfriending", () => {
  const src = read(MIGRATION);
  const fn = src.slice(src.indexOf("create or replace function public.guard_block_coherence()"));

  it("runs on every block, whoever writes it", () => {
    expect(src).toMatch(/create trigger trg_guard_block_coherence[\s\S]{0,80}after insert on public\.user_blocks/);
  });

  it("ends the friendship and clears every request in both directions", () => {
    expect(fn).toMatch(/delete from public\.friendships/);
    expect(fn).toMatch(/delete from public\.friend_requests/);
    expect(fn).toMatch(/from_user_id = new\.blocker_id and to_user_id = new\.blocked_id/);
    expect(fn).toMatch(/from_user_id = new\.blocked_id and to_user_id = new\.blocker_id/);
  });

  it("refuses a new request to somebody you are already friends with", () => {
    expect(src).toMatch(/guard_friend_request_existing_friend/);
    expect(src).toMatch(/You are already friends with this athlete/);
  });
});

describe("trigger functions stay off the client API", () => {
  const src = read(MIGRATION);

  it("revokes EXECUTE on every trigger function it adds", () => {
    for (const fn of [
      "guard_direct_message",
      "notify_direct_message",
      "guard_block_coherence",
      "guard_friend_request_existing_friend",
    ]) {
      expect(src, `${fn} is client-callable`).toMatch(
        new RegExp(`revoke execute on function public\\.${fn}\\(\\) from public, anon, authenticated`),
      );
    }
  });

  it("adds the table to Realtime, so the chat is not pull-to-refresh", () => {
    expect(src).toMatch(/alter publication supabase_realtime add table public\.direct_messages/);
    expect(src).toMatch(/alter publication supabase_realtime add table public\.notifications/);
  });
});

describe("deletion and export cover the new table", () => {
  it("is in the shared user-table registry for both columns", () => {
    const registry = read("/supabase/functions/_shared/userTables.ts");
    expect(registry).toMatch(/\["direct_messages", \["sender_id", "recipient_id"\]\]/);
  });

  it("declares the table and both RPCs in the generated types", () => {
    const types = read("/src/integrations/supabase/types.ts");
    expect(types).toMatch(/^ {6}direct_messages: \{$/m);
    expect(types).toMatch(/mark_messages_read: \{ Args: \{ p_friend_id: string \}; Returns: number \}/);
    expect(types).toMatch(/unfriend: \{ Args: \{ p_friend_id: string \}; Returns: boolean \}/);
  });
});

describe("the client does not route around the database", () => {
  it("never writes a friendship row by hand", () => {
    // friendships are created by accept_friend_request() alone; a pair trigger
    // refuses a hand-written row.
    const lib = read(FRIENDS_LIB);
    expect(lib).toContain('rpc("accept_friend_request"');
    expect(lib).not.toMatch(/from\("friendships"\)[\s\S]{0,60}\.insert/);
  });

  it("looks a friend code up through the exact-match RPC, not the table", () => {
    const lib = read(FRIENDS_LIB);
    expect(lib).toContain('rpc(\n    "find_user_by_friend_code"');
    // friend_codes is own-row readable on purpose: listing it would make every
    // code enumerable.
    expect(lib).not.toMatch(/from\("friend_codes"\)[\s\S]{0,80}\.in\(/);
  });

  it("unfriends through the RPC rather than deleting rows", () => {
    const lib = read(FRIENDS_LIB);
    expect(lib).toContain('rpc("unfriend"');
    expect(lib).not.toMatch(/from\("friendships"\)[\s\S]{0,80}\.delete\(/);
  });

  it("marks messages read through the RPC, never by updating the row", () => {
    const lib = read(MESSAGES_LIB);
    expect(lib).toContain('rpc("mark_messages_read"');
    expect(lib).not.toMatch(/from\("direct_messages"\)[\s\S]{0,80}\.update\(/);
  });

  it("tells the truth about a failed send", () => {
    const lib = read(MESSAGES_LIB);
    // A refusal has to reach the screen as a refusal, with the database's own
    // sentence, not as a message that silently did not arrive.
    expect(lib).toMatch(/if \(error\) return \{ ok: false, error: error\.message \}/);
  });
});

describe("the surface is reachable", () => {
  it("routes /friends to the page, not to a redirect home", () => {
    const app = read("/src/App.tsx");
    expect(app).toMatch(/<Route path="\/friends" element=\{<Friends \/>\} \/>/);
    expect(app).toMatch(/<Route path="\/friends\/:friendId" element=\{<FriendChat \/>\} \/>/);
    expect(app).not.toMatch(/<Route path="\/friends" element=\{<Navigate to="\/" replace \/>\} \/>/);
  });

  it("is in the sidebar and the nav catalog", () => {
    expect(read("/src/components/layout/AppSidebar.tsx")).toMatch(
      /labelKey: "sidebar\.friends", path: "\/friends"/,
    );
    expect(read("/src/lib/personalization/nav.ts")).toMatch(/path: "\/friends"/);
  });

  it("reuses the sidebar.friends label every language already carries", () => {
    const en = JSON.parse(read("/src/i18n/locales/en/index.json"));
    expect(en.sidebar.friends).toBeTruthy();
  });

  it("puts report, block and unfriend on screen, not behind a settings page", () => {
    for (const page of [HUB, CHAT]) {
      const src = read(page);
      expect(src, `${page} has no report/block control`).toContain("<ReportMenu");
      expect(src, `${page} cannot unfriend`).toContain("unfriend(");
    }
    // Blocking has to end the friendship in the UI too, or the screen keeps
    // offering to message somebody who has just been blocked.
    expect(read("/src/components/safety/ReportMenu.tsx")).toContain("onBlocked");
  });

  it("can message, and can attach one of your own shared activities", () => {
    const chat = read(CHAT);
    expect(chat).toContain("sendMessage(");
    expect(chat).toContain("fetchMySharedActivities(");
    expect(chat).toContain("markConversationRead(");
  });

  it("gives the share control a home — it had no importer at all", () => {
    // ShareActivityButton and activitySharing.ts were unreachable: activity
    // sharing existed as a library with no screen that could start one.
    expect(read(HUB)).toContain("<ShareActivityButton");
    expect(read(HUB)).toContain("workoutShareInput(");
  });
});
