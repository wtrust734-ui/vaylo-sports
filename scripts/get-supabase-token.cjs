// Prints the Supabase access token stored in Windows Credential Manager
// (same source scripts/run-sql.cjs uses) so the Supabase CLI can consume it:
//   SUPABASE_ACCESS_TOKEN="$(node scripts/get-supabase-token.cjs)" npx supabase ...
// Never prints anything else; errors go to stderr with a non-zero exit.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const psScript = path.join(os.tmpdir(), "read-supabase-token.ps1");
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

let token = "";
try {
  token = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psScript], { encoding: "utf8" }).trim();
} finally {
  try { fs.unlinkSync(psScript); } catch { /* best effort */ }
}
if (!token) { console.error("NO_TOKEN in Credential Manager entry 'Supabase CLI:supabase'"); process.exit(1); }
process.stdout.write(token);
