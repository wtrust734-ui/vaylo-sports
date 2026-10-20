// Ad-hoc SQL against the live project via the management API, Windows-Credman token.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PS = path.join(os.tmpdir(), "read-token3.ps1");
fs.writeFileSync(
  PS,
  [
    "$code = @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public class CredManB {",
    "  [DllImport(\"advapi32.dll\", EntryPoint=\"CredReadW\", CharSet=CharSet.Unicode, SetLastError=true)]",
    "  public static extern bool CredRead(string target, int type, int flags, out IntPtr credPtr);",
    "  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]",
    "  public struct CREDENTIAL {",
    "    public int Flags; public int Type; public string TargetName; public string Comment;",
    "    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;",
    "    public int AttributeCount; public string TargetAlias; public string UserName;",
    "    public static string Read(string target) {",
    "      IntPtr p;",
    "      if (!CredRead(target, 1, 0, out p)) return null;",
    "      CREDENTIAL c = (CREDENTIAL)System.Runtime.InteropServices.Marshal.PtrToStructure(p, typeof(CREDENTIAL));",
    "      if (c.CredentialBlobSize > 0) {",
    "        byte[] b = new byte[c.CredentialBlobSize];",
    "        System.Runtime.InteropServices.Marshal.Copy(c.CredentialBlob, b, 0, b.Length);",
    "        return System.Text.Encoding.UTF8.GetString(b).TrimEnd('\\0');",
    "      }",
    "      return null;",
    "    }",
    "  }",
    "}'@",
    "Add-Type -TypeDefinition $code",
    "[CredManB]::Read('Supabase CLI:supabase')",
  ].join("\n"),
  "utf8",
);
const token = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS], { encoding: "utf8", cwd: os.tmpdir() }).trim().replace(/\r/g, "");
fs.unlinkSync(PS);
if (!token) { console.error("NO_TOKEN"); process.exit(1); }

const query = process.argv[2];
if (!query) { console.error("usage: node .tools/live-sql.cjs \"<sql>\""); process.exit(1); }

fetch("https://api.supabase.com/v1/projects/vvwhausdjzdmmsyxekrcl/database/query", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
})
  .then(async (r) => {
    const body = await r.text();
    console.log(`HTTP ${r.status}: ${body.slice(0, 4000)}`);
    if (r.status >= 300) process.exit(1);
  })
  .catch((e) => { console.error(e.message); process.exit(1); });
