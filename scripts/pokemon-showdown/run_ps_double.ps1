param(
  [ValidateSet('demo','train')] [string]$Action = 'demo',
  [int]$Battles = 20,
  [int]$Epochs = 0,
  [int]$SnapshotEvery = 10,
  [int]$OpponentPool = 20,
  [double]$Lr = 0.01,
  [string]$Format = '',
  [int]$PythonPort = 8099,
  [int]$Seed = 123
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

$args = @{
  Mode         = 'double'
  Action       = $Action
  Battles      = $Battles
  Epochs       = $Epochs
  SnapshotEvery= $SnapshotEvery
  OpponentPool = $OpponentPool
  Lr           = $Lr
  Format       = $Format
  PythonPort   = $PythonPort
  Seed         = $Seed
}

& .\scripts\pokemon-showdown\run_ps_one_shot.ps1 @args

exit $LASTEXITCODE
