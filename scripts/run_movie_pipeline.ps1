param(
  [string]$ServerHost = '127.0.0.1',
  [int]$ServerPort = 8788,
  [int]$UiPort = 5175,
  [switch]$NoKill,
  [switch]$NoBrowser,
  [switch]$InstallDeps,
  [switch]$InstallPlaywright,
  [switch]$ShowLogsOnFailure
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$logDir = Join-Path $repoRoot 'data/movie-pipeline/logs/run'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Get-LogTail {
  param(
    [string]$Path,
    [int]$Lines = 60
  )
  if (-not (Test-Path $Path)) { return @() }
  try { return (Get-Content -Path $Path -Tail $Lines -ErrorAction SilentlyContinue) } catch { return @() }
}

function Stop-ListeningPort {
  param([int]$Port)
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }
    if (-not $conns) { return }
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $pids) {
      try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
    }
  } catch {
    # ignore
  }
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

function Wait-HttpOk {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 20
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-HttpOk $Url) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[run_movie_pipeline] node not found in PATH.' -ForegroundColor Yellow
  Write-Host 'Install Node.js (LTS) and ensure `node`/`npm` are available.' -ForegroundColor Yellow
  exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host '[run_movie_pipeline] npm not found in PATH.' -ForegroundColor Yellow
  exit 1
}

$coreDir = Join-Path $repoRoot 'apps/movie-pipeline/core'
$serverDir = Join-Path $repoRoot 'apps/movie-pipeline/server'
$uiDir = Join-Path $repoRoot 'web/movie-pipeline'

if (-not (Test-Path (Join-Path $coreDir 'package.json'))) {
  throw "[run_movie_pipeline] Missing core package.json: $coreDir"
}
if (-not (Test-Path (Join-Path $serverDir 'package.json'))) {
  throw "[run_movie_pipeline] Missing server package.json: $serverDir"
}
if (-not (Test-Path (Join-Path $uiDir 'package.json'))) {
  throw "[run_movie_pipeline] Missing ui package.json: $uiDir"
}

if (-not $NoKill) {
  Write-Host "[run_movie_pipeline] Freeing ports $ServerPort (server) and $UiPort (ui)" -ForegroundColor Cyan
  Stop-ListeningPort -Port $ServerPort
  Stop-ListeningPort -Port $UiPort
}

if ($InstallDeps) {
  Write-Host '[run_movie_pipeline] Installing core deps (npm install)' -ForegroundColor Cyan
  & npm --prefix $coreDir install

  Write-Host '[run_movie_pipeline] Installing server deps (npm install)' -ForegroundColor Cyan
  & npm --prefix $serverDir install

  Write-Host '[run_movie_pipeline] Installing ui deps (npm install)' -ForegroundColor Cyan
  & npm --prefix $uiDir install
}

if ($InstallPlaywright) {
  Write-Host '[run_movie_pipeline] Installing Playwright Chromium (core)' -ForegroundColor Cyan
  & npm --prefix $coreDir exec playwright install chromium
}

$serverUrl = "http://$ServerHost`:$ServerPort"
$serverUrl = "http://127.0.0.1`:$ServerPort"
$uiUrl = "http://127.0.0.1`:$UiPort"

$serverOut = Join-Path $logDir 'server.out.log'
$serverErr = Join-Path $logDir 'server.err.log'
$uiOut = Join-Path $logDir 'ui.out.log'
$uiErr = Join-Path $logDir 'ui.err.log'

Remove-Item -Force -ErrorAction SilentlyContinue $serverOut, $serverErr, $uiOut, $uiErr | Out-Null

function Start-LoggedProcess {
  param(
    [string]$Title,
    [string]$Command,
    [string]$LogPath
  )

  $psCmd = @(
    "`$host.UI.RawUI.WindowTitle = '$Title';",
    "Set-Location -LiteralPath `"$repoRoot`";",
    "$Command 2>&1 | Tee-Object -FilePath `"$LogPath`""
  ) -join ' '

  return Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NoExit', '-Command', $psCmd) -WorkingDirectory $repoRoot -PassThru
}

Write-Host "[run_movie_pipeline] Starting server: $serverUrl" -ForegroundColor Cyan
$serverCmd = "`$env:MP_PORT=$ServerPort; npm --prefix `"$serverDir`" run dev"
$serverProc = Start-LoggedProcess -Title 'Movie Pipeline: server' -Command $serverCmd -LogPath $serverOut

Write-Host "[run_movie_pipeline] Starting ui: $uiUrl" -ForegroundColor Cyan
$uiCmd = "`$env:VITE_MP_API_BASE='$serverUrl'; npm --prefix `"$uiDir`" run dev"
$uiProc = Start-LoggedProcess -Title 'Movie Pipeline: ui' -Command $uiCmd -LogPath $uiOut

Start-Sleep -Milliseconds 500
if ($serverProc.HasExited) {
  Write-Host "[run_movie_pipeline] Server process exited early." -ForegroundColor Yellow
}
if ($uiProc.HasExited) {
  Write-Host "[run_movie_pipeline] UI process exited early." -ForegroundColor Yellow
}

$serverReady = Wait-HttpOk -Url ("$serverUrl/api/mp/doctor") -TimeoutSeconds 30
$uiReady = Wait-HttpOk -Url $uiUrl -TimeoutSeconds 45

if ($serverReady) {
  Write-Host "[run_movie_pipeline] Server OK: $serverUrl" -ForegroundColor Green
} else {
  Write-Host "[run_movie_pipeline] Server did not respond: $serverUrl" -ForegroundColor Yellow
}

if ($uiReady) {
  Write-Host "[run_movie_pipeline] UI OK: $uiUrl" -ForegroundColor Green
} else {
  Write-Host "[run_movie_pipeline] UI did not respond: $uiUrl" -ForegroundColor Yellow
}

$exitCode = 0
if (-not $serverReady) { $exitCode = 1 }
if (-not $uiReady) { $exitCode = 1 }
if ($serverProc.HasExited) { $exitCode = 1 }
if ($uiProc.HasExited) { $exitCode = 1 }

if ((-not $serverReady) -or (-not $uiReady) -or $serverProc.HasExited -or $uiProc.HasExited) {
  Write-Host "[run_movie_pipeline] Logs: $logDir" -ForegroundColor Cyan

  if ($ShowLogsOnFailure -or (-not $serverReady)) {
    $t = Get-LogTail -Path $serverOut
    if ($t.Count -gt 0) {
      Write-Host '[run_movie_pipeline] --- server.out.log (tail) ---' -ForegroundColor DarkYellow
      $t | ForEach-Object { Write-Host $_ }
    }
  }
  if ($ShowLogsOnFailure -or (-not $uiReady)) {
    $t = Get-LogTail -Path $uiOut
    if ($t.Count -gt 0) {
      Write-Host '[run_movie_pipeline] --- ui.out.log (tail) ---' -ForegroundColor DarkYellow
      $t | ForEach-Object { Write-Host $_ }
    }
  }

  Write-Host '[run_movie_pipeline] If you see missing package errors, re-run with -InstallDeps.' -ForegroundColor Gray
}

if (-not $NoBrowser) {
  Write-Host "[run_movie_pipeline] Opening: $uiUrl" -ForegroundColor Cyan
  if ($uiReady) {
    Start-Process $uiUrl | Out-Null
  } else {
    Write-Host '[run_movie_pipeline] Not opening browser because UI is not ready.' -ForegroundColor Yellow
  }
}

Write-Host '[run_movie_pipeline] Done.' -ForegroundColor Gray

exit $exitCode
