// ============================================================================
// SAFETY & COMPLIANCE REGRESSION
// ----------------------------------------------------------------------------
// Guards the controls added for docs/LEGAL-COMPLIANCE-AUDIT.md. Each test is a
// way the compliance position can silently regress — an age gate that stops
// being enforced, a right that becomes unreachable, a table that leaves the
// deletion/export registry.
//
// These are deliberately assertions about the SHIPPED ARTEFACTS (SQL, TSX,
// generated legal pages) rather than about runtime behaviour, because that is
// what can be checked in CI. A behavioural test for "reporting works" needs a
// database; a test that the RPC exists, is validated, and is reachable is not.
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

const migrationsDir = join(root, "supabase", "migrations");
const allMigrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
  .join("\n");

const safetyMigration = read(
  "supabase",
  "migrations",
  "20261001120000_safety_reporting_and_privacy_defaults.sql",
);

describe("P0-1 content reporting", () => {
  it("has a content_reports table with RLS enabled", () => {
    expect(safetyMigration).toContain("create table if not exists public.content_reports");
    expect(safetyMigration).toMatch(
      /alter table public\.content_reports enable row level security/i,
    );
  });

  it("never lets anon read or write reports", () => {
    expect(safetyMigration).toMatch(/revoke all on public\.content_reports from anon/i);
    // A reporter sees only their own rows; there must be no blanket SELECT.
    expect(safetyMigration).not.toMatch(/on public\.content_reports for select[\s\S]{0,200}using \(true\)/i);
  });

  it("withholds update and delete from the client so status cannot be self-set", () => {
    expect(safetyMigration).toMatch(
      /grant select, insert on public\.content_reports to authenticated/i,
    );
    expect(safetyMigration).not.toMatch(/grant update[^\n]*content_reports/i);
    expect(safetyMigration).not.toMatch(/grant delete[^\n]*content_reports/i);
  });

  it("validates the reason enum server-side", () => {
    // A closed enum in the function AND a CHECK on the column: either alone
    // would do, and both means a bad value cannot arrive by either route.
    expect(safetyMigration).toMatch(/p_reason not in \(/);
    expect(safetyMigration).toMatch(/check \(reason in \(/);
  });

  it("rate-limits and de-duplicates reports from one athlete", () => {
    expect(safetyMigration).toMatch(/v_recent >= 10/);
    expect(safetyMigration).toMatch(
      /create unique index if not exists content_reports_one_per_target/i,
    );
  });

  it("exposes a report control in the app", () => {
    expect(read("src/components/safety/ReportMenu.tsx")).toContain("REPORT_REASONS");
    // Wired into the surface where another athlete's content is visible.
    // The activity feed carried the second one until it was removed on
    // 2026-10-08; a report control on a page that no longer exists was a pin
    // over nothing, so the assertion went with the page rather than the
    // control, which PublicProfile still ships.
    expect(read("src/pages/PublicProfile.tsx")).toContain("<ReportMenu");
  });
});

describe("P0-2 blocking reaches the feed", () => {
  it("filters blocked athletes server-side, not in the client", () => {
    expect(safetyMigration).toMatch(/create view public\.feed_visible_activities/i);
    expect(safetyMigration).toMatch(/security_invoker = true/i);
    // The feed must read the view. A client-side filter would still ship the
    // blocked athlete's rows to the device.
    const feed = read("src/lib/activitySharing.ts");
    expect(feed).toContain('from("feed_visible_activities")');
    expect(feed).not.toContain('from("shared_activities")\n    .select("*")\n    .order("shared_at"');
  });

  it("excludes BOTH directions of a block", () => {
    expect(safetyMigration).toMatch(/b\.blocker_id = s\.user_id and b\.blocked_id = auth\.uid\(\)/);
    expect(safetyMigration).toMatch(/b\.blocker_id = auth\.uid\(\) and b\.blocked_id = s\.user_id/);
  });

  it("is reachable from the interface", () => {
    expect(read("src/components/safety/ReportMenu.tsx")).toContain("blockUser");
  });
});

describe("P0-3 privacy defaults are private", () => {
  it("defaults new athletes to private with a hidden avatar", () => {
    // The column is group_visibility, not "privacy" — the schema has never had
    // a column called privacy, and asserting on one let a broken migration pass.
    expect(safetyMigration).toMatch(/alter column group_visibility set default 'private'/i);
    expect(safetyMigration).toMatch(/alter column show_avatar_publicly set default false/i);
  });

  it("does not reference a privacy column that does not exist", () => {
    expect(safetyMigration).not.toMatch(/alter column privacy set default/i);
    expect(safetyMigration).not.toMatch(/new\.privacy :=/);
  });

  it("forces the private default for anyone under 18, server-side", () => {
    // Children's Code std 12. The client must not be able to opt a minor out.
    expect(safetyMigration).toMatch(/create or replace function public\.enforce_minor_privacy_defaults/i);
    expect(safetyMigration).toMatch(/interval '18 years'/);
    expect(safetyMigration).toMatch(/new\.group_visibility := 'private'/);
    expect(safetyMigration).toMatch(/new\.show_avatar_publicly := false/);
  });

  it("backfills existing athletes rather than only future signups", () => {
    // Every pre-existing account had no privacy_settings row, so every read fell
    // through to the permissive default. The trigger alone does not fix that.
    expect(safetyMigration).toMatch(
      /insert into public\.privacy_settings[\s\S]{0,200}select p\.user_id, 'private', false/i,
    );
  });
});

describe("P0-4 data portability", () => {
  it("has an export function that authenticates the caller", () => {
    const fn = read("supabase", "functions", "export-my-data", "index.ts");
    expect(fn).toContain("admin.auth.getUser(token)");
    // The user id must never be a client-supplied parameter.
    expect(fn).not.toMatch(/p_user_id/);
  });

  it("shares one table registry with account deletion", () => {
    const registry = read("supabase", "functions", "_shared", "userTables.ts");
    const deletion = read("supabase", "functions", "delete-account", "index.ts");
    const exportFn = read("supabase", "functions", "export-my-data", "index.ts");
    expect(deletion).toContain('from "../_shared/userTables.ts"');
    expect(exportFn).toContain('from "../_shared/userTables.ts"');
    expect(registry).toContain("export const USER_TABLES");
  });

  it("covers the tables that deletion already covered, plus the new ones", () => {
    const registry = read("supabase", "functions", "_shared", "userTables.ts");
    for (const t of [
      "profiles", "shared_activities", "activity_hypes", "coach_messages",
      "video_form_analyses", "user_blocks", "content_reports", "privacy_settings",
    ]) {
      expect(registry, `${t} missing from the registry`).toContain(`"${t}"`);
    }
  });

  it("reports a partial export rather than claiming completeness", () => {
    const fn = read("supabase", "functions", "export-my-data", "index.ts");
    expect(fn).toContain("unreadable");
    expect(fn).toContain("complete: false");
  });

  it("is reachable in the app", () => {
    expect(read("src/pages/Legal.tsx")).toContain("requestMyData");
  });
});

describe("P0-5 legal and safety surfaces", () => {
  it("routes to the legal centre and safety pages", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/legal"');
    expect(app).toContain('path="/safety"');
  });

  it("links the legal centre from Profile", () => {
    expect(read("src/pages/Profile.tsx")).toContain('navigate("/legal")');
  });

  it("states the AI and health limits in the app, not only in the Terms", () => {
    const safety = read("src/pages/Safety.tsx");
    expect(safety).toMatch(/not a doctor|not medical advice/i);
    expect(safety).toMatch(/can be wrong/i);
    expect(safety).toContain("Community Guidelines");
  });

  it("publishes community guidelines in the Terms as well as in the app", () => {
    const terms = read("legal/terms.html");
    expect(terms).toMatch(/community guidelines/i);
    expect(terms).toMatch(/Report<\/strong> control|report content/i);
  });
});

describe("P0-6 promotional surfaces are adult-only", () => {
  it("keeps the promotional surfaces adult-only while buying itself is open", () => {
    // Changed deliberately on 2026-10-04: the owner opened purchasing to
    // under-18 accounts, with an unconditional refund on request for any
    // purchase made on one (legal/purchases.html section 8, legal/refunds.html
    // section 4). What must NOT open is the promotion — a discount offer, a
    // "double credits" push, a pick-for-you recommendation. Children's Code
    // standard 37 is about nudging a young athlete to spend, and a listed price
    // is not a nudge, so the two are now separated instead of sharing one gate.
    const market = read("src/pages/Market.tsx");
// Purchasing itself is open to all ages, so all four promo gates read the
    // same age helper as the dashboard banner. Unknown DOB is still "not adult"
    // — that branch now only hides MERCHANT promotion, never the transaction.
    expect(market).toContain('ageBand(profile?.date_of_birth) === "adult"');
    // Unknown age must still count as NOT adult, matching the sponsored rule.
    expect(market, "the starter-offer promo is no longer adult-only").toMatch(/isAdult && starterOffer/);
    expect(market, "the double-credits promo is no longer adult-only").toMatch(/isAdult && doubleOffer/);
    // The banner now also shows in the unlocks section, not only packs — but
    // the property that matters is the age gate, not the section list. Assert
    // the gate on the expression that renders it rather than pinning sections.
    {
      const at = market.indexOf("<FamilyPickBanner");
      expect(at, "Market.tsx no longer renders FamilyPickBanner").toBeGreaterThan(-1);
      const gate = market.slice(market.lastIndexOf("{", at), at);
      expect(gate, "the recommendation banner is no longer adult-only").toMatch(/isAdult/);
    }
    // The buying controls must NOT be age-gated any more.
    expect(market, "the buying sections are age-gated again").not.toContain("canPurchase");
    expect(market, "the under-18 buying note is missing").toContain("GuardianNote");
  });

  it("keeps the dashboard priced offer open to every age while merchant promos stay adult-only", () => {
    const card = read("src/components/dashboard/StarterOfferCard.tsx");
    // Renamed 2026-10-06: this test never asserted a child's offer was hidden.
    // It asserts the opposite, and that is deliberate. Changed 2026-10-04, the
    // owner opened purchasing to under-18 accounts with an unconditional refund
    // on request for any purchase made on one (legal/purchases.html section 8,
    // legal/refunds.html section 4). The dashboard Welcome Bundle is therefore
    // open to every age: it is a priced item, not a nudge. Children's Code
    // standard 37 is about pushing a young athlete to spend, and a listed price
    // is not a push, so it is separated from MERCHANT promotion (a discount, a
    // "double credits" push, a pick-for-you banner) which stays adult-only.
    // The sibling test above pins that merchant split in Market.tsx.
    expect(card).not.toMatch(/if \(!isAdult/);
    expect(card).not.toContain('ageBand(profile?.date_of_birth) === "adult"');
    // The card must still be reachable at all — a rename must not leave a
    // component nobody renders, which would make this test protect nothing.
    expect(card).toContain("export default StarterOfferCard");
    const index = read("src/pages/Index.tsx");
    expect(index).toContain("import StarterOfferCard from");
    expect(index).toContain("<StarterOfferCard />");
  });

  it("treats unknown date of birth as a minor everywhere", () => {
    // The 18+ sponsored gate depends on this. src/lib/age.test.ts covers the
    // maths; this asserts the default has not been inverted.
    const age = read("src/lib/age.ts");
    expect(age).toMatch(/export const ADULT_AGE = 18/);
    expect(age).toMatch(/age === null \|\| age < ADULT_AGE|age !== null && age >= ADULT_AGE/);
  });
});

describe("P1-6 consent is recorded, not implied", () => {
  it("stores agreement timestamps on the profile", () => {
    expect(safetyMigration).toMatch(/add column if not exists terms_accepted_at/i);
    expect(safetyMigration).toMatch(/add column if not exists terms_version/i);
    expect(safetyMigration).toMatch(/add column if not exists health_consent_at/i);
  });

  it("actually WRITES them — columns with no writer are not consent records", () => {
    // This is the check that was missing. The columns existed and nothing
    // populated them, so a document claiming "we record when you accepted our
    // terms" would have been untrue.
    expect(read("src/lib/consent.ts")).toContain("terms_accepted_at");
    expect(read("src/lib/consent.ts")).toContain("health_consent_at");
    expect(read("src/pages/Auth.tsx")).toContain("recordTermsAcceptance()");
    // 2026-10-06 audit: guest sign-in was the only account-creation path that
    // never stamped the Terms version — a guest account is a real account, and
    // the Terms accept on account creation.
    expect(read("src/contexts/AuthContext.tsx")).toContain("recordTermsAcceptance()");
    expect(read("src/pages/Recovery.tsx")).toContain("recordHealthConsent()");
  });

  it("never blocks the user on a consent write, and never overwrites", () => {
    const consent = read("src/lib/consent.ts");
    expect(consent).toMatch(/catch/);
    // health consent is set only once, so it cannot be silently refreshed
    expect(consent).toContain('.is("health_consent_at", null)');
  });
});

describe("no invented operator details", () => {
  it("publishes no company number, address or DPO that we do not have", () => {
    const operator = JSON.parse(read("legal", "operator.json"));
    // The registry only ever held a name and an inbox. If a fake registered
    // company or ICO number appears here, it is a fabrication.
    expect(Object.keys(operator).sort()).toEqual(["contactEmail", "operatorName"]);
  });

  it("keeps the honest gap disclosures in the policies, not on the app's landing screen", () => {
    // Changed 2026-10-11 (owner request): the Legal centre no longer renders a
    // "what we have not published yet" list. The disclosure itself is not
    // retracted — it stays in the documents a reader opens for it, because that
    // is where a missing company number or retention window belongs. This test
    // now pins both halves: the documents still say what is missing, and the
    // landing screen no longer shows the operator's to-do list as if it were a
    // user-facing notice.
    const privacy = read("legal/privacy.html");
    expect(privacy, "the privacy policy dropped its retention disclosure").toMatch(/not published|not yet/i);
    const dataRights = read("legal/data-rights.html");
    expect(dataRights, "the data-rights page dropped its retention disclosure").toMatch(/not published|not yet/i);
    expect(read("src/pages/Legal.tsx"), "the unpublished-particulars list is back").not.toMatch(
      /What we have not published yet<\/h2>/i,
    );
  });

  it("adds no personal-data column to solve a legal problem", () => {
    // The only new profile columns are timestamps recording agreement. If
    // someone adds address, phone or a tracking identifier, this fails.
    const added = safetyMigration.match(/add column if not exists (\w+)/g) ?? [];
    expect(added.sort()).toEqual([
      "add column if not exists health_consent_at",
      "add column if not exists terms_accepted_at",
      "add column if not exists terms_version",
    ]);
  });
});

describe("row-scoped reads on three formerly world-readable tables", () => {
  const rowScoped = read(
    "supabase",
    "migrations",
    "20261003211500_row_scoped_reads_three_tables.sql",
  );

  // readdir order is not guaranteed chronological, so order by filename: the
  // "last policy wins" assertions below must read history in apply order.
  const chronological = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n");

  // The last SELECT policy created for a table is the one that survives (the
  // migration drops the old blanket one first). If a later migration re-opens
  // any of these tables to every signed-in user, this pins the regression.
  const lastSelectPolicy = (table: string) => {
    const re = new RegExp(
      `create policy "([^"]+)" on public\\.${table}\\s+for select`,
      "gis",
    );
    let name: string | null = null;
    for (const m of chronological.matchAll(re)) name = m[1];
    return name;
  };

  it("each table's surviving SELECT policy is own-row, not blanket", () => {
    expect(lastSelectPolicy("referral_codes")).toBe("Own code readable");
    expect(lastSelectPolicy("privacy_settings")).toBe("Own privacy readable");
    expect(lastSelectPolicy("user_region")).toBe("Own region readable");
  });

  it("scopes each own-row policy to auth.uid()", () => {
    expect(rowScoped).toMatch(
      /using \(\(select auth\.uid\(\)\) = user_id\)/i,
    );
    // All three own-row policies are created by this one migration.
    for (const name of ["Own code readable", "Own privacy readable", "Own region readable"]) {
      expect(rowScoped).toContain(`create policy "${name}"`);
    }
  });

  it("hands peers only the columns three screens consume, via definer fns", () => {
    expect(rowScoped).toMatch(/security definer/i);
    // privacy: Communities needs allow_friend_requests, PublicProfile needs
    // show_avatar_publicly — and nothing else leaves the table.
    expect(rowScoped).toMatch(
      /select s\.allow_friend_requests, s\.show_avatar_publicly[\s\S]{0,120}from public\.privacy_settings/,
    );
    // regions: Leaderboards need exactly user_id + country; currency and
    // detected_at must not travel to peers.
    expect(rowScoped).toMatch(
      /select r\.user_id, r\.country[\s\S]{0,120}from public\.user_region/,
    );
  });

  it("withholds the definer helpers from anon and public", () => {
    for (const sig of ["peer_privacy\\(uuid\\)", "peer_regions\\(uuid\\[\\]\\)"]) {
      expect(rowScoped).toMatch(new RegExp(`revoke all on function public\\.${sig} from public, anon`));
      expect(rowScoped).toMatch(new RegExp(`grant execute on function public\\.${sig} to authenticated`));
    }
  });

  it("keeps referral redemption independent of the row policy", () => {
    // redeem_referral is SECURITY DEFINER and reads referral_codes itself, so
    // shrinking the SELECT policy must not break claiming a code.
    const referralMigration = read(
      "supabase",
      "migrations",
      "20260922090000_entitlement_and_referral_fixes.sql",
    );
    expect(referralMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.redeem_referral\(p_code text\)[\s\S]{0,120}SECURITY DEFINER/i,
    );
    // and the row-scoped migration must not have revoked or dropped it.
    expect(rowScoped).not.toMatch(/revoke[^\n]*redeem_referral/i);
    expect(rowScoped).not.toMatch(/drop (function|policy)[^\n]*redeem_referral/i);
  });
});

describe("the registry stays honest", () => {
  it("every registry table exists in the schema", () => {
    const registry = read("supabase", "functions", "_shared", "userTables.ts");
    const names = [...registry.matchAll(/^\s*\["([a-z_]+)",/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(80);
    for (const t of names) {
      // `feed_visible_activities` is a view created by this migration; every
      // other name must be a table the schema actually declares.
      if (t === "feed_visible_activities") continue;
      expect(allMigrations, `${t} is in the registry but not in any migration`).toContain(
        `public.${t}`,
      );
    }
  });
});
