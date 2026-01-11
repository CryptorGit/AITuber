param(
  [string]$HostAddr = $env:AITUBER_SERVER_HOST,
  [int]$Port = [int]($env:AITUBER_SERVER_PORT),
  [switch]$Reload,
  [switch]$Detach
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

function Wait-Healthy {
  param(
    [string]$BaseUrl,
    [int]$TimeoutSeconds = 10
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $healthUrl = ($BaseUrl.TrimEnd('/') + '/health')
  while ((Get-Date) -lt $deadline) {
    try {
      $h = Invoke-RestMethod $healthUrl -TimeoutSec 1
      if ($h -and $h.ok) { return $true }
    } catch {
      # ignore
    }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

if (-not $Detach) {
  & .\.venv\Scripts\python.exe @args
  exit $LASTEXITCODE
}

# Detached: keep server alive even if this PowerShell session exits.
if ($Reload) {
  Write-Host "[run_server] NOTE: -Reload with -Detach is not recommended; running in foreground instead." -ForegroundColor Yellow
  & .\.venv\Scripts\python.exe @args
  exit $LASTEXITCODE
}

$logsDir = 'data/stream_studio/logs'
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
$outLog = Join-Path $logsDir ("server_" + $ts + ".out.log")
$errLog = Join-Path $logsDir ("server_" + $ts + ".err.log")
$pidFile = Join-Path $logsDir 'server.pid'

$py = ".\\.venv\\Scripts\\python.exe"
$serverProc = Start-Process -FilePath $py -ArgumentList $args -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
$serverProc.Id | Out-File -FilePath $pidFile -Encoding ascii

if (-not (Wait-Healthy -BaseUrl $baseUrl -TimeoutSeconds 15)) {
  Write-Host "[run_server] Server did not become healthy: $baseUrl" -ForegroundColor Yellow
  Write-Host "[run_server] Log(out): $outLog" -ForegroundColor Yellow
  Write-Host "[run_server] Log(err): $errLog" -ForegroundColor Yellow
  try { Stop-Process -Id $serverProc.Id -Force } catch {}
  exit 1
}

Write-Host "[run_server] Server PID: $($serverProc.Id)" -ForegroundColor Gray
Write-Host "[run_server] Console: $baseUrl/console" -ForegroundColor Green
Write-Host "[run_server] Stage:   $baseUrl/stage" -ForegroundColor Green
Write-Host "[run_server] Log(out): $outLog" -ForegroundColor Gray
Write-Host "[run_server] Log(err): $errLog" -ForegroundColor Gray
return
