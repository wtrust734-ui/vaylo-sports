# Set both MANUS_SHARED_SECRET and ENGINE_OWNER_JWT via the Supabase
# permissions API, authenticated with a token obtained from the Supabase
# CLI's Credential Manager store. Tokens are never echoed to the console.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Read the MANUS secret from the temp file
$manusSecret = Get-Content "$root\.tools\manus-secret.tmp" -Raw
if (-not $manusSecret) { Write-Error "Missing MANUS secret"; exit 1 }
$manusSecretLen = $manusSecret.Length
Write-Output ("MANUS secret read. Length={0}" -f $manusSecretLen)

# Read the JWT from the preview session JSON
$previewSessionJson = Get-Content "$root\.preview-session.json"
$previewSession = $previewSessionJson | ConvertFrom-Json
$jwt = $previewSession.access_token
if (-not $jwt) { Write-Error "No JWT in preview session"; exit 1 }
$jwtLen = $jwt.Length
Write-Output ("JWT read. Length={0}" -f $jwtLen)

# Build the payload
$body = @{
    MANUS_SHARED_SECRET = $manusSecret
    ENGINE_OWNER_JWT   = $jwt
} | ConvertTo-Json -Compress

# Call the Supabase permissions API to set the secrets
$uri = "https://api.supabase.com/v1/projects/vvwhausdjzdmmsyxekrcl/secrets"
$headers = @{
    Authorization = "Bearer " + $jwt
    "Content-Type" = "application/json"
}

Write-Output "Calling Supabase permissions API to set secrets..."
try {
    $resp = Invoke-RestMethod -Uri $uri -Method Patch -Headers $headers -Body $body
    Write-Output ("Secrets set via permissions API: " + ($resp | ConvertTo-Json -Compress))
} catch {
    $err = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($err)
    $reader.BaseStream.Position = 0
    $errBody = $reader.ReadToEnd()
    Write-Error ("Failed to set secrets: HTTP " + $_.Exception.Response.StatusCode + " " + $errBody)
    exit 1
}

Write-Output "Engine secrets applied"
