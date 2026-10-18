// ============================================================================
// STREAK REWARDS — migration + client contract tests
// ----------------------------------------------------------------------------
// The trusted backend computes streaks and awards XP, so the strongest client
// test that can run in CI is a source-level contract on the migration and on
// the client module: no client minting路径, exact milestone configuration, the
// XP award can only run through the existing xp_award service, and every
// duplicate/multi-milestone/time-zone hazard has an explicit server-side rule.
// ============================================================================

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../../", p), "utf8").replace(/\r\n?/g, "\n");

const MIGRATION = read("supabase/migrations/20261019090000_streak_rewards.sql");
const CLIENT = read("src/lib/streakRewards.ts");

/** The exact spec table: days → (name fragment, XP). */
const MILESTONES: [number, string, number][] = [
  [3, "The Starter", 25],
  [7, "The Consistency Badge", 75],
  [14, "The Momentum Badge", 125],
  [30, "The Discipline Badge", 250],
  [60, "The Dedication Badge", 400],
  [90, "The Elite Habit Badge", 600],
  [180, "The Unbreakable Badge", 1000],
  [365, "The Year of Progress Badge", 2000],
];

describe("streak migration — milestone configuration", () => {
  it("defines exactly the eight specified milestones with their exact XP", () => {
    for (const [days, name, xp] of MILESTONES) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rowPattern = new RegExp(
        `streak_milestone_${days}',\\s*'[^']*${escaped}[^']*',\\s*${xp},`,
      );
      expect(MIGRATION, `${name} (${days}d) → ${xp} XP`).toMatch(rowPattern);
    }
  });

  it("milestone XP flows ONLY through the existing xp_award service", () => {
    // The claim transaction calls xp_award; it never inserts into
    // xp_transactions directly and never mints a second ledger.
    expect(MIGRATION).toMatch(/v_award := public\.xp_award\(/);
    expect(MIGRATION).not.toMatch(/insert into public\.xp_transactions/);
  });

  it("milestone awards are proven against the wins table through the XP proof gate", () => {
    expect(MIGRATION).toMatch(/alter function public\._xp_validate_source\(uuid, text, text\)\s*\n\s*rename to _xp_validate_source_core/);
    expect(MIGRATION).toMatch(/streak_milestone_wins[\s\S]*?xp_amount = \(select xp_reward from public\.xp_reward_rules/);
  });
});

describe("streak migration — reliability hardening", () => {
  it("a day is unique per user: duplicate events and concurrent claims collapse to one row", () => {
    expect(MIGRATION).toMatch(/unique \(user_id, day\)/);
    expect(MIGRATION).toMatch(/on conflict \(user_id, day\) do nothing/);
  });

  it("a milestone is awarded exactly once per account, even after a streak restart", () => {
    expect(MIGRATION).toMatch(/unique \(user_id, milestone_days\)/);
    expect(MIGRATION).toMatch(/if not exists \(\s*\n\s*select 1 from public\.streak_milestone_wins/);
  });

  it("claimed days are window-bounded: no arbitrary backdating from the client", () => {
    // up to 14 days in the past (offline sync), max 1 day ahead (user-local
    // calendar east of UTC) — anything else is rejected.
    expect(MIGRATION).toMatch(/p_day < v_utc_today - 14 or p_day > v_utc_today \+ 1/);
  });

  it("kernel: the run is computed server-side from activity days, never trusted from the client", () => {
    expect(MIGRATION).toMatch(/select s\.run/);
    expect(MIGRATION).toMatch(/from public\._streak_compute\(v_user\)/);
  });

  it("a failed XP award unwinds the win row so a later claim can retry", () => {
    expect(MIGRATION).toMatch(/delete from public\.streak_milestone_wins where id = v_win_id/);
  });

  it("rest days qualify without exercise, with the reason recorded in history", () => {
    expect(MIGRATION).toMatch(/'rest_day'/);
    expect(MIGRATION).toMatch(/scheduled rest day in the active training plan/);
  });

  it("clients get read-only access: no insert/update/delete policy on activity days", () => {
    expect(MIGRATION).toMatch(/create policy "streak days own read" on public\.streak_activity_days\s*\n\s*for select/);
    expect(MIGRATION).not.toMatch(/on public\.streak_activity_days\s*\n?\s*for insert/);
    expect(MIGRATION).not.toMatch(/on public\.streak_milestone_wins\s*\n?\s*for insert/);
  });
});

describe("streak client — nothing is minted or decided client-side", () => {
  it("the achievement counters read the server's streak, not a client guess", () => {
    const hook = read("src/hooks/useAchievementStats.ts");
    expect(hook).toMatch(/from\("streaks" as never\)/);
    expect(hook).toMatch(/current_streak/);
  });

  it("claims send source + reference only; day is a date, never an amount", () => {
    expect(CLIENT).toMatch(/rpc\("streak_claim_day"/);
    // The client never CALLS the XP service directly from the claim module:
    // milestone XP is awarded inside the server's claim transaction.
    expect(CLIENT).not.toMatch(/rpc\("xp_award"/);
    expect(CLIENT).not.toMatch(/p_xp|xp_amount/);
  });

  it("milestone toasts fire only from server-reported new milestones", () => {
    expect(CLIENT).toMatch(/r\.new_milestones/);
  });

  it("rest-day claims pass today's date and the rest-day source from the dashboard card", () => {
    const card = read("src/components/dashboard/DailyTrainingCard.tsx");
    expect(card).toMatch(/claimStreakDay\("rest_day", day, day\)/);
  });
});
