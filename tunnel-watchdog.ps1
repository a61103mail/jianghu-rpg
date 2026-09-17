# Cloudflare Tunnel 監控守護程式:
# - 每 30 秒健康檢查一次目前通道網址是否正常回應
# - 通道行程意外結束、健康檢查失敗、或運行超過 90 分鐘(搶在官方強制斷線前)就自動重開一個新通道
# - 同時也監控後端(3002埠)是否還活著,死了就自動重啟 npm run dev
# - 目前有效的通道網址永遠寫在 tunnel-url.txt,隨時可以打開這個檔案查看最新網址
$ErrorActionPreference = 'SilentlyContinue'
$cloudflaredPath = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
$repoRoot = "C:\Users\v-tslee\Desktop\jianghu-rpg"
$urlFile = Join-Path $repoRoot "tunnel-url.txt"
$logFile = Join-Path $repoRoot "tunnel-watchdog.log"
$maxTunnelAgeMinutes = 90
$checkIntervalSeconds = 30

function Write-Log($msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Write-Output $line
  Add-Content -Path $logFile -Value $line
}

function Test-BackendAlive {
  try {
    $r = Invoke-RestMethod -Uri "http://localhost:3002/api/game/classes" -Method Get -TimeoutSec 8
    return $true
  } catch { return $false }
}

function Start-Backend {
  Write-Log "後端未回應,重新啟動 npm run dev..."
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c","cd /d `"$repoRoot\server`" && npm run dev" -WindowStyle Hidden
  Start-Sleep -Seconds 8
}

function Start-NewTunnel {
  $tunnelLog = [System.IO.Path]::GetTempFileName()
  $proc = Start-Process -FilePath $cloudflaredPath -ArgumentList "tunnel","--url","http://localhost:3002" -RedirectStandardError $tunnelLog -PassThru -WindowStyle Hidden
  $url = $null
  $attempts = 0
  while (-not $url -and $attempts -lt 30) {
    Start-Sleep -Seconds 1
    $content = Get-Content $tunnelLog -Raw
    # cloudflared 內部有時會在日誌中提到 https://api.trycloudflare.com(呼叫其後端API的網址,不是真正的通道網址)。
    # 真正的快速通道網址一定是「多個單字用連字號相連」的隨機字串(例如 thats-hair-basic-designing),
    # 要求至少一個連字號,才不會誤抓到 api.trycloudflare.com 這種固定保留字。
    if ($content -match 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com') { $url = $matches[0] }
    $attempts++
  }
  return [PSCustomObject]@{ Process = $proc; Url = $url; LogFile = $tunnelLog; StartTime = Get-Date }
}

if (-not (Test-BackendAlive)) { Start-Backend }
Write-Log "守護程式啟動,建立第一個通道..."
$tunnel = Start-NewTunnel
if ($tunnel.Url) {
  $tunnel.Url | Out-File -FilePath $urlFile -Encoding utf8 -NoNewline
  Write-Log "目前通道網址: $($tunnel.Url)"
} else {
  Write-Log "警告:未能取得通道網址,30秒後重試"
}

while ($true) {
  Start-Sleep -Seconds $checkIntervalSeconds

  if (-not (Test-BackendAlive)) {
    Start-Backend
  }

  $needsRestart = $false
  $ageMinutes = if ($tunnel.StartTime) { ((Get-Date) - $tunnel.StartTime).TotalMinutes } else { 999 }

  if (-not $tunnel.Process -or $tunnel.Process.HasExited) {
    Write-Log "通道行程已結束,準備重啟..."
    $needsRestart = $true
  } elseif ($ageMinutes -gt $maxTunnelAgeMinutes) {
    Write-Log "通道已運行 $([math]::Round($ageMinutes)) 分鐘,主動更新避免被官方強制斷線..."
    $needsRestart = $true
  } elseif ($tunnel.Url) {
    try {
      $r = Invoke-WebRequest -Uri "$($tunnel.Url)/api/game/classes" -UseBasicParsing -TimeoutSec 10
      if ($r.StatusCode -ne 200) { $needsRestart = $true }
    } catch {
      Write-Log "通道健康檢查失敗($_),準備重啟..."
      $needsRestart = $true
    }
  } else {
    $needsRestart = $true
  }

  if ($needsRestart) {
    if ($tunnel.Process -and -not $tunnel.Process.HasExited) {
      Stop-Process -Id $tunnel.Process.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    $tunnel = Start-NewTunnel
    if ($tunnel.Url) {
      $tunnel.Url | Out-File -FilePath $urlFile -Encoding utf8 -NoNewline
      Write-Log "新通道網址: $($tunnel.Url)"
    } else {
      Write-Log "警告:未能取得新通道網址,將於下個週期重試"
    }
  }
}
