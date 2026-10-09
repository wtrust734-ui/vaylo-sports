import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("supabase/functions/process-purchase/index.ts", "utf8");
const transaction = readFileSync("supabase/migrations/20261010090001_atomic_purchase_delivery.sql", "utf8");

describe("purchase transaction boundary", () => {
  it("validates the basket before calling the atomic delivery routine", () => {
    expect(source.indexOf("if (cost > availableCredits)")).toBeLessThan(source.indexOf('rpc("deliver_purchase"'));
    expect(source).not.toContain("rollBackPurchase");
    expect(source).not.toMatch(/item\.price_cents/);
  });
  it("resolves feature costs again while holding the profile lock", () => {
    expect(transaction.indexOf("FOR UPDATE")).toBeLessThan(transaction.indexOf("v_cost := public.credit_cost"));
    expect(transaction).toContain("IF v_profile.credits < v_cost THEN RAISE EXCEPTION");
    expect(transaction).toContain("INSERT INTO public.user_purchases");
    expect(transaction).toContain("public.credits_grant");
    expect(transaction).toContain("public.grant_coins");
    expect(transaction).toContain("public.grant_infinite_credits");
  });
  it("returns a stored delivery on replay and restricts delivery to the service role", () => {
    expect(transaction).toContain("pg_advisory_xact_lock");
    expect(transaction).toContain("RETURN v_prior.result");
    expect(transaction).toContain("Receipt belongs to another account");
    expect(transaction).toContain("FROM PUBLIC, anon, authenticated");
    expect(transaction).toContain("TO service_role");
  });
});
