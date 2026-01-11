param(
  [string]$HostUrl = "http://127.0.0.1:8000",
  [int]$TimeoutSec = 5
)

$ErrorActionPreference = "Stop"

$port = 8000
$c = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" } | Select-Object -First 1
if ($c) {
  Write-Output ("LISTEN_" + $port + " pid=" + $c.OwningProcess)
} else {
  Write-Output ("NO_LISTENER_" + $port)
}

try {
  $resp = Invoke-WebRequest -UseBasicParsing -Uri ($HostUrl.TrimEnd('/') + "/health") -TimeoutSec $TimeoutSec
  Write-Output ("HEALTH_HTTP=" + $resp.StatusCode)
  Write-Output $resp.Content
} catch {
  Write-Output ("HEALTH_ERROR=" + $_.Exception.Message)
  exit 1
}
