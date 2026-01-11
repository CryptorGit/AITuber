param(
  [int]$Epochs = 0,
  [string]$Format = "gen9vgc2026regf",
  [int]$Seed = 123,
  [int]$PythonPort = 8099,
  [int]$SnapshotEvery = 10,
  [int]$OpponentPool = 20,
  [double]$Lr = 0.01
)

# Env overrides (so callers can do: $env:VGC_TRAIN_EPOCHS='100'; ./scripts/run_ps_vgc_train.ps1)
if (-not $PSBoundParameters.ContainsKey('Epochs') -and $env:VGC_TRAIN_EPOCHS) { try { $Epochs = [int]$env:VGC_TRAIN_EPOCHS } catch {} }
if (-not $PSBoundParameters.ContainsKey('Format') -and $env:VGC_TRAIN_FORMAT) { $Format = [string]$env:VGC_TRAIN_FORMAT }
if (-not $PSBoundParameters.ContainsKey('Seed') -and $env:VGC_TRAIN_SEED) { try { $Seed = [int]$env:VGC_TRAIN_SEED } catch {} }
if (-not $PSBoundParameters.ContainsKey('PythonPort') -and $env:VGC_TRAIN_PY_PORT) { try { $PythonPort = [int]$env:VGC_TRAIN_PY_PORT } catch {} }
if (-not $PSBoundParameters.ContainsKey('SnapshotEvery') -and $env:VGC_TRAIN_SNAPSHOT_EVERY) { try { $SnapshotEvery = [int]$env:VGC_TRAIN_SNAPSHOT_EVERY } catch {} }
if (-not $PSBoundParameters.ContainsKey('OpponentPool') -and $env:VGC_TRAIN_OPP_POOL) { try { $OpponentPool = [int]$env:VGC_TRAIN_OPP_POOL } catch {} }
if (-not $PSBoundParameters.ContainsKey('Lr') -and $env:VGC_TRAIN_LR) { try { $Lr = [double]$env:VGC_TRAIN_LR } catch {} }

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$agentDir = Join-Path $repoRoot "apps/pokemon-showdown/vgc-demo/agent"
$orchDir = Join-Path $repoRoot "apps/pokemon-showdown/vgc-demo/orchestrator"

$pythonProc = $null

try {
  Write-Host "[vgc-train] Starting Python policy+trainer server..."
  Push-Location $agentDir
  if (-not (Test-Path ".venv")) {
    python -m venv .venv
  }
  & .\.venv\Scripts\python.exe -m pip install -r requirements.txt | Out-Host
  $pythonProc = Start-Process -FilePath ".\.venv\Scripts\python.exe" -ArgumentList "agent_server.py", "--host", "127.0.0.1", "--port", "$PythonPort" -PassThru
  Pop-Location

  Start-Sleep -Seconds 2

  Write-Host "[vgc-train] Running training loop (Ctrl+C to stop)..."
  Push-Location $orchDir
  npm install | Out-Host
  # NOTE: some npm versions treat unknown --flags as npm config. Use positional args.
  npm run train -- $Epochs $Format "http://127.0.0.1:$PythonPort" $Seed $SnapshotEvery $OpponentPool $Lr
  Pop-Location
}
finally {
  if ($pythonProc -and -not $pythonProc.HasExited) {
    Write-Host "[vgc-train] Stopping Python server (pid=$($pythonProc.Id))..."
    try { Stop-Process -Id $pythonProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
}
