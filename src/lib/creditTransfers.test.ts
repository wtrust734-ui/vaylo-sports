// Guards for the credit-transfer client seam.
//
// The database enforces the actual rules (authorization, caps, refunds); these
// tests pin the CLIENT contract: the readable refusals map to real DB error
// text, the parameter shapes match the migration's function signatures, and
// nothing here can push credits without the RPC layer.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../supabase/migrations/20261016100000_credit_transfers.sql"),
  "utf8",
).replace(/\r\n?/g, "\n");
const CLIENT = readFileSync(
  path.resolve(__dirname, "./creditTransfers.ts"),
  "utf8",
).replace(/\r\n?/g, "\n");

describe("credit transfer migration", () => {
  it("is SECURITY DEFINER and locks the sender balance before deducting", () => {
    expect(MIGRATION).toMatch(/create or replace function public\.credit_transfer_send/);
    expect(MIGRATION).toMatch(/select credits into v_locked[\s\S]{0,200}for update/);
    // deduct is guarded by the app.allow_credit_change flag like every other path
    expect(MIGRATION).toMatch(/set_config\('app\.allow_credit_change', 'on', true\)/);
  });

  it("requires receiver authorization before any funds move", () => {
    const sendFn = MIGRATION.slice(
      MIGRATION.indexOf("credit_transfer_send"),
      MIGRATION.indexOf("credit_transfer_claim"),
    );
    expect(sendFn).toMatch(/credit_transfer_auth/);
    expect(sendFn).toMatch(/Receiver has not authorized/);
  });

  it("never lets the receiver claim someone else's transfer, and refuses self-transfer", () => {
    expect(MIGRATION).toMatch(/Only the receiver can claim/);
    expect(MIGRATION).toMatch(/Only the receiver can decline/);
    expect(MIGRATION).toMatch(/constraint credit_transfers_self check \(sender_id <> receiver_id\)/);
  });

  it("expires pending transfers with a refund written through the ledger", () => {
    expect(MIGRATION).toMatch(/credit transfer expired — refunded/);
    expect(MIGRATION).toMatch(/Transfer expired — the credits were returned/);
  });

  it("caps amounts at the same ceiling as add_credits", () => {
    // add_credits raises at >50; the transfer must match or the rail becomes
    // a bigger faucet than the arcade award path it must not outlive.
    expect(MIGRATION).toMatch(/p_amount > 50 then/);
  });

  it("RLS is on and both tables have no anonymous access", () => {
    expect(MIGRATION).toMatch(/alter table public\.credit_transfers enable row level security/);
    expect(MIGRATION).toMatch(/alter table public\.credit_transfer_auth enable row level security/);
    expect(MIGRATION).not.toMatch(/using \(true\)/i);
  });

  it("functions are revoked from public/anon and granted to authenticated only", () => {
    expect(MIGRATION.match(/revoke all on function public\.credit_transfer_/g)?.length).toBeGreaterThanOrEqual(4);
    expect(MIGRATION.match(/grant execute on function public\.credit_transfer_\w+\([^)]*\) to authenticated;/g)?.length).toBe(4);
  });
});

describe("credit transfer client seam", () => {
  it("translates every refusal the function can raise into readable copy", () => {
    expect(CLIENT).toMatch(/Not enough credits for that amount/);
    expect(CLIENT).toMatch(/haven't allowed transfers from you/);
    expect(CLIENT).toMatch(/already waiting to be claimed/);
    expect(CLIENT).toMatch(/1–\$\{TRANSFER_MAX_AMOUNT\} credits/);
  });

  it("calls only the RPC layer — no direct table writes", () => {
    expect(CLIENT).not.toMatch(/\.from\("credit_transfers"\)[\s\S]{0,120}\.(update|insert|delete)/);
    // the only from() select is the read-your-own-pending list
    expect(CLIENT).toMatch(/\.from\("credit_transfers" as never\)[\s\S]{0,120}\.select\(/);
  });

  it("clamps the note to the column's 200-char limit before sending", () => {
    expect(CLIENT).toMatch(/\.slice\(0, 200\)/);
  });
});
