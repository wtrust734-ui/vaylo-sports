// Pins the scheduled launch sequence — the countdown emails and the launch-day
// message.
//
// This is the part of the product that mails the whole list without anybody
// present, so the failures worth testing for are not "does the copy read well"
// but:
//
//   * can someone other than the operator trigger a send? (auth)
//   * can one person be mailed the same campaign twice? (the ledger)
//   * can a "one week to go" message go out after launch day? (staleness)
//   * can a campaign go out without a way off the list? (the footer)
//
// As with waitlist.test.ts these assert the source — the migration, the edge
// function, the config — because there is no live database in the test run. The
// behaviour itself was exercised against the deployed project: the RPCs were
// called directly, and the full cron -> pg_net -> function -> SMTP path was run
// end to end. That exercise is what these tests stop from regressing silently.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

/** SQL with `--` comments stripped, for assertions about clauses not prose. */
const sql = (p: string) =>
  read(p)
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const MIGRATION = "/supabase/migrations/20261004170000_waitlist_campaigns.sql";
const FN = "/supabase/functions/waitlist-campaigns/index.ts";
const CONFIG = "/supabase/config.toml";

describe("waitlist campaigns — access control", () => {
  const body = read(MIGRATION);

  it("denies both campaign tables to anon and authenticated", () => {
    // waitlist_campaign_sends is a list of who was mailed, keyed by address:
    // a read grant would be the same disclosure as reading the signup list.
    expect(body).toMatch(/alter table public\.waitlist_campaigns enable row level security/);
    expect(body).toMatch(/alter table public\.waitlist_campaign_sends enable row level security/);
    expect(body).toMatch(/create policy "waitlist_campaigns_denied"[\s\S]*?using \(false\)/);
    expect(body).toMatch(/create policy "waitlist_campaign_sends_denied"[\s\S]*?using \(false\)/);
  });

  it("grants the tables and the RPCs to service_role only", () => {
    const clauses = sql(MIGRATION);
    expect(clauses).toMatch(/grant all on public\.waitlist_campaigns to service_role/);
    expect(clauses).toMatch(/grant all on public\.waitlist_campaign_sends to service_role/);
    expect(clauses).not.toMatch(/grant[^;]*to anon/i);
    expect(clauses).not.toMatch(/grant[^;]*to authenticated/i);
    // The recipient RPC names who has not yet been mailed, so it must not be
    // reachable by the two client roles even by name.
    expect(clauses).toMatch(
      /revoke all on function public\.waitlist_campaign_recipients\(text, integer\) from public, anon, authenticated/,
    );
    expect(clauses).toMatch(
      /grant execute on function public\.waitlist_campaign_recipients\(text, integer\) to service_role/,
    );
  });

  it("requires the cron secret on the function, not a session", () => {
    // verify_jwt is off because the caller is pg_cron, which holds no JWT. That
    // makes the shared secret the whole gate, so it must actually be checked,
    // and the comparison must not be a plain early-exit ===.
    expect(read(CONFIG)).toMatch(/\[functions\.waitlist-campaigns\]\nverify_jwt = false/);
    const f = read(FN);
    expect(f).toMatch(/x-cron-secret/);
    expect(f).toMatch(/constantTimeEqual/);
    expect(f).toMatch(/return json\(\{ error: "forbidden" \}, 403\)/);
  });
});

describe("waitlist campaigns — the schedule", () => {
  it("enables the scheduler and registers a daily job", () => {
    const body = read(MIGRATION);
    expect(body).toMatch(/create extension if not exists pg_cron/);
    expect(body).toMatch(/create extension if not exists pg_net/);
    expect(body).toMatch(
      /cron\.schedule\(\s*'waitlist-campaigns-daily',\s*'0 9 \* \* \*',/,
    );
  });

  it("keeps the credential out of the cron job", () => {
    // A service-role key pasted into a cron command would sit in plain text in
    // cron.job for anyone who can read that table.
    const body = read(MIGRATION);
    expect(body).toMatch(/from vault\.decrypted_secrets/);
    expect(body).toMatch(/name = 'waitlist_cron_secret'/);
    expect(body).toMatch(/net\.http_post/);
    expect(body).not.toMatch(/service_role_key/i);
  });

  it("sends the four dated messages in the right order", () => {
    const f = read(FN);
    const dates = [...f.matchAll(/sendAt: "(\d{4}-\d{2}-\d{2})T/g)].map((m) => m[1]);
    // The three countdowns, then the launch — the launch date is a named
    // constant so the copy and the schedule cannot disagree about it.
    expect(dates).toEqual(["2026-12-02", "2026-12-25", "2026-12-31"]);
    expect(f).toMatch(/const LAUNCH_AT = "2027-01-01T08:00:00Z"/);
    expect(f).toMatch(/sendAt: LAUNCH_AT,/);
  });

  it("refuses to send a stale countdown, but always sends the launch email", () => {
    // "One week to go" arriving after launch day is a false statement mailed to
    // the whole list; the launch email cannot go stale, so it never skips.
    const f = read(FN);
    expect(f).toMatch(/skipIfLateDays: 3/);
    expect(f).toMatch(/skipIfLateDays: 2/);
    expect(f).toMatch(/skipIfLateDays: 1/);
    expect(f).toMatch(/key: "launch",[\s\S]*?skipIfLateDays: null/);
    expect(f).toMatch(/lateBy > def\.skipIfLateDays/);
    expect(f).toMatch(/status: "skipped"/);
  });

  it("sends at most one campaign per run, so the order cannot invert", () => {
    const f = read(FN);
    // The loop picks one campaign and stops; without the break a late run would
    // fire several countdowns at once, out of order.
    expect(f).toMatch(/chosen = def;\s*break;/);
  });

  it("the site and the emails agree on one launch date", () => {
    // Two copies of the date that can drift is how a page ends up saying "no
    // date" while the emails count down to one.
    expect(read(FN)).toMatch(/1 January 2027/);
    expect(read("/site/pages/waitlist.mjs")).toMatch(/1 January 2027/);
    expect(read("/supabase/functions/_shared/email.ts")).toMatch(/1 January 2027/);
    expect(read("/legal/waitlist-terms.html")).toMatch(/1 January 2027/);
  });
});

describe("waitlist campaigns — exactly-once and safety", () => {
  const body = read(MIGRATION);

  it("claims a recipient before sending, so a retry cannot double-send", () => {
    // The ledger is a primary key, not a function's memory: SMTP can fail or be
    // cut off, and the only safe place for "already sent" is the database.
    expect(body).toMatch(/primary key \(campaign_key, email\)/);
    expect(body).toMatch(/on conflict \(campaign_key, email\) do update/);
    // A 'sent' row is never reclaimed; only a stale 'claimed' one is.
    expect(body).toMatch(
      /where public\.waitlist_campaign_sends\.status = 'claimed'[\s\S]*?claimed_at < now\(\) - interval '1 hour'/,
    );
  });

  it("excludes anyone who has left, and anyone who already has this campaign", () => {
    expect(body).toMatch(
      /where s\.unsubscribed_at is null[\s\S]*?from public\.waitlist_campaign_sends c[\s\S]*?c\.campaign_key = p_campaign_key[\s\S]*?c\.email = s\.email/,
    );
  });

  it("gives a claim back on failure, so a failure is retried not recorded as sent", () => {
    const f = read(FN);
    expect(f).toMatch(/catch \(failure\) \{[\s\S]*?waitlist_release_campaign_send/);
    // Only 'claimed' rows are released — a sent row is never deleted.
    expect(body).toMatch(
      /delete from public\.waitlist_campaign_sends[\s\S]*?and status = 'claimed'/,
    );
  });

  it("never sends without a working way off the list", () => {
    // The footer supplies the per-recipient unsubscribe link; a campaign body
    // cannot be sent without it.
    const f = read(FN);
    expect(f).toMatch(/withFooter\(def\.html, def\.text, row\.unsubscribe_token\)/);
    expect(f).toMatch(/unsubscribeUrl: footer\.link \|\| undefined/);
  });

  it("replies before it sends, so the trigger is never held open on SMTP", () => {
    const f = read(FN);
    expect(f).toMatch(/function background\(/);
    expect(f).toMatch(/EdgeRuntime/);
    expect(f).toMatch(/background\(async \(\) => \{/);
    expect(f).toMatch(/message: "sending in background"/);
  });

  it("is POST only, so a crawler cannot trigger the sequence", () => {
    expect(read(FN)).toMatch(
      /if \(req\.method !== "POST"\) return json\(\{ error: "method_not_allowed" \}, 405\)/,
    );
  });
});
