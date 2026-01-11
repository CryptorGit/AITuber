param(
  [int]$Battles = 20,
  [string]$Format = "gen9vgc2026regf",
  [int]$PythonPort = 8099
)

# Allow env vars to override defaults (without requiring explicit parameters).
# This matches the demo docs/usage where callers often do: $env:VGC_DEMO_BATTLES='5'; ./scripts/run_ps_vgc_demo.ps1
if (-not $PSBoundParameters.ContainsKey('Battles') -and $env:VGC_DEMO_BATTLES) {
  try { $Battles = [int]$env:VGC_DEMO_BATTLES } catch {}
}
if (-not $PSBoundParameters.ContainsKey('Format') -and $env:VGC_DEMO_FORMAT) {
  $Format = [string]$env:VGC_DEMO_FORMAT
}
if (-not $PSBoundParameters.ContainsKey('PythonPort')) {
  if ($env:VGC_DEMO_PY_PORT) {
    try { $PythonPort = [int]$env:VGC_DEMO_PY_PORT } catch {}
  } elseif ($env:VGC_DEMO_PYTHON_PORT) {
    try { $PythonPort = [int]$env:VGC_DEMO_PYTHON_PORT } catch {}
  }
}

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$agentDir = Join-Path $repoRoot "apps/pokemon-showdown/vgc-demo/agent"
$orchDir = Join-Path $repoRoot "apps/pokemon-showdown/vgc-demo/orchestrator"

$pythonProc = $null

try {
  Write-Host "[vgc-demo] Starting Python policy server..."
  Push-Location $agentDir
  if (-not (Test-Path ".venv")) {
    python -m venv .venv
  }
  & .\.venv\Scripts\python.exe -m pip install -r requirements.txt | Out-Host
  $pythonProc = Start-Process -FilePath ".\.venv\Scripts\python.exe" -ArgumentList "agent_server.py", "--host", "127.0.0.1", "--port", "$PythonPort" -PassThru
  Pop-Location

  Start-Sleep -Seconds 2

  Write-Host "[vgc-demo] Running Node orchestrator ($Battles battles)..."
  Push-Location $orchDir
  npm install | Out-Host
  # NOTE: some npm versions treat unknown --flags as npm config. Use positional args.
  npm run demo -- $Battles $Format heuristic heuristic "http://127.0.0.1:$PythonPort"
  Pop-Location
}
finally {
  if ($pythonProc -and -not $pythonProc.HasExited) {
    Write-Host "[vgc-demo] Stopping Python policy server (pid=$($pythonProc.Id))..."
    try { Stop-Process -Id $pythonProc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
}
