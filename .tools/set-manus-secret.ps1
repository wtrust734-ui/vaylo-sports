$root = "$(Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))"
$secret = (Get-Content (Join-Path $root ".tools\manus-secret.tmp") -Raw).Trim()
if (-not $secret) { Write-Error "NO_SECRET"; exit 1 }
Set-Location (Join-Path $root "supabase")
supabase secrets set "MANUS_SHARED_SECRET=$secret"
