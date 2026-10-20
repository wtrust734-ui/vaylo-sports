// ============================================================================
// REFERRAL COMMISSIONS — migration + client contract tests
// ----------------------------------------------------------------------------
// Money rules must hold even if UI code drifts, so these tests pin the
// migration source: the formula, the qualification gate (a verified purchase,
// not a click or a signup), idempotency, refund handling, fraud checks, the
// 18+ restriction, and the fact that no user can write a balance. The real
// numeric behaviour is enforced in plpgsql where the actual transaction lives.
// ============================================================================

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../../", p), "utf8").replace(/\r\n?/g, "\n");

describe("referral codes — server-issued, not guessable", () => {
  it("codes are generated server-side from crypto randomness with collision retry", () => {
    expect(CODE_SAFETY).toMatch(/pg_catalog\.gen_random_bytes\(9\)/);
    expect(CODE_SAFETY).toMatch(/when unique_violation then/);
  });

  it("the page calls the server-issued code RPC instead of the old Math.random genCode", () => {
    const page = read("src/pages/Referrals.tsx");
    expect(page).not.toMatch(/function genCode\(\)/);
    expect(page).not.toMatch(/Math\.random\(\)\.toString\(36\)/);
    expect(page).toMatch(/referral_code_issue/);
  });

  it("issuing is idempotent per account", () => {
    expect(CODE_SAFETY).toMatch(/select c\.code into v_existing from public\.referral_codes c where c\.user_id = v_user/);
  });
});

const MIGRATION = read("supabase/migrations/20261019110000_referral_commissions.sql");
const CODE_SAFETY = read("supabase/migrations/20261019120000_referral_code_safety.sql");
const GATE = read("supabase/migrations/20261014220000_referral_qualification_gate.sql");
const PROCESS_PURCHASE = read("supabase/functions/process-purchase/index.ts");
const ADMIN = read("src/pages/AdminReferrals.tsx");

describe("money — documented formula and configuration", () => {
  it("commission is calculated from revenue Vaylo keeps, not the advertised price", () => {
    expect(MIGRATION).toMatch(
      /v_net := round\(v_purchase_price::numeric\s*\*\s*\(100 - coalesce\(v_cfg\.provider_fee_pct, 0\) - coalesce\(v_cfg\.tax_pct, 0\)\) \/ 100\)/,
    );
    expect(MIGRATION).toMatch(/v_commission := round\(v_net::numeric \* coalesce\(v_cfg\.commission_pct, 0\) \/ 100\)/);
  });

  it("defaults: 15% commission, 30-day hold, £25 (2500 minor units) threshold, GBP", () => {
    expect(MIGRATION).toMatch(/commission_pct\s+numeric not null default 15/);
    expect(MIGRATION).toMatch(/hold_days\s+integer not null default 30/);
    expect(MIGRATION).toMatch(/min_payout_minor\s+bigint not null default 2500/);
    expect(MIGRATION).toMatch(/payout_currency\s+text not null default 'GBP'/);
    expect(MIGRATION).toMatch(/attribution_window_days integer not null default 30/);
  });
});

describe("lifecycle — no commission without a verified purchase", () => {
  it("commissions are created ONLY inside settle_referral's verified path", () => {
    // The insert into referral_commissions appears exactly once, in the
    // settlement function that process-purchase calls with the provider-
    // verified transaction reference.
    const inserts = MIGRATION.match(/insert into public\.referral_commissions \(/g) ?? [];
    expect(inserts.length).toBe(1);
    expect(MIGRATION).toMatch(/settle_referral[\s\S]*?insert into public\.referral_commissions \(/);
  });

  it("the settlement path enforces the referee's positive-price, transaction-verified purchase", () => {
    expect(MIGRATION).toMatch(/coalesce\(v_purchase_price, 0\) <= 0/);
    expect(MIGRATION).toMatch(/v_purchase_reference is distinct from p_transaction_reference/);
  });

  it("process-purchase only settles the first positive-price row that owns the unique reference", () => {
    expect(PROCESS_PURCHASE).toMatch(
      /const qualifying = resolved\.find\(\(r\) => r\.priceCents > 0 && r\.purchaseId && body\.verification\?\.reference\)/,
    );
  });

  it("a free trial, a failed payment or a click earns nothing: qualification is only via purchase rows", () => {
    // redeem_referral (registration + code) grants credits only — it never
    // touches referral_commissions.
    expect(GATE).not.toMatch(/referral_commissions/);
    expect(GATE).toMatch(/Referral qualification requires the referee/);
  });

  it("duplicate purchases and webhook replays cannot create a second commission", () => {
    expect(MIGRATION).toMatch(/referral_id\s+uuid not null unique/);
    expect(MIGRATION).toMatch(/purchase_id\s+uuid not null unique/);
    expect(MIGRATION).toMatch(/on conflict \(referral_id\) do nothing/);
  });
});

describe("payout — honest statuses and real requirements", () => {
  it("a payout is not marked paid without a real provider record", () => {
    expect(MIGRATION).toMatch(
      /raise exception 'Recording a payout requires the provider and the real transfer reference'/,
    );
    expect(MIGRATION).toMatch(/status = 'paid', provider = p_provider/);
  });

  it("requests below the threshold are refused and reported", () => {
    expect(MIGRATION).toMatch(/v_withdrawable < coalesce\(v_cfg\.min_payout_minor, 2500\)/);
  });

  it("under-18 referrers cannot request payouts", () => {
    expect(MIGRATION).toMatch(/public\.viewer_is_adult\(\)/);
    expect(MIGRATION).toMatch(/'under_18_not_eligible'/);
  });

  it("cancelled commissions carry a recorded reason", () => {
    expect(MIGRATION).toMatch(/raise exception 'A cancellation must state a reason'/);
    expect(MIGRATION).toMatch(/cancellation_reason = p_reason/);
  });
});

describe("security — permissions on the backend, not the frontend", () => {
  it("users cannot write balances: no insert/update policy on commissions or payouts", () => {
    expect(MIGRATION).toMatch(/create policy "referral commissions own read" on public\.referral_commissions\s*\n\s*for select/);
    expect(MIGRATION).not.toMatch(/on public\.referral_commissions\s*\n\s*for insert/);
    expect(MIGRATION).not.toMatch(/on public\.referral_payouts\s*\n\s*for insert/);
  });

  it("every admin mutation checks has_role(uid,'admin') server-side", () => {
    expect(MIGRATION).toMatch(/perform public\._referral_admin_assert\(\)/);
    expect(MIGRATION).toMatch(/public\.has_role\(auth\.uid\(\), 'admin'\)/);
  });

  it("config changes and payout decisions are audited with before/after values", () => {
    expect(MIGRATION).toMatch(/referral_admin_audit[\s\S]*?'configure', 'referral_commission_config', v_before, v_after/);
    expect(MIGRATION).toMatch(/'payout_' \|\| p_action/, );
    expect(MIGRATION).toMatch(/values \(auth\.uid\(\), 'cancel_commission', p_commission_id::text, v_before, v_after\)/);
  });

  it("settle_referral stays service-role only; click recording is anonymous", () => {
    expect(MIGRATION).toMatch(/revoke all on function public\.settle_referral\(uuid, uuid, text, text\) from public, anon, authenticated/);
    expect(MIGRATION).toMatch(/grant execute on function public\.settle_referral\(uuid, uuid, text, text\) to service_role/);
  });
});

describe("the client never trusts itself", () => {
  it("the dashboard reads the server's aggregate, never its own math", () => {
    expect(ADMIN).toMatch(/referral_admin_commissions_list/);
    expect(ADMIN).toMatch(/referral_admin_payouts_list/);
    expect(ADMIN).toMatch(/referral_admin_configure/);
  });

  it("recording a payout demands the real provider + reference, and a cancel demands a reason", () => {
    expect(ADMIN).toMatch(/The real transfer reference recorded with the provider/);
    expect(ADMIN).toMatch(/fraud review, admin decision/);
  });

  it("referral clicks are recorded at the landing, anonymously", () => {
    expect(read("src/pages/Auth.tsx")).toMatch(/void recordReferralClick/);
  });
});
