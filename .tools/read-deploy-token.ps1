# Read the Supabase deployment token from the Credential Manager,
# then write it to a temp file for the caller to pick up.
add-type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CredMan {
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
        CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
        if (c.CredentialBlobSize > 0) {
            byte[] b = new byte[c.CredentialBlobSize];
            System.Runtime.InteropServices.Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
            return System.Text.Encoding.UTF8.GetString(b).TrimEnd('\0');
        }
        return null;
    }
}
'@
$t = [CredMan]::Read('supabase://vvwhausdjzdmmsyxekrcl?key')
if (-not $t) {
    Write-Error "No Supabase credential found in Credential Manager"
    exit 1
}
# Write to a temp file for the caller
$out = "$env:TEMP\supabase-deploy-token.txt"
[System.IO.File]::WriteAllText($out, $t, [System.Text.UTF8Encoding]::new($true))
Write-Output "[caller] wrote token to $out"
