param(
  [ValidateSet('double','single')] [string]$Mode = 'double',
  [ValidateSet('demo','train')] [string]$Action = 'demo',

  # demo
  [int]$Battles = 20,

  # train
  [int]$Epochs = 0,
  [int]$SnapshotEvery = 10,
  [int]$OpponentPool = 20,
  [double]$Lr = 0.01,

  # common
  [string]$Format = '',
  [int]$PythonPort = 8099,
  [int]$Seed = 123
)

$ErrorActionPreference = 'Stop'

# Defaults per mode
if (-not $Format) {
  if ($Mode -eq 'double') {
    $Format = 'gen9vgc2026regf'
  } else {
    # Singles here means Battle Stadium Singles style (6 shown -> pick 3).
    # If your generated sets aren't legal for this ladder, override with -Format.
    $Format = 'gen9bssregi'
  }
}

# Tell orchestrator how many mons to pick at team preview.
# - double(VGC): 6 shown -> pick 4
# - single(BSS): 6 shown -> pick 3
if ($Mode -eq 'double') {
  $env:PS_PICK_N = '4'
} else {
  $env:PS_PICK_N = '3'
}

# Keep existing env override behavior in the underlying scripts.
$env:VGC_TRAIN_SEED = "$Seed"
$env:VGC_DEMO_FORMAT = "$Format"
$env:VGC_TRAIN_FORMAT = "$Format"
$env:VGC_DEMO_PY_PORT = "$PythonPort"
$env:VGC_TRAIN_PY_PORT = "$PythonPort"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

if ($Action -eq 'demo') {
  $env:VGC_DEMO_BATTLES = "$Battles"
  Write-Host "[one-shot][$Mode] demo battles=$Battles format=$Format pythonPort=$PythonPort" -ForegroundColor Cyan
  & .\scripts\pokemon-showdown\run_ps_vgc_demo.ps1 -Battles $Battles -Format $Format -PythonPort $PythonPort
  exit $LASTEXITCODE
}

$env:VGC_TRAIN_EPOCHS = "$Epochs"
$env:VGC_TRAIN_SNAPSHOT_EVERY = "$SnapshotEvery"
$env:VGC_TRAIN_OPP_POOL = "$OpponentPool"
$env:VGC_TRAIN_LR = "$Lr"

Write-Host "[one-shot][$Mode] train epochs=$Epochs format=$Format pythonPort=$PythonPort seed=$Seed snapshotEvery=$SnapshotEvery opponentPool=$OpponentPool lr=$Lr" -ForegroundColor Cyan
& .\scripts\pokemon-showdown\run_ps_vgc_train.ps1 -Epochs $Epochs -Format $Format -Seed $Seed -PythonPort $PythonPort -SnapshotEvery $SnapshotEvery -OpponentPool $OpponentPool -Lr $Lr
exit $LASTEXITCODE
