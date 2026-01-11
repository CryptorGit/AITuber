param(
  [string]$BattleId,
  [string]$ServerBase = "http://127.0.0.1:8787",
  [int]$TimeoutSec = 900
)

$ErrorActionPreference = "Stop"

if (-not $BattleId) {
  throw "BattleId is required"
}

function Get-Status {
  param([string]$BattleId)
  $u = $ServerBase.TrimEnd('/') + "/api/export/status?battle_id=" + [uri]::EscapeDataString($BattleId)
  return (Invoke-RestMethod -Uri $u -Method GET)
}

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$final = $null
$lastLine = $null

while ((Get-Date) -lt $deadline) {
  $st = Get-Status -BattleId $BattleId
  $status = [string]$st.status
  $progress = [string]$st.progress
  $msg = [string]$st.message

  $line = (Get-Date -Format "HH:mm:ss") + " status=" + $status + " progress=" + $progress + " msg=" + $msg
  if ($line -ne $lastLine) {
    Write-Output $line
    $lastLine = $line
  }

  if ($status -eq "done" -or $status -eq "failed") {
    $final = $st
    break
  }

  Start-Sleep -Seconds 10
}

if (-not $final) {
  throw "export timeout after ${TimeoutSec}s"
}

if ($final.status -ne "done") {
  throw ("export failed: " + $final.message)
}

Write-Output ("output_mp4=" + $final.output_mp4)
if (-not (Test-Path $final.output_mp4)) {
  throw ("output file not found: " + $final.output_mp4)
}

$ffprobe = "C:\Users\crypt\source\repos\CryptorGit\AITuber\tools\ffmpeg\bin\ffprobe.exe"
if (Test-Path $ffprobe) {
  $dims = & $ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x $final.output_mp4
  Write-Output ("ffprobe.dims=" + $dims)
  if ($dims -ne "642x362") {
    throw ("unexpected dims (expected 642x362): " + $dims)
  }
} else {
  Write-Output "ffprobe not found; skipped dimension check"
}

Write-Output "OK"
