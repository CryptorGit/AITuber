$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

if (-not (Test-Path ".venv")) {
  Write-Host "[run_dev] Creating venv" -ForegroundColor Cyan
  py -3 -m venv .venv
}

Write-Host "[run_dev] Installing requirements" -ForegroundColor Cyan
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\pip.exe install -r requirements.txt

if (-not (Test-Path ".env")) {
  New-Item -ItemType Directory -Path ".env" | Out-Null
}

# Use .env/.env.main (local file) for the main app.
$env:AITUBER_ENV_FILE = ".env/.env.main"

Write-Host "[run_dev] Starting server" -ForegroundColor Cyan
.\scripts\stream_studio\run_server.ps1
