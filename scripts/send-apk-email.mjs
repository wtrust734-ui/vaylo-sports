#!/usr/bin/env node
// ==============================================================================
// Email a built APK to gemmellj175@gmail.com FROM vaylosportsupport@gmail.com.
// ============================================================================
// Uses Gmail SMTP (Nodemailer). Reads GMAIL_USER + GMAIL_APP_PASSWORD from .env
// (same convention as the rest of the project).
//
// Gmail blocks .apk attachments, so the APK is attached with a .zip extension as
// a workaround. The email tells the recipient to rename it back to .apk before
// installing (Play Protect / package installs still work on a renamed APK).
//
// Fully automatic after builds once GMAIL_USER + GMAIL_APP_PASSWORD are in .env.
//
// Fails loudly (non-zero exit) when:
//   - GMAIL_USER / GMAIL_APP_PASSWORD are missing or GMAIL_USER is wrong
//   - the APK file is missing
//   - the send itself fails
// ==============================================================================

import { readFileSync, statSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const APK_PATH = process.argv[2];
const RECIPIENT = "gemmellj175@gmail.com";
const FROM_ADDRESS = "vaylosportsupport@gmail.com";

// --- Load .env (same convention as the project: .env is git-ignored) --------
function loadEnv() {
  try {
    const envPath = resolve(__dirname, "..", ".env");
    if (!existsSync(envPath)) return;
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      if (key) process.env[key] = value;
    }
  } catch {
    // .env missing or unreadable — creds may still be set in the shell.
  }
}

loadEnv();

const user = process.env.GMAIL_USER;
const appPassword = process.env.GMAIL_APP_PASSWORD;
if (!user) {
  console.error(
    "send-apk-email: GMAIL_USER is not set (the From address, e.g. vaylosportsupport@gmail.com). Put it in .env.",
  );
  process.exit(2);
}
if (user && user !== FROM_ADDRESS) {
  console.error(
    `send-apk-email: GMAIL_USER is "${user}" but this script is wired to send FROM ${FROM_ADDRESS}. Set GMAIL_USER=${FROM_ADDRESS} in .env.`,
  );
  process.exit(2);
}
if (!appPassword) {
  console.error(
    "send-apk-email: GMAIL_APP_PASSWORD is not set. Put it in .env (an App Password, not the account password).",
  );
  process.exit(2);
}

if (!APK_PATH) {
  console.error("send-apk-email: APK path required as first argument.");
  process.exit(2);
}

const apkResolved = resolve(APK_PATH);
if (!existsSync(apkResolved)) {
  console.error("send-apk-email: APK not found at", apkResolved);
  process.exit(1);
}

// --- Build the email metadata -------------------------------------------------
const apkBuf = readFileSync(apkResolved);
const apkLen = apkBuf.length;
const sha256 = (await import("node:crypto")).createHash("sha256").update(apkBuf).digest("hex");

// Try to read the version out of the APK filename (matches build-apk.sh naming).
// E.g. apk/vaylo-sports-1.2.13-17-release.apk -> "1.2.13 (17)".
const name = apkResolved.split("/").pop() ?? apkResolved;
const versionMatch = name.match(/vaylo-sports-([0-9.]+)-([0-9]+)/);
const versionLabel = versionMatch ? `${versionMatch[1]} (code ${versionMatch[2]})` : name;

const now = new Date().toISOString().replace("T", " ").slice(0, 19);
const subject = `Vaylo Sports APK ${versionLabel} — ${now.slice(0, 10)}`;

// Gmail blocks .apk attachments, so attach as .zip and tell the recipient how to
// restore the real extension before installing.
const attachedName = name.endsWith(".apk") ? name.slice(0, -4) + ".zip" : name + ".zip";

const html = `
<p>New Vaylo Sports APK ready (built ${now}).</p>
<p>The APK is attached as <code>${attachedName}</code> because Gmail blocks .apk attachments.
To install it:</p>
<ol>
  <li>Download <code>${attachedName}</code>.</li>
  <li>Rename it to <code>${name}</code> (change the .zip back to .apk).</li>
  <li>Install it: on a normal Android device, open the renamed file in a file manager and tap it;
      if Play Protect warns, that is normal for an unsigned debug/shared APK — confirm you want to install.</li>
</ol>
<p>Before installing, you can verify the file on the machine that built it:</p>
<pre style="font-family: monospace;">sha256sum = ${sha256}
size      = ${(apkLen / 1024 / 1024).toFixed(2)} MB
file      = ${name}
version   = ${versionLabel}
built     = ${now}</pre>
<p><small>Sent from vaylosportsupport@gmail.com. If anything is wrong, reply to this address.</small></p>
`.trim();

// --- Send via Gmail SMTP (From = the Gmail account) -----------------------
async function main() {
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: FROM_ADDRESS,
      pass: appPassword,
    },
  });

  const sendRes = await transporter.sendMail({
    from: `"Vaylo Sports" <${FROM_ADDRESS}>`,
    to: RECIPIENT,
    subject,
    html,
    attachments: [
      {
        // Attach under the .zip name so Gmail lets it through.
        filename: attachedName,
        content: apkBuf,
        contentType: "application/zip",
        // Keep the real APK MIME on the inside so a recipient who already renamed
        // it sees the right type in some viewers. Mostly cosmetic.
        headers: { "x-attachment-origin": "apk" },
      },
    ],
  });

  console.log("send-apk-email: sent", subject, "to", RECIPIENT);
  console.log("send-apk-email: message id", sendRes.messageId);
  console.log("send-apk-email: attached as", attachedName, "(rename back to", name, ")");
  console.log("send-apk-email: sha256", sha256);
  console.log("send-apk-email: size MB", (apkLen / 1024 / 1024).toFixed(2));
}

main().catch((err) => {
  console.error("send-apk-email: failed:", err?.message ?? err);
  if (err?.code) console.error("send-apk-email: code:", err.code);
  if (err?.response?.data) console.error("send-apk-email: body:", err.response.data);
  process.exit(1);
});
