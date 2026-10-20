# Read and patch the Supabase deploy token from CredMan,
# then inject it into the current session environment.
$credRead = @"
add-type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CredMan {
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool CredRead(string target, int type, int flags, out IntPtr credPtr);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags; public int Type; public string TargetName; public string Comment;
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
[CredMan]::Read('supabase://vvwhausdjzdmmsyxekrcl?key')
"@

function Get-PatchedToken {
    $raw = Invoke-Expression $credRead
    if (-not $raw -or $raw.Length -lt 10) { return $null }
    # Supabase CLI expects the deploy token as a URL with the secret as the path part.
    "https://" + ($raw -replace "=", "%3D")
}

# Inject into the current session
$env:SUPABASE_ACCESS_TOKEN = Get-PatchedToken
Write-Output "Patched token injected into environment"
