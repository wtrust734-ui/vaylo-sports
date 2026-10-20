// Tests for the >3-distinct-report Friends restriction.
//
// Two layers, matching the project's pattern of picking a database-migration
// test over a run of live SQL (dbSecurityMigration.test.ts):
//
//   * SOURCE assertions — the migration must keep the pieces that actually
//     enforce the rule: the distinct-report count, the threshold written once,
//     the two write-path guards, the read policy, and the moderation release
//     lever. Lose any of these and the rule stops being enforced without
//     anything in the app noticing.
//
//   * CLIENT behaviour — what the restriction read maps to, what the screens
//     must do on a failed read (the read can only lag the truth), and the
//     appeal path's shape.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "@/integrations/supabase/client";
import {
  appealFriendRestriction,
  fetchMyFriendAccess,
  FRIEND_RESTRICTION_APPEAL,
  FRIEND_RESTRICTION_POLICY,
} from "@/lib/friendAccess";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../..", p), "utf8").replace(/\r\n?/g, "\n");

const MIGRATION = "supabase/migrations/20261019150000_friend_access_restriction.sql";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    auth: { getSession: vi.fn() },
    functions: { invoke: vi.fn() },
  },
}));

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const getSession = supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;
const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  rpc.mockReset();
  getSession.mockReset();
  invoke.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("friend restriction migration", () => {
  const src = read(MIGRATION);

  it("counts DISTINCT, non-dismissed reports — repetition cannot stack, review can release", () => {
    expect(src).toMatch(/count\(distinct r\.reporter_id\)/);
    expect(src).toMatch(/r\.status <> 'dismissed'/);
  });

  it("targets profile reports only, and writes the threshold once", () => {
    expect(src).toMatch(/r\.target_type = 'profile'/);
    // One place, commented as the policy: "more than three".
    const matches = src.match(/v_threshold constant integer := 4/g);
    expect(matches).toHaveLength(1);
  });

  it("guards BOTH write paths — requests and messages — on insert", () => {
    expect(src).toMatch(
      /create trigger trg_guard_friendrequest_restriction[\s\S]*?on public\.friend_requests/,
    );
    expect(src).toMatch(
      /create trigger trg_guard_messaging_restriction[\s\S]*?on public\.direct_messages/,
    );
    expect(src.match(/is_friend_restricted/g)!.length).toBeGreaterThanOrEqual(6);
  });

  it("closes the anon/executable surface of every new function", () => {
    for (const fn of [
      "public\\.friend_qualifying_report_count\\(uuid\\)",
      "public\\.recompute_friend_restriction\\(\\)",
      "public\\.guard_friendrequest_restriction\\(\\)",
      "public\\.guard_messaging_restriction\\(\\)",
    ]) {
      expect(src, fn).toMatch(new RegExp(`revoke all on function ${fn} from public, anon, authenticated;`));
    }
    // The self-read and the moderation lever grant narrowly instead.
    expect(src).toMatch(/grant execute on function public\.my_friend_restriction\(\) to authenticated, service_role;/);
    expect(src).toMatch(
      /grant execute on function public\.moderation_set_friend_restriction\(uuid, boolean, text\) to service_role;/,
    );
  });

  it("never lets an authenticated caller probe a third party's restriction state", () => {
    // is_friend_restricted(any-uuid) executed by anybody would answer
    // "is this athlete restricted?" about anyone — a small but real oracle.
    // Guards, policies and the recompute still work: they run as the function
    // they are declared under, not via the caller's EXECUTE.
    expect(src).toMatch(/revoke all on function public\.is_friend_restricted\(uuid\) from public, anon, authenticated;/);
    expect(src).not.toMatch(/grant execute on function public\.is_friend_restricted\(uuid\) to authenticated/);
  });

  it("hides the friend list from the restricted viewer without deleting it", () => {
    expect(src).toMatch(
      /select auth\.uid\(\)\) = user_id AND NOT public\.is_friend_restricted\(\(select auth\.uid\(\)\)\)/,
    );
  });

  it("limits the athlete's own visibility of the state to themselves", () => {
    expect(src).toMatch(
      /on public\.friend_restriction_state for select[\s\S]*?to authenticated[\s\S]*?using \(\(select auth\.uid\(\)\) = user_id\)/,
    );
  });
});

describe("fetchMyFriendAccess", () => {
  it("maps the server triple to the client state", async () => {
    rpc.mockResolvedValue({
      data: { restricted: true, qualifying_reports: 5, threshold_for_restriction: 4 },
      error: null,
    });
    const result = await fetchMyFriendAccess();
    expect(result).toEqual({
      ok: true,
      state: { restricted: true, qualifyingReports: 5, thresholdForRestriction: 4 },
    });
  });

  it("treats a failed read as open, not restricted — the read can only lag the truth", async () => {
    // The server refuses restricted actions regardless; the screen cannot
    // redesign itself around "unknown", and guessing "restricted" would lock
    // out an athlete the database is about to serve normally.
    rpc.mockResolvedValue({ data: null, error: { message: "network down" } });
    const result = await fetchMyFriendAccess();
    expect(result.ok).toBe(true);
    expect(result.ok && result.state.restricted).toBe(false);
  });

  it("reads score zero for a missing or malformed payload but never restricts", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const result = await fetchMyFriendAccess();
    expect(result.ok).toBe(true);
    expect(result.ok && result.state).toMatchObject({
      restricted: false,
      qualifyingReports: 0,
      thresholdForRestriction: 4,
    });
  });
});

describe("the restriction wording", () => {
  it("explains the policy without naming any reporter", () => {
    expect(FRIEND_RESTRICTION_POLICY).toMatch(/more than three qualifying reports/);
    expect(FRIEND_RESTRICTION_POLICY).not.toMatch(/reported you|reporter|by .+ athlete(?!s)/i);
  });

  it("points a wronged athlete at a review, not a dead end", () => {
    expect(FRIEND_RESTRICTION_APPEAL).toMatch(/review/i);
  });
});

describe("appealFriendRestriction", () => {
  it("files through support-request with the moderation category and a named subject", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: "a@b.dev" } } } });
    invoke.mockResolvedValue({ data: { reference: "SR-7" }, error: null });
    const result = await appealFriendRestriction("Two of those reports are fake; please review.");
    expect(invoke).toHaveBeenCalledWith("support-request", {
      body: expect.objectContaining({
        category: "safety",
        email: "a@b.dev",
        subject: "Friends restriction appeal",
      }),
    });
    expect(result).toEqual({ ok: true, reference: "SR-7" });
  });

  it("demands a real sentence before sending", async () => {
    const result = await appealFriendRestriction("  why  ");
    expect(result.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses to send for a signed-out account instead of emailing a blank ticket", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const result = await appealFriendRestriction("Please, these reports are mistaken.");
    expect(result.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns the function's error rather than swallowing it", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: "a@b.dev" } } } });
    invoke.mockResolvedValue({ data: null, error: { message: "rate_limited" } });
    const result = await appealFriendRestriction("These reports are mistaken, please review.");
    expect(result).toEqual({ ok: false, error: "rate_limited" });
  });
});
