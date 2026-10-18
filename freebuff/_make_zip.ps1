$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$entries = @('src', 'public', 'index.html', 'vite.config.ts', 'tsconfig.app.json', 'package.json')

$dest = Join-Path $root 'freebuff/vaylo-web-app.zip'
$destDir = Split-Path $dest -Parent

if (-not (Test-Path $destDir)) {
  New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}

foreach ($e in $entries) {
  if (-not (Test-Path (Join-Path $root $e))) {
    Write-Error "missing source entry: $e"
    exit 1
  }
}

Compress-Archive -Path (Join-Path $root $entries[0]) -DestinationPath $dest -Force

try {
  Get-Item $dest | Select-Object FullName, Length | Format-List
} catch {
  Write-Error "zip created but listing failed: $dest"
  exit 1
}
