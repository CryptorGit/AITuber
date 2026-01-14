param(
  [string]$BaseUrl = 'http://127.0.0.1:8000',
  [string]$ImagePath = 'tests/image_test.jpg',
  [switch]$IncludeVlm,
  [switch]$StartServer
)

$ErrorActionPreference = 'Stop'

# Ensure Japanese text prints correctly on Windows terminals
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$logDir = 'data/stream-studio/logs'
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

function Stop-PortListeners {
  param([int]$Port)
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if (-not $conns) { return }
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
      if ($pid -and $pid -gt 0) {
        try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  } catch {}
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

function Invoke-JsonUtf8 {
  param(
    [Parameter(Mandatory=$true)][string]$Uri,
    [ValidateSet('Get','Post','Put','Patch','Delete')][string]$Method = 'Get',
    [string]$BodyJson,
    [int]$TimeoutSec = 15
  )

  $headers = @{ 'Accept' = 'application/json' }
  $args = @{
    Uri = $Uri
    Method = $Method
    Headers = $headers
    TimeoutSec = $TimeoutSec
    UseBasicParsing = $true
  }
  if ($PSBoundParameters.ContainsKey('BodyJson')) {
    $args['ContentType'] = 'application/json'
    $args['Body'] = $BodyJson
  }

  $resp = Invoke-WebRequest @args
  if (-not $resp) { return $null }

  try {
    if ($resp.RawContentStream) { $resp.RawContentStream.Position = 0 }
    $ms = New-Object System.IO.MemoryStream
    $resp.RawContentStream.CopyTo($ms)
    $bytes = $ms.ToArray()
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    if (-not $text) { return $null }
    return $text | ConvertFrom-Json
  } catch {
    # Fallback: let PowerShell parse it (may mojibake on PS 5.1)
    return $resp.Content | ConvertFrom-Json
  }
}

$serverProc = $null
if ($StartServer) {
  Write-Host '[smoke] starting server' -ForegroundColor Cyan

  Stop-PortListeners -Port 8000

  $serverLogDir = 'logs'
  New-Item -ItemType Directory -Force -Path $serverLogDir | Out-Null
  $serverLogBase = 'smoke_server_' + (Get-Date -Format 'yyyyMMdd_HHmmss')
  $serverOut = Join-Path $serverLogDir ($serverLogBase + '.out.log')
  $serverErr = Join-Path $serverLogDir ($serverLogBase + '.err.log')

  $serverProc = Start-Process -FilePath $py -ArgumentList @(
    '-m','uvicorn','server.main:app','--app-dir','apps/stream-studio','--host','127.0.0.1','--port','8000'
  ) -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr

  if (-not (Wait-Healthy -TimeoutSeconds 20)) {
    if ($serverProc -and -not $serverProc.HasExited) { Stop-Process -Id $serverProc.Id -Force }
    Write-Host ('[smoke] server logs: ' + $serverOut) -ForegroundColor Yellow
    Write-Host ('[smoke] server errs: ' + $serverErr) -ForegroundColor Yellow
    if (Test-Path $serverOut) {
      Write-Host '[smoke] last 60 log lines:' -ForegroundColor Yellow
      Get-Content -Path $serverOut -Tail 60 | ForEach-Object { Write-Host $_ }
    }
    if (Test-Path $serverErr) {
      Write-Host '[smoke] last 60 err lines:' -ForegroundColor Yellow
      Get-Content -Path $serverErr -Tail 60 | ForEach-Object { Write-Host $_ }
    }
    throw ('Server did not become healthy at ' + ($Base + '/health'))
  }
}

try {

Write-Host '[smoke] health' -ForegroundColor Cyan
$health = Invoke-JsonUtf8 -Uri ($Base + '/health')
$health | ConvertTo-Json

Write-Host '[smoke] diagnostics' -ForegroundColor Cyan
Invoke-JsonUtf8 -Uri ($Base + '/diagnostics') | ConvertTo-Json -Depth 6

Write-Host '[smoke] upsert long-term persona' -ForegroundColor Cyan
$persona = @{
  doc_id = 'persona'
  source = 'persona'
  text = 'You are a streaming assistant. Keep responses short and polite. Do not include personal data.'
} | ConvertTo-Json
Invoke-JsonUtf8 -Method Post -Uri ($Base + '/rag/long_term/upsert') -BodyJson $persona | ConvertTo-Json

if ($IncludeVlm) {
  if (-not (Test-Path $ImagePath)) {
    throw ('ImagePath not found: ' + $ImagePath)
  }

  Write-Host '[smoke] POST /vlm/summary_from_path' -ForegroundColor Cyan
  $vlmReq = @{ path = $ImagePath } | ConvertTo-Json
  Invoke-JsonUtf8 -Method Post -Uri ($Base + '/vlm/summary_from_path') -BodyJson $vlmReq | ConvertTo-Json -Depth 6
}

Write-Host '[smoke] POST /events (text + optional image)' -ForegroundColor Cyan
$event = @{
  source = 'stub'
  text = 'Create a short greeting for the stream and a shorter overlay subtitle.'
  include_vlm = [bool]$IncludeVlm
  vlm_image_path = $(if ($IncludeVlm) { $ImagePath } else { $null })
} | ConvertTo-Json

$resp = Invoke-JsonUtf8 -Method Post -Uri ($Base + '/events') -BodyJson $event
$resp | ConvertTo-Json -Depth 6
$pendingId = $resp.pending_id

Write-Host '[smoke] GET /manager/pending' -ForegroundColor Cyan
Invoke-JsonUtf8 -Uri ($Base + '/manager/pending') | ConvertTo-Json -Depth 6

Write-Host '[smoke] POST /manager/approve' -ForegroundColor Cyan
$approve = @{
  pending_id = $pendingId
  notes = 'smoke'
} | ConvertTo-Json
$approved = Invoke-JsonUtf8 -Method Post -Uri ($Base + '/manager/approve') -BodyJson $approve
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
Invoke-JsonUtf8 -Uri ($Base + '/state') | ConvertTo-Json -Depth 6

} finally {
  if ($serverProc -and -not $serverProc.HasExited) {
    Write-Host ('[smoke] stopping server pid=' + $serverProc.Id) -ForegroundColor Cyan
    Stop-Process -Id $serverProc.Id -Force
  }

  Stop-Transcript | Out-Null
}
