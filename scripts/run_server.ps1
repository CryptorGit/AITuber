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
.\.venv\Scripts\python.exe -m uvicorn apps.main.server.main:app --host $HostAddr --port $Port --reload
