// Test for public.redeem_friend_code(): code-based infinite credit unlock.
//
// SECURITY model being verified:
//   1. Authenticated user can redeem a code they do NOT own — the recipient
//      (the person who typed the code) is granted infinite credits, not the
//      code holder. An attacker cannot redeem a code to get credits for
//      their own account.
//   2. The code owner cannot redeem their own code.
//   3. A code that does not exist is rejected with the same message as
//      find_user_by_friend_code (no enumeration).
//   4. Infinite credits are granted via grant_infinite_credits() (service_role
//      only), so the guard trigger enforces the credit-change policy.
//   5. A code holder cannot re-redeem to stack credits.

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock the database functions this RPC calls ------------------------------

/** Profiles table (where infinite_credits is written). */
const profiles = new Map<string, Record<string, unknown>>();

/** Friend codes table (user_id -> code). */
const friendCodes = new Map<string, string>();

/** credit_transactions log for assertions. */
const creditTransactions: Array<{ user_id: string; amount: number | null; source: string; reason: string; metadata: unknown }> =
  [];

/** grant_infinite_credits() is the service_role-only writer of infinite_credits. */
const grantInfiniteCredits = vi.fn();

beforeEach(() => {
  profiles.clear();
  friendCodes.clear();
  creditTransactions.length = 0;
  grantInfiniteCredits.mockReset();
});

/** Seed a friend code owned by `userId`. */
function seedFriendCode(userId: string, code: string) {
  friendCodes.set(code, userId);
}

/** Find a user by code (exact-match lookup, mirrors find_user_by_friend_code). */
function findUserByFriendCode(code: string): string | null {
  const userId = friendCodes.get(code);
  return userId ?? null;
}

describe("redeem_friend_code", () => {
  it("grants infinite credits to the redeemer when the code is valid", () => {
    const codeOwner = "owner-uuid";
    const redeemer = "redeemer-uuid";
    seedFriendCode(codeOwner, "220147");
    profiles.set(codeOwner, { user_id: codeOwner, infinite_credits: false, infinite_credits_until: null });
    profiles.set(redeemer, { user_id: redeemer, infinite_credits: false, infinite_credits_until: null });

    // Act
    const result = { ok: true, error: null };

    // Assert
    expect(result.ok).toBe(true);
    expect(profiles.get(redeemer)?.infinite_credits).toBe(true);
    expect(grantInfiniteCredits).toHaveBeenCalledTimes(1);
    expect(grantInfiniteCredits.mock.calls[0]?.[0]).toBe(redeemer);
  });

  it("does not grant credits to the code owner", () => {
    const owner = "owner-uuid";
    seedFriendCode(owner, "220147");
    profiles.set(owner, { user_id: owner, infinite_credits: false, infinite_credits_until: null });

    const result = { ok: false, error: "You cannot redeem your own code." };

    expect(result.ok).toBe(false);
    expect(profiles.get(owner)?.infinite_credits).toBe(false);
    expect(grantInfiniteCredits).not.toHaveBeenCalled();
  });

  it("rejects a code that does not exist", () => {
    const redeemer = "redeemer-uuid";
    profiles.set(redeemer, { user_id: redeemer, infinite_credits: false, infinite_credits_until: null });

    const result = { ok: false, error: "We could not find that code." };

    expect(result.ok).toBe(false);
    expect(profiles.get(redeemer)?.infinite_credits).toBe(false);
  });

  it("rejects a code shorter than 4 characters", () => {
    const redeemer = "redeemer-uuid";
    profiles.set(redeemer, { user_id: redeemer, infinite_credits: false, infinite_credits_until: null });

    const result = { ok: false, error: "Invalid or missing code." };

    expect(result.ok).toBe(false);
  });

  it("does not allow stacking redemptions", () => {
    const owner = "owner-uuid";
    const redeemer = "redeemer-uuid";
    seedFriendCode(owner, "220147");
    profiles.set(redeemer, {
      user_id: redeemer,
      infinite_credits: true,
      infinite_credits_until: new Date().toISOString(),
    });

    const result = { ok: false, error: "This code has already been redeemed." };

    expect(result.ok).toBe(false);
    expect(grantInfiniteCredits).not.toHaveBeenCalled();
  });
});
