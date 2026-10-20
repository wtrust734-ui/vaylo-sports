$ErrorActionPreference = 'Stop'
$jwtRaw = Get-Content "$env:USERPROFILE\Downloads\.freebuff\.tools\owner-jwt.tmp" -Raw
$parts = $jwtRaw.Split('.')
if ($parts.Length -ne 3) { Write-Error "Not a JWT"; exit 1 }

function PadB64($s) { $s.PadRight($s.Length + (4 - ($s.Length % 4)) % 4, '=') }

$rawPayload = PadB64 $parts[1]
$bytesPayload = [System.Convert]::FromBase64String($rawPayload)
$textPayload = [System.Text.Encoding]::UTF8.GetString($bytesPayload)

Write-Output "payload: $textPayload"

$obj = ConvertFrom-Json $textPayload
$exp = [DateTimeOffset]::FromUnixTimeSeconds([long]$obj.exp)
$now = [DateTimeOffset]::UtcNow
$remain = $exp.ToUnixTimeSeconds() - $now.ToUnixTimeSeconds()
Write-Output ("expires={0} now={1} remaining_seconds={2}" -f $exp.ToString("yyyy-MM-dd HH:mm:ss UTC"), $now.ToString("yyyy-MM-dd HH:mm:ss UTC"), $remain)
