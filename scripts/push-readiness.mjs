#!/usr/bin/env node
// ============================================================================
// PUSH READINESS
// ---------------------------------------------------------------------------
// Reports exactly what is still missing before server-sent push can deliver
// anything, and nothing else. It is deliberately a checklist rather than a
// setup script: every missing piece is a credential that has to come from a
// Firebase project, so there is nothing here a machine can safely fill in.
//
// Run it before and after adding the client config from google-services.json:
//
//   npm run push:ready
//
// Exit code 0 means every input the sender needs is present. Exit code 1 means
// at least one is missing, and the list of what to do is printed underneath.
// ============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FCM_XML = join(ROOT, "android/app/src/main/res/values/vaylo_fcm.xml");
const GOOGLE_SERVICES = join(ROOT, "android/app/google-services.json");

/** The four client values PushPlugin.kt reads, in the order the XML declares them. */
const CLIENT_VALUES = [
  "vaylo_fcm_app_id",
  "vaylo_fcm_api_key",
  "vaylo_fcm_project_id",
  "vaylo_fcm_sender_id",
];

/** The three secrets supabase/functions/push-notify/index.ts asks for. */
const SERVER_SECRETS = ["FCM_PROJECT_ID", "FCM_CLIENT_EMAIL", "FCM_PRIVATE_KEY"];

const MISSING = [];
const OK = [];

/* ------------------------------------------------------------- client side -- */

if (!existsSync(FCM_XML)) {
  MISSING.push(`vaylo_fcm.xml is missing at ${FCM_XML.replace(ROOT, ".")}`);
} else {
  const xml = readFileSync(FCM_XML, "utf8");
  for (const name of CLIENT_VALUES) {
    const value = new RegExp(`name="${name}"[^>]*>([^<]*)<`).exec(xml)?.[1]?.trim() ?? "";
    // Firebase client config must match the SDK formats. Never echo the value:
    // this diagnostic is frequently copied into CI and issue logs.
    const valid = name === "vaylo_fcm_app_id"
      ? /^1:\d{6,}:android:[0-9a-f]{8,}$/i.test(value)
      : name === "vaylo_fcm_api_key"
      ? /^AIza[0-9A-Za-z_-]{35}$/.test(value)
      : name === "vaylo_fcm_project_id"
      ? /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value)
      : /^\d{6,}$/.test(value);
    if (valid) OK.push(`${name} is present and well-formed`);
    else MISSING.push(`${name} is missing or invalid in android/app/src/main/res/values/vaylo_fcm.xml`);
  }
}

// Optional only while the explicit client resources remain unconfigured.
if (existsSync(GOOGLE_SERVICES)) {
  try {
    const services = JSON.parse(readFileSync(GOOGLE_SERVICES, "utf8"));
    const app = services.client?.find((client) =>
      client.client_info?.android_client_info?.package_name === "com.vaylosports.app",
    );
    if (app?.client_info?.mobilesdk_app_id && app?.api_key?.some((key) => key.current_key)) {
      OK.push("google-services.json has a matching Android client and API key");
    } else {
      MISSING.push("google-services.json has no valid com.vaylosports.app client");
    }
  } catch {
    MISSING.push("google-services.json is not valid JSON");
  }
} else {
  OK.push("google-services.json absent — optional only while FCM client config is empty");
}

/* ------------------------------------------------------------- server side -- */

const projectRef = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(
  readFileSync(join(ROOT, ".env"), "utf8"),
)?.[1];

if (!projectRef) {
  MISSING.push("could not read the Supabase project ref from .env");
} else {
  let listed = "";
  try {
    // `shell` because on Windows npx is npx.cmd, which execFileSync cannot
    // spawn without it — and the only interpolated value is the project ref,
    // which came from a URL match and is [a-z0-9]+ by construction.
    listed = execFileSync(
      `npx --yes supabase secrets list --project-ref ${projectRef}`,
      { cwd: ROOT, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    MISSING.push(`could not list function secrets for ${projectRef} (network or login)`);
  }
  for (const name of SERVER_SECRETS) {
    if (new RegExp(`\\b${name}\\b`).test(listed)) OK.push(`${name} is set on ${projectRef}`);
    else MISSING.push(`${name} is not set as a function secret on ${projectRef}`);
  }
}

/* ----------------------------------------------------------------- report -- */

console.log("Push readiness\n");
for (const line of OK) console.log(`  ok    ${line}`);
for (const line of MISSING) console.log(`  TO DO ${line}`);

console.log("");
if (MISSING.length === 0) {
  console.log("READY — server-sent push can deliver. Test with:");
  console.log("  supabase functions invoke push-notify --body '{\"title\":\"Test\",\"body\":\"Hello\"}'");
  process.exit(0);
}

console.log(`NOT READY — ${MISSING.length} item(s) outstanding. The full walkthrough is in`);
console.log("android/app/src/main/java/com/vaylosports/app/push/FIREBASE.md, and the short version is:");
console.log("  1. Firebase console -> new project -> add Android app, package com.vaylosports.app");
console.log("  2. Paste its four web-config values into vaylo_fcm.xml (the TO DO lines above)");
console.log("  3. Download google-services.json into android/app/");
console.log("  4. supabase secrets set FCM_PROJECT_ID=... FCM_CLIENT_EMAIL=... FCM_PRIVATE_KEY=...");
console.log("  5. supabase db push && supabase functions deploy push-notify");
console.log("  6. Rebuild the APK, then run this again to confirm every line reads ok");
console.log("");
console.log("Until then the app is unchanged: it reports push as unconfigured, and the");
console.log("device notifications from src/lib/localNotifications.ts still work.");
process.exit(1);
