// Set env vars on the live Supabase project using temp files — never echoes secrets.
const fs = require("fs");
const { execFileSync } = require("child_process");
const os = require("os");
const path = require("path");

const ROOT = process.env.ROOT || process.cwd();
const secretsFilePath = path.join(ROOT, ".tools", "secrets-to-set.txt");
const tokenPath = path.join(os.tmpdir(), "supabase-cli-token.txt");

// Build secrets from temp files
const map = {
  MANUS_SHARED_SECRET: path.join(ROOT, ".tools", "manus-secret.tmp"),
  ENGINE_OWNER_JWT: path.join(ROOT, ".tools", "owner-jwt.tmp"),
};

const pairs = [];
for (const [k, v] of Object.entries(map)) {
  const val = fs.readFileSync(v, "utf8").trim();
  if (!val) {
    console.error("Missing secret for", k, v);
    process.exit(1);
  }
  pairs.push(`${k}=${val}`);
}
const secretsFile = path.join(ROOT, ".tools", "secrets-to-set.txt");
fs.writeFileSync(secretsFile, pairs.join("\n") + "\n");

// Invoke the Supabase CLI with the token as an env var so it is never visible to the parent shell
const ps = path.join(os.tmpdir(), "supabase-set-secrets.ps1");
fs.writeFileSync(ps, [
  "$env:SUPA_TOKEN = (Get-Content \"" + tokenPath.replace(/\\/g, "/") + "\")",
  // Read the temp file with the secrets; pass to CLI with --no-verify (for dev only)
  "supabase secrets set --project-ref vvwhausdjzdmmsyxekrcl --no-verify --file \"" + secretsFilePath.replace(/\\/g, "/") + "\"",
].join("`n") + "`n", "utf8");
try {
  const out = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps], { encoding: "utf8", env: { ...process.env }, cwd: os.tmpdir() });
  const masked = out.replace(/([^=]+=)(.+)/g, "$1<redacted>");
  console.log(masked.split("\n").filter(Boolean).join("\n"));
} finally {
  try { fs.unlinkSync(ps); } catch {}
  try { fs.unlinkSync(secretsFile); } catch {}
  try { fs.unlinkSync(tokenPath); } catch {}
}
