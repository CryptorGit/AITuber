param(
  [string]$HostAddr = '127.0.0.1',
  [int]$Port = 8000,
  [bool]$Reload = $true,
  [bool]$EnsureGoogleTts = $true
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$py = '.\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
  Write-Host '[run_stack] .venv not found. Running scripts/run_dev.ps1 to create venv + install deps.' -ForegroundColor Cyan
  .\scripts\run_dev.ps1
  # run_dev.ps1 starts the server in foreground; if it returned, it likely failed.
  if (-not (Test-Path $py)) {
    throw '[run_stack] .venv still not found after run_dev.ps1'
  }
}

Write-Host '[run_stack] Installing/refreshing requirements' -ForegroundColor Cyan
& $py -m pip install -r requirements.txt

# Ensure .env exists (run_dev behavior)
if (-not (Test-Path '.env')) { New-Item -ItemType Directory -Path '.env' | Out-Null }

# Use .env/.env.main (local file) for the main app.
$env:AITUBER_ENV_FILE = '.env/.env.main'

# Best-effort warnings about required secrets (do not print values).
try {
  $hasGeminiKey = $false
  if (Test-Path '.env\.env') {
    $line = Get-Content '.env\.env' -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*AITUBER_GEMINI_API_KEY\s*=\s*\S+' } | Select-Object -First 1
    if ($line) { $hasGeminiKey = $true }
  }
  if (-not $hasGeminiKey) {
    Write-Host '[run_stack] NOTE: AITUBER_GEMINI_API_KEY is missing/blank in .env/.env; LLM will fall back.' -ForegroundColor Yellow
  }
} catch {
  # ignore
}

function Test-HttpOk {
  param([string]$Url)
  try {
    $r = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Wait-Healthy {
  param(
    [string]$BaseUrl,
    [int]$TimeoutSeconds = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $h = Invoke-RestMethod ($BaseUrl.TrimEnd('/') + '/health') -TimeoutSec 2
      if ($h -and $h.ok) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 350
  }
  return $false
}

if ($EnsureGoogleTts) {
  # Best-effort hint only (does not validate secrets).
  $gac = ($env:GOOGLE_APPLICATION_CREDENTIALS + '').Trim()
  if (-not $gac) {
    Write-Host '[run_stack] NOTE: GOOGLE_APPLICATION_CREDENTIALS is not set; Google TTS may fail.' -ForegroundColor Yellow
  } elseif (-not (Test-Path $gac)) {
    Write-Host ('[run_stack] NOTE: GOOGLE_APPLICATION_CREDENTIALS path not found: ' + $gac) -ForegroundColor Yellow
  }
  $env:AITUBER_LLM_PROVIDER = 'gemini'
  $env:AITUBER_TTS_PROVIDER = 'google'
}

Write-Host "[run_stack] Starting AITuber server on http://$HostAddr`:$Port" -ForegroundColor Cyan
$baseUrl = "http://$HostAddr`:$Port"
if (Wait-Healthy -BaseUrl $baseUrl -TimeoutSeconds 2) {
  Write-Host "[run_stack] Server already running: $baseUrl" -ForegroundColor Green
  Write-Host "Console: http://$HostAddr`:$Port/console" -ForegroundColor Green
  Write-Host "Stage:   http://$HostAddr`:$Port/stage" -ForegroundColor Green
  return
}

$uvArgs = @('uvicorn','apps.server.main:app','--host',$HostAddr,'--port',[string]$Port)

Write-Host ''
Write-Host '---' -ForegroundColor DarkGray
Write-Host "Console: http://$HostAddr`:$Port/console" -ForegroundColor Green
Write-Host "Stage:   http://$HostAddr`:$Port/stage" -ForegroundColor Green
Write-Host '---' -ForegroundColor DarkGray

if ($Reload) {
  # Run in foreground so the script stays alive (uvicorn --reload spawns a reloader).
  & $py -m @($uvArgs + @('--reload'))
  return
}

# Non-reload: run detached with logs + PID for stop_stack.
$logsDir = 'data/logs'
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
$serverOutLog = Join-Path $logsDir ("stack_server_" + $ts + ".out.log")
$serverErrLog = Join-Path $logsDir ("stack_server_" + $ts + ".err.log")
$pidFile = Join-Path $logsDir 'stack_server.pid'

$serverProc = Start-Process -FilePath $py -ArgumentList (@('-m') + $uvArgs) -PassThru -RedirectStandardOutput $serverOutLog -RedirectStandardError $serverErrLog
$serverProc.Id | Out-File -FilePath $pidFile -Encoding ascii

if (-not (Wait-Healthy -BaseUrl $baseUrl -TimeoutSeconds 25)) {
  Write-Host "[run_stack] Server did not become healthy: $baseUrl" -ForegroundColor Yellow
  Write-Host "[run_stack] Log(out): $serverOutLog" -ForegroundColor Yellow
  Write-Host "[run_stack] Log(err): $serverErrLog" -ForegroundColor Yellow
  try { Stop-Process -Id $serverProc.Id -Force } catch {}
  exit 1
}

Write-Host "Server PID: $($serverProc.Id)" -ForegroundColor Gray
Write-Host "Stop: .\scripts\stop_stack.ps1" -ForegroundColor Gray
Write-Host "Log(out): $serverOutLog" -ForegroundColor Gray
Write-Host "Log(err): $serverErrLog" -ForegroundColor Gray

# Detach: do not wait for the server process.
return
