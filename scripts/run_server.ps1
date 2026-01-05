param(
  [string]$HostAddr = $env:AITUBER_SERVER_HOST,
  [int]$Port = [int]($env:AITUBER_SERVER_PORT)
)

$ErrorActionPreference = "Stop"

if (-not $HostAddr) { $HostAddr = "127.0.0.1" }
if (-not $Port) { $Port = 8000 }

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# Use .env/.env.main (local file) for the main app.
$env:AITUBER_ENV_FILE = ".env/.env.main"

if (-not (Test-Path ".venv\Scripts\python.exe")) {
  Write-Host "[run_server] .venv not found. Create venv and install requirements first." -ForegroundColor Yellow
  Write-Host "py -3 -m venv .venv" -ForegroundColor Yellow
  Write-Host ".\.venv\Scripts\pip install -r requirements.txt" -ForegroundColor Yellow
  exit 1
}

Write-Host "[run_server] Starting uvicorn on $HostAddr`:$Port" -ForegroundColor Cyan

# Uvicorn access logs can be extremely noisy due to polling endpoints (e.g. /overlay_text).
# Default: suppress access log. Set AITUBER_UVICORN_ACCESS_LOG=1 to re-enable.
$accessLog = (($env:AITUBER_UVICORN_ACCESS_LOG + '').Trim().ToLower())
$args = @('uvicorn','apps.main.server.main:app','--host',$HostAddr,'--port',[string]$Port,'--reload')
if ($accessLog -notin @('1','true','yes','on')) {
  $args += '--no-access-log'
}

& .\.venv\Scripts\python.exe -m @args
