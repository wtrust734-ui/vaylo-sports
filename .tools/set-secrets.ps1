param([param(Position=0)][string]$Command)
$Command | Out-File -FilePath "$env:TEMP\set-secrets-command.txt"
supabase "$Command"
