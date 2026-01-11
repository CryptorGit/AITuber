param(
  [string]$ServerHost = '127.0.0.1',
  [int]$ServerPort = 8787,
  [int]$UiPort = 5173,
  [switch]$NoKill,
  [switch]$NoBrowser,
  [switch]$InstallDeps,
  [switch]$InstallPlaywright,
  [switch]$ShowLogsOnFailure
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

$logDir = Join-Path $repoRoot 'data/pokemon-showdown/logs/replay-studio'
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

# Validate Node/npm exist
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[run_replay_studio] node not found in PATH.' -ForegroundColor Yellow
  Write-Host 'Install Node.js (LTS) and ensure `node`/`npm` are available.' -ForegroundColor Yellow
  exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host '[run_replay_studio] npm not found in PATH.' -ForegroundColor Yellow
  exit 1
}

$serverDir = Join-Path $repoRoot 'apps/pokemon-showdown/replay-studio/server'
$uiDir = Join-Path $repoRoot 'web/pokemon-showdown/replay-studio/ui'

if (-not (Test-Path (Join-Path $serverDir 'package.json'))) {
  throw "[run_replay_studio] Missing server package.json: $serverDir"
}
if (-not (Test-Path (Join-Path $uiDir 'package.json'))) {
  throw "[run_replay_studio] Missing ui package.json: $uiDir"
}

if (-not $NoKill) {
  Write-Host "[run_replay_studio] Freeing ports $ServerPort (server) and $UiPort (ui)" -ForegroundColor Cyan
  Stop-ListeningPort -Port $ServerPort
  Stop-ListeningPort -Port $UiPort
}

if ($InstallDeps) {
  Write-Host '[run_replay_studio] Installing server deps (npm install)' -ForegroundColor Cyan
  & npm --prefix $serverDir install

  Write-Host '[run_replay_studio] Installing ui deps (npm install)' -ForegroundColor Cyan
  & npm --prefix $uiDir install
}

if ($InstallPlaywright) {
  Write-Host '[run_replay_studio] Installing Playwright Chromium (server)' -ForegroundColor Cyan
  & npm --prefix $serverDir run playwright:install
}

$serverUrl = "http://$ServerHost`:$ServerPort"

# Use explicit IPv4 loopback to avoid Windows/PowerShell preferring IPv6 (::1) for localhost.
# Vite is started with --host 127.0.0.1, so localhost health checks can fail.
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

  # Important: Vite (and some Node dev servers) can exit immediately if started without a console/stdin.
  # We start a dedicated PowerShell window (-NoExit) and tee output to a log file.
  $psCmd = @(
    "`$host.UI.RawUI.WindowTitle = '$Title';",
    "Set-Location -LiteralPath `"$repoRoot`";",
    "$Command 2>&1 | Tee-Object -FilePath `"$LogPath`""
  ) -join ' '

  return Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NoExit', '-Command', $psCmd) -WorkingDirectory $repoRoot -PassThru
}

# Start server in a new terminal window
Write-Host "[run_replay_studio] Starting server: $serverUrl" -ForegroundColor Cyan
$serverCmd = "`$env:PORT=$ServerPort; npm --prefix `"$serverDir`" run dev"
$serverProc = Start-LoggedProcess -Title 'Replay Studio: server' -Command $serverCmd -LogPath $serverOut

# Start UI in a new terminal window
Write-Host "[run_replay_studio] Starting ui: $uiUrl" -ForegroundColor Cyan
$uiCmd = "`$env:UI_HOST='127.0.0.1'; `$env:UI_PORT=$UiPort; npm --prefix `"$uiDir`" run dev"
$uiProc = Start-LoggedProcess -Title 'Replay Studio: ui' -Command $uiCmd -LogPath $uiOut

Start-Sleep -Milliseconds 500
if ($serverProc.HasExited) {
  Write-Host "[run_replay_studio] Server process exited early." -ForegroundColor Yellow
}
if ($uiProc.HasExited) {
  Write-Host "[run_replay_studio] UI process exited early." -ForegroundColor Yellow
}

# Wait for readiness
$serverReady = Wait-HttpOk -Url ("$serverUrl/api/replays?page=1") -TimeoutSeconds 30
$uiReady = Wait-HttpOk -Url $uiUrl -TimeoutSeconds 45

if ($serverReady) {
  Write-Host "[run_replay_studio] Server OK: $serverUrl" -ForegroundColor Green
} else {
  Write-Host "[run_replay_studio] Server did not respond: $serverUrl" -ForegroundColor Yellow
}

if ($uiReady) {
  Write-Host "[run_replay_studio] UI OK: $uiUrl" -ForegroundColor Green
} else {
  Write-Host "[run_replay_studio] UI did not respond: $uiUrl" -ForegroundColor Yellow
}

if ((-not $serverReady) -or (-not $uiReady) -or $serverProc.HasExited -or $uiProc.HasExited) {
  Write-Host "[run_replay_studio] Logs: $logDir" -ForegroundColor Cyan

  # Output is tee'd into *.out.log; stderr is included.
  if ($ShowLogsOnFailure -or (-not $serverReady)) {
    $t = Get-LogTail -Path $serverOut
    if ($t.Count -gt 0) {
      Write-Host '[run_replay_studio] --- server.out.log (tail) ---' -ForegroundColor DarkYellow
      $t | ForEach-Object { Write-Host $_ }
    }
  }
  if ($ShowLogsOnFailure -or (-not $uiReady)) {
    $t = Get-LogTail -Path $uiOut
    if ($t.Count -gt 0) {
      Write-Host '[run_replay_studio] --- ui.out.log (tail) ---' -ForegroundColor DarkYellow
      $t | ForEach-Object { Write-Host $_ }
    }
  }

  Write-Host '[run_replay_studio] If you see missing package errors, re-run with -InstallDeps.' -ForegroundColor Gray
}

if (-not $NoBrowser) {
  $openUrl = "$uiUrl/replays"
  Write-Host "[run_replay_studio] Opening: $openUrl" -ForegroundColor Cyan
  if ($uiReady) {
    Start-Process $openUrl | Out-Null
  } else {
    Write-Host '[run_replay_studio] Not opening browser because UI is not ready.' -ForegroundColor Yellow
  }
}

Write-Host '[run_replay_studio] Done.' -ForegroundColor Gray
