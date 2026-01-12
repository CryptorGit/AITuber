param(
  [string]$Format = "gen9vgc2026regf",
  [int]$Seed = 2,
  [int]$PythonPort = 8099,
  [int]$OpponentPool = 20,
  [double]$Lr = 0.01,

  # Relaunch this script as a detached background PowerShell process.
  # This avoids VS Code terminal churn during long runs.
  [switch]$Detach,

  # Log directory for detached runs. If empty, a timestamped folder under logs/forever/ is used.
  [string]$LogDir = "",

  # How many battles to run per chunk (one invocation of run_ps_vgc_train.ps1).
  # Smaller chunks = more frequent snapshots + faster restart after failures.
  [int]$BattlesPerBatch = 6000,

  # Rollout length for PPO updates.
  [int]$PpoRolloutLen = 8,

  # Save a PPO snapshot every N updates during training.
  # This is independent from replay saving; it's for resuming after crashes.
  [int]$SnapshotEvery = 1000,

  # Save exactly one replay after crossing each N updates.
  [int]$ReplayEveryUpdates = 10000,

  # Sleep between chunks (helps when recovering from transient errors).
  [int]$SleepOnErrorSec = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$trainScript = Join-Path $repoRoot "scripts/pokemon-showdown/run_ps_vgc_train.ps1"

if (-not (Test-Path $trainScript)) {
  throw "Missing train script: $trainScript"
}

if ($Detach -and $env:VGC_TRAIN_FOREVER_CHILD -ne "1") {
  if (-not $LogDir) {
    $LogDir = Join-Path $repoRoot ("logs/forever/" + (Get-Date -Format "yyyyMMdd_HHmmss"))
  }

  New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
  $stdoutPath = Join-Path $LogDir "stdout.log"
  $stderrPath = Join-Path $LogDir "stderr.log"
  $pidPath = Join-Path $LogDir "pid.txt"

  $childArgs = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $PSCommandPath,
    "-Format", $Format,
    "-Seed", [string]$Seed,
    "-PythonPort", [string]$PythonPort,
    "-OpponentPool", [string]$OpponentPool,
    "-Lr", [string]$Lr,
    "-BattlesPerBatch", [string]$BattlesPerBatch,
    "-PpoRolloutLen", [string]$PpoRolloutLen,
    "-SnapshotEvery", [string]$SnapshotEvery,
    "-ReplayEveryUpdates", [string]$ReplayEveryUpdates,
    "-SleepOnErrorSec", [string]$SleepOnErrorSec,
    "-LogDir", $LogDir
  )

  $prevChild = $env:VGC_TRAIN_FOREVER_CHILD
  $env:VGC_TRAIN_FOREVER_CHILD = "1"
  try {
    $p = Start-Process -FilePath "powershell.exe" -ArgumentList $childArgs -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  }
  finally {
    if ($null -eq $prevChild) { Remove-Item Env:VGC_TRAIN_FOREVER_CHILD -ErrorAction SilentlyContinue } else { $env:VGC_TRAIN_FOREVER_CHILD = $prevChild }
  }

  Set-Content -Path $pidPath -Value ([string]$p.Id) -Encoding ascii
  Write-Host ("[forever] detached pid={0}" -f $p.Id) -ForegroundColor Cyan
  Write-Host ("[forever] logs: {0}" -f $LogDir) -ForegroundColor Cyan
  Write-Host ("[forever] stop: Stop-Process -Id (Get-Content '{0}')" -f $pidPath) -ForegroundColor DarkGray
  exit 0
}

# Replay logging throttle (Replay Studio indexing expects train_* outputs + replays.jsonl(.gz))
$env:VGC_SAVE_REPLAY = "1"
$env:VGC_SAVE_REPLAY_ONLY_AFTER_UPDATE = "1"
$env:VGC_SAVE_REPLAY_EVERY_N_UPDATES = [string]$ReplayEveryUpdates

# If you don't want extra per-step logs during long runs, keep this off.
if (-not $env:VGC_SAVE_TRAIN_LOG) {
  $env:VGC_SAVE_TRAIN_LOG = "0"
}

# PPO rollout length
$env:PPO_ROLLOUT_LEN = [string]$PpoRolloutLen
$env:PPO_ROLLOUT_LEN_SOURCE = "cli"

Write-Host "[forever] format=$Format seed=$Seed python_port=$PythonPort opponent_pool=$OpponentPool lr=$Lr" -ForegroundColor Cyan
Write-Host "[forever] battles_per_batch=$BattlesPerBatch ppo_rollout_len=$PpoRolloutLen snapshot_every=$SnapshotEvery" -ForegroundColor Cyan
Write-Host "[forever] replay_only_after_update=1 replay_every_updates=$ReplayEveryUpdates" -ForegroundColor Cyan
Write-Host "[forever] Starting infinite training loop. Stop with Ctrl+C." -ForegroundColor Cyan

while ($true) {
  Write-Host ("[forever] chunk start: {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
  try {
    & $trainScript `
      -Epochs 1 `
      -BatchesPerEpoch 1 `
      -BattlesPerBatch $BattlesPerBatch `
      -Format $Format `
      -Seed $Seed `
      -PythonPort $PythonPort `
      -OpponentPool $OpponentPool `
      -Lr $Lr `
      -SnapshotEvery $SnapshotEvery `
      -ResumeSnapshot "latest" `
      -SaveSnapshotOnExit 1 `
      -PpoRolloutLen $PpoRolloutLen

    Write-Host ("[forever] chunk done: {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
  }
  catch {
    Write-Warning ("[forever] chunk failed: {0}" -f $_.Exception.Message)
    Start-Sleep -Seconds $SleepOnErrorSec
  }
}
