// Source assertions + unit tests for the 30 September 2026 social/privacy
// package. Same pattern as dbSecurityMigration.test.ts: the live probes in
// `npm run security:check` prove the database enforces these rules today;
// these tests fail the suite if a future edit silently drops a policy,
// constraint, or trigger from the migration SOURCE.
//
// The behavioural DB tests (self-request, opposite-direction, privacy-off,
// undocumented friendship, leader self-promotion, duplicate-request, cancel,
// recipient-cannot-cancel) were executed against the live database inside
// rolled-back transactions on 2026-09-30 — all blocked/allowed as intended.
// They need two real auth users, so they are not reproducible in CI.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { safeNotificationLink } from "@/lib/notifications";
import { isWithinQuietHours } from "@/lib/notificationTriggers";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const SOCIAL = "/supabase/migrations/20260930092253_social_privacy_integrity.sql";
const BLOCKING = "/supabase/migrations/20260930093736_social_blocking.sql";

describe("social privacy migration — friend system", () => {
  const src = read(SOCIAL);

  it("rejects self-directed friend requests at the table level", () => {
    expect(src).toMatch(/friend_requests_no_self_request/);
    expect(src).toMatch(/check \(from_user_id <> to_user_id\)/);
  });

  it("closes the friend-request status set", () => {
    expect(src).toMatch(/status in \('pending', 'accepted', 'declined'\)/);
  });

  it("enforces the recipient's allow_friend_requests inside the transaction", () => {
    expect(src).toMatch(/guard_friend_request_insert\(\)/);
    expect(src).toMatch(/This athlete is not accepting friend requests/);
  });

  it("answers opposite-direction requests with 'accept it instead'", () => {
    expect(src).toMatch(/already sent you a request/);
  });

  it("gives senders a DELETE policy scoped to their own pending rows", () => {
    expect(src).toMatch(/Senders cancel their own pending requests/);
    expect(src).toMatch(/= from_user_id\s+and status = 'pending'/);
  });

  it("creates friendships only against an ACCEPTED request (pair trigger)", () => {
    expect(src).toMatch(/guard_friendship_pair\(\)/);
    expect(src).toMatch(/Friendships are created by accepting a friend request/);
  });

  it("accepting a request is atomic (single RPC flips status and inserts both rows)", () => {
    const rpc = src.indexOf("accept_friend_request(p_request_id uuid)");
    expect(rpc).toBeGreaterThan(-1);
    const body = src.slice(rpc);
    expect(body).toMatch(/status = 'accepted'\s*\n\s*where id = p_request_id\s*\n\s*and to_user_id = v_user\s*\n\s*and status = 'pending'/);
    expect(body).toMatch(/insert into public\.friendships \(user_id, friend_id\) values \(v_user, v_from\)/);
    expect(body).toMatch(/insert into public\.friendships \(user_id, friend_id\) values \(v_from, v_user\)/);
  });
});

describe("social privacy migration — challenges", () => {
  const src = read(SOCIAL);

  it("requires a positive target (zero targets complete instantly)", () => {
    expect(src).toMatch(/challenges_target_positive/);
    expect(src).toMatch(/check \(target_value > 0\)/);
  });

  it("keeps the window sane and progress non-negative", () => {
    expect(src).toMatch(/check \(end_date >= start_date\)/);
    expect(src).toMatch(/challenge_participants_progress_non_negative/);
  });

  it("refuses joins to expired or not-yet-open challenges (both RPCs)", () => {
    expect(src).toMatch(/This challenge is not open for joining/);
    expect(src).toMatch(/not_found_or_closed/);
  });

  it("reads the participant count back instead of adding to it (no double-count)", () => {
    const fn = src.indexOf("join_challenge_by_id");
    const body = src.slice(fn);
    expect(body).not.toMatch(/participant_count = coalesce\(participant_count, 0\) \+ 1/);
    expect(body).toMatch(/select participant_count into v_count/);
  });

  it("keeps progress server-side and completion rewards once-only", () => {
    expect(src).toMatch(/if v_row\.status = 'completed' then/);
    expect(src).toMatch(/'challenge:' \|\| v_ch\.id/);
    // Row-locked against concurrent updates from the same athlete.
    expect(src).toMatch(/challenge_id = p_challenge and user_id = v_user for update/);
  });
});

describe("social privacy migration — communities and visibility", () => {
  const src = read(SOCIAL);

  it("closes the privacy and role value sets", () => {
    expect(src).toMatch(/privacy in \('public', 'private', 'invite'\)/);
    expect(src).toMatch(/role in \('member', 'moderator', 'leader'\)/);
  });

  it("only the community owner may hold the leader role", () => {
    expect(src).toMatch(/guard_member_role\(\)/);
    expect(src).toMatch(/Only the community owner is a leader/);
  });

  it("lets the owner manage roles (the old policy silently failed every change)", () => {
    expect(src).toMatch(/Members self-serve, owners manage roles/);
  });

  it("self-serve joining is limited to public communities", () => {
    expect(src).toMatch(/Join public communities/);
  });

  it("private and invite-only communities are not publicly enumerable", () => {
    expect(src).toMatch(/Communities visible by privacy/);
    expect(src).toMatch(/privacy = 'public'\s*\n\s*or owner_id = \(select auth\.uid\(\)\)\s*\n\s*or is_community_member/);
  });

  it("membership lists are visible to members only", () => {
    expect(src).toMatch(/Members viewable by community and self/);
  });

  it("feed tables are no longer anonymous-readable", () => {
    expect(src).toMatch(/Shared activities viewable by authenticated/);
    expect(src).toMatch(/Hypes viewable by authenticated/);
  });

  it("bounds post content", () => {
    expect(src).toMatch(/char_length\(btrim\(content\)\) between 1 and 2000/);
  });

  it("makes re-sharing the same source idempotent", () => {
    expect(src).toMatch(/unique \(user_id, source_kind, source_id\)/);
  });
});

describe("blocking migration", () => {
  const src = read(BLOCKING);

  it("blocks are private to the blocker", () => {
    expect(src).toMatch(/Blocks are private to the blocker/);
  });

  it("a block refuses friend requests in BOTH directions", () => {
    expect(src).toMatch(/guard_friend_request_blocked\(\)/);
    expect(src).toMatch(/b\.blocker_id = new\.to_user_id and b\.blocked_id = new\.from_user_id/);
    expect(src).toMatch(/b\.blocker_id = new\.from_user_id and b\.blocked_id = new\.to_user_id/);
  });

  it("never grants user_blocks to anon", () => {
    expect(src).not.toMatch(/grant .* on table public\.user_blocks to anon/);
  });
});

describe("frontend enforces the same rules", () => {
  it("notification links are sanitised before navigation", () => {
    // NotificationBell was deleted in the 2026-10-06 dead-code pass — nothing
    // imported it, so a pin over it proved nothing an attacker can reach. This
    // scans the one shipped surface that renders notification links.
    expect(read("/src/pages/Notifications.tsx")).toMatch(/safeNotificationLink\(n\.link\)/);
  });

  // The community explorer was removed on 2026-10-08 (an empty social surface
  // with no seeded users) and its assertion went with it: the RLS policy it
  // pinned is still enforced in Postgres, and the migration-source assertions
  // above still fail the suite if it is dropped from the schema.
  //
  // The friends page was removed in the same pass and restored the same day
  // with the friend graph, direct messages and per-activity sharing behind it,
  // so the surface the accept RPC was pinned against exists again and
  // src/lib/friends.test.ts now pins the whole flow.
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
describe("safeNotificationLink (in-app routes only)", () => {
  it.each([
    ["/challenges", "/challenges"],
    ["/profile/notifications ", "/profile/notifications"], // trimmed
    [null, null],
    [undefined, null],
    ["", null],
    ["vaylo:workout:2026-09-30", null], // dedup keys are not routes
    ["https://evil.example.com", null],
    ["//evil.example.com", null],
    ["javascript:alert(1)", null],
    ["data:text/html,<script>", null],
    ["challenges", null], // relative garbage — not a route
  ])("safeNotificationLink(%j) = %j", (input, expected) => {
    expect(safeNotificationLink(input as string | null | undefined)).toBe(expected);
  });
});

describe("isWithinQuietHours (HH:MM:SS strings vs local clock)", () => {
  it("returns false when either bound is missing (quiet hours off)", () => {
    expect(isWithinQuietHours({ quiet_start: null, quiet_end: null })).toBe(false);
    expect(isWithinQuietHours({ quiet_start: "22:00:00" })).toBe(false);
    expect(isWithinQuietHours({})).toBe(false);
  });

  it("parses HH:MM:SS strings (the actual column format)", () => {
    // The old implementation compared numbers against time strings — always
    // false, so quiet hours could never engage. Just assert it now parses
    // without throwing and is a boolean for a real window.
    expect(typeof isWithinQuietHours({ quiet_start: "22:00:00", quiet_end: "06:30:00" })).toBe("boolean");
  });

  it("windows spanning midnight are accepted as valid input", () => {
    // Deterministic check: fixed clock via a window that can never contain
    // 00:00 vs one that must contain it, evaluated with mocked hours.
    const RealDate = Date;
    const withHour = (h: number, fn: () => void) => {
      const Mock = class extends RealDate {
        getHours() { return h; }
        getMinutes() { return 0; }
      } as unknown as typeof Date;
      globalThis.Date = Mock;
      try { fn(); } finally { globalThis.Date = RealDate; }
    };
    withHour(23, () => {
      expect(isWithinQuietHours({ quiet_start: "22:00:00", quiet_end: "06:00:00" })).toBe(true);
      expect(isWithinQuietHours({ quiet_start: "06:00:00", quiet_end: "22:00:00" })).toBe(false);
    });
    withHour(9, () => {
      expect(isWithinQuietHours({ quiet_start: "22:00:00", quiet_end: "06:00:00" })).toBe(false);
      expect(isWithinQuietHours({ quiet_start: "06:00:00", quiet_end: "22:00:00" })).toBe(true);
    });
  });
});
