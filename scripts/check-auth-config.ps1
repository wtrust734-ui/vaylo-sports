# Read-only check of the project's auth provider configuration.
# Prints ONLY booleans and value lengths — never a secret character.

$code = @'
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
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    string s = null;
    if (c.CredentialBlobSize > 0) {
      byte[] blob = new byte[c.CredentialBlobSize];
      System.Runtime.InteropServices.Marshal.Copy(c.CredentialBlob, blob, 0, c.CredentialBlobSize);
      s = System.Text.Encoding.UTF8.GetString(blob).TrimEnd('\0');
    }
    return s;
  }
}
'@
Add-Type -TypeDefinition $code

$token = [CredMan]::Read('Supabase CLI:supabase')
if (-not $token) { Write-Output 'TOKEN_NOT_FOUND'; exit 1 }
Write-Output ("token found, length " + $token.Length)

$headers = @{ Authorization = "Bearer $token" }
$r = Invoke-RestMethod -Uri 'https://api.supabase.com/v1/projects/vvwhausdjzdmsyxekrcl/config/auth' -Headers $headers

Write-Output ("site_url: " + $r.site_url)
Write-Output ("redirect_urls: " + (($r.uri_allow_list | Select-Object -First 6) -join ', '))

foreach ($p in @('google','azure','apple','phone')) {
  $cidProp = "external_${p}_client_id"
  $secProp = "external_${p}_secret"
  $enProp  = "external_${p}_enabled"
  $cid = $r.$cidProp
  $sec = $r.$secProp
  $en  = $r.$enProp
  $cidLen = if ($cid) { ($cid -split ',').Count } else { 0 }   # google can hold comma-separated audiences
  $secLen = if ($sec) { $sec.Length } else { 0 }
  Write-Output ("${p}: enabled=$en client_ids=$cidLen secret_len=$secLen")
}
Write-Output ("sms_provider: " + $r.sms_provider)
