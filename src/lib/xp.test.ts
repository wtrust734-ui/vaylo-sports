// ============================================================================
// XP PROGRESSION — foundation tests
// ----------------------------------------------------------------------------
// Pure level math is tested directly. Server behaviour (proof validation,
// idempotency) is enforced in the database functions, so the client-side
// contract is asserted at source level: the client can only ASK for XP by kind
// — it can never supply an amount — and every award call carries an
// idempotency key derived from the real, verified source of the XP.
// ============================================================================

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  XP_LEVEL_THRESHOLDS,
  xpLevelFor,
  xpThreshold,
  XP_POST10_FIRST_DELTA,
  XP_POST10_GROWTH,
} from "@/lib/xp";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

const XP = read("/src/lib/xp.ts");
const MIGRATION_PATH = "supabase/migrations/20261018080000_xp_progression.sql";
const MIGRATION_SRC = readFileSync(
  path.resolve(__dirname, "../../" + MIGRATION_PATH),
  "utf8",
).replace(/\r\n?/g, "\n");

describe("level math — thresholds match the specified ladder", () => {
  it("levels 1-10 have exactly the specified cumulative XP", () => {
    const expected = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200];
    for (let level = 1; level <= 10; level++) {
      expect(xpThreshold(level)).toBe(expected[level - 1]);
    }
    expect(XP_LEVEL_THRESHOLDS).toEqual(expected);
  });

  it("post-level-10 growth is strictly increasing by the documented formula", () => {
    // threshold(11) = 3200 + 800; each extra level adds first_delta + growth
    expect(xpThreshold(11)).toBe(3200 + XP_POST10_FIRST_DELTA);
    expect(xpThreshold(12)).toBe(xpThreshold(11) + XP_POST10_FIRST_DELTA + XP_POST10_GROWTH);
    let prev = xpThreshold(1);
    for (let level = 2; level <= 40; level++) {
      const t = xpThreshold(level);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it("matches the SQL formula for post-10 levels (shared logic, two implementations)", () => {
    // SQL: threshold(10) + sum_{k=11..n} (first_delta + (k-11)*growth)
    const sqlFormula = (level: number) => {
      let total = 3200;
      for (let k = 11; k <= level; k++) total += 800 + (k - 11) * 60;
      return total;
    };
    expect(xpThreshold(15)).toBe(sqlFormula(15));
    expect(xpThreshold(23)).toBe(sqlFormula(23));
  });

  it("boundaries resolve to the right level", () => {
    expect(xpLevelFor(0)).toBe(1);
    expect(xpLevelFor(99)).toBe(1);
    expect(xpLevelFor(100)).toBe(2);
    expect(xpLevelFor(249)).toBe(2);
    expect(xpLevelFor(250)).toBe(3);
    expect(xpLevelFor(3200)).toBe(10);
    expect(xpLevelFor(3199)).toBe(9);
    expect(xpLevelFor(4000)).toBe(11);
    expect(xpLevelFor(3999)).toBe(10);
  });

  it("one big event can skip levels and never loses one", () => {
    // 90 XP = level 1; +200 in a single valid event → 290 = level 3+
    expect(xpLevelFor(90)).toBe(1);
    expect(xpLevelFor(290)).toBe(3);
    expect(xpLevelFor(xpThreshold(5) - 1)).toBe(4);
    expect(xpLevelFor(xpThreshold(5))).toBe(5);
  });

  it("level is a pure function of total XP — inactivity cannot lower it", () => {
    expect(xpLevelFor(700)).toBe(5);
    expect(xpLevelFor(700)).toBe(5); // same input, same level, no decay
  });
});

describe("client contract — the browser never awards XP, the server decides", () => {
  it("xp_award receives a kind and ref, never an XP amount", () => {
    expect(XP).toMatch(/p_kind:\s*kind/);
    expect(XP).toMatch(/p_source_ref:\s*sourceRef/);
    // the RPC payload carries no numeric value the client invented
    expect(XP).not.toMatch(/p_\w+:\s*\d/);
    expect(XP).not.toMatch(/xp_amount:\s*\d/);
    expect(XP).not.toMatch(/\{[^}]*\b20\b[^}]*p_kind/);
  });

  it("every award helper derives a stable idempotency key from the source", () => {
    expect(XP).toMatch(/idempotencyKey:\s*`training:\$\{logId\}`/);
    expect(XP).toMatch(/idempotencyKey:\s*`recovery:\$\{logDate\}`/);
    expect(XP).toMatch(/idempotencyKey:\s*`lesson:\$\{lessonId\}`/);
    expect(XP).toMatch(/idempotencyKey:\s*`assessment:\$\{lessonId\}`/);
    expect(XP).toMatch(/idempotencyKey:\s*`weekly:\$\{goalId\}:\$\{weekStartIso\}`/);
  });

  it("keeps XP separate from credits, coins and money", () => {
    expect(XP).not.toMatch(/spendCredits|claimCreditReward|credit_transactions|credits_spend/);
    expect(XP).not.toMatch(/COIN_BUNDLES|COINS_PER_CREDIT|convert_credits_to_coins|purchase_cosmetic/);
    expect(XP).not.toMatch(/import[^\n]*(coins|credits)/i);
  });
});

describe("database contract — the migration enforces security and the amounts", () => {
  it("declares the exact specified reward values, configurable in rules", () => {
    expect(MIGRATION_SRC).toMatch(/\('training_session',[^]*?20,[^]*?true[^]*?3\)/s);
    expect(MIGRATION_SRC).toMatch(/\('recovery_session'[^]*?15,/);
    expect(MIGRATION_SRC).toMatch(/\('learning_lesson'[^]*?10,/);
    expect(MIGRATION_SRC).toMatch(/\('weekly_goal'[^]*?50,/);
    expect(MIGRATION_SRC).toMatch(/\('assessment'[^]*?15,[^]*?80,/);
  });

  it("writes are server-only: RLS has a select policy and no write policies", () => {
    expect(MIGRATION_SRC).toMatch(/enable row level security/);
    expect(MIGRATION_SRC).toMatch(/for select to authenticated/);
    expect(MIGRATION_SRC).not.toMatch(/create policy[^\n]*for insert/i);
    expect(MIGRATION_SRC).not.toMatch(/create policy[^\n]*for update/i);
    expect(MIGRATION_SRC).not.toMatch(/create policy[^\n]*for all/i);
  });

  it("awards run as security definer and identify the caller from auth.uid()", () => {
    expect(MIGRATION_SRC).toMatch(/security definer/);
    expect(MIGRATION_SRC).toMatch(/v_user uuid := auth\.uid\(\)/);
    expect(MIGRATION_SRC).toMatch(/if v_user is null[^]*?not_authenticated/);
  });

  it("every award validates its source row server-side before any XP moves", () => {
    expect(MIGRATION_SRC).toMatch(/unverified_activity/);
    expect(MIGRATION_SRC).toMatch(/performance_logs pl[\s\S]*log_type = 'training'/);
    expect(MIGRATION_SRC).toMatch(/recovery_logs rl/);
    expect(MIGRATION_SRC).toMatch(/learning_progress lp[^]*?completed = true/);
    expect(MIGRATION_SRC).toMatch(/daily_action_logs dal/);
  });

  it("duplicates are impossible: unique idempotency key plus per-source unique index", () => {
    expect(MIGRATION_SRC).toMatch(/idempotency_key text not null unique/);
    expect(MIGRATION_SRC).toMatch(
      /create unique index[^\n]*xp_transactions_user_kind_ref_idx/,
    );
    expect(MIGRATION_SRC).toMatch(/on conflict \(idempotency_key\) do nothing/);
    expect(MIGRATION_SRC).toMatch(/'duplicate', true/);
  });

  it("a replayed event returns the standing profile without awarding again", () => {
    expect(MIGRATION_SRC).toMatch(/if v_amount is null then/);
    expect(MIGRATION_SRC).toMatch(/\|\| jsonb_build_object\('ok', true, 'awarded', 0, 'duplicate', true\)/);
  });

  it("corrections append an auditable reversal, never overwrite history", () => {
    expect(MIGRATION_SRC).toMatch(/reversal_of\s+uuid references public\.xp_transactions/);
    expect(MIGRATION_SRC).toMatch(/'reverse:' \|\| v_orig\.id::text/);
    expect(MIGRATION_SRC).toMatch(/already_reversed/);
    // Reversals are negative-with-reference; awards positive-without.
    expect(MIGRATION_SRC).toMatch(
      /xp_amount > 0 and reversal_of is null\) or \(xp_amount < 0 and reversal_of is not null\)/,
    );
  });

  it("privacy: only your own ledger, and xp_profile refuses other users", () => {
    expect(MIGRATION_SRC).toMatch(/user_id = auth\.uid\(\)/);
    expect(MIGRATION_SRC).toMatch(/'forbidden'/);
  });

  it("the anonymous and revoked paths fail closed", () => {
    expect(MIGRATION_SRC).toMatch(/revoke all on function public\.xp_award[^]*from public, anon/);
    expect(MIGRATION_SRC).toMatch(/grant execute on function public\.xp_award[^]*to authenticated/);
  });

  it("training volume is capped per day so overtraining earns nothing extra", () => {
    expect(MIGRATION_SRC).toMatch(/daily_cap/);
    expect(MIGRATION_SRC).toMatch(/daily_cap_reached/);
  });
});

describe("integration — rewards are wired to activities that actually work", () => {
  it("a logged training session calls the award with the log id", () => {
    const training = read("/src/pages/Training.tsx");
    expect(training).toMatch(/const newLogId = \(insertedLog[\s\S]*?awardTrainingSession\(newLogId\)/);
  });

  it("a completed lesson and a passing assessment both call the award", () => {
    const article = read("/src/pages/LearningArticle.tsx");
    expect(article).toMatch(/awardLesson\(lesson\.id\)/);
    expect(article).toMatch(/score >= 80\) void awardAssessment\(lesson\.id\)/);
  });

  it("recovery check-ins award XP — rest days included, no exercise required", () => {
    const recovery = read("/src/pages/Recovery.tsx");
    expect(recovery).toMatch(/awardRecoverySession\(today\)/);
  });

  it("weekly goals award through their idempotent goal+week key", () => {
    const goals = read("/src/pages/Goals.tsx");
    // Local date key, not UTC — the week window the server validates must
    // match the local days the athlete actually logs.
    expect(goals).toMatch(/awardWeeklyGoal\(pg\.id, isoDate\(startOfWeek\(\)\)\)/);
    expect(goals).not.toMatch(/startOfWeek\(\)\.toISOString/);
    expect(goals).toMatch(/wk\.done >= wk\.target/);
  });

  it("opening the app or the profile page awards nothing", () => {
    const profile = read("/src/pages/Profile.tsx");
    expect(profile).not.toMatch(/xp_award|awardTraining|awardRecovery|awardLesson|awardAssessment|awardWeeklyGoal/);
  });
});

describe("XP UI — level, total, next-level progress, history, explanation", () => {
  it("the profile page hosts the summary card", () => {
    const profile = read("/src/pages/Profile.tsx");
    expect(profile).toMatch(/XpSummaryCard/);
  });

  it("the card shows level, total XP, progress and how XP works", () => {
    const card = read("/src/components/xp/XpSummaryCard.tsx");
    expect(card).toMatch(/Athlete level/);
    expect(card).toMatch(/XP total/);
    expect(card).toMatch(/role="progressbar"/);
    expect(card).toMatch(/XP to Level/);
    expect(card).toMatch(/Recent XP/);
    expect(card).toMatch(/not money or credits/);
    expect(card).toMatch(/Rest days count/);
  });

  it("notifications stay subtle and never repeat an event", () => {
    const xp = XP;
    expect(xp).toMatch(/result\.duplicate[^]*?return/);
    expect(xp).toMatch(/\+\$\{result\.awarded\} XP/);
    expect(xp).toMatch(/leveled_up/);
  });
});

describe("story — avatar and cosmetics stay removed", () => {
  it("no cosmetics surface was recreated anywhere in XP work", () => {
    const profile = read("/src/pages/Profile.tsx");
    expect(profile).not.toMatch(/StyleTab|CosmeticShop|useCosmetics/);
    expect(profile).not.toMatch(/\/collection|Titles, borders/);
    expect(profile).not.toMatch(/Palette icon/);
    expect(read("/src/components/xp/XpSummaryCard.tsx")).not.toMatch(/cosmetic|avatar/i);
    expect(XP).not.toMatch(/cosmetic|avatar/i);
  });
});
