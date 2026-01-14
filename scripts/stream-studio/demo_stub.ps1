param(
  [string]$BaseUrl = "http://127.0.0.1:8000",
  [switch]$IncludeVlm
)

$ErrorActionPreference = "Stop"

Write-Host "[demo_stub] POST /events" -ForegroundColor Cyan
$body = @{
  source = "stub"
  text = "縺薙ｓ縺ｫ縺｡縺ｯ・∽ｻ頑律縺ｮ驟堺ｿ｡縺ｮ謖ｨ諡ｶ繧堤洒縺上♀鬘倥＞縲・
  include_vlm = [bool]$IncludeVlm
} | ConvertTo-Json

$resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/events" -ContentType "application/json" -Body $body
$pendingId = $resp.pending_id
Write-Host "[demo_stub] pending_id=$pendingId" -ForegroundColor Green

Write-Host "[demo_stub] GET /manager/pending" -ForegroundColor Cyan
$pending = Invoke-RestMethod -Method Get -Uri "$BaseUrl/manager/pending"
$items = $pending.items
Write-Host "[demo_stub] pending count = $($items.Count)" -ForegroundColor Green

Write-Host "[demo_stub] POST /manager/approve (auto-approve latest)" -ForegroundColor Cyan
$approveBody = @{
  pending_id = $pendingId
  notes = "demo auto-approve"
} | ConvertTo-Json

$approved = Invoke-RestMethod -Method Post -Uri "$BaseUrl/manager/approve" -ContentType "application/json" -Body $approveBody

Write-Host "[demo_stub] DONE. overlay_path=$($approved.state.overlay_path) audio_path=$($approved.state.audio_path)" -ForegroundColor Green
Write-Host "[demo_stub] Check data/stream-studio/state.json and data/stream-studio/obs/overlay.txt" -ForegroundColor Green
