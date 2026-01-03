param(
  [string]$BaseUrl = 'http://127.0.0.1:8000',
  [string]$ImagePath = 'tests/image_test.jpg',
  [switch]$IncludeVlm,
  [switch]$StartServer
)

$ErrorActionPreference = 'Stop'

$logDir = 'data/logs'
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}
$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
$logPath = Join-Path $logDir ("smoke_api_" + $ts + ".log")
Start-Transcript -Path $logPath -Append | Out-Null

$Base = ($BaseUrl.TrimEnd('/'))

if (-not $PSBoundParameters.ContainsKey('StartServer')) {
  $StartServer = $true
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$py = '.\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
  throw '.venv not found. Run .\\scripts\\run_dev.ps1 first.'
}

function Wait-Healthy {
  param([int]$TimeoutSeconds = 15)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $h = Invoke-RestMethod ($Base + '/health') -TimeoutSec 2
      if ($h.ok) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 400
  }
  return $false
}

$serverProc = $null
if ($StartServer) {
  Write-Host '[smoke] starting server' -ForegroundColor Cyan
  $serverProc = Start-Process -FilePath $py -ArgumentList @(
    '-m','uvicorn','apps.server.main:app','--host','127.0.0.1','--port','8000'
  ) -PassThru -WindowStyle Hidden

  if (-not (Wait-Healthy -TimeoutSeconds 20)) {
    if ($serverProc -and -not $serverProc.HasExited) { Stop-Process -Id $serverProc.Id -Force }
    throw ('Server did not become healthy at ' + ($Base + '/health'))
  }
}

try {

Write-Host '[smoke] health' -ForegroundColor Cyan
$health = Invoke-RestMethod ($Base + '/health')
$health | ConvertTo-Json

Write-Host '[smoke] diagnostics' -ForegroundColor Cyan
Invoke-RestMethod ($Base + '/diagnostics') | ConvertTo-Json -Depth 6

Write-Host '[smoke] upsert long-term persona' -ForegroundColor Cyan
$persona = @{
  doc_id = 'persona'
  source = 'persona'
  text = 'You are a streaming assistant. Keep responses short and polite. Do not include personal data.'
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri ($Base + '/rag/long_term/upsert') -ContentType 'application/json' -Body $persona | ConvertTo-Json

if ($IncludeVlm) {
  if (-not (Test-Path $ImagePath)) {
    throw ('ImagePath not found: ' + $ImagePath)
  }

  Write-Host '[smoke] POST /vlm/summary_from_path' -ForegroundColor Cyan
  $vlmReq = @{ path = $ImagePath } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri ($Base + '/vlm/summary_from_path') -ContentType 'application/json' -Body $vlmReq | ConvertTo-Json -Depth 6
}

Write-Host '[smoke] POST /events (text + optional image)' -ForegroundColor Cyan
$event = @{
  source = 'stub'
  text = 'Create a short greeting for the stream and a shorter overlay subtitle.'
  include_vlm = [bool]$IncludeVlm
  vlm_image_path = $(if ($IncludeVlm) { $ImagePath } else { $null })
} | ConvertTo-Json

$resp = Invoke-RestMethod -Method Post -Uri ($Base + '/events') -ContentType 'application/json' -Body $event
$resp | ConvertTo-Json -Depth 6
$pendingId = $resp.pending_id

Write-Host '[smoke] GET /manager/pending' -ForegroundColor Cyan
Invoke-RestMethod ($Base + '/manager/pending') | ConvertTo-Json -Depth 6

Write-Host '[smoke] POST /manager/approve' -ForegroundColor Cyan
$approve = @{
  pending_id = $pendingId
  notes = 'smoke'
} | ConvertTo-Json
$approved = Invoke-RestMethod -Method Post -Uri ($Base + '/manager/approve') -ContentType 'application/json' -Body $approve
$approved | ConvertTo-Json -Depth 8

$overlayPath = $approved.state.overlay_path
$audioPath = $approved.state.audio_path

Write-Host '[smoke] overlay file' -ForegroundColor Cyan
Write-Host ('overlay_path=' + $overlayPath) -ForegroundColor Green
if (Test-Path $overlayPath) {
  Get-Content $overlayPath
} else {
  Write-Host 'overlay file not found' -ForegroundColor Yellow
}

Write-Host '[smoke] audio file' -ForegroundColor Cyan
Write-Host ('audio_path=' + $audioPath) -ForegroundColor Green
if (Test-Path $audioPath) {
  $len = (Get-Item $audioPath).Length
  Write-Host ('audio bytes=' + $len) -ForegroundColor Green
} else {
  Write-Host 'audio file not found' -ForegroundColor Yellow
}

Write-Host '[smoke] state' -ForegroundColor Cyan
Invoke-RestMethod ($Base + '/state') | ConvertTo-Json -Depth 6

} finally {
  if ($serverProc -and -not $serverProc.HasExited) {
    Write-Host ('[smoke] stopping server pid=' + $serverProc.Id) -ForegroundColor Cyan
    Stop-Process -Id $serverProc.Id -Force
  }

  Stop-Transcript | Out-Null
}
