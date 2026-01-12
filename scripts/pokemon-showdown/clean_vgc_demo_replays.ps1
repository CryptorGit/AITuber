param(
  [switch]$KeepAssets
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
