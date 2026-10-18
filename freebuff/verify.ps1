$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path $scriptDir
$zipPath = Join-Path $root 'freebuff/vaylo-web-app.zip'
$f = Get-Item $zipPath
if (-not $f) { exit 1 }

Write-Output('EXISTS ' + $zipPath)
Write-Output('BYTES ' + $f.Length)
Write-Output('KB ' + [math]::Round($f.Length / 1KB, 1))
Write-Output('MB ' + [math]::Round($f.Length / 1MB, 2))
Write-Output('MTIME ' + $f.LastWriteTimeUtc.ToString('u'))
