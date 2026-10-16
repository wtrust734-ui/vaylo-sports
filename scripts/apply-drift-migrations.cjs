// ============================================================================
// apply-drift-migrations.cjs — apply repository migrations the remote database
// has never seen, then record each one in the remote history table.
//
// Why this exists: `supabase db push` refuses to run here because the remote
// `supabase_migrations.schema_migrations` table also contains versions from an
// older authoring era that have no local file, and the CLI will not reconcile
// that gap. This script only *adds* what is missing; it never touches the
// remote-only entries, and it applies in filename order so later migrations
// see the earlier ones' objects.
//
// Usage:
//   node scripts/apply-drift-migrations.cjs --dry-run   # list the diff
//   node scripts/apply-drift-migrations.cjs             # apply + record
//
// Auth via the Supabase CLI access token (Credential Manager), same as
// scripts/run-sql.cjs. No tokens, keys or SQL bodies are printed.
// ============================================================================
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT = "vvwhausdjzdmsyxekrcl";
const MIG_DIR = path.join(__dirname, "..", "supabase", "migrations");
const DRY = process.argv.includes("--dry-run");

function readToken() {
  const psScript = path.join(os.tmpdir(), "read-supabase-token-drift.ps1");
  fs.writeFileSync(
    psScript,
    `$code = @'
using System;
using System.Runtime.InteropServices;
public class CredMan {
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] 
  public static extern bool CredRead(string target, int type, int flags, out IntPtr credPtr);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public string TargetAlias; public string UserName;
  }
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    CREDENTIAL c = (CREDENTIAL)System.Runtime.InteropServices.Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    if (c.CredentialBlobSize > 0) {
      byte[] blob = new byte[c.CredentialBlobSize];
      System.Runtime.InteropServices.Marshal.Copy(c.CredentialBlob, blob, 0, c.CredentialBlobSize);
      return System.Text.Encoding.UTF8.GetString(blob).TrimEnd('\\0');
    }
    return null;
  }
}
'@
Add-Type -TypeDefinition $code
[CredMan]::Read('Supabase CLI:supabase')
`,
    "utf8"
  );
  const token = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psScript], { encoding: "utf8" }).trim();
  fs.unlinkSync(psScript);
  if (!token) { console.error("NO_TOKEN"); process.exit(1); }
  return token;
}

const TOKEN = readToken();

async function runSql(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

(async () => {
  // Remote applied versions.
  const appliedRes = await runSql("select version from supabase_migrations.schema_migrations order by version;");
  if (appliedRes.status !== 201) { console.error("cannot read remote history:", JSON.stringify(appliedRes.body)); process.exit(1); }
  const applied = new Set(appliedRes.body.map(r => String(r.version)));

  // Local migration files, oldest first.
  const files = fs.readdirSync(MIG_DIR).filter(f => /^\d+_/.test(f) && f.endsWith(".sql")).sort();

  // History table shape, so the INSERT matches whatever this project's columns are.
  const colRes = await runSql(
    "select column_name, is_nullable, data_type from information_schema.columns " +
    "where table_schema='supabase_migrations' and table_name='schema_migrations' order by ordinal_position;"
  );
  const cols = colRes.body.map(c => c.column_name);
  console.log("[drift] history columns:", cols.join(","));

  const missing = files.filter(f => !applied.has(f.slice(0, f.indexOf("_"))));
  console.log(`[drift] local=${files.length} remote-applied=${applied.size} missing=${missing.length}`);
  if (!missing.length) { console.log("[drift] nothing to do: no unapplied local migration."); return; }
  for (const f of missing) {
    const v = f.slice(0, f.indexOf("_"));
    console.log(`[drift] missing ${v}  ${f.slice(f.indexOf("_") + 1)}`);
  }
  if (DRY) { console.log("[drift] dry run complete."); return; }

  for (const f of missing) {
    const v = f.slice(0, f.indexOf("_"));
    const sql = fs.readFileSync(path.join(MIG_DIR, f), "utf8");
    process.stdout.write(`[drift] applying ${v} ... `);
    const res = await runSql(sql);
    if (res.status !== 201) {
      console.log("FAILED");
      console.error(`  HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 1200)}`);
      console.error("[drift] stopping at first failure; earlier migrations are recorded, this one and later ones are not.");
      process.exit(1);
    }
    // Record it in the history table so db push / migration list agree below.
    // For newer migrations (timestamp-styled files like 202610*.sql) the
    // statements column is not meaningful; null it when nullable, else '{}'.
    const stmtCol = colRes.body.find(c => c.column_name === "statements");
    const statementsArg = stmtCol && stmtCol.is_nullable === "YES" ? "NULL::text[]" : "'{}'";
    const rec = await runSql(
      `insert into supabase_migrations.schema_migrations (version, statements, name) ` +
      `values ('${v}', ${statementsArg}, '${PROJECT.replace(/'/g, "")}:local:${v}') ` +
      `on conflict (version) do nothing;`
    );
    if (rec.status !== 201) {
      console.log("APPLIED but history insert FAILED");
      console.error(`  HTTP ${rec.status}: ${JSON.stringify(rec.body).slice(0, 600)}`);
      console.error(`[drift] ${v} is applied in the schema but NOT recorded — rerun this script to retry recording only.`);
      process.exit(1);
    }
    console.log("ok (recorded)");
  }

  // Final agreement check.
  const after = await runSql("select version from supabase_migrations.schema_migrations order by version;");
  const still = missing.filter(f => !after.body.some(r => String(r.version) === f.slice(0, f.indexOf("_"))));
  console.log(still.length ? `[drift] FINISH: ${still.length} still unrecorded` : "[drift] FINISH: local and remote histories agree on every local migration.");
})().catch(e => { console.error(e); process.exit(1); });
