// Runs a SQL FILE against the live Supabase project via the management API.
// Same auth flow as scripts/run-sql.cjs; the file path is argv[2] so multi-line
// migrations never pass through a shell (dollar-quoting survives intact). Also
// accepts a short verification query, e.g. "--> select 1".
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const psScript = path.join(os.tmpdir(), "read-supabase-token-file.ps1");
fs.writeFileSync(
  psScript,
  [
    "$code = @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public class CredManFile {",
    "  [DllImport(\"advapi32.dll\", EntryPoint=\"CredReadW\", CharSet=CharSet.Unicode, SetLastError=true)]",
    "  public static extern bool CredRead(string target, int type, int flags, out IntPtr credPtr);",
    "  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]",
    "  public struct CREDENTIAL {",
    "    public int Flags; public int Type; public string TargetName; public string Comment;",
    "    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;",
    "    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;",
    "    public int AttributeCount; public string TargetAlias; public string UserName;",
    "  }",
    "  public static string Read(string target) {",
    "    IntPtr p;",
    "    if (!CredRead(target, 1, 0, out p)) return null;",
    "    CREDENTIAL c = (CREDENTIAL)System.Runtime.InteropServices.Marshal.PtrToStructure(p, typeof(CREDENTIAL));",
    "    if (c.CredentialBlobSize > 0) {",
    "      byte[] blob = new byte[c.CredentialBlobSize];",
    "      System.Runtime.InteropServices.Marshal.Copy(c.CredentialBlob, blob, 0, blob.Length);",
    "      return System.Text.Encoding.UTF8.GetString(blob).TrimEnd('\\0');",
    "    }",
    "    return null;",
    "  }",
    "}",
    "'@",
    "Add-Type -TypeDefinition $code",
    "[CredManFile]::Read('Supabase CLI:supabase')",
  ].join("\n"),
  "utf8"
);

const token = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psScript], { encoding: "utf8" }).trim();
fs.unlinkSync(psScript);
if (!token) { console.error("NO_TOKEN"); process.exit(1); }

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/run-sql-file.cjs <file.sql>"); process.exit(1); }

const sql = fs.readFileSync(file, "utf8");
if (!sql.trim()) { console.error("EMPTY_SQL_FILE"); process.exit(1); }

fetch("https://api.supabase.com/v1/projects/vvwhausdjzdmsyxekrcl/database/query", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
}).then(async (r) => {
  const body = await r.text();
  console.log(`HTTP ${r.status}: ${body.slice(0, 3000)}`);
  if (r.status >= 300) process.exit(1);
}).catch((e) => { console.error(e.message); process.exit(1); });
