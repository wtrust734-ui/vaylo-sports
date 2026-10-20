$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$serverFile = Join-Path $root "server.cjs"
$backupFile = $serverFile + ".bak"

if (Test-Path $serverFile) {
    Copy-Item $serverFile $backupFile -Force
    Write-Output ("Backed up {0} to {1}" -f $serverFile, $backupFile)
} else {
    Write-Output "server.cjs not found — skipping patch"
    exit 0
}

$content = Get-Content $serverFile -Raw -Encoding UTF8
$target = "http://localhost:3000"
$replacement = "https://vvwhausdjzdmmsyxekrcl.supabase.co"

$found = [regex]::IsMatch($content, [regex]::Escape($target))
if ($found) {
    $newContent = $content -replace [regex]::Escape($target), $replacement
    [System.IO.File]::WriteAllText($serverFile, $newContent, [System.Text.UTF8Encoding]::new($true))
    Write-Output ("Patched server.cjs: {0} -> {1}" -f $target, $replacement)
} else {
    Write-Output "No localhost URL found in server.cjs — skipping patch"
}
