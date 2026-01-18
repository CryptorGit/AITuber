param(
  [string]$Config = 'config/tetris-ai/config.yaml',
  [string]$RunId = '',
  [string]$CheckpointId = '',
  [string]$CheckpointPath = '',
  [int]$Episodes = 3,
  [string]$Device = 'cpu',
  [int]$Seed = 0
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

$py = '.\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
  Write-Host '[run_tetris_eval] .venv not found. Running scripts/stream-studio/run_dev.ps1 to create venv + install deps.' -ForegroundColor Cyan
  .\scripts\stream-studio\run_dev.ps1
  if (-not (Test-Path $py)) { throw '[run_tetris_eval] .venv still not found after run_dev.ps1' }
}

if (-not $RunId) { throw '[run_tetris_eval] RunId is required.' }
if (-not $CheckpointId) { throw '[run_tetris_eval] CheckpointId is required.' }
if (-not $CheckpointPath) { throw '[run_tetris_eval] CheckpointPath is required.' }

$args = @('apps/tetris-ai/eval/cli.py', '--config', $Config, '--run-id', $RunId, '--checkpoint-id', $CheckpointId, '--checkpoint-path', $CheckpointPath, '--episodes', [string]$Episodes, '--device', $Device, '--seed', [string]$Seed)

Write-Host '[run_tetris_eval] Starting evaluation' -ForegroundColor Cyan
& $py @args
