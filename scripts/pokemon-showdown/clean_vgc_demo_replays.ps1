param(
  [switch]$KeepAssets,
  # Also remove learned models / PPO snapshots / run logs so training can restart from a clean slate.
  [switch]$WipeModels
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dataRoot = Join-Path $repoRoot 'data\pokemon-showdown\vgc-demo'

if (-not (Test-Path $dataRoot)) {
  Write-Host "[clean] data root missing: $dataRoot"
  exit 0
}

Write-Host "[clean] dataRoot=$dataRoot"

# Remove training run dirs (train_*)
Get-ChildItem -Path $dataRoot -Directory -Filter 'train_*' -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "[clean] rm dir: $($_.FullName)"
  Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue
}

# Remove index + generated artifacts (keeps snapshots by default)
$paths = @(
  (Join-Path $dataRoot 'index.json'),
  (Join-Path $dataRoot 'generated_logs'),
  (Join-Path $dataRoot 'exports')
)

foreach ($p in $paths) {
  if (Test-Path $p) {
    Write-Host "[clean] rm: $p"
    Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
  }
}

if ($WipeModels) {
  Write-Host "[clean] WIPE_MODELS enabled: removing models/snapshots/logs"

  $wipePaths = @(
    # Per-run + index-ish
    (Join-Path $dataRoot '_match_counter.json'),
    (Join-Path $dataRoot 'battles.jsonl'),
    (Join-Path $dataRoot 'errors.jsonl'),
    (Join-Path $dataRoot 'debug.jsonl'),
    (Join-Path $dataRoot 'summary.json'),
    (Join-Path $dataRoot 'trajectories.jsonl'),
    (Join-Path $dataRoot 'trajectories.jsonl.gz'),
    (Join-Path $dataRoot 'replays.jsonl'),
    (Join-Path $dataRoot 'replays.jsonl.gz'),
    (Join-Path $dataRoot 'batches.jsonl'),

    # Training artifacts
    (Join-Path $dataRoot 'logs'),
    (Join-Path $dataRoot 'models'),
    (Join-Path $dataRoot 'ppo_snapshots'),
    (Join-Path $dataRoot 'snapshots'),
    (Join-Path $dataRoot 'snapshots_e2e'),
    (Join-Path $dataRoot 'experiments')
  )

  foreach ($p in $wipePaths) {
    if (Test-Path $p) {
      Write-Host "[clean] rm: $p"
      Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
    }
  }
} else {
  Write-Host "[clean] keeping models/snapshots/logs (pass -WipeModels to remove)"
}

if (-not $KeepAssets) {
  $psAssets = Join-Path $dataRoot 'ps_assets'
  if (Test-Path $psAssets) {
    Write-Host "[clean] rm: $psAssets"
    Remove-Item -Recurse -Force $psAssets -ErrorAction SilentlyContinue
  }
} else {
  Write-Host "[clean] keeping ps_assets (KeepAssets)"
}

Write-Host "[clean] done"
