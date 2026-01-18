param(
  [string]$Config = 'config/tetris-ai/config.yaml',
  [string]$RunId = '',
  [int]$TotalSteps = 0,
  [int]$EvalInterval = 0,
  [int]$EvalEpisodes = 0,
  [string]$Device = 'cpu'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

$py = '.\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
  Write-Host '[run_tetris_train] .venv not found. Running scripts/stream-studio/run_dev.ps1 to create venv + install deps.' -ForegroundColor Cyan
  .\scripts\stream-studio\run_dev.ps1
  if (-not (Test-Path $py)) { throw '[run_tetris_train] .venv still not found after run_dev.ps1' }
}

$args = @('apps/tetris-ai/train/cli.py', '--config', $Config, '--device', $Device)
if ($RunId) { $args += @('--run-id', $RunId) }
if ($TotalSteps -gt 0) { $args += @('--total-steps', [string]$TotalSteps) }
if ($EvalInterval -gt 0) { $args += @('--eval-interval', [string]$EvalInterval) }
if ($EvalEpisodes -gt 0) { $args += @('--eval-episodes', [string]$EvalEpisodes) }

Write-Host '[run_tetris_train] Starting training' -ForegroundColor Cyan
& $py @args
