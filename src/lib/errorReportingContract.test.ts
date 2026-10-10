// Guards the failure reporter's contract, most of which cannot be exercised
// from jsdom.
//
// Why a source-level test and not a behavioural one: the parts that matter most
// here live outside the app's runtime. The RLS posture, the revoked EXECUTE on a
// function that writes without a user, the `verify_jwt = false` declaration, and
// the promise that no third-party crash SDK is installed are all facts about
// files, and every one of them is the kind of thing that is deleted by a later
// edit that looks harmless and type-checks perfectly. `src/lib/errorReporting.test.ts`
// covers what the reporter actually does; this covers what it must never become.
//
// What this cannot do is verify the effect: it checks that the SQL says what it
// should say, not that Postgres accepts it. Applying the migration against a real
// database remains the check that proves it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(path.resolve(__dirname, "../..", file), "utf8").replace(/\r\n?/g, "\n");

const MIGRATION = "supabase/migrations/20261010120000_app_error_reports.sql";
const migration = read(MIGRATION);
const fn = read("supabase/functions/report-error/index.ts");
const config = read("supabase/config.toml");
const reporter = read("src/lib/errorReporting.ts");
const main = read("src/main.tsx");
const boundary = read("src/components/ErrorBoundary.tsx");
const screen = read("src/pages/AdminErrorReports.tsx");
const app = read("src/App.tsx");
const pkg = read("package.json");
const privacy = read("legal/privacy.html");
const register = read("docs/internal-compliance/33-processor-register.md");
const store = read("PLAY_STORE.md");

describe("no third-party crash service", () => {
  it("adds no crash-reporting SDK to the app or the endpoint", () => {
    // The published advertising and cookie documents promise there is no
    // analytics or error-reporting SDK. A crash reporter is the most tempting
    // way to break that promise, because adding one looks like a two-line diff.
    //
    // Checked at the import statements and at the dependency list — the two
    // places that actually install code — and not in prose, because these files
    // name Sentry deliberately to explain why it is not used.
    const VENDOR = /sentry|crashlytics|bugsnag|datadog|rollbar|honeybadger/i;
    for (const [name, source] of [
      ["errorReporting.ts", reporter],
      ["report-error/index.ts", fn],
    ] as const) {
      const imports = source.match(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?/gm) ?? [];
      expect(imports.length, `${name} has no imports at all — the check has broken`).toBeGreaterThan(0);
      for (const line of imports) {
        expect(line, `${name} imports a crash-reporting SDK`).not.toMatch(VENDOR);
      }
    }
    expect(pkg).not.toMatch(/"(?:@)?(sentry|bugsnag|datadog|rollbar|honeybadger|crashlytics)[^"]*"\s*:/i);
  });

  it("keeps the reports in the project's own backend, which is already a declared processor", () => {
    expect(migration).toContain("public.app_error_reports");
    expect(register).toMatch(/first-party failure report/i);
    expect(register).toMatch(/app_error_reports/);
    // The register's third-party row must still say this is absent, or the
    // document has drifted from the build in the other direction.
    expect(register).toMatch(/P8 \| \*\*Error\/analytics service \(third party\)\*\* \| Deliberately absent/);
  });

  it("still matches what the Privacy Policy tells a reader", () => {
    expect(privacy).toMatch(/the app itself sends us a short diagnostic\s+report/i);
    expect(privacy).toMatch(/no sign-in tokens/i);
    expect(store).toMatch(/Crash logs, diagnostics/);
  });
});

describe("report-error — exposed on purpose, and only able to do one small thing", () => {
  it("declares its JWT exemption in the repository rather than a deploy flag", () => {
    // A device that is signed out must be able to report — failures at sign-in
    // are exactly the kind that matter. And a flag passed at deploy time is
    // recorded nowhere, so a later redeploy silently turns every report into a
    // 401 nobody sees. This is the same lesson support-request learned.
    expect(config).toMatch(/\[functions\.report-error\]\nverify_jwt = false/);
  });

  it("accepts only POST, and only a size-capped JSON body", () => {
    expect(fn).toMatch(/if \(req\.method !== "POST"\)/);
    expect(fn).toMatch(/await readJsonBody\(req\)/);
  });

  it("refuses anything outside a closed set", () => {
    expect(fn).toMatch(/const SOURCES = \["error", "rejection", "react"\] as const;/);
    expect(fn).toMatch(/const PLATFORMS = \["native", "web"\] as const;/);
    expect(fn).toMatch(/if \(!source\) return json\(\{ error: "invalid_source" \}, 400\);/);
    expect(fn).toMatch(/if \(!platform\) return json\(\{ error: "invalid_platform" \}, 400\);/);
    expect(migration).toContain("check (platform in ('native', 'web'))");
  });

  it("derives the fingerprint itself and never takes one from the caller", () => {
    // A client that chose its own grouping could bury real errors under a shared
    // fingerprint, or scatter one bug across thousands of rows.
    expect(fn).toContain("p_fingerprint: report.fingerprint");
    expect(fn).toMatch(/fingerprint: await fingerprintFor\(/);
    expect(fn).not.toMatch(/payload\.fingerprint|payload\.app_fingerprint/);
  });

  it("normalizes ids out of the message before hashing, so one bug is one row", () => {
    expect(fn).toMatch(/\.replace\(\/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/);
    expect(fn).toMatch(/\.replace\(\/\\b\\d\{3,\}\\b\/g, "<n>"\)/);
  });

  it("caps every field it stores", () => {
    for (const cap of ["MAX_NAME", "MAX_MESSAGE", "MAX_STACK", "MAX_SCREEN", "MAX_VERSION", "MAX_UA"]) {
      expect(fn, `${cap} is missing`).toContain(`const ${cap} =`);
    }
    expect(fn).toMatch(/required\(payload\.name, MAX_NAME\)/);
    expect(fn).toMatch(/clean\(payload\.stack, MAX_STACK\)/);
  });

  it("throttles by client address without storing that address", () => {
    expect(fn).toMatch(/throttled\(`\$\{clientIp\(req\)\}\|report-error`\)/);
    expect(migration).not.toMatch(/ip_hash/);
  });

  it("writes with the service role through the atomic upsert", () => {
    expect(fn).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(fn).toMatch(/admin\.rpc\("record_app_error_report"/);
    expect(migration).toMatch(/on conflict on constraint app_error_reports_key do update/);
    expect(migration).toMatch(/occurrences\s+= r\.occurrences \+ 1/);
  });

  it("mails the operator only for a failure nobody has seen before", () => {
    // Forty testers hitting one bug is one bug, and forty emails is a queue
    // nobody reads. Repeats bump a counter instead.
    expect(fn).toMatch(/if \(row\?\.was_new\) await notifyOperator/);
    expect(fn).toMatch(/if \(!emailConfigured\(\)\) return false;/);
    // And a mail outage must cost a notification, never the report.
    expect(fn).toMatch(/catch \(error\) \{\n\s*\/\/ The report is already stored and counted/);
  });

  it("does not claim to catch native crashes", () => {
    expect(fn).toMatch(/never reaches JavaScript at all/);
    expect(screen).toMatch(/Android\s+vitals reports those/);
  });
});

describe("app_error_reports — nobody but the function writes, only admins read", () => {
  it("is the migration the admin screen names when a read is denied", () => {
    // The screen tells an operator which file to apply, so the two must agree.
    expect(screen).toContain("20261010120000_app_error_reports.sql");
    expect(MIGRATION).toContain("20261010120000_app_error_reports.sql");
  });

  it("enables RLS and denies every client write", () => {
    expect(migration).toMatch(/alter table public\.app_error_reports enable row level security;/);
    expect(migration).toMatch(/for insert\s+to anon, authenticated\s+with check \(false\);/);
    expect(migration).toMatch(/for delete\s+to anon, authenticated\s+using \(false\);/);
  });

  it("reads only through an admin policy, on top of an explicit alon deny", () => {
    expect(migration).toMatch(/for select\s+to anon\s+using \(false\);/);
    expect(migration).toMatch(
      /app_error_reports_admin_read[\s\S]*?to authenticated\s+using \(public\.has_role\(auth\.uid\(\), 'admin'\)\);/
    );
    expect(migration).toMatch(
      /app_error_reports_admin_update[\s\S]*?using \(public\.has_role\(auth\.uid\(\), 'admin'\)\)\s+with check \(public\.has_role\(auth\.uid\(\), 'admin'\)\);/
    );
  });

  it("grants reachability to signed-in users, because a policy without a grant is unreachable", () => {
    expect(migration).toMatch(/grant select, update on public\.app_error_reports to authenticated;/);
    expect(migration).toMatch(/grant all on public\.app_error_reports to service_role;/);
  });

  it("keys a row on fingerprint and build, so one bug cannot become a thousand rows", () => {
    expect(migration).toMatch(/constraint app_error_reports_key\s+unique \(fingerprint, app_version\)/);
    expect(migration).toMatch(/occurrences\s+integer\s+not null default 1/);
  });

  it("bounds what a row can hold", () => {
    expect(migration).toMatch(/char_length\(message\) between 1 and 1000/);
    expect(migration).toMatch(/char_length\(stack\) <= 4000/);
    expect(migration).toMatch(/char_length\(screen\) <= 200/);
    expect(migration).toMatch(/char_length\(user_agent\) <= 300/);
  });

  it("keeps the write function off the public RPC surface", () => {
    // Functions are executable by PUBLIC by default, which on PostgREST would
    // make this an open table insert for anyone holding the publishable key.
    expect(migration).toMatch(
      /revoke all on function public\.record_app_error_report\([\s\S]*?from public, anon, authenticated;/
    );
    expect(migration).toMatch(
      /grant execute on function public\.record_app_error_report\([\s\S]*?to service_role;/
    );
    // INVOKER, not DEFINER: it must not get its own privileged path around RLS.
    expect(migration).toMatch(/security invoker/);
    expect(migration).not.toMatch(/security definer/);
  });

  it("has no delete path for anyone, and no delete button on the screen", () => {
    expect(migration).not.toMatch(/for delete[\s\S]{0,80}has_role/);
    expect(screen).not.toMatch(/\.delete\(\)/);
    expect(screen).toMatch(/A failure that has been fixed[\s\S]{0,24}is evidence the fix was needed/);
  });

  it("never stores the client address, unlike the website forms", () => {
    expect(migration).not.toMatch(/ip_hash|inet|client_ip/);
  });

  it("carries no athlete identifier, so it is neither theirs to delete nor to export", () => {
    // A row here is a shared counter for a failure across every tester, not a row
    // belonging to one person. An account id on it would make the row personal
    // data of whoever reported it first, while leaving deletion and the Article
    // 20 export no honest answer — deleting the row would destroy other testers'
    // counts. So the report identifies the FAILURE and nothing else, which is
    // also why accountDeletionCoverage.test.ts needs no entry for this table:
    // the strongest form of "handled" is a table with no user-keyed column.
    expect(migration).not.toMatch(/references auth\.users/);
    expect(migration).not.toMatch(/\buser_id\b/);
    expect(fn).not.toMatch(/p_user_id|authenticate/);
    expect(reporter).not.toMatch(/user_id|userId/);
  });
});

describe("the reporter is wired into the failures that actually happen", () => {
  it("installs a global handler for uncaught errors, which nothing else caught", () => {
    // React render errors have the boundary and rejections had a handler in
    // main.tsx. An error thrown from an event handler or a plugin callback had
    // nothing, and in a WebView it vanished without even a toast.
    expect(main).toMatch(/installGlobalErrorReporting\(\)/);
    expect(reporter).toMatch(/window\.addEventListener\("error"/);
    expect(reporter).toMatch(/if \(!error && !message\) return;/);
  });

  it("reports rejections and render errors from where they are caught", () => {
    expect(main).toMatch(/installGlobalErrorReporting/);
    expect(main).toMatch(/source: "rejection"/);
    expect(boundary).toMatch(/reportError\(\{/);
    expect(boundary).toMatch(/source: "react"/);
  });

  it("never lets a render error become a rejection, or a report become an error", () => {
    expect(reporter).toMatch(/a reporter must never throw/);
    expect(reporter).toMatch(/if \(typeof window === "undefined"\) return false;/);
  });

  it("takes the build label from the installed app, not a second copy of the version", () => {
    // The number in the Play Console listing comes from the Android manifest.
    // A constant maintained in this repository would drift from it.
    expect(reporter).toMatch(/App\.getInfo\(\)/);
    // Through lib/platform's loader, not a bare `@capacitor/app` import: that is
    // the project's convention, it keeps the plugin out of the web bundle, and
    // it settles the thenable trap on the plugin proxy.
    expect(reporter).toMatch(/loadPlugin<\{ getInfo/);
    expect(reporter).not.toMatch(/from "@capacitor\/app"/);
    expect(reporter).toMatch(/if \(!isNative\(\)\) return \{ platform: "web"/);
  });

  it("is reachable by an operator from the app, behind the admin gate", () => {
    expect(app).toMatch(
      /<Route path="\/admin\/errors" element=\{<RequireAdmin><AdminErrorReports \/><\/RequireAdmin>\} \/>/
    );
    // An empty list from a denied policy must not read as a healthy app.
    expect(screen).toMatch(/permission denied, the admin policies from/);
  });
});
