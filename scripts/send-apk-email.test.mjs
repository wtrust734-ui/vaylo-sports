#!/usr/bin/env node
// Smoke tests for the Gmail/Google Drive path of send-apk-email.mjs.
// These do NOT send a real email (no real creds) — they verify the script fails
// correctly on bad input, which is the part that must never be wrong.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SCRIPT = resolve(import.meta.dirname, "send-apk-email.mjs");
const APK_NAME = "vaylo-sports-1.2.13-17-release.apk";
const APK_DIR = tmpdir();
const APK_PATH = `${APK_DIR}/${APK_NAME}`;

let failed = 0;

function run(args, envOverrides = {}) {
  const envPath = resolve(import.meta.dirname, "..", ".env");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

  // Start from a clean .env base: keep all real vars except any email-cred-ish ones,
  // which we fully control per test.
  let patched = existing
    .replace(/^GMAIL_USER=.*$/gm, "")
    .replace(/^GMAIL_APP_PASSWORD=.*$/gm, "")
    .replace(/^GMAIL_REFRESH_TOKEN=.*$/gm, "")
    .replace(/^GMAIL_CLIENT_ID=.*$/gm, "")
    .replace(/^GMAIL_CLIENT_SECRET=.*$/gm, "")
    .replace(/^APK_DRIVE_LINK=.*$/gm, "")
    .replace(/\r\n/g, "\n");
  for (const [k, v] of Object.entries(envOverrides)) {
    patched = patched + `${k}=${v}\n`;
  }
  patched = patched.replace(/\n{3,}/g, "\n\n");
  if (!patched.endsWith("\n")) patched += "\n";
  writeFileSync(envPath, patched, "utf8");

  const env = { ...process.env, ...envOverrides };
  const r = spawnSync("node", [SCRIPT, ...args], {
    env,
    encoding: "utf8",
    timeout: 10_000,
  });

  // Restore .env to the empty placeholder for the email creds.
  let restore = readFileSync(envPath, "utf8").replace(/\r\n/g, "\n");
  restore =
    restore
      .replace(/^GMAIL_USER=.*$/gm, "")
      .replace(/^GMAIL_APP_PASSWORD=.*$/gm, "")
      .replace(/^GMAIL_REFRESH_TOKEN=.*$/gm, "")
      .replace(/^GMAIL_CLIENT_ID=.*$/gm, "")
      .replace(/^GMAIL_CLIENT_SECRET=.*$/gm, "")
      .replace(/^APK_DRIVE_LINK=.*$/gm, "");
  restore = restore.replace(/\n{3,}/g, "\n\n");
  if (!restore.endsWith("\n")) restore += "\n";
  writeFileSync(envPath, restore + "RESEND_API_KEY=\n", "utf8");

  return { stdout: r.stdout, stderr: r.stderr, exit: r.status };
}

function check(label, fn) {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${label}: ${e.message}`);
  }
}

function expectExit(label, args, expected, stderrContains, envOverrides) {
  const r = run(args, envOverrides);
  check(`${label}: exit=${expected}`, () => {
    if (r.exit !== expected)
      throw new Error(`expected exit ${expected}, got ${r.exit}. stderr: ${r.stderr.trim()}`);
  });
  if (stderrContains) {
    check(`${label}: stderr mentions "${stderrContains}"`, () => {
      if (!r.stderr.includes(stderrContains))
        throw new Error(
          `expected stderr to contain "${stderrContains}", got: ${r.stderr.trim()}`,
        );
    });
  }
}

console.log("send-apk-email (Gmail/Drive path) smoke tests");
console.log("  (no real email is sent — these only check error paths)");

// 1. Missing GMAIL_USER.
expectExit("missing GMAIL_USER", [], 2, "GMAIL_USER is not set");

// 2. Missing GMAIL_APP_PASSWORD (with GMAIL_USER set).
expectExit(
  "missing GMAIL_APP_PASSWORD",
  [],
  2,
  "GMAIL_APP_PASSWORD is not set",
  { GMAIL_USER: "vaylosportsupport@gmail.com" },
);

// 3. GMAIL_USER set to the wrong address (script is wired to send FROM
//    vaylosportsupport@gmail.com).
expectExit(
  "GMAIL_USER mismatch",
  [],
  2,
  'GMAIL_USER is "wrong@example.com" but this script is wired to send FROM',
  { GMAIL_USER: "wrong@example.com", GMAIL_APP_PASSWORD: "fake" },
);

// 4. Missing APK argument (with creds present so we get past the cred check).
expectExit(
  "missing APK arg",
  [],
  2,
  "APK path required",
  { GMAIL_USER: "vaylosportsupport@gmail.com", GMAIL_APP_PASSWORD: "fake" },
);

// 5. Nonexistent APK (with creds present).
expectExit(
  "nonexistent APK",
  ["/tmp/does-not-exist-12345.apk"],
  1,
  "APK not found",
  { GMAIL_USER: "vaylosportsupport@gmail.com", GMAIL_APP_PASSWORD: "fake" },
);

// 6. No Drive link and no OAuth creds -> exits 2 telling you to set one.
expectExit(
  "no Drive link and no OAuth creds",
  [APK_PATH],
  2,
  "APK_DRIVE_LINK is not set and OAuth creds",
  {
    GMAIL_USER: "vaylosportsupport@gmail.com",
    GMAIL_APP_PASSWORD: "fake",
    ...(() => {
      writeFileSync(APK_PATH, Buffer.alloc(512));
      return {};
    })(),
  },
);

// Clean up the temp APK created above.
try { unlinkSync(APK_PATH); } catch {}

if (failed) {
  console.log(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
