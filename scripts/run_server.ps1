param(
  [string]$HostAddr = $env:AITUBER_SERVER_HOST,
  [int]$Port = [int]($env:AITUBER_SERVER_PORT),
  [switch]$Reload
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

# If the server is already running, don't try to bind again.
$baseUrl = "http://$HostAddr`:$Port"
try {
  $h = Invoke-RestMethod ($baseUrl.TrimEnd('/') + '/health') -TimeoutSec 1
  if ($h -and $h.ok) {
    Write-Host "[run_server] Server already running: $baseUrl" -ForegroundColor Green
    Write-Host "Console: $baseUrl/console" -ForegroundColor Green
    Write-Host "Stage:   $baseUrl/stage" -ForegroundColor Green
    return
  }
} catch {
  # ignore
}

# Uvicorn access logs can be extremely noisy due to polling endpoints (e.g. /overlay_text).
# Default: suppress access log. Set AITUBER_UVICORN_ACCESS_LOG=1 to re-enable.
$accessLog = (($env:AITUBER_UVICORN_ACCESS_LOG + '').Trim().ToLower())

$args = @('scripts/run_uvicorn.py','--host',$HostAddr,'--port',[string]$Port)
if ($accessLog -in @('1','true','yes','on')) {
  $args += '--access-log'
}

# Note: --reload intentionally spawns a second "reloader" process.
# Default is single-process (no reload). Use -Reload to enable hot reload.
if ($Reload) {
  $args += '--reload'
}

& .\.venv\Scripts\python.exe @args
