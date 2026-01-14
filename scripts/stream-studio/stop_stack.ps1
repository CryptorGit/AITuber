$ErrorActionPreference = 'Continue'

$pidFile = 'data/stream-studio/logs/stack_server.pid'
if (Test-Path $pidFile) {
  $pid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($pid -match '^\d+$') {
    Write-Host ('[stop_stack] Stopping server pid=' + $pid) -ForegroundColor Cyan
    try { Stop-Process -Id ([int]$pid) -Force } catch {}
  }
}

Write-Host '[stop_stack] Done.' -ForegroundColor Cyan
