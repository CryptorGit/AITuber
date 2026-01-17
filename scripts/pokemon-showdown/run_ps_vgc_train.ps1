param(
  [int]$Epochs = 0,
  [string]$Format = "gen9vgc2026regf",
  [int]$Seed = 123,
  [int]$PythonPort = 8099,
  [int]$SnapshotEvery = 10,
  # Resume from a PPO snapshot id, or 'latest' to auto-pick the highest step.
  [string]$ResumeSnapshot = "",
  # When Ctrl+C is used to stop training, save a snapshot before exit.
  [int]$SaveSnapshotOnExit = 1,
  [int]$OpponentPool = 20,
  [double]$Lr = 0.01,
  [int]$BatchesPerEpoch = 1,
  [int]$BattlesPerBatch = 20,
  [int]$PpoRolloutLen = 0
)

# Env overrides (so callers can do: $env:VGC_TRAIN_EPOCHS='100'; ./scripts/run_ps_vgc_train.ps1)
if (-not $PSBoundParameters.ContainsKey('Epochs') -and $env:VGC_TRAIN_EPOCHS) { try { $Epochs = [int]$env:VGC_TRAIN_EPOCHS } catch {} }
if (-not $PSBoundParameters.ContainsKey('Format') -and $env:VGC_TRAIN_FORMAT) { $Format = [string]$env:VGC_TRAIN_FORMAT }
if (-not $PSBoundParameters.ContainsKey('Seed') -and $env:VGC_TRAIN_SEED) { try { $Seed = [int]$env:VGC_TRAIN_SEED } catch {} }
if (-not $PSBoundParameters.ContainsKey('PythonPort') -and $env:VGC_TRAIN_PY_PORT) { try { $PythonPort = [int]$env:VGC_TRAIN_PY_PORT } catch {} }
if (-not $PSBoundParameters.ContainsKey('SnapshotEvery') -and $env:VGC_TRAIN_SNAPSHOT_EVERY) { try { $SnapshotEvery = [int]$env:VGC_TRAIN_SNAPSHOT_EVERY } catch {} }
if (-not $PSBoundParameters.ContainsKey('ResumeSnapshot') -and $env:VGC_TRAIN_RESUME_SNAPSHOT) { $ResumeSnapshot = [string]$env:VGC_TRAIN_RESUME_SNAPSHOT }
if (-not $PSBoundParameters.ContainsKey('SaveSnapshotOnExit') -and $env:VGC_TRAIN_SAVE_SNAPSHOT_ON_EXIT) { try { $SaveSnapshotOnExit = [int]$env:VGC_TRAIN_SAVE_SNAPSHOT_ON_EXIT } catch {} }
if (-not $PSBoundParameters.ContainsKey('OpponentPool') -and $env:VGC_TRAIN_OPP_POOL) { try { $OpponentPool = [int]$env:VGC_TRAIN_OPP_POOL } catch {} }
if (-not $PSBoundParameters.ContainsKey('Lr') -and $env:VGC_TRAIN_LR) { try { $Lr = [double]$env:VGC_TRAIN_LR } catch {} }
if (-not $PSBoundParameters.ContainsKey('BatchesPerEpoch') -and $env:VGC_TRAIN_BATCHES_PER_EPOCH) { try { $BatchesPerEpoch = [int]$env:VGC_TRAIN_BATCHES_PER_EPOCH } catch {} }
if (-not $PSBoundParameters.ContainsKey('BattlesPerBatch') -and $env:VGC_TRAIN_BATTLES_PER_BATCH) { try { $BattlesPerBatch = [int]$env:VGC_TRAIN_BATTLES_PER_BATCH } catch {} }
if (-not $PSBoundParameters.ContainsKey('PpoRolloutLen') -and $env:PPO_ROLLOUT_LEN) { try { $PpoRolloutLen = [int]$env:PPO_ROLLOUT_LEN } catch {} }

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$agentDir = Join-Path $repoRoot "apps/pokemon-showdown/vgc-demo/agent"
$orchDir = Join-Path $repoRoot "apps/pokemon-showdown/vgc-demo/orchestrator"

# E2E log capture (file-based evidence). We don't know run_id until TS starts,
# so write to a temp log then move it into data/pokemon-showdown/vgc-demo/logs/runs/{run_id}/e2e_train.log.
$logsRoot = Join-Path $repoRoot "data/pokemon-showdown/vgc-demo/logs"
$runsRoot = Join-Path $logsRoot "runs"
New-Item -ItemType Directory -Path $runsRoot -Force | Out-Null
$tmpLog = Join-Path $logsRoot ("_tmp_vgc_train_{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
$transcriptStarted = $false
try {
  Start-Transcript -Path $tmpLog -Force | Out-Null
  $transcriptStarted = $true
} catch {
  Write-Warning "[vgc-train] Start-Transcript failed; continuing without transcript. error=$($_.Exception.Message)"
}

$pythonProc = $null
$pythonOutLog = $null
$pythonErrLog = $null

function Test-LocalPortInUse {
  param([int]$Port)
  try {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    return [bool]$c
  } catch {
    return $false
  }
}

try {
  if (Test-LocalPortInUse -Port $PythonPort) {
    throw "PythonPort $PythonPort is already in use. Stop the process listening on that port or re-run with -PythonPort <free_port>."
  }

  Write-Host "[vgc-train] Starting Python policy+trainer server..."
  Push-Location $agentDir
  if (-not (Test-Path ".venv")) {
    python -m venv .venv 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "python -m venv failed (exit=$LASTEXITCODE)" }
  }
  & .\.venv\Scripts\python.exe -m pip install --disable-pip-version-check -r requirements.txt 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "pip install failed (exit=$LASTEXITCODE)" }
  $stamp = (Get-Date -Format "yyyyMMdd_HHmmss")
  $pythonOutLog = Join-Path $logsRoot ("_tmp_vgc_agent_{0}.out.log" -f $stamp)
  $pythonErrLog = Join-Path $logsRoot ("_tmp_vgc_agent_{0}.err.log" -f $stamp)
  $pythonProc = Start-Process -FilePath ".\.venv\Scripts\python.exe" -ArgumentList "agent_server.py", "--host", "127.0.0.1", "--port", "$PythonPort", "--log-level", "debug" -RedirectStandardOutput $pythonOutLog -RedirectStandardError $pythonErrLog -PassThru
  Pop-Location

  # Wait until the server is actually reachable (Start-Process is async).
  $baseUrl = "http://127.0.0.1:$PythonPort"
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/snapshot/list" -TimeoutSec 3 -ErrorAction Stop 2>$null | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $ready) {
    $msg = "Python server did not become ready at $baseUrl"
    if ($pythonProc -and $pythonProc.HasExited) {
      $msg = $msg + " (process exited early)"
    }
    if ($pythonOutLog -and (Test-Path $pythonOutLog)) {
      $tailOut = (Get-Content -Path $pythonOutLog -Tail 60 -ErrorAction SilentlyContinue | Out-String)
      if ($tailOut) { $msg = $msg + "`n--- python stdout tail ($pythonOutLog) ---`n" + $tailOut }
    }
    if ($pythonErrLog -and (Test-Path $pythonErrLog)) {
      $tailErr = (Get-Content -Path $pythonErrLog -Tail 60 -ErrorAction SilentlyContinue | Out-String)
      if ($tailErr) { $msg = $msg + "`n--- python stderr tail ($pythonErrLog) ---`n" + $tailErr }
    }
    throw $msg
  }

  Write-Host "[vgc-train] Running training loop (Ctrl+C to stop)..."
  Push-Location $orchDir
  & npm.cmd install 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit=$LASTEXITCODE)" }

  if ($PpoRolloutLen -gt 0) {
    $env:PPO_ROLLOUT_LEN = [string]$PpoRolloutLen
    $env:PPO_ROLLOUT_LEN_SOURCE = 'cli'
    Write-Host "[vgc-train] PPO_ROLLOUT_LEN=$env:PPO_ROLLOUT_LEN"
  }

  if ($ResumeSnapshot) {
    $env:VGC_TRAIN_RESUME_SNAPSHOT = [string]$ResumeSnapshot
    Write-Host "[vgc-train] VGC_TRAIN_RESUME_SNAPSHOT=$env:VGC_TRAIN_RESUME_SNAPSHOT"
  }
  $env:VGC_TRAIN_SAVE_SNAPSHOT_ON_EXIT = [string]$SaveSnapshotOnExit
  Write-Host "[vgc-train] VGC_TRAIN_SAVE_SNAPSHOT_ON_EXIT=$env:VGC_TRAIN_SAVE_SNAPSHOT_ON_EXIT"

  # NOTE: some npm versions treat unknown --flags as npm config. Use positional args.
  # Extra positional args are accepted by src/train.ts as fallbacks:
  #   [resume_snapshot] [save_snapshot_on_exit]
  if ($ResumeSnapshot) {
    & npm.cmd run train -- $Epochs $Format "http://127.0.0.1:$PythonPort" $Seed $SnapshotEvery $OpponentPool $Lr $BatchesPerEpoch $BattlesPerBatch $ResumeSnapshot $SaveSnapshotOnExit 2>&1 | Out-Host
  } else {
    & npm.cmd run train -- $Epochs $Format "http://127.0.0.1:$PythonPort" $Seed $SnapshotEvery $OpponentPool $Lr $BatchesPerEpoch $BattlesPerBatch $SaveSnapshotOnExit 2>&1 | Out-Host
  }
  if ($LASTEXITCODE -ne 0) { throw "npm run train failed (exit=$LASTEXITCODE)" }
  Pop-Location
}
catch {
  Write-Host "[vgc-train] ERROR: $($_.Exception.Message)" -ForegroundColor Red
  throw
}
finally {
  if ($transcriptStarted) {
    try { Stop-Transcript | Out-Null } catch {}
    # If we can find run_id in the transcript, move it under the per-run directory.
    try {
      $m = Select-String -Path $tmpLog -Pattern "^\[train\] run_id=(\S+)" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($m -and $m.Matches -and $m.Matches.Count -gt 0) {
        $runId = $m.Matches[0].Groups[1].Value
        if ($runId) {
          $runDir = Join-Path $runsRoot $runId
          New-Item -ItemType Directory -Path $runDir -Force | Out-Null
          $dst = Join-Path $runDir "e2e_train.log"
          Move-Item -Path $tmpLog -Destination $dst -Force
          Write-Host "[vgc-train] Saved E2E log: $dst"
        }
      }
    } catch {
      Write-Warning "[vgc-train] Failed to relocate transcript: $($_.Exception.Message)"
    }
  }
  if ($pythonProc -and -not $pythonProc.HasExited) {
    Write-Host "[vgc-train] Stopping Python server (pid=$($pythonProc.Id))..."
    try { Stop-Process -Id $pythonProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
}
