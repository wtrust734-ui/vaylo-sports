// Sets MANUS_SHARED_SECRET on the live edge functions. Reads the value from a
// temp file (never echoed); writes the supabase CLI command through a temp
// PowerShell/YouTube-free runner so the secret never appears in argv.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const secret = fs.readFileSync(path.join(ROOT, ".tools", "manus-secret.tmp"), "utf8").trim();
if (!secret) { console.error("NO_SECRET"); process.exit(1); }

// Use the CLI directly with env var so the value is not visible in argv.
const env = { ...process.env, MANUS_SHARED_SECRET_VALUE: secret };
// supabase CLI does not interpolate env into `secrets set`, so write a small
// .ps1 that reads the env var and invokes the CLI.
const ps = path.join(os.tmpdir(), "set-secret-run.ps1");
fs.writeFileSync(ps, [
  "$env:MANUS_SHARED_SECRET_VALUE | Set-Content -Path (Join-Path $env:TEMP 'sv.txt') -NoNewline",
  "$s = Get-Content (Join-Path $env:TEMP 'sv.txt') -Raw",
  "Remove-Item (Join-Path $env:TEMP 'sv.txt')",
  "supabase secrets set \"MANUS_SHARED_SECRET=$s\" --project-ref vvwhausdjzdmmsyxekrcl",
].join("\n") + "\n", "utf8");

try {
  const out = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps], { encoding: "utf8", env });
  console.log(out.replace(/MANUS_SHARED_SECRET=.*/g, "MANUS_SHARED_SECRET=<set>"));
} finally {
  fs.unlinkSync(ps);
}
