// Pins the public waiting list.
//
// The waiting list is the only thing in this project that accepts input from
// anyone on the internet without an account, which makes it the most
// abuseable surface here and the one most likely to be quietly loosened later:
// an "everyone can read the signups" grant looks helpful right up until it is
// a list of strangers' addresses.
//
// These assert the MIGRATION and FUNCTION SOURCE, the same pattern as
// dbSecurityMigration.test.ts. The live behaviour was not exercised against a
// deployed database — see the note at the end.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(path.resolve(__dirname, "../.." + p), "utf8").replace(/\r\n?/g, "\n");

/**
 * The same file with SQL/JS comments removed.
 *
 * Several assertions below are about what the code does — "no grant to anon",
 * "no mail provider". Run against the raw file they also match the comments
 * that explain those very rules, which is both a false failure and a way for
 * the rule to be deleted while the explanation of it stays.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const MIGRATION = "/supabase/migrations/20261004130000_waitlist_signups.sql";
const FN = "/supabase/functions/waitlist-signup/index.ts";
const SITE_JS = "/site/assets/site.js";
const PARTS = "/site/parts.mjs";
const GEN = "/scripts/gen-website.cjs";

describe("waitlist_signups — access control", () => {
  const sql = read(MIGRATION);

  it("denies every read to anon and authenticated", () => {
    // A list of people's email addresses is not public data. There is no
    // "own row" version of this table, because a visitor to the waiting list
    // has no account to own a row with.
    expect(sql).toMatch(/alter table public\.waitlist_signups enable row level security/);
    expect(sql).toMatch(
      /create policy "waitlist_signups_select_denied"[\s\S]*?for select[\s\S]*?using \(false\)/
    );
    expect(sql).toMatch(/create policy "waitlist_signups_insert_denied"/);
    expect(sql).toMatch(/create policy "waitlist_signups_update_denied"/);
    expect(sql).toMatch(/create policy "waitlist_signups_delete_denied"/);
  });

  it("grants nothing to anon or authenticated — the deny policies are the second lock", () => {
    const sqlCode = code(MIGRATION);
    expect(sqlCode).not.toMatch(/grant[^;]*to anon/i);
    expect(sqlCode).not.toMatch(/grant[^;]*to authenticated/i);
    expect(sqlCode).toMatch(/grant all on public\.waitlist_signups to service_role/);
  });

  it("no client insert, so validation and rate limiting cannot be bypassed", () => {
    // Otherwise anybody with the publishable key — which ships in the app —
    // writes straight to the table with PostgREST.
    expect(sql).toMatch(/with check \(false\)/);
    const f = read(FN);
    expect(f).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("has no self-service removal, because that would be an enumeration oracle", () => {
    // Kept as a soft column rather than a DELETE so the removal is auditable.
    expect(sql).toMatch(/unsubscribed_at timestamptz/);
  });
});

describe("waitlist_signups — data integrity", () => {
  const sql = read(MIGRATION);

  it("the email is unique, so a double click is one person", () => {
    expect(sql).toMatch(/email\s+text\s+not null unique/);
  });

  it("source is a closed set", () => {
    expect(sql).toMatch(/check \(source in \('web', 'home', 'play', 'share', 'qr'\)\)/);
    const f = read(FN);
    // An unknown source is coerced rather than rejected, but only ever to a
    // value inside that set.
    expect(f).toMatch(/const SOURCES = \["web", "home", "play", "share", "qr"\] as const/);
    expect(f).toMatch(/SOURCES\.includes\(sourceRaw as Source\)/);
  });

  it("length limits exist, matching what the function accepts", () => {
    expect(sql).toMatch(/check \(char_length\(email\) between 3 and 320\)/);
    expect(sql).toMatch(/check \(display_name is null or char_length\(display_name\) <= 120\)/);
    const f = read(FN);
    expect(f).toMatch(/clean\(payload\.email, 320\)/);
    expect(f).toMatch(/clean\(payload\.display_name, 120\)/);
  });

  it("indexes what the rate limit actually queries", () => {
    expect(sql).toMatch(
      /create index if not exists waitlist_signups_ip_recent_idx[\s\S]*?ip_hash, created_at desc/
    );
  });
});

describe("waitlist-signup — endpoint behaviour", () => {
  const f = read(FN);

  it("never confirms whether an address is already registered", () => {
    // "You are already on the list" turns this into an oracle for whether a
    // given person has a Vaylo account, and for whether they signed up.
    expect(f).toMatch(/const ACCEPTED = \{[\s\S]*?ok: true,[\s\S]*?message: "You are on the list\."/);
    expect(f).toMatch(/onConflict: "email", ignoreDuplicates: true/);
    for (const leak of ["already", "position", "queue", "total"]) {
      expect(f, `response wording leaks "${leak}"`).not.toMatch(new RegExp(`message: "[^"]*${leak}`, "i"));
    }
  });

  it("rate limits durably rather than in the isolate's memory", () => {
    // Supabase runs several instances per function and recycles them, so an
    // in-memory counter resets constantly and is not shared between them.
    expect(f).toMatch(/const RATE_LIMIT = 5/);
    expect(f).toMatch(/\.from\("waitlist_signups"\)[\s\S]*?select\("id", \{ count: "exact", head: true \}\)/);
    expect(f).toMatch(/\.eq\("ip_hash", ipHash\)/);
    expect(f).toMatch(/count \?\? 0\) >= RATE_LIMIT/);
  });

  it("drops honeypot submissions while answering exactly as a success would", () => {
    // A rejected bot that gets an error learns the trap exists and stops
    // tripping it.
    expect(f).toMatch(/payload\.company_website[\s\S]*?return json\(ACCEPTED\)/);
  });

  it("posts the client IP as a salted hash, never in the clear", () => {
    expect(f).toMatch(/WAITLIST_IP_SALT/);
    expect(f).toMatch(/crypto\.subtle\.digest\("SHA-256"/);
    expect(f).not.toMatch(/ip:\s*clientIp/);
  });

  it("sends a confirmation only for a genuinely new signup", () => {
    // This test used to assert the exact opposite — that no mail code existed
    // in this function at all, because no provider was wired up. There is one
    // now, so what is worth protecting changed from "does not mail" to "cannot
    // mail twice, and cannot mail by accident".
    //
    // The mechanism is the `.select()` on the upsert. With ignoreDuplicates a
    // repeat address collides and returns no rows, so `inserted` is empty and
    // no confirmation is sent. Asserting only that sendMail is called would
    // still pass with that guard deleted, which is why the guard itself is what
    // is asserted here.
    const fCode = code(FN);
    expect(fCode).toMatch(/ignoreDuplicates: true[\s\S]*?\.select\("email, display_name, unsubscribe_token"\)/);
    expect(fCode).toMatch(/const created = inserted\?\.\[0\]/);
    expect(fCode).toMatch(/if \(created\) \{[\s\S]*?sendMail\(confirmationMail\(created\)\)/);
  });

  it("sends through Google, not a third-party email API", () => {
    // A gmail.com sender cannot go through Resend/SendGrid/Postmark/Mailgun:
    // the From domain publishes a strict DMARC policy, so anything not sent by
    // Google fails alignment and is rejected or junked. Google's own SMTP is
    // the only correct route, which is why no provider SDK appears here.
    const fCode = code(FN);
    expect(fCode).not.toMatch(/resend|sendgrid|postmark|mailgun/i);
  });

  it("sends the confirmation after replying, so a mail failure cannot fail the signup", () => {
    // By the time this runs the row is stored. Holding the request open on a
    // slow SMTP conversation would turn a successful signup into a timeout the
    // person answers by submitting again.
    const fCode = code(FN);
    expect(fCode).toMatch(/function background\(/);
    expect(fCode).toMatch(/EdgeRuntime/);
    expect(fCode).toMatch(/background\(async \(\) => \{/);
    expect(fCode).toMatch(/confirmation_sent_at/);
  });

  it("never echoes the database error back to the caller", () => {
    // A raw Postgres message can name the constraint and the column, which is a
    // free map of the table.
    expect(f).toMatch(/console\.error\("waitlist insert failed", error\.code\)/);
    expect(f).not.toMatch(/error\.message/);
  });
});

describe("waiting list — site wiring", () => {
  it("the form posts to its own endpoint, not to the support function", () => {
    const gen = read(GEN);
    expect(gen).toMatch(/functions\/v1\/waitlist-signup/);
    expect(gen).toMatch(/waitlistEndpoint:/);
    expect(read(PARTS)).toMatch(/data-vaylo-form="waitlist"/);
  });

  it("the page is reachable from the navigation", () => {
    expect(read("/site/data/site.mjs")).toMatch(/href: "\/waitlist\/"/);
    expect(read("/site/pages/waitlist.mjs")).toMatch(/path: "\/waitlist\/"/);
  });

  it("an unconfigured endpoint disables the form and says why, like every other form", () => {
    const js = read(SITE_JS);
    // Each form kind resolves to its own endpoint, and this assertion was
    // widened on 2026-10-07 when the sponsorship questionnaire added a third
    // kind. The old form pinned one two-way ternary — an implementation detail
    // that had to change — so it is replaced by the mapping that actually
    // matters: a kind must never borrow another kind's endpoint. Posting a
    // brand enquiry into the support queue would file it in the wrong inbox,
    // and posting a waiting-list signup there would apply the wrong rate limit.
    expect(js).toMatch(/config\.waitlistEndpoint/);
    expect(js).toMatch(/isWaitlist\s*\? config\.waitlistEndpoint/);
    expect(js).toMatch(/isSponsor\s*\? config\.sponsorEndpoint/);
    expect(js).toMatch(/config\.supportEndpoint/);
    // A form with no endpoint must disable itself rather than pretend — for
    // every kind, not just the waiting list.
    expect(js).toMatch(/data-unavailable/);
    expect(js).toMatch(/The waiting list is not available yet/);
    expect(js).toMatch(/The sponsor questionnaire is not available yet/);
  });

  it("never shows success the server did not confirm", () => {
    const js = read(SITE_JS);
    // The only 2xx path clears the form, for both kinds.
    expect(js).toMatch(/The connection failed before we could/);
    expect(js).toMatch(/your address has not been stored/);
  });

  it("describes the emails you actually get, and the one date the page gives", () => {
    // This assertion has changed twice, and each change tracked a real change in
    // behaviour rather than wording being bent to keep it green. It first pinned
    // the page to "no mailing system is connected" (true then, false now). Then
    // it pinned the page to "may promise mail, must not promise a date". Now the
    // release date — 1 January 2027 — is announced, so the property worth
    // protecting is different again: the page must name the date it is counting
    // down to, must say what will actually arrive, and must not go back to
    // claiming there is no date at all (which would now contradict the emails).
    const page = read("/site/pages/waitlist.mjs");
    expect(page).toMatch(/confirmation goes out as soon as you join/);
    expect(page).toMatch(/Every email carries a link that removes you/);
    expect(page).toMatch(/1 January 2027/);
    expect(page).toMatch(/short run of updates/);
    expect(page).not.toMatch(/no mailing system/);
    expect(page).not.toMatch(/no release date/);
    expect(page).not.toMatch(/no date we are willing to promise/);
    expect(page).not.toMatch(/you will be notified/i);
  });

  it("offers a real removal route instead of a self-service button", () => {
    const page = read("/site/pages/waitlist.mjs");
    expect(page).toMatch(/href="\/contact\/"/);
    expect(page).toMatch(/href="\/legal\/data-rights\/"/);
  });
});

// The behavioural tests for these properties — honeypot silently accepted, a
// repeat address producing an identical body, the rate limit tripping on the
// sixth signup in an hour — need a deployed database and a deployed function.
// They have NOT been run. Until they are, the guarantees above are guarantees
// about the source, not about a live endpoint.